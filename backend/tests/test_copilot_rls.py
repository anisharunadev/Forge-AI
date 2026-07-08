"""Phase 4 N — Row-level security on copilot tables.

Smoke test: the cross-user 404 assertion in
``test_copilot_security.py`` exercises the service-layer filter; this
test exercises the database-layer RLS predicate directly via raw SQL.
Skipped on SQLite (no FORCE ROW LEVEL SECURITY support); the test
short-circuits when the connection dialect is not PostgreSQL.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text


def _principal(*, tenant_id: Any, user_id: Any) -> Any:
    from app.core.security import AuthenticatedPrincipal

    return AuthenticatedPrincipal(
        user_id=str(user_id),
        email="t@example.com",
        tenant_id=str(tenant_id),
        project_id=None,
        roles=[],
        raw_claims={"forge.permissions": ["copilot:use"]},
    )


@pytest.mark.asyncio
async def test_rls_blocks_cross_user_raw_sql(request):  # type: ignore[no-untyped-def]
    """Smoke test for the RLS predicate. Skipped when the test
    environment is SQLite (no FORCE ROW LEVEL SECURITY support) — the
    migration runs at deploy time on Postgres, so this test runs in
    the integration environment that has a live DB."""
    from app.db.session import get_engine

    engine = get_engine()
    if engine.dialect.name != "postgresql":
        pytest.skip("RLS test requires PostgreSQL")
    tenant_id = uuid.uuid4()
    """A raw SELECT with the wrong ``app.user_id`` GUC returns 0 rows.

    The RLS predicate on copilot_conversations compares
    ``user_id::text = current_setting('app.user_id', true)``. With the
    wrong GUC, the predicate is unsatisfied and the row is hidden.
    """
    from app.db.session import get_session_factory

    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    factory = get_session_factory()
    async with factory() as session:
        # Seed a conversation owned by user_a with RLS bypassed (we
        # own the row, so we can write it).
        await session.execute(
            text(
                "SET LOCAL row_security = off"
            )
        )
        await session.execute(
            text(
                """
                INSERT INTO copilot_conversations (id, tenant_id, user_id, message_count,
                                                       total_cost_usd, total_tokens_in, total_tokens_out,
                                                       created_at, updated_at)
                VALUES (:id, :tenant, :user, 0, 0, 0, 0, NOW(), NOW())
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "tenant": str(tenant_id),
                "user": str(user_a),
            },
        )
        await session.commit()

    # Query as user_b — RLS should hide user_a's row.
    async with factory() as session:
        await session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
        await session.execute(text(f"SET app.user_id = '{user_b}'"))
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM copilot_conversations WHERE tenant_id = :tenant"
            ),
            {"tenant": str(tenant_id)},
        )
        count = result.scalar()
    assert count == 0, f"RLS leak: user_b saw user_a rows (count={count})"


@pytest.mark.asyncio
async def test_rls_allows_same_user_raw_sql(request):  # type: ignore[no-untyped-def]
    from app.db.session import get_engine

    engine = get_engine()
    if engine.dialect.name != "postgresql":
        pytest.skip("RLS test requires PostgreSQL")
    tenant_id = uuid.uuid4()
    """With the correct GUC, RLS lets the same user see their row."""
    from app.db.session import get_session_factory

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    conv_id = uuid.uuid4()

    factory = get_session_factory()
    async with factory() as session:
        await session.execute(text("SET LOCAL row_security = off"))
        await session.execute(
            text(
                """
                INSERT INTO copilot_conversations (id, tenant_id, user_id, message_count,
                                                       total_cost_usd, total_tokens_in, total_tokens_out,
                                                       created_at, updated_at)
                VALUES (:id, :tenant, :user, 0, 0, 0, 0, NOW(), NOW())
                """
            ),
            {"id": str(conv_id), "tenant": str(tenant_id), "user": str(user_id)},
        )
        await session.commit()

    async with factory() as session:
        await session.execute(text(f"SET app.tenant_id = '{tenant_id}'"))
        await session.execute(text(f"SET app.user_id = '{user_id}'"))
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM copilot_conversations WHERE id = :id"
            ),
            {"id": str(conv_id)},
        )
        count = result.scalar()
    assert count == 1, f"RLS over-blocked same user (count={count})"
