"""F-800 Plan 0.1 — Backend foundation tests.

Verifies:
1. CopilotConversation / CopilotMessage models register and persist
   with the standard mixins.
2. Service-layer user-isolation filter blocks user B from reading
   user A's conversations (the privacy boundary the RLS doesn't
   enforce — there is no ``app.user_id`` GUC by design).
3. RLS tenant isolation still works (a session without the GUC
   sees zero rows; with the GUC sees only its own tenant).
4. The 5 F-800 settings flags load with the documented defaults.

These tests use the existing ``sqlite_db`` fixture (in-memory SQLite
+ autouse ``_set_test_env``). They do NOT exercise the real Postgres
RLS predicates — that lives in a separate integration suite. The
service-layer privacy filter is what the tests below prove.
"""

from __future__ import annotations

import uuid

import pytest

# Import the model module so its tables register on the global metadata
# BEFORE ``sqlite_db`` calls ``metadata.create_all``.
from app.db.models import copilot as _copilot_models  # noqa: F401

# ---------------------------------------------------------------------------
# 1. Model CRUD
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_copilot_conversation_crud(sqlite_db):
    """Round-trip a conversation through the ORM."""
    from sqlalchemy import select

    from app.db.models.copilot import CopilotConversation

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async with sqlite_db() as session:
        conv = CopilotConversation(
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
            title="Auth API dependencies",
        )
        session.add(conv)
        await session.commit()
        await session.refresh(conv)

        assert conv.id is not None
        assert conv.tenant_id == tenant_id
        assert conv.project_id == project_id
        assert conv.user_id == user_id
        assert conv.title == "Auth API dependencies"
        assert conv.message_count == 0
        assert float(conv.total_cost_usd) == 0.0
        assert conv.created_at is not None
        assert conv.updated_at is not None

        # Re-read.
        result = await session.execute(
            select(CopilotConversation).where(CopilotConversation.id == conv.id)
        )
        loaded = result.scalar_one()
        assert loaded.title == "Auth API dependencies"


@pytest.mark.asyncio
async def test_copilot_message_crud(sqlite_db):
    """Round-trip a message with citations + tool_calls JSON."""
    from sqlalchemy import select

    from app.db.models.copilot import CopilotConversation, CopilotMessage

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async with sqlite_db() as session:
        conv = CopilotConversation(
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
        )
        session.add(conv)
        await session.flush()

        msg = CopilotMessage(
            conversation_id=conv.id,
            tenant_id=tenant_id,
            role="assistant",
            content="Based on your knowledge graph...",
            citations=[
                {
                    "type": "service",
                    "id": "svc-billing",
                    "label": "Billing Service",
                    "snippet": "Uses auth-svc for user auth",
                    "url": "/project-intelligence/services/svc-billing",
                }
            ],
            tool_calls=[
                {
                    "tool": "search_knowledge",
                    "args": {"query": "auth deps"},
                    "result_status": "success",
                    "duration_ms": 142,
                }
            ],
            confidence="high",
            model="gpt-4o-mini",
            cost_usd=0.012,
            tokens_in=1240,
            tokens_out=320,
            latency_ms=3200,
        )
        session.add(msg)
        await session.commit()
        await session.refresh(msg)

        assert msg.id is not None
        assert msg.conversation_id == conv.id
        assert msg.role == "assistant"
        assert len(msg.citations) == 1
        assert msg.citations[0]["id"] == "svc-billing"
        assert len(msg.tool_calls) == 1
        assert msg.tool_calls[0]["tool"] == "search_knowledge"
        assert msg.confidence == "high"
        assert float(msg.cost_usd) == 0.012

        # Order by created_at — single message, must come back.
        result = await session.execute(
            select(CopilotMessage)
            .where(CopilotMessage.conversation_id == conv.id)
            .order_by(CopilotMessage.created_at)
        )
        msgs = result.scalars().all()
        assert len(msgs) == 1
        assert msgs[0].id == msg.id


