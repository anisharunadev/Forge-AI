"""Cost tracking integration for the SDLC supervisor.

Every LiteLLM call wrapped by :class:`SDLCPhaseCostTracker` records its
cost into the global :class:`~backend.app.services.cost_ledger.CostLedger`
(``COST_INCURRED`` event) and updates the run's ``state.cost_so_far``.

Why a wrapper?
--------------
Rule 1 (no direct LLM SDKs) means LLM calls go through the LiteLLM
Proxy. We layer this tracker on top so that ``LiteLLMClient`` stays
provider-agnostic while every chat / embed call:

1. Has its USD cost added to the SDLC state.
2. Emits a :class:`EventType.COST_INCURRED` event for downstream audit.
3. Increments the cost ledger's per-tenant / per-project total.

The tracker implements the :class:`CostRecorder` protocol so any node
can swap it out for an alternative (test doubles, mock recorders, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID

from app.agents.nodes.base import CostRecorder
from app.agents.sdlc_state import SDLCPhase, SDLCState
from app.services.cost_ledger import CostLedger, cost_ledger as default_ledger
from app.services.event_bus import EventType, bus as default_bus


@dataclass(slots=True)
class PhaseCostBreakdown:
    """Per-phase cost totals — exposed by the run cost summary endpoint."""

    phase: SDLCPhase
    cost_usd: Decimal
    prompt_tokens: int = 0
    completion_tokens: int = 0
    call_count: int = 0


class SDLCPhaseCostTracker(CostRecorder):
    """Wraps ``CostLedger`` so each LLM call updates ledger + state + event.

    Use :meth:`record` directly, or use :meth:`wrap_litellm_chat` as an
    adapter around :class:`~backend.app.services.litellm_client.LiteLLMClient`
    responses.
    """

    def __init__(
        self,
        *,
        ledger: CostLedger | None = None,
        bus: Any | None = None,
    ) -> None:
        self._ledger = ledger or default_ledger
        self._bus = bus or default_bus
        # In-memory aggregation per phase for fast access in /runs/{id}/cost
        self._per_phase: dict[SDLCPhase, PhaseCostBreakdown] = {}

    async def record(
        self,
        *,
        run_id: UUID,
        tenant_id: UUID,
        project_id: UUID,
        actor_id: UUID,
        phase: SDLCPhase,
        model: str | None,
        cost_usd: Decimal,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        source: str = "litellm",
    ) -> None:
        """Persist the cost entry and emit the ``COST_INCURRED`` event."""

        if cost_usd < 0:
            raise ValueError("cost_usd must be non-negative")

        await self._ledger.record(
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=run_id,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=float(cost_usd),
            source=source,
            metadata={"phase": phase.value, "run_id": str(run_id)},
        )
        await self._bus.publish(
            EventType.COST_INCURRED,
            {
                "run_id": str(run_id),
                "phase": phase.value,
                "model": model,
                "cost_usd": str(cost_usd),
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "source": source,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        breakdown = self._per_phase.get(phase)
        if breakdown is None:
            breakdown = PhaseCostBreakdown(phase=phase, cost_usd=Decimal("0"))
            self._per_phase[phase] = breakdown
        breakdown.cost_usd += cost_usd
        breakdown.prompt_tokens += prompt_tokens
        breakdown.completion_tokens += completion_tokens
        breakdown.call_count += 1

    async def record_from_response(
        self,
        *,
        state: SDLCState,
        response_body: dict[str, Any],
        model: str,
        phase: SDLCPhase | None = None,
    ) -> SDLCState:
        """Read ``usage`` from a LiteLLM response and update the state.

        Returns a new :class:`SDLCState` with ``cost_so_far`` incremented.
        The caller is expected to assign the returned state to its variable.
        """

        usage = response_body.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        cost_usd = Decimal(
            str(response_body.get("cost_usd") or usage.get("cost_usd") or 0)
        )
        phase = phase or state.current_phase
        if cost_usd == 0 and prompt_tokens == 0 and completion_tokens == 0:
            return state
        await self.record(
            run_id=state.run_id,
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=state.actor_id,
            phase=phase,
            model=model,
            cost_usd=cost_usd,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )
        return state.add_cost(cost_usd)

    def breakdown(self) -> list[PhaseCostBreakdown]:
        return list(self._per_phase.values())

    def total(self) -> Decimal:
        return sum((b.cost_usd for b in self._per_phase.values()), Decimal("0"))


def cost_tracker_default() -> SDLCPhaseCostTracker:
    """Module-level accessor — wired by the supervisor builder."""

    return SDLCPhaseCostTracker()


__all__ = [
    "SDLCPhaseCostTracker",
    "PhaseCostBreakdown",
    "cost_tracker_default",
]
