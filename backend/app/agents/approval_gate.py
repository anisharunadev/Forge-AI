"""Approval gate — a special LangGraph node that pauses the run.

When a phase requires approval, the supervisor routes into
``approval_gate`` instead of advancing. ``approval_gate``:

1. Persists ``state.pending_approval`` to the checkpoint.
2. Emits ``APPROVAL_REQUESTED`` (already done by the phase node, but
   the gate re-asserts so the contract is visible at this boundary).
3. Waits for an external ``ApprovalResponse`` (via REST or WS).
4. On grant, emits ``APPROVAL_GRANTED`` and routes forward.
5. On deny, emits ``APPROVAL_DENIED`` and routes to ``failed``.
6. On 24h timeout, emits ``APPROVAL_EXPIRED`` (mapped to ``DENIED``
   via the EventType enum) and routes to ``failed``.

NFR-032 / NFR-044 — every gate surfaces the workflow's budget state
in ``state.metadata[approval:<phase>:budget]`` so the reviewer sees
how much of the ceiling is still available before deciding.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.agents.sdlc_state import (
    ApprovalRequest,
    ApprovalResponse,
    SDLCPhase,
    SDLCState,
)
from app.core.logging import get_logger
from app.services.event_bus import EventType, bus as default_bus
from app.services.workflow_budget import workflow_budget_service


APPROVAL_TIMEOUT_HOURS = 24

logger = get_logger(__name__)


class ApprovalGateNode:
    """The pause-and-resume node used at every approval boundary.

    LangGraph calls nodes with the full state. We look at
    ``state.pending_approval``:

    * Set, no decision yet → pause (no edges leave the node).
    * Set with metadata flag ``approval:<phase>:granted=True`` → forward.
    * Set with metadata flag ``approval:<phase>:granted=False`` → fail.
    """

    phase_name = SDLCPhase.BLOCKED_APPROVAL
    name = "approval_gate"

    def __init__(
        self,
        *,
        event_bus: Any | None = None,
        budget_service: Any | None = None,
        timeout_hours: int = APPROVAL_TIMEOUT_HOURS,
    ) -> None:
        self._bus = event_bus or default_bus
        self._budget_service = budget_service or workflow_budget_service
        self._timeout_hours = timeout_hours

    # ---- LangGraph surface --------------------------------------------

    async def __call__(self, state: SDLCState) -> SDLCState:
        """Pause-or-resume entry point used by LangGraph.

        Behavior matrix
        ---------------
        - No ``pending_approval``              → keep current phase.
        - ``pending_approval`` + no decision  → check timeout, pause.
        - ``pending_approval`` + granted flag → forward (set state forward).
        - ``pending_approval`` + denied flag  → fail.

        NFR-032 / NFR-044: on entry, the gate writes
        ``metadata[approval:<phase>:budget]`` from the workflow budget
        service so reviewers see ceiling / spent / remaining / status
        alongside the decision. Failures to read budget state are
        non-fatal (the budget is opt-in per workflow).
        """

        pending = state.pending_approval
        if pending is None:
            return state

        state = await self._attach_budget_snapshot(state, pending)

        # Look for a recorded decision in metadata.
        decision_key = self._decision_key(pending)
        decision = state.metadata.get(decision_key)
        if decision is None:
            return await self._check_timeout(state, pending)
        if decision.get("granted"):
            return await self._grant(state, pending)
        return await self._deny(state, pending)

    # ---- Budget snapshot (NFR-044) ------------------------------------

    @staticmethod
    def _budget_key(pending: ApprovalRequest) -> str:
        return f"approval:{pending.type}:budget"

    async def _attach_budget_snapshot(
        self,
        state: SDLCState,
        pending: ApprovalRequest,
    ) -> SDLCState:
        """Embed the workflow's budget state into gate metadata."""

        workflow_id = state.metadata.get("workflow_id") or state.run_id
        try:
            snapshot = await self._budget_service.surface_at_gate(workflow_id)
        except Exception:  # noqa: BLE001 — budget is opt-in; never block the gate
            logger.exception(
                "approval_gate.budget_snapshot_failed",
                workflow_id=str(workflow_id),
                phase=pending.type,
            )
            return state
        return state.model_copy(
            update={
                "metadata": {
                    **state.metadata,
                    self._budget_key(pending): snapshot,
                },
                "updated_at": datetime.now(timezone.utc),
            }
        )

    # ---- Decision helpers ---------------------------------------------

    @staticmethod
    def _decision_key(pending: ApprovalRequest) -> str:
        return f"approval:{pending.type}:decision"

    async def record_response(
        self,
        state: SDLCState,
        response: ApprovalResponse,
    ) -> SDLCState:
        """Store a response into state metadata so the gate resumes."""

        pending = state.pending_approval
        if pending is None or pending.approval_id != response.approval_id:
            return state
        state = state.model_copy(
            update={
                "metadata": {
                    **state.metadata,
                    self._decision_key(pending): {
                        "granted": response.granted,
                        "decided_by": str(response.decided_by),
                        "reason": response.reason,
                        "decided_at": response.decided_at.isoformat(),
                    },
                },
                "updated_at": datetime.now(timezone.utc),
            }
        )
        return state

    # ---- Internal actions ---------------------------------------------

    async def _check_timeout(
        self,
        state: SDLCState,
        pending: ApprovalRequest,
    ) -> SDLCState:
        now = datetime.now(timezone.utc)
        if pending.expires_at <= now:
            await self._bus.publish(
                EventType.APPROVAL_DENIED,
                {
                    "run_id": str(state.run_id),
                    "approval_id": str(pending.approval_id),
                    "reason": "expired",
                },
                tenant_id=state.tenant_id,
                project_id=state.project_id,
                actor_id=None,
            )
            return state.with_phase(
                SDLCPhase.FAILED,
                reason="approval_expired",
            )
        # Pause: still in BLOCKED_APPROVAL, no edge leaves the gate.
        return state

    async def _grant(
        self,
        state: SDLCState,
        pending: ApprovalRequest,
    ) -> SDLCState:
        await self._bus.publish(
            EventType.APPROVAL_GRANTED,
            {
                "run_id": str(state.run_id),
                "approval_id": str(pending.approval_id),
                "type": pending.type,
            },
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=state.actor_id,
        )
        return state.set_pending_approval(None)

    async def _deny(
        self,
        state: SDLCState,
        pending: ApprovalRequest,
    ) -> SDLCState:
        await self._bus.publish(
            EventType.APPROVAL_DENIED,
            {
                "run_id": str(state.run_id),
                "approval_id": str(pending.approval_id),
                "type": pending.type,
                "reason": "denied",
            },
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=state.actor_id,
        )
        return state.with_phase(SDLCPhase.FAILED, reason="approval_denied")


def approval_gate_default() -> ApprovalGateNode:
    return ApprovalGateNode()


__all__ = ["ApprovalGateNode", "approval_gate_default", "APPROVAL_TIMEOUT_HOURS"]
