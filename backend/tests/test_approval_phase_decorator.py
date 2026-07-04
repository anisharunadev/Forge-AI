"""M2 Plan 01-01 (T-A5) — 5 pytest-asyncio cases for @require_approval_phase.

The decorator enforces the approval gate per Rule 3 ("no autonomous
crossing of Architecture / Security / Deployment boundaries").  The
five cases below cover the full decision matrix from the M2 spec
§4 T-A5:

* ``granted_proceeds`` — happy path: a recorded granted decision lets
  the handler run and returns the wrapped value.
* ``denied_raises`` — a recorded denied decision raises
  :class:`ApprovalRequiredError` with the right phase.
* ``missing_decision_raises`` — pending_approval set but no decision
  recorded yet → :class:`ApprovalRequiredError`.
* ``missing_pending_raises`` — no pending_approval at all → raise.
* ``wrong_phase_raises`` — pending_approval.type doesn't match any of
  the decorator's allowed phases → raise.

All five cases use the in-memory SDLCState from conftest's
``sqlite_db`` + ``event_bus`` fixtures so they exercise the real
:class:`SDLCState` (frozen via T-A2) and the real
:class:`ApprovalEnvelope` / :class:`ApprovalRequiredError` /
:func:`require_approval_phase` exports.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.agents.approval_gate import (
    ApprovalEnvelope,
    ApprovalRequiredError,
    frozen_state_envelope,
    require_approval_phase,
)
from app.agents.sdlc_state import (
    ApprovalRequest,
    ApprovalResponse,
    SDLCPhase,
    SDLCState,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_state(**overrides) -> SDLCState:
    """Build a fresh :class:`SDLCState` for decorator tests."""
    defaults: dict = {
        "tenant_id": uuid.uuid4(),
        "project_id": uuid.uuid4(),
        "actor_id": uuid.uuid4(),
        "context": {"repo_path": "/tmp", "workspace_path": "/tmp/ws"},
    }
    defaults.update(overrides)
    return SDLCState(**defaults)


def _make_pending(*, phase: str = "architecture") -> ApprovalRequest:
    """Build a :class:`ApprovalRequest` that has not expired."""
    return ApprovalRequest(
        approval_id=uuid.uuid4(),
        type=phase,
        required_role="forge-architect",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )


def _make_decision(*, granted: bool = True) -> dict:
    """Build the metadata-shaped decision dict the gate writes."""
    return {
        "granted": granted,
        "decided_by": str(uuid.uuid4()),
        "reason": "test",
        "decided_at": datetime.now(UTC).isoformat(),
    }


# ---------------------------------------------------------------------------
# Case 1 — granted proceeds
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_granted_proceeds():
    """A recorded granted decision lets the decorated handler run."""
    pending = _make_pending(phase="architecture")
    state = _make_state().set_pending_approval(pending).with_phase(
        SDLCPhase.BLOCKED_APPROVAL
    )
    state = state.model_copy(
        update={
            "metadata": {
                **state.metadata,
                "approval:architecture:decision": _make_decision(granted=True),
            }
        },
        deep=True,
    )

    @require_approval_phase(SDLCPhase.ARCHITECTURE)
    async def handler(s: SDLCState) -> str:
        return "approved"

    result = await handler(state)
    assert result == "approved"


# ---------------------------------------------------------------------------
# Case 2 — denied raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_denied_raises():
    """A recorded denied decision raises ApprovalRequiredError."""
    pending = _make_pending(phase="architecture")
    state = _make_state().set_pending_approval(pending).with_phase(
        SDLCPhase.BLOCKED_APPROVAL
    )
    state = state.model_copy(
        update={
            "metadata": {
                **state.metadata,
                "approval:architecture:decision": _make_decision(granted=False),
            }
        },
        deep=True,
    )

    @require_approval_phase(SDLCPhase.ARCHITECTURE)
    async def handler(s: SDLCState) -> None:
        return None

    with pytest.raises(ApprovalRequiredError) as excinfo:
        await handler(state)
    assert excinfo.value.phase == SDLCPhase.ARCHITECTURE
    assert excinfo.value.run_id == state.run_id
    assert excinfo.value.tenant_id == state.tenant_id


# ---------------------------------------------------------------------------
# Case 3 — missing decision raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_decision_raises():
    """pending_approval set but no recorded decision → raise."""
    pending = _make_pending(phase="security")
    state = _make_state().set_pending_approval(pending).with_phase(
        SDLCPhase.BLOCKED_APPROVAL
    )
    # Note: no metadata["approval:security:decision"] written.

    @require_approval_phase(SDLCPhase.SECURITY)
    async def handler(s: SDLCState) -> None:
        return None

    with pytest.raises(ApprovalRequiredError) as excinfo:
        await handler(state)
    assert excinfo.value.phase == SDLCPhase.SECURITY
    # The exception message names the missing key so supervisors can
    # surface the actionable hint to the human reviewer.
    assert "approval:security:decision" in str(excinfo.value)


# ---------------------------------------------------------------------------
# Case 4 — missing pending raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_missing_pending_raises():
    """No pending_approval at all → raise (decorator requires a gate context)."""
    state = _make_state()  # no pending_approval set

    @require_approval_phase(SDLCPhase.DEPLOYMENT)
    async def handler(s: SDLCState) -> None:
        return None

    with pytest.raises(ApprovalRequiredError) as excinfo:
        await handler(state)
    assert excinfo.value.phase == SDLCPhase.DEPLOYMENT
    # The decorator must surface the run_id + tenant_id so the audit
    # row written by the supervisor's outer try/except is informative.
    assert excinfo.value.run_id == state.run_id
    assert excinfo.value.tenant_id == state.tenant_id


# ---------------------------------------------------------------------------
# Case 5 — wrong phase raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_phase_raises():
    """pending_approval.type not in the decorator's allowed set → raise."""
    pending = _make_pending(phase="architecture")
    state = _make_state().set_pending_approval(pending).with_phase(
        SDLCPhase.BLOCKED_APPROVAL
    )
    state = state.model_copy(
        update={
            "metadata": {
                **state.metadata,
                # Record an approval for a DIFFERENT phase so we exercise
                # the "wrong phase" branch (not the "missing decision"
                # branch) — the gate's architecture decision was never
                # recorded.
                "approval:security:decision": _make_decision(granted=True),
            }
        },
        deep=True,
    )

    @require_approval_phase(SDLCPhase.SECURITY, SDLCPhase.DEPLOYMENT)
    async def handler(s: SDLCState) -> None:
        return None

    with pytest.raises(ApprovalRequiredError) as excinfo:
        await handler(state)
    # The error names the offending pending phase (architecture), not
    # one of the allowed ones — the supervisor surfaces the mismatch.
    assert excinfo.value.phase == SDLCPhase.ARCHITECTURE


