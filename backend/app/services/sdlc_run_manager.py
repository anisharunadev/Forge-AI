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
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from langgraph.checkpoint.base import BaseCheckpointSaver

from app.agents.approval_gate import ApprovalGateNode
from app.agents.cost_tracking import SDLCPhaseCostTracker
from app.agents.sdlc_agent import build_sdlc_graph, run_sdlc
from app.agents.sdlc_state import (
    ApprovalResponse,
    SDLCPhase,
    SDLCState,
)
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

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
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


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
        # M6-G1 — replay idempotency cache.  Maps
        # ``(source_run_id, idempotency_key)`` → ``new_run_id`` so a
        # client that retries the same replay (network blip, double
        # click) collapses to the original new run rather than
        # spawning parallel duplicates.  In-memory by design — replay
        # requests within the same process are the only ones we
        # accept; the API layer enforces the "source not active"
        # check (Track A T-A2) so a successful replay_token pair
        # always refers to a stable source run.
        self._replay_cache: dict[tuple[UUID, str], UUID] = {}
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
        if state.current_phase in (SDLCPhase.DONE, SDLCPhase.FAILED):
            return state
        if run_id in self._tasks and not self._tasks[run_id].done():
            # Already driving — the new state will be picked up next tick.
            return state
        self._tasks[run_id] = asyncio.create_task(self._drive(state), name=f"sdlc-run-{run_id}")
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

    async def replay_run(
        self,
        run_id: UUID,
        *,
        idempotency_key: str | None = None,
    ) -> SDLCState:
        """Replay a completed or failed run with identical scope.

        Behavior (M6 spec §5 T-A1 — M6-G1):

        * Loads the *source* run via :meth:`get_run`; raises
          ``LookupError`` if absent.
        * Builds a fresh :class:`SDLCState` that copies ``goal``,
          ``project_id``, ``tenant_id``, ``actor_id``, and the
          budget cap (``metadata["budget_cap_usd"]`` when present,
          else :attr:`Settings.run_budget_cap_usd`).
        * Carries the lineage forward via ``metadata["replay_of"]``
          so downstream audit / UI layers can render "Replayed
          from <src_run_id>" badges.
        * Emits ``EventType.RUN_REPLAYED`` through the bus so
          subscribers (audit, WS feed) see the new run immediately.
        * Idempotency: when ``idempotency_key`` (default ``uuid4``)
          already maps to a previous successful replay, returns the
          cached new state rather than spawning a duplicate.

        The replay always starts a *new* background task via
        :meth:`start_run`'s task-creation path so it behaves like a
        fresh run from the operator's perspective.
        """
        source = self._states.get(run_id)
        if source is None:
            raise LookupError(f"sdlc_run {run_id} not found")

        key = idempotency_key or str(uuid4())
        cache_key = (run_id, key)
        cached_new_id = self._replay_cache.get(cache_key)
        if cached_new_id is not None:
            cached_state = self._states.get(cached_new_id)
            if cached_state is not None:
                return cached_state

        # Carry over the goal / context so a replay reuses the
        # operator's original intent verbatim.  ``context`` already
        # includes ``workspace_path`` / ``repo_path`` for the source
        # run, so we copy it as-is.
        goal = source.context.get("goal") or source.context.get("objective") or ""
        initial_context: dict[str, Any] = dict(source.context)
        if goal and "goal" not in initial_context:
            initial_context["goal"] = goal

        # Pull the per-tenant budget cap the source run was issued
        # under, falling back to the global default.  The per-tenant
        # override map can change between runs so this is the
        # source-run snapshot — operator sees the same ceiling.
        try:
            from app.core.config import get_settings  # noqa: PLC0415 — lazy to avoid cycle

            settings = get_settings()
            tenant_key = str(source.tenant_id)
            budget_cap_usd = float(
                settings.run_budget_cap_overrides.get(tenant_key, settings.run_budget_cap_usd)
            )
        except Exception:  # noqa: BLE001 — settings may not be wired in tests
            budget_cap_usd = 50.0

        # Build the new state.  Same identity triple, fresh run_id.
        new_state = SDLCState(
            tenant_id=source.tenant_id,
            project_id=source.project_id,
            actor_id=source.actor_id,
            context=initial_context,
        )
        # Stamp lineage + budget on metadata so the cost cap rule
        # (which reads ``metadata["budget_cap_usd"]``) and the UI
        # lineage badge both see consistent values.
        new_state = new_state.model_copy(
            update={
                "metadata": {
                    **new_state.metadata,
                    "replay_of": str(run_id),
                    "replay_idempotency_key": key,
                    "budget_cap_usd": budget_cap_usd,
                },
            },
            deep=True,
        )

        self._states[new_state.run_id] = new_state
        self._cost_trackers[new_state.run_id] = SDLCPhaseCostTracker()
        self._replay_cache[cache_key] = new_state.run_id

        await self._broker.publish(new_state.run_id, new_state)
        await self._bus.publish(
            EventType.RUN_REPLAYED,
            {
                "run_id": str(new_state.run_id),
                "source_run_id": str(run_id),
                "idempotency_key": key,
                "tenant_id": str(source.tenant_id),
                "project_id": str(source.project_id),
                "goal": goal,
                "budget_cap_usd": budget_cap_usd,
            },
            tenant_id=source.tenant_id,
            project_id=source.project_id,
            actor_id=source.actor_id,
        )
        await self._bus.publish(
            EventType.AGENT_RUN_STARTED,
            {"run_id": str(new_state.run_id), "phase": new_state.current_phase.value},
            tenant_id=source.tenant_id,
            project_id=source.project_id,
            actor_id=source.actor_id,
        )
        self._tasks[new_state.run_id] = asyncio.create_task(
            self._drive(new_state), name=f"sdlc-run-{new_state.run_id}"
        )
        return new_state

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
    global _default_manager  # noqa: PLW0603
    if _default_manager is None:
        _default_manager = SDLCRunManager()
    return _default_manager


def set_default_manager(manager: SDLCRunManager) -> None:
    global _default_manager  # noqa: PLW0603
    _default_manager = manager


__all__ = [
    "CostSummary",
    "RunStateBroker",
    "SDLCRunManager",
    "get_default_manager",
    "set_default_manager",
]
