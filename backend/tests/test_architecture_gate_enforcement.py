"""M5 Architecture Center (T-A6) — gate-enforcement pytest cases (4 cases).

Covers AC-1:

(a) test_post_adr_without_approval_raises - direct call without
    envelope raises ApprovalRequiredError.
(b) test_post_adr_with_approval_passes - with envelope the row is
    written (verified via @require_approval_phase decorated stub).
(c) test_post_contract_super_approval_only_for_same_phase -
    attempting to use a SECURITY envelope on the ARCHITECTURE
    decorator fails.
(d) test_super_approval_persists_decision_recorded_in_metadata -
    grant metadata is round-tripped.

The decorator under test is the real :func:`require_approval_phase`
from :mod:`app.agents.approval_gate`; the test uses inline stubs so
the cases run without spinning up FastAPI.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.agents.approval_gate import (
    ApprovalEnvelope,
    ApprovalRequiredError,
    require_approval_phase,
)
from app.agents.sdlc_state import (
    ApprovalRequest,
    SDLCPhase,
    SDLCState,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_state(
    *,
    phase_value: str = "architecture",
    granted: bool | None = None,
) -> SDLCState:
    """Build an :class:`SDLCState` with optional pending + decision."""
    state = SDLCState(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        actor_id=uuid.uuid4(),
        context={"repo_path": "/tmp", "workspace_path": "/tmp/ws"},
    )
    pending = ApprovalRequest(
        approval_id=uuid.uuid4(),
        type=phase_value,
        required_role="forge-architect",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    state = state.set_pending_approval(pending).with_phase(
        SDLCPhase.BLOCKED_APPROVAL
    )
    if granted is not None:
        state = state.model_copy(
            update={
                "metadata": {
                    **state.metadata,
                    f"approval:{phase_value}:decision": {
                        "granted": granted,
                        "decided_by": str(uuid.uuid4()),
                        "reason": "test",
                        "decided_at": datetime.now(UTC).isoformat(),
                    },
                }
            },
            deep=True,
        )
    return state


# ---------------------------------------------------------------------------
# Case (a) — direct call without envelope raises ApprovalRequiredError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_adr_without_approval_raises():
    """No SDLCState \u2192 ApprovalRequiredError before any handler logic runs."""

    @require_approval_phase(SDLCPhase.ARCHITECTURE)
    async def create_adr() -> str:
        return "adr created"

    with pytest.raises(ApprovalRequiredError) as excinfo:
        await create_adr()
    assert excinfo.value.phase == SDLCPhase.ARCHITECTURE
    assert "no SDLCState argument" in str(excinfo.value)


# ---------------------------------------------------------------------------
# Case (b) — with envelope the handler runs and returns
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_adr_with_approval_passes(grant_architecture_approval):
    """Granted architecture decision lets the decorated handler execute."""

    @require_approval_phase(SDLCPhase.ARCHITECTURE)
    async def create_adr(state: SDLCState) -> str:
        return f"adr created for {state.tenant_id}"

    state, _envelope = grant_architecture_approval()
    result = await create_adr(state)
    assert result == f"adr created for {state.tenant_id}"


# ---------------------------------------------------------------------------
# Case (c) — cross-phase envelope rejected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_contract_super_approval_only_for_same_phase():
    """SECURITY envelope cannot satisfy an ARCHITECTURE-only decorator."""
    # Build a SECURITY-phase state and try to run an architecture-only
    # decorated handler. The decorator sees pending_approval.type ==
    # 'security' and rejects it because only architecture is allowed.
    state = _make_state(phase_value="security", granted=True)

    @require_approval_phase(SDLCPhase.ARCHITECTURE)
    async def handler(s: SDLCState) -> None:
        return None

    with pytest.raises(ApprovalRequiredError) as excinfo:
        await handler(state)
    # The decorator names the offending pending phase in the error;
    # since 'security' isn't in the ARCHITECTURE allow set, raise.
    assert excinfo.value.phase == SDLCPhase.SECURITY
    assert "not in" in str(excinfo.value)


# ---------------------------------------------------------------------------
# Case (d) — grant metadata round-trips through the state copy
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_super_approval_persists_decision_recorded_in_metadata(
    grant_architecture_approval,
):
    """The grant metadata written by the fixture is readable by the handler."""

    @require_approval_phase(SDLCPhase.ARCHITECTURE)
    async def check_decision(state: SDLCState) -> dict:
        decision_key = (
            f"approval:{SDLCPhase.ARCHITECTURE.value}:decision"
        )
        return dict(state.metadata[decision_key])

    state, envelope = grant_architecture_approval()
    decision = await check_decision(state)
    assert decision["granted"] is True
    assert decision["reason"] == "test-grant-architecture-approval"
    # The envelope is independent of the state (frozen model).
    assert isinstance(envelope, ApprovalEnvelope)
    assert envelope.granted is True
    assert envelope.phase == SDLCPhase.ARCHITECTURE


__all__ = [
    "test_post_adr_without_approval_raises",
    "test_post_adr_with_approval_passes",
    "test_post_contract_super_approval_only_for_same_phase",
    "test_super_approval_persists_decision_recorded_in_metadata",
]