# ---------------------------------------------------------------------------
# Bonus — frozen_state_envelope is exported and round-trips
# ---------------------------------------------------------------------------


def test_frozen_state_envelope_writes_to_metadata():
    """frozen_state_envelope stamps the envelope at the right metadata key."""
    pending = _make_pending(phase="architecture")
    state = _make_state().set_pending_approval(pending).with_phase(
        SDLCPhase.BLOCKED_APPROVAL
    )
    response = ApprovalResponse(
        approval_id=pending.approval_id,
        granted=True,
        decided_by=uuid.uuid4(),
        reason="ok",
        decided_at=datetime.now(UTC),
    )
    envelope = ApprovalEnvelope.from_response(
        phase=SDLCPhase.ARCHITECTURE,
        tenant_id=state.tenant_id,
        project_id=state.project_id,
        response=response,
    )
    stamped = frozen_state_envelope(state, envelope)
    # Source state is untouched (frozen contract).
    assert "approval:architecture:envelope" not in state.metadata
    # Stamped state carries the envelope at the expected key.
    assert "approval:architecture:envelope" in stamped.metadata
    assert stamped.metadata["approval:architecture:envelope"]["granted"] is True
    # stamped state is a fresh SDLCState (model_copy deep=True semantics).
    assert stamped is not state
    assert stamped.metadata is not state.metadata


def test_approval_envelope_is_frozen():
    """ApprovalEnvelope is frozen — direct attribute write raises."""
    envelope = ApprovalEnvelope(
        approval_id=uuid.uuid4(),
        phase=SDLCPhase.ARCHITECTURE,
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        decided_by=uuid.uuid4(),
        decided_at=datetime.now(UTC),
        granted=True,
        reason="ok",
    )
    with pytest.raises(ValidationError):
        envelope.granted = False  # type: ignore[misc]