"""Tests for NFR-044 — Workflow Budget Guardrails.

* Declare budget persists.
* check_budget returns BLOCKED when exceeded.
* check_budget returns ALLOWED when under.
* Audit row on BLOCKED.
* Gate metadata includes budget state.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio

# Import the model module so its tables register on the global metadata
# BEFORE `sqlite_db` calls `metadata.create_all`.
from app.db.models import workflow_budget as _workflow_budget_models  # noqa: F401


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    from app.db.models import workflow_budget  # noqa: F401

    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


@pytest_asyncio.fixture
async def service(sqlite_db, event_bus):
    from app.services.workflow_budget import WorkflowBudgetService

    return WorkflowBudgetService(bus=event_bus)


def _principal_state(*, tenant=None, project=None, actor=None, workflow=None):
    return {
        "tenant_id": tenant or uuid.uuid4(),
        "project_id": project or uuid.uuid4(),
        "actor_id": actor or uuid.uuid4(),
        "workflow_id": workflow or uuid.uuid4(),
    }


# ---------------------------------------------------------------------------
# 1. Declare budget persists
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_declare_budget_persists(service, sqlite_db):
    ids = _principal_state()
    snapshot = await service.declare_budget(
        tenant_id=ids["tenant_id"],
        project_id=ids["project_id"],
        workflow_id=ids["workflow_id"],
        ceiling_usd=10.0,
        actor_id=ids["actor_id"],
    )
    assert snapshot.ceiling_usd == 10.0
    assert snapshot.spent_usd == 0.0
    assert snapshot.workflow_id == ids["workflow_id"]
    assert snapshot.status.value == "active"

    # Re-read from the DB to ensure it actually persisted.
    fetched = await service.get_budget(ids["workflow_id"])
    assert fetched is not None
    assert fetched.ceiling_usd == 10.0
    assert fetched.spent_usd == 0.0


# ---------------------------------------------------------------------------
# 2. check_budget returns BLOCKED when exceeded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_budget_returns_blocked_when_exceeded(service, sqlite_db):
    ids = _principal_state()
    await service.declare_budget(
        tenant_id=ids["tenant_id"],
        project_id=ids["project_id"],
        workflow_id=ids["workflow_id"],
        ceiling_usd=5.0,
        actor_id=ids["actor_id"],
    )
    check = await service.check_budget(
        workflow_id=ids["workflow_id"],
        projected_cost_usd=10.0,
        actor_id=ids["actor_id"],
    )
    assert check.decision.value == "blocked"
    assert check.ceiling_usd == 5.0
    assert check.spent_usd == 0.0
    assert check.projected_cost_usd == 10.0


# ---------------------------------------------------------------------------
# 3. check_budget returns ALLOWED when under
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_budget_returns_allowed_when_under(service, sqlite_db):
    ids = _principal_state()
    await service.declare_budget(
        tenant_id=ids["tenant_id"],
        project_id=ids["project_id"],
        workflow_id=ids["workflow_id"],
        ceiling_usd=5.0,
        actor_id=ids["actor_id"],
    )
    check = await service.check_budget(
        workflow_id=ids["workflow_id"],
        projected_cost_usd=1.5,
        actor_id=ids["actor_id"],
    )
    assert check.decision.value == "allowed"
    assert check.reason == "within_ceiling"

    # Spend below ceiling should commit cleanly.
    snapshot = await service.record_spend(
        workflow_id=ids["workflow_id"],
        actual_cost_usd=1.5,
        tenant_id=ids["tenant_id"],
        project_id=ids["project_id"],
    )
    assert snapshot.spent_usd == 1.5
    assert snapshot.remaining_usd == pytest.approx(3.5)


# ---------------------------------------------------------------------------
# 4. Audit row on BLOCKED
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_row_written_on_blocked(service, sqlite_db):
    from sqlalchemy import select

    from app.db.models.workflow_budget import WorkflowBudgetDecision

    ids = _principal_state()
    await service.declare_budget(
        tenant_id=ids["tenant_id"],
        project_id=ids["project_id"],
        workflow_id=ids["workflow_id"],
        ceiling_usd=1.0,
        actor_id=ids["actor_id"],
    )
    check = await service.check_budget(
        workflow_id=ids["workflow_id"],
        projected_cost_usd=5.0,
        actor_id=ids["actor_id"],
    )
    assert check.decision.value == "blocked"

    factory = sqlite_db
    async with factory() as session:
        rows = (
            (
                await session.execute(
                    select(WorkflowBudgetDecision).where(
                        WorkflowBudgetDecision.workflow_id == str(ids["workflow_id"])
                    )
                )
            )
            .scalars()
            .all()
        )

    assert any(r.decision == "blocked" for r in rows)
    blocked = next(r for r in rows if r.decision == "blocked")
    assert float(blocked.projected_cost_usd) == 5.0
    assert float(blocked.ceiling_usd) == 1.0
    assert blocked.reason == "ceiling_exceeded"


# ---------------------------------------------------------------------------
# 5. Gate metadata includes budget state
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gate_metadata_includes_budget_state(service, sqlite_db, event_bus):
    from app.agents.approval_gate import ApprovalGateNode
    from app.agents.sdlc_state import (
        ApprovalRequest,
        SDLCPhase,
        SDLCState,
    )

    ids = _principal_state()
    await service.declare_budget(
        tenant_id=ids["tenant_id"],
        project_id=ids["project_id"],
        workflow_id=ids["workflow_id"],
        ceiling_usd=20.0,
        actor_id=ids["actor_id"],
    )

    gate = ApprovalGateNode(event_bus=event_bus, budget_service=service)
    now = datetime.now(UTC)
    pending = ApprovalRequest(
        approval_id=uuid.uuid4(),
        type="architecture",
        required_role="architect",
        expires_at=now.replace(hour=now.hour + 1),
        target_artifact_id=None,
        reason="",
        payload={},
    )
    state = SDLCState(
        run_id=ids["workflow_id"],
        tenant_id=ids["tenant_id"],
        project_id=ids["project_id"],
        actor_id=ids["actor_id"],
        current_phase=SDLCPhase.BLOCKED_APPROVAL,
        pending_approval=pending,
        metadata={"workflow_id": str(ids["workflow_id"])},
    )

    out = await gate(state)
    budget_key = "approval:architecture:budget"
    assert budget_key in out.metadata
    snap = out.metadata[budget_key]
    assert snap["declared"] is True
    assert snap["ceiling_usd"] == 20.0
    assert snap["spent_usd"] == 0.0
    assert snap["remaining_usd"] == 20.0
    assert snap["status"] == "active"
    assert snap["workflow_id"] == str(ids["workflow_id"])
