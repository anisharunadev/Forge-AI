"""SDLC run manager — orchestrates run lifecycle around the LangGraph graph.

Responsibilities
----------------
* Create new runs (initial state + thread_id).
* Track in-process run state by ``run_id``.
* Persist checkpointed state via LangGraph's :class:`BaseCheckpointSaver`.
* Provide resume / cancel / list / cost-summary endpoints.
* Stream state snapshots to consumers via the
  :class:`RunStateBroker` it owns.

Persistence
-----------
This module is intentionally in-memory plus checkpoint-driven. The
persistent record of an SDLC run is the LangGraph checkpoint + the
M1 substrate's :class:`Artifact` rows. Restarting the process does
not lose state — :meth:`resume_run` rehydrates from the checkpoint.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, AsyncIterator
from uuid import UUID, uuid4

from langgraph.checkpoint.base import BaseCheckpointSaver

from app.agents.approval_gate import ApprovalGateNode
from app.agents.cost_tracking import SDLCPhaseCostTracker
from app.agents.sdlc_agent import build_sdlc_graph, run_sdlc
from app.agents.sdlc_state import (
    ApprovalRequest,
    ApprovalResponse,
    SDLCPhase,
    SDLCState,
)
from app.services.event_bus import EventType, bus as default_bus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Cost summary DTO
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class CostSummary:
    run_id: UUID
    total_usd: Decimal
    by_phase: dict[SDLCPhase, Decimal]
    prompt_tokens: int
    completion_tokens: int
    call_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": str(self.run_id),
            "total_usd": str(self.total_usd),
            "by_phase": {p.value: str(v) for p, v in self.by_phase.items()},
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "call_count": self.call_count,
        }


# ---------------------------------------------------------------------------
# In-process broker — fans state updates out to WS / SSE consumers
# ---------------------------------------------------------------------------

@dataclass
class _Subscriber:
    queue: asyncio.Queue[SDLCState]
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class RunStateBroker:
    """Subscribers receive every :class:`SDLCState` snapshot published
    by :class:`SDLCRunManager.publish`.

    Used by the WebSocket and SSE endpoints. Subscriptions are keyed
    by ``run_id`` so multiple consumers can listen to different runs.
    """

    def __init__(self) -> None:
        self._subs: dict[UUID, set[_Subscriber]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, run_id: UUID) -> _Subscriber:
        sub = _Subscriber(queue=asyncio.Queue(maxsize=128))
        async with self._lock:
            self._subs[run_id].add(sub)
        return sub

    async def unsubscribe(self, run_id: UUID, sub: _Subscriber) -> None:
        async with self._lock:
            self._subs.get(run_id, set()).discard(sub)

    async def publish(self, run_id: UUID, state: SDLCState) -> None:
        async with self._lock:
            subs = list(self._subs.get(run_id, ()))
        for sub in subs:
            try:
                sub.queue.put_nowait(state)
            except asyncio.QueueFull:  # drop the slowest consumer
                pass


# ---------------------------------------------------------------------------
# Run manager
# ---------------------------------------------------------------------------

class SDLCRunManager:
    """Lifecycle and orchestration for SDLC runs.

    The manager is process-local. Persisted state lives in the
    LangGraph checkpoint (Postgres in production, SQLite for tests).
    """

    def __init__(
        self,
        *,
        checkpointer: BaseCheckpointSaver[Any, Any] | None = None,
        broker: RunStateBroker | None = None,
        bus: Any | None = None,
        graph_factory: Any | None = None,
    ) -> None:
        self._checkpointer = checkpointer
        self._broker = broker or RunStateBroker()
        self._bus = bus or default_bus
        self._graph_factory = graph_factory or build_sdlc_graph
        self._states: dict[UUID, SDLCState] = {}
        self._cost_trackers: dict[UUID, SDLCPhaseCostTracker] = {}
        self._tasks: dict[UUID, asyncio.Task[None]] = {}
        self._graph = None  # lazy compile

    # ---- Properties ----------------------------------------------------

    @property
    def broker(self) -> RunStateBroker:
        return self._broker

    @property
    def checkpointer(self) -> BaseCheckpointSaver[Any, Any] | None:
        return self._checkpointer

    # ---- Run lifecycle -------------------------------------------------

    async def start_run(
        self,
        *,
        tenant_id: UUID,
        project_id: UUID,
        actor_id: UUID,
        initial_context: dict[str, Any] | None = None,
    ) -> SDLCState:
        """Start a new SDLC run.

        Creates the initial :class:`SDLCState`, kicks off the supervisor
        in a background task, and returns the initial state. The actual
        progression is observed by subscribing to :attr:`broker`.
        """

        state = SDLCState(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            context=dict(initial_context or {}),
        )
        self._states[state.run_id] = state
        self._cost_trackers[state.run_id] = SDLCPhaseCostTracker()
        await self._broker.publish(state.run_id, state)
        await self._bus.publish(
            EventType.AGENT_RUN_STARTED,
            {"run_id": str(state.run_id), "phase": state.current_phase.value},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        self._tasks[state.run_id] = asyncio.create_task(
            self._drive(state), name=f"sdlc-run-{state.run_id}"
        )
        return state

    async def resume_run(
        self,
        run_id: UUID,
        *,
        approval_response: ApprovalResponse | None = None,
    ) -> SDLCState:
        """Resume a paused run, optionally applying an approval decision.

        Returns the (possibly updated) state. If the run is already
        completed, returns the last state without side effects.
        """

        state = self._states.get(run_id)
        if state is None:
            raise LookupError(f"sdlc_run {run_id} not found")
        if approval_response is not None:
            gate = ApprovalGateNode()
            state = await gate.record_response(state, approval_response)
            self._states[run_id] = state
            await self._broker.publish(run_id, state)
        if state.current_phase == SDLCPhase.DONE or state.current_phase == SDLCPhase.FAILED:
            return state
        if run_id in self._tasks and not self._tasks[run_id].done():
            # Already driving — the new state will be picked up next tick.
            return state
        self._tasks[run_id] = asyncio.create_task(
            self._drive(state), name=f"sdlc-run-{run_id}"
        )
        return state

    async def cancel_run(self, run_id: UUID, *, reason: str = "") -> SDLCState:
        state = self._states.get(run_id)
        if state is None:
            raise LookupError(f"sdlc_run {run_id} not found")
        state = state.with_phase(SDLCPhase.FAILED, reason=f"cancelled:{reason}")
        self._states[run_id] = state
        task = self._tasks.get(run_id)
        if task is not None and not task.done():
            task.cancel()
        await self._broker.publish(run_id, state)
        return state

    # ---- Read APIs -----------------------------------------------------

    async def get_run(self, run_id: UUID) -> SDLCState | None:
        return self._states.get(run_id)

    async def list_runs(
        self,
        *,
        tenant_id: UUID | None = None,
        project_id: UUID | None = None,
        status: SDLCPhase | None = None,
    ) -> list[SDLCState]:
        out = list(self._states.values())
        if tenant_id is not None:
            out = [s for s in out if s.tenant_id == tenant_id]
        if project_id is not None:
            out = [s for s in out if s.project_id == project_id]
        if status is not None:
            out = [s for s in out if s.current_phase == status]
        return out

    async def get_run_artifacts(self, run_id: UUID) -> list[dict[str, Any]]:
        state = self._states.get(run_id)
        if state is None:
            return []
        return [ref.model_dump(mode="json") for ref in state.artifacts.values()]

    async def get_run_cost(self, run_id: UUID) -> CostSummary:
        tracker = self._cost_trackers.get(run_id)
        if tracker is None:
            return CostSummary(
                run_id=run_id,
                total_usd=Decimal("0"),
                by_phase={},
                prompt_tokens=0,
                completion_tokens=0,
                call_count=0,
            )
        breakdown = tracker.breakdown()
        by_phase = {b.phase: b.cost_usd for b in breakdown}
        return CostSummary(
            run_id=run_id,
            total_usd=tracker.total(),
            by_phase=by_phase,
            prompt_tokens=sum(b.prompt_tokens for b in breakdown),
            completion_tokens=sum(b.completion_tokens for b in breakdown),
            call_count=sum(b.call_count for b in breakdown),
        )

    # ---- Driver -------------------------------------------------------

    async def _drive(self, initial_state: SDLCState) -> None:
        """Background coroutine: stream state from the supervisor graph.

        Persists each snapshot into ``self._states`` and publishes to
        the broker so SSE / WS consumers can stream updates.
        """

        try:
            async for snapshot in run_sdlc(
                initial_state,
                thread_id=str(initial_state.run_id),
                graph=self._ensure_graph(),
            ):
                self._states[snapshot.run_id] = snapshot
                await self._broker.publish(snapshot.run_id, snapshot)
        except asyncio.CancelledError:
            logger.info("sdlc_run.cancelled", run_id=str(initial_state.run_id))
        except Exception as exc:  # noqa: BLE001
            logger.exception("sdlc_run.failed", run_id=str(initial_state.run_id))
            state = self._states.get(initial_state.run_id) or initial_state
            from app.agents.sdlc_state import ErrorRecord
            state = state.add_error(
                ErrorRecord(
                    phase=state.current_phase,
                    error_type=type(exc).__name__,
                    message=str(exc),
                )
            ).with_phase(SDLCPhase.FAILED, reason=f"exception:{type(exc).__name__}")
            self._states[state.run_id] = state
            await self._broker.publish(state.run_id, state)

    def _ensure_graph(self) -> Any:
        if self._graph is None:
            self._graph = self._graph_factory(checkpointer=self._checkpointer)
        return self._graph


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_default_manager: SDLCRunManager | None = None


def get_default_manager() -> SDLCRunManager:
    global _default_manager
    if _default_manager is None:
        _default_manager = SDLCRunManager()
    return _default_manager


def set_default_manager(manager: SDLCRunManager) -> None:
    global _default_manager
    _default_manager = manager


__all__ = [
    "CostSummary",
    "RunStateBroker",
    "SDLCRunManager",
    "get_default_manager",
    "set_default_manager",
]
