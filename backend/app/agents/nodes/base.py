"""Base phase node — the contract every SDLC phase must satisfy.

Each phase of the LangGraph SDLC supervisor is implemented as a node
that inherits from :class:`BasePhaseNode`. Nodes are responsible for:

* Executing the phase work and producing typed artifacts
* Enforcing the per-phase cost and duration guards
* Emitting the relevant domain events (cost incurred, phase transition, …)
* Pausing for human approval when ``requires_approval`` is True

The concrete nodes (``DiscoveryNode``, ``PlanningNode``, …) live in
the sibling modules and override :meth:`BasePhaseNode.execute`.
"""

from __future__ import annotations

import abc
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Awaitable, Callable, Protocol

from langchain_core.tools import BaseTool

from app.agents.sdlc_state import (
    ApprovalRequest,
    ApprovalResponse,
    ArtifactRef,
    ErrorRecord,
    SDLCPhase,
    SDLCState,
)
from app.services.event_bus import EventType, bus as default_bus


# ---------------------------------------------------------------------------
# Errors raised by the guard rails
# ---------------------------------------------------------------------------

class CostLimitExceeded(RuntimeError):
    """Raised when a phase would exceed its per-phase cost budget."""

    def __init__(self, phase: SDLCPhase, spent: Decimal, limit: Decimal) -> None:
        super().__init__(
            f"phase {phase.value} exceeded cost guard: "
            f"spent ${spent} > limit ${limit}"
        )
        self.phase = phase
        self.spent = spent
        self.limit = limit


class DurationLimitExceeded(RuntimeError):
    """Raised when a phase runs longer than its per-phase duration cap."""

    def __init__(self, phase: SDLCPhase, elapsed: float, limit: int) -> None:
        super().__init__(
            f"phase {phase.value} exceeded duration guard: "
            f"elapsed {elapsed:.1f}s > limit {limit}s"
        )
        self.phase = phase
        self.elapsed = elapsed
        self.limit = limit


# ---------------------------------------------------------------------------
# Hook callbacks — wired by the orchestrator
# ---------------------------------------------------------------------------

HookFn = Callable[[SDLCState], Awaitable[None]]


@dataclass(slots=True)
class PhaseHooks:
    """Optional async callbacks fired around a phase's :meth:`execute`.

    All hooks receive the live (mutable reference to the) state. They are
    fired by :class:`BasePhaseNode.execute` in this order:

        pre_hooks -> execute() -> post_hooks

    Hooks may raise; the caller decides whether to abort or continue.
    """

    pre_hooks: list[HookFn] = field(default_factory=list)
    post_hooks: list[HookFn] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Cost-tracker protocol (so cost_tracking.py can swap in a richer impl)
# ---------------------------------------------------------------------------

class CostRecorder(abc.ABC):
    """Records a single LLM/tool cost incurrence for a run."""

    @abc.abstractmethod
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
    ) -> None: ...


# ---------------------------------------------------------------------------
# PhaseNode Protocol
# ---------------------------------------------------------------------------

class PhaseNode(Protocol):
    """The structural type every phase node implements.

    LangGraph calls nodes with the full state dict. Our concrete nodes
    accept an :class:`SDLCState` and return a transformed copy.
    """

    phase_name: SDLCPhase

    async def __call__(self, state: SDLCState) -> SDLCState: ...


# ---------------------------------------------------------------------------
# BasePhaseNode
# ---------------------------------------------------------------------------

