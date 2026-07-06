"""M5 Architecture Center (T-A6) — End-to-end approval gate chain (1 case).

AC-5 backend half:

(a) test_full_approval_gate_chain
    1. Without an approval envelope, calling a decorated handler raises
       ApprovalRequiredError (the supervisor's BLOCKED_APPROVAL state).
    2. With a granted architecture envelope in metadata, calling the
       same handler succeeds.
    3. The granted decision is also mirrored to the KG via the
       approval_workflow.decide() path (T-A4 wiring).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
import pytest_asyncio

from app.agents.approval_gate import (
    ApprovalEnvelope,
    ApprovalRequiredError,
    require_approval_phase,
)
from app.agents.sdlc_state import (
    ApprovalRequest,
    ApprovalResponse,
    SDLCPhase,
    SDLCState,
)


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


@pytest.mark.asyncio
async def test_full_approval_gate_chain(sqlite_db, event_bus):
    """E2E approval gate chain.

    Steps:
    1. Hand an undecorated call through a *decorated* handler without
       an envelope \u2192 ApprovalRequiredError. Verify the phase.
    2. Hand the same call through with a granted architecture envelope
       in metadata \u2192 handler succeeds.
    3. Drive approval_workflow.decide() with a granted verdict;
       verify a KGNode with node_type='architecture_approval' lands
       in the kg_nodes table (T-A4 wiring).
    """
    from sqlalchemy import func, select

    from app.db.models.architecture import (
        ADR,
        ArchitectureApproval,
    )
    from app.db.session import get_session_factory
    from app.services.architecture.approval_workflow import (
        ArchitectureApprovalWorkflow,
    )
    from app.services.knowledge_graph import KGNode

    # (1) Decorated handler without envelope \u2192 ApprovalRequiredError.
    @require_approval_phase(SDLCPhase.ARCHITECTURE)
    async def create_adr(state: SDLCState) -> str:
        return "adr created"

    with pytest.raises(ApprovalRequiredError) as excinfo:
        await create_adr()  # no state at all
    assert excinfo.value.phase == SDLCPhase.ARCHITECTURE

    # (2) Decorated handler WITH envelope \u2192 handler runs.
    pending = ApprovalRequest(
        approval_id=uuid.uuid4(),
        type="architecture",
        required_role="forge-architect",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    granted_state = (
        SDLCState(
            tenant_id=uuid.uuid4(),
            project_id=uuid.uuid4(),
            actor_id=uuid.uuid4(),
            context={"repo_path": "/tmp", "workspace_path": "/tmp/ws"},
        )
        .set_pending_approval(pending)
        .with_phase(SDLCPhase.BLOCKED_APPROVAL)
    )
    granted_state = granted_state.model_copy(
        update={
            "metadata": {
                **granted_state.metadata,
                "approval:architecture:decision": {
                    "granted": True,
                    "decided_by": str(uuid.uuid4()),
                    "reason": "e2e-test-grant",
                    "decided_at": datetime.now(UTC).isoformat(),
                },
                "approval:architecture:envelope": ApprovalEnvelope.from_response(
                    phase=SDLCPhase.ARCHITECTURE,
                    tenant_id=granted_state.tenant_id,
                    project_id=granted_state.project_id,
                    response=ApprovalResponse(
                        approval_id=pending.approval_id,
                        granted=True,
                        decided_by=uuid.uuid4(),
                        reason="e2e-test-grant",
                        decided_at=datetime.now(UTC),
                    ),
                ).model_dump(mode="json"),
            },
        },
        deep=True,
    )
    outcome = await create_adr(granted_state)
    assert outcome == "adr created"

    # (3) Drive approval_workflow.decide() with a granted verdict and
    #     verify the KG mirror (T-A4 wiring) lands an
    #     ``architecture_approval`` node.
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = get_session_factory()
    async with factory() as session:
        adr_row = ADR(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            number=1,
            title="E2E ADR",
            status="proposed",
            context="ctx",
            decision="dec",
            consequences={},
            alternatives=[],
            related_adrs=[],
            generated_by=str(uuid.uuid4()),
        )
        session.add(adr_row)
        await session.commit()
        await session.refresh(adr_row)
        adr_id = adr_row.id

        approval_row = ArchitectureApproval(
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            artifact_type="adr",
            artifact_id=str(adr_id),
            requested_by=uuid.uuid4(),
            status="pending",
            reason=(
                '{"reviewers": [{"role": "forge-architect",'
                ' "status": "pending", "decided_by": null,'
                ' "decided_at": null, "reason": null}]}'
            ),
        )
        session.add(approval_row)
        await session.commit()
        await session.refresh(approval_row)
        approval_id = approval_row.id

    wf = ArchitectureApprovalWorkflow(
        litellm_client=MagicMock(),
        event_bus=event_bus,
        artifact_registry_instance=None,  # use module-level default
        audit_service=None,
    )
    decided = await wf.decide(
        approval_id=str(approval_id),
        decision="approve",
        reviewer_id=uuid.uuid4(),
        reason="e2e-chain-grant",
    )
    assert decided.status == "approved"
    assert decided.decided_by is not None

    # Confirm the KG mirror row landed.
    async with factory() as session:
        stmt = (
            select(func.count())
            .select_from(KGNode)
            .where(
                KGNode.tenant_id == str(tenant_id),
                KGNode.node_type == "architecture_approval",
            )
        )
        kg_count = int((await session.execute(stmt)).scalar_one())
    assert kg_count >= 1, "Expected KG mirror row for the granted approval"


__all__ = ["test_full_approval_gate_chain"]
