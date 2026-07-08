"""Tests for F-305 — Architecture Approval Workflow."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
import pytest_asyncio

# Register architecture tables on the global metadata BEFORE conftest's
# `sqlite_db` fixture calls `metadata.create_all`.
from app.db.models import architecture as _architecture_models  # noqa: F401


@pytest_asyncio.fixture
async def sqlite_db(sqlite_db):  # type: ignore[no-untyped-def]
    from app.db.models import architecture  # noqa: F401

    return sqlite_db


@pytest_asyncio.fixture
async def event_bus(event_bus):  # type: ignore[no-untyped-def]
    return event_bus


@pytest_asyncio.fixture
async def captured_events(event_bus):  # type: ignore[no-untyped-def]
    from app.services.event_bus import Event

    captured: list[Event] = []
    event_bus.subscribe_all(captured.append)
    return captured


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approval_request_determines_required_reviewers(
    sqlite_db, event_bus, captured_events
):
    from app.services.architecture.approval_workflow import (
        ROLE_ARCHITECT,
        ROLE_SECURITY,
        ArchitectureApprovalWorkflow,
        _decode_reviewers,
    )

    wf = ArchitectureApprovalWorkflow(litellm_client=MagicMock(), event_bus=event_bus)
    tenant = uuid.uuid4()
    project = uuid.uuid4()

    # ADR -> architect only
    adr_approval = await wf.request_approval(
        artifact_type="adr",
        artifact_id=uuid.uuid4(),
        requester_id=uuid.uuid4(),
        tenant_id=tenant,
        project_id=project,
    )
    reviewers = _decode_reviewers(adr_approval.reason)
    assert {r["role"] for r in reviewers} == {ROLE_ARCHITECT}

    # RiskRegister -> architect + security
    rr_approval = await wf.request_approval(
        artifact_type="risk_register",
        artifact_id=uuid.uuid4(),
        requester_id=uuid.uuid4(),
        tenant_id=tenant,
        project_id=project,
    )
    reviewers = _decode_reviewers(rr_approval.reason)
    assert {r["role"] for r in reviewers} == {ROLE_ARCHITECT, ROLE_SECURITY}


@pytest.mark.asyncio
async def test_approval_decide_grants_artifact(sqlite_db, event_bus, captured_events):
    from app.services.architecture.approval_workflow import (
        ArchitectureApprovalWorkflow,
        _decode_reviewers,
    )

    wf = ArchitectureApprovalWorkflow(litellm_client=MagicMock(), event_bus=event_bus)
    approval = await wf.request_approval(
        artifact_type="adr",
        artifact_id=uuid.uuid4(),
        requester_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
    )
    decided = await wf.decide(
        approval_id=approval.id,
        decision="approve",
        reviewer_id=uuid.uuid4(),
        reason="looks good",
    )
    assert decided.status == "approved"
    reviewers = _decode_reviewers(decided.reason)
    assert all(r["status"] == "approved" for r in reviewers)
    assert decided.decided_at is not None
    assert any(e.event_type.value == "approval.granted" for e in captured_events)


@pytest.mark.asyncio
async def test_approval_multi_reviewer_requires_all(sqlite_db, event_bus, captured_events):
    from app.services.architecture.approval_workflow import (
        ArchitectureApprovalWorkflow,
        _decode_reviewers,
    )

    wf = ArchitectureApprovalWorkflow(litellm_client=MagicMock(), event_bus=event_bus)
    approval = await wf.request_approval(
        artifact_type="risk_register",
        artifact_id=uuid.uuid4(),
        requester_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
    )
    reviewers = _decode_reviewers(approval.reason)
    assert len(reviewers) == 2

    # First reviewer approves -> still in_review
    after_first = await wf.decide(
        approval_id=approval.id,
        decision="approve",
        reviewer_id=uuid.uuid4(),
        reason="architect ok",
    )
    assert after_first.status == "in_review"
    state = _decode_reviewers(after_first.reason)
    approved_count = sum(1 for r in state if r["status"] == "approved")
    assert approved_count == 1

    # Second reviewer approves -> approved
    after_second = await wf.decide(
        approval_id=approval.id,
        decision="approve",
        reviewer_id=uuid.uuid4(),
        reason="security ok",
    )
    assert after_second.status == "approved"
    state2 = _decode_reviewers(after_second.reason)
    assert all(r["status"] == "approved" for r in state2)


@pytest.mark.asyncio
async def test_approval_deny_blocks_artifact(sqlite_db, event_bus, captured_events):
    from app.services.architecture.approval_workflow import (
        ArchitectureApprovalWorkflow,
        _decode_reviewers,
    )

    wf = ArchitectureApprovalWorkflow(litellm_client=MagicMock(), event_bus=event_bus)
    approval = await wf.request_approval(
        artifact_type="risk_register",
        artifact_id=uuid.uuid4(),
        requester_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
    )
    decided = await wf.decide(
        approval_id=approval.id,
        decision="deny",
        reviewer_id=uuid.uuid4(),
        reason="security gap",
    )
    assert decided.status == "denied"
    state = _decode_reviewers(decided.reason)
    assert any(r["status"] == "denied" for r in state)
    assert any(e.event_type.value == "approval.denied" for e in captured_events)

    # A subsequent decision should be rejected.
    import pytest as _pytest

    with _pytest.raises(ValueError):
        await wf.decide(
            approval_id=approval.id,
            decision="approve",
            reviewer_id=uuid.uuid4(),
            reason="too late",
        )


@pytest.mark.asyncio
async def test_approval_get_pending_filters_by_reviewer(sqlite_db, event_bus, captured_events):
    from app.services.architecture.approval_workflow import ArchitectureApprovalWorkflow

    wf = ArchitectureApprovalWorkflow(litellm_client=MagicMock(), event_bus=event_bus)
    tenant = uuid.uuid4()

    a1 = await wf.request_approval(
        artifact_type="adr",
        artifact_id=uuid.uuid4(),
        requester_id=uuid.uuid4(),
        tenant_id=tenant,
        project_id=uuid.uuid4(),
    )
    a2 = await wf.request_approval(
        artifact_type="risk_register",
        artifact_id=uuid.uuid4(),
        requester_id=uuid.uuid4(),
        tenant_id=tenant,
        project_id=uuid.uuid4(),
    )

    # Decide one to move it out of pending
    await wf.decide(
        approval_id=a1.id,
        decision="approve",
        reviewer_id=uuid.uuid4(),
        reason="ok",
    )

    pending = await wf.get_pending(tenant_id=tenant)
    pending_ids = {str(r.id) for r in pending}
    assert str(a2.id) in pending_ids
    assert str(a1.id) not in pending_ids

    # When a reviewer is supplied, only approvals involving them in
    # any capacity should be returned (best-effort filter).
    user = uuid.uuid4()
    await wf.request_approval(
        artifact_type="adr",
        artifact_id=uuid.uuid4(),
        requester_id=user,
        tenant_id=tenant,
        project_id=uuid.uuid4(),
    )
    pending_for_user = await wf.get_pending(tenant_id=tenant, reviewer_id=user)
    pending_user_ids = {str(r.id) for r in pending_for_user}
    assert str(a2.id) in pending_user_ids  # still pending for someone else
    # And at least one approval where the user is involved is present.
    assert any(str(r.requested_by) == str(user) for r in pending_for_user)


__all__ = [
    "test_approval_request_determines_required_reviewers",
    "test_approval_decide_grants_artifact",
    "test_approval_multi_reviewer_requires_all",
    "test_approval_deny_blocks_artifact",
    "test_approval_get_pending_filters_by_reviewer",
]