class BasePhaseNode(abc.ABC):
    """Abstract base class for every SDLC phase.

    Subclasses override :meth:`execute`. The base class wraps ``execute``
    with the cost/duration guards and the hook firing machinery so all
    phases share identical guard semantics.
    """

    phase_name: SDLCPhase
    requires_approval: bool = False
    max_cost_usd: Decimal = Decimal("5.00")
    max_duration_seconds: int = 1800
    tools: list[BaseTool] = []

    def __init__(
        self,
        *,
        event_bus: Any | None = None,
        cost_recorder: CostRecorder | None = None,
        hooks: PhaseHooks | None = None,
        approval_timeout_hours: int = 24,
    ) -> None:
        self._bus = event_bus or default_bus
        self._cost_recorder = cost_recorder
        self._hooks = hooks or PhaseHooks()
        self._approval_timeout = timedelta(hours=approval_timeout_hours)

    # ---- Template method -----------------------------------------------

    async def __call__(self, state: SDLCState) -> SDLCState:
        """LangGraph entry point.

        Sequence:
            1. Transition into ``phase_name`` and emit the event.
            2. Fire pre-hooks.
            3. Enforce cost guard; call :meth:`execute` under duration guard.
            4. Fire post-hooks.
            5. If ``requires_approval``, request approval and pause.
            6. Otherwise advance the phase.
        """

        state = state.with_phase(self.phase_name, reason=f"enter:{self.phase_name.value}")
        await self._bus.publish(
            EventType.AGENT_RUN_STARTED,
            {
                "run_id": str(state.run_id),
                "phase": self.phase_name.value,
                "actor_id": str(state.actor_id),
            },
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=state.actor_id,
        )

        started = time.perf_counter()
        for hook in self._hooks.pre_hooks:
            await hook(state)
        try:
            await self._check_cost(state)
            state = await self._timed_execute(state)
        except Exception as exc:  # noqa: BLE001 — translated to ErrorRecord
            state = state.add_error(
                ErrorRecord(
                    phase=self.phase_name,
                    error_type=type(exc).__name__,
                    message=str(exc),
                )
            )
            await self._bus.publish(
                EventType.AGENT_RUN_FAILED,
                {
                    "run_id": str(state.run_id),
                    "phase": self.phase_name.value,
                    "error_type": type(exc).__name__,
                    "message": str(exc),
                    "elapsed_seconds": time.perf_counter() - started,
                },
                tenant_id=state.tenant_id,
                project_id=state.project_id,
                actor_id=state.actor_id,
            )
            return state.with_phase(SDLCPhase.FAILED, reason=f"exception:{type(exc).__name__}")

        for hook in self._hooks.post_hooks:
            await hook(state)

        await self._bus.publish(
            EventType.AGENT_RUN_COMPLETED,
            {
                "run_id": str(state.run_id),
                "phase": self.phase_name.value,
                "elapsed_seconds": time.perf_counter() - started,
                "cost_so_far": str(state.cost_so_far),
            },
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=state.actor_id,
        )

        if self.requires_approval and not self._has_response(state):
            state = await self.request_approval(
                state,
                reason=f"phase:{self.phase_name.value}:boundary",
            )
        return state

    # ---- Subclass extension point --------------------------------------

    @abc.abstractmethod
    async def execute(self, state: SDLCState) -> SDLCState:
        """Phase-specific work. Subclasses MUST implement."""

    # ---- Internal helpers ----------------------------------------------

    async def _timed_execute(self, state: SDLCState) -> SDLCState:
        """Run :meth:`execute` while enforcing the duration guard."""

        import asyncio

        start = time.perf_counter()
        try:
            result = await asyncio.wait_for(
                self.execute(state),
                timeout=self.max_duration_seconds,
            )
        except asyncio.TimeoutError as exc:
            elapsed = time.perf_counter() - start
            raise DurationLimitExceeded(
                self.phase_name, elapsed, self.max_duration_seconds
            ) from exc
        elapsed = time.perf_counter() - start
        if elapsed > self.max_duration_seconds:
            raise DurationLimitExceeded(
                self.phase_name, elapsed, self.max_duration_seconds
            )
        return result

    async def _check_cost(self, state: SDLCState) -> None:
        if state.cost_so_far > self.max_cost_usd:
            raise CostLimitExceeded(self.phase_name, state.cost_so_far, self.max_cost_usd)

    def _has_response(self, state: SDLCState) -> bool:
        """Approval-gate helper: a response exists when the metadata flag is set.

        Concrete implementations push an ``ApprovalResponse`` via
        :meth:`handle_approval_response`, which sets this flag.
        """

        return bool(state.metadata.get(f"approval:{self.phase_name.value}"))

    # ---- Approval helpers ----------------------------------------------

    async def check_approval_required(self, state: SDLCState) -> bool:
        return self.requires_approval and state.pending_approval is None

    async def request_approval(
        self,
        state: SDLCState,
        *,
        reason: str,
    ) -> SDLCState:
        """Emit :class:`ApprovalRequest`, persist it, and pause the run."""

        expires_at = datetime.now(timezone.utc) + self._approval_timeout
        request = ApprovalRequest(
            approval_id=__import__("uuid").uuid4(),
            type=_approval_type_for(self.phase_name),
            required_role=_required_role_for(self.phase_name),
            expires_at=expires_at,
            reason=reason,
            payload={"run_id": str(state.run_id)},
        )
        state = state.set_pending_approval(request).with_phase(
            SDLCPhase.BLOCKED_APPROVAL,
            actor_id=state.actor_id,
            reason=f"awaiting_approval:{request.type}",
        )
        await self._bus.publish(
            EventType.APPROVAL_REQUESTED,
            {
                "run_id": str(state.run_id),
                "approval_id": str(request.approval_id),
                "type": request.type,
                "required_role": request.required_role,
                "expires_at": expires_at.isoformat(),
            },
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=state.actor_id,
        )
        return state

    async def handle_approval_response(
        self,
        state: SDLCState,
        response: ApprovalResponse,
    ) -> SDLCState:
        """Apply a recorded approval decision to the state.

        Sets a per-phase metadata flag so subsequent calls to
        :meth:`__call__` skip the gate and resume execution.
        """

        if state.pending_approval is None:
            return state
        if response.approval_id != state.pending_approval.approval_id:
            return state
        state = state.set_pending_approval(None)
        state.metadata = {
            **state.metadata,
            f"approval:{self.phase_name.value}": response.model_dump(mode="json"),
        }
        event_type = (
            EventType.APPROVAL_GRANTED if response.granted else EventType.APPROVAL_DENIED
        )
        await self._bus.publish(
            event_type,
            {
                "run_id": str(state.run_id),
                "approval_id": str(response.approval_id),
                "phase": self.phase_name.value,
                "decided_by": str(response.decided_by),
                "reason": response.reason,
            },
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=response.decided_by,
        )
        if not response.granted:
            state = state.add_error(
                ErrorRecord(
                    phase=self.phase_name,
                    error_type="ApprovalDenied",
                    message=response.reason or "approval denied",
                )
            )
            state = state.with_phase(
                SDLCPhase.FAILED,
                actor_id=response.decided_by,
                reason="approval_denied",
            )
        return state


def _approval_type_for(phase: SDLCPhase) -> str:
    return {
        SDLCPhase.ARCHITECTURE: "architecture",
        SDLCPhase.SECURITY: "security",
        SDLCPhase.DEPLOYMENT: "deployment",
    }.get(phase, "architecture")


def _required_role_for(phase: SDLCPhase) -> str:
    return {
        SDLCPhase.ARCHITECTURE: "forge-architect",
        SDLCPhase.SECURITY: "forge-security",
        SDLCPhase.DEPLOYMENT: "forge-deployer",
    }.get(phase, "forge-admin")


__all__ = [
    "BasePhaseNode",
    "PhaseNode",
    "PhaseHooks",
    "CostRecorder",
    "CostLimitExceeded",
    "DurationLimitExceeded",
]