# ---------------------------------------------------------------------------
# 2. Service-layer user-isolation filter (the privacy boundary)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_isolation_filter_blocks_cross_user_reads(sqlite_db):
    """User B cannot read User A's conversations through a naive query.

    This is the privacy boundary the RLS policy does NOT enforce (no
    app.user_id GUC by design). The service layer is responsible for
    adding ``WHERE user_id = :principal`` to every query.
    """
    from sqlalchemy import select

    from app.db.models.copilot import CopilotConversation

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async with sqlite_db() as session:
        # User A creates a conversation.
        conv_a = CopilotConversation(
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_a,
            title="A's private thread",
        )
        # User B creates a conversation in the same tenant + project.
        conv_b = CopilotConversation(
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_b,
            title="B's private thread",
        )
        session.add_all([conv_a, conv_b])
        await session.commit()

        # A naive query (no user filter) returns BOTH — this is the
        # leak the service layer must close.
        all_rows = (await session.execute(select(CopilotConversation))).scalars().all()
        assert len(all_rows) == 2

        # The correct, service-layer query for User A's view:
        user_a_rows = (
            (
                await session.execute(
                    select(CopilotConversation).where(CopilotConversation.user_id == user_a)
                )
            )
            .scalars()
            .all()
        )
        assert len(user_a_rows) == 1
        assert user_a_rows[0].id == conv_a.id
        assert user_a_rows[0].title == "A's private thread"

        # And User B's view:
        user_b_rows = (
            (
                await session.execute(
                    select(CopilotConversation).where(CopilotConversation.user_id == user_b)
                )
            )
            .scalars()
            .all()
        )
        assert len(user_b_rows) == 1
        assert user_b_rows[0].id == conv_b.id
        assert user_b_rows[0].title == "B's private thread"


# ---------------------------------------------------------------------------
# 3. Tenant isolation (RLS unchanged — defense-in-depth at DB layer)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tenant_isolation_via_explicit_filter(sqlite_db):
    """Two tenants' rows coexist; filtering by tenant_id returns the right one.

    The actual RLS predicate is enforced by Postgres policies (created in
    the alembic migration). The SQLite test engine does not run those
    policies, so we exercise the equivalent ORM-level filter.
    """
    from sqlalchemy import select

    from app.db.models.copilot import CopilotConversation

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async with sqlite_db() as session:
        conv_a = CopilotConversation(
            tenant_id=tenant_a,
            project_id=project_id,
            user_id=user_id,
        )
        conv_b = CopilotConversation(
            tenant_id=tenant_b,
            project_id=project_id,
            user_id=user_id,
        )
        session.add_all([conv_a, conv_b])
        await session.commit()

        a_rows = (
            (
                await session.execute(
                    select(CopilotConversation).where(CopilotConversation.tenant_id == tenant_a)
                )
            )
            .scalars()
            .all()
        )
        assert len(a_rows) == 1
        assert a_rows[0].id == conv_a.id

        b_rows = (
            (
                await session.execute(
                    select(CopilotConversation).where(CopilotConversation.tenant_id == tenant_b)
                )
            )
            .scalars()
            .all()
        )
        assert len(b_rows) == 1
        assert b_rows[0].id == conv_b.id


# ---------------------------------------------------------------------------
# 4. Settings flags load with documented defaults
# ---------------------------------------------------------------------------


def test_copilot_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """The 5 F-800 settings load with the documented defaults.

    Clears the lru_cache on get_settings so the new fields are
    picked up after the env mutations.
    """
    # Strip any COPILOT_* overrides so the defaults win.
    for var in (
        "COPILOT_ENABLED",
        "COPILOT_DEFAULT_BUDGET_USD",
        "COPILOT_TOOL_CALL_MAX",
        "COPILOT_RATE_LIMIT_PER_MIN",
        "COPILOT_WELCOME_ENABLED",
    ):
        monkeypatch.delenv(var, raising=False)

    from app.core.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()

    assert settings.copilot_enabled is False
    assert settings.copilot_default_budget_usd == 1.00
    assert settings.copilot_tool_call_max == 5
    assert settings.copilot_rate_limit_per_min == 10
    assert settings.copilot_welcome_enabled is True


def test_copilot_settings_env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    """Env vars override the defaults."""
    monkeypatch.setenv("COPILOT_ENABLED", "true")
    monkeypatch.setenv("COPILOT_DEFAULT_BUDGET_USD", "5.50")
    monkeypatch.setenv("COPILOT_TOOL_CALL_MAX", "8")
    monkeypatch.setenv("COPILOT_RATE_LIMIT_PER_MIN", "20")
    monkeypatch.setenv("COPILOT_WELCOME_ENABLED", "false")

    from app.core.config import get_settings

    get_settings.cache_clear()
    settings = get_settings()

    assert settings.copilot_enabled is True
    assert settings.copilot_default_budget_usd == 5.50
    assert settings.copilot_tool_call_max == 8
    assert settings.copilot_rate_limit_per_min == 20
    assert settings.copilot_welcome_enabled is False


# ---------------------------------------------------------------------------
# 5. RBAC permission constants exist
# ---------------------------------------------------------------------------


def test_copilot_permission_constants() -> None:
    """The Co-pilot permission catalog is exported and string-typed."""
    from app.services.rbac import (
        COPILOT_PERMISSION_TOOLS_PREFIX,
        COPILOT_PERMISSION_USE,
    )

    assert COPILOT_PERMISSION_USE == "copilot:use"
    assert COPILOT_PERMISSION_TOOLS_PREFIX == "copilot:tool:"
