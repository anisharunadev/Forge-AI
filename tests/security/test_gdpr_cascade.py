"""Phase 8 SC-8.3 - GDPR cascade executor test.

Seeds a tenant with rows in each affected table, runs the cascade,
and asserts the per-table counts match expectations:

- delete-mode tables: 0 rows remaining for the tenant.
- anonymize-mode tables: rows remain, but PII columns are NULL.
"""

from __future__ import annotations

import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[2] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import pytest
from sqlalchemy import text

from app.db.session import get_session_factory
from app.services.gdpr_cascade import gdpr_cascade_executor


async def _count(sqlite_db, sql: str, **params) -> int:
    factory = sqlite_db if not hasattr(sqlite_db, "__call__") else sqlite_db
    if hasattr(sqlite_db, "__call__"):
        # sqlite_db is a session_factory
        async with sqlite_db() as session:
            row = await session.execute(text(sql), params)
            return int(row.scalar() or 0)
    async with get_session_factory()() as session:
        row = await session.execute(text(sql), params)
        return int(row.scalar() or 0)


@pytest.mark.asyncio
async def test_gdpr_cascade_removes_tenant_rows(sqlite_db):
    """Seed a tenant, run cascade, assert delete-mode rows are gone,
    anonymize-mode rows remain with PII columns nulled.

    Uses an explicit set of tables that are guaranteed to exist in
    SQLite via the sqlite_db fixture's metadata.create_all pass.
    """
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()

    # --- Seed: every table that the cascade touches. ---
    factory = sqlite_db
    async with factory() as session:
        # users (keycloak_sub is unique + required)
        await session.execute(
            text(
                "INSERT INTO users (id, tenant_id, keycloak_sub, email, display_name, mfa_enabled, role_ids, profile, created_at, updated_at) "
                "VALUES (:id, :tid, :kc, :email, :name, false, '[]', '{}', :ts, :ts)"
            ),
            {"id": str(user_id), "tid": str(tenant_id),
             "kc": f"kc-{user_id}", "email": "u@x.com",
             "name": "u", "ts": datetime.now(UTC)},
        )
        # kg_nodes (the cascade deletes on tenant_id directly)
        await session.execute(
            text(
                "INSERT INTO kg_nodes (id, tenant_id, project_id, node_type, name, properties, created_at, updated_at) "
                "VALUES (:id, :tid, :pid, 'code', 'n1', '{}', :ts, :ts)"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tenant_id),
             "pid": str(project_id), "ts": datetime.now(UTC)},
        )
        # kg_edges (FK to kg_nodes via source_id)
        # cost_entries (anonymize) - needs recorded_at per model.
        await session.execute(
            text(
                "INSERT INTO cost_entries (id, tenant_id, project_id, source, model, prompt_tokens, completion_tokens, cost_usd, projected, agent, recorded_at, metadata, created_at, updated_at) "
                "VALUES (:id, :tid, :pid, 'litellm', 'm', 0, 0, 0.01, false, 'a', :ts, '{}', :ts, :ts)"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tenant_id),
             "pid": str(project_id), "ts": datetime.now(UTC)},
        )
        # audit_events (anonymize) - actor_id, payload, occurred_at are the real columns.
        await session.execute(
            text(
                "INSERT INTO audit_events (id, tenant_id, project_id, actor_id, action, target_type, target_id, payload, occurred_at) "
                "VALUES (:id, :tid, :pid, :actor, 'test.event', 'test', 'tgt-1', '{}', :ts)"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tenant_id),
             "pid": str(project_id), "actor": str(user_id),
             "ts": datetime.now(UTC)},
        )
        await session.commit()

    # Pre-cascade counts
    users_before = await _count(sqlite_db, "SELECT count(*) FROM users WHERE tenant_id = :tid",
                                tid=str(tenant_id))
    kg_before = await _count(sqlite_db, "SELECT count(*) FROM kg_nodes WHERE tenant_id = :tid",
                             tid=str(tenant_id))
    cost_before = await _count(sqlite_db, "SELECT count(*) FROM cost_entries WHERE tenant_id = :tid",
                               tid=str(tenant_id))
    audit_before = await _count(sqlite_db, "SELECT count(*) FROM audit_events WHERE tenant_id = :tid",
                                tid=str(tenant_id))
    assert users_before == 1
    assert kg_before == 1
    assert cost_before == 1
    assert audit_before == 1

    # --- Run the cascade. ---
    async with factory() as session:
        result = await gdpr_cascade_executor.run(session, tenant_id=tenant_id)
    # Errors are expected for tables not present in the SQLite test schema;
    # production (Postgres) has them all. The test cares that users and
    # kg_nodes (the two we seeded) are deleted.
    seeded_table_errors = [e for e in result.errors if e.startswith("users:") or e.startswith("kg_nodes:")]
    assert seeded_table_errors == [], f"seeded-table errors: {seeded_table_errors}"
    assert result.deleted.get("users", 0) == 1
    assert result.deleted.get("kg_nodes", 0) == 1
    # Anonymize-mode rows still present.
    cost_after = await _count(sqlite_db, "SELECT count(*) FROM cost_entries WHERE tenant_id = :tid",
                              tid=str(tenant_id))
    audit_after = await _count(sqlite_db, "SELECT count(*) FROM audit_events WHERE tenant_id = :tid",
                               tid=str(tenant_id))
    assert cost_after == 1, "cost_entries must remain (anonymized)"
    assert audit_after == 1, "audit_events must remain (anonymized)"

    # PII columns nulled
    actor_null = await _count(
        sqlite_db,
        "SELECT count(*) FROM audit_events WHERE tenant_id = :tid AND actor_id IS NULL",
        tid=str(tenant_id),
    )
    assert actor_null == 1, "audit_events.actor_id should be NULL after cascade"
