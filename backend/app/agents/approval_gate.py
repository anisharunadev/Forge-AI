"""Approval gate — a special LangGraph node that pauses the run.

When a phase requires approval, the supervisor routes into
``approval_gate`` instead of advancing. ``approval_gate``:

1. Persists ``state.pending_approval`` to the checkpoint.
2. Emits ``APPROVAL_REQUESTED`` (already done by the phase node, but
   the gate re-asserts so the contract is visible at this boundary).
3. Waits for an external ``ApprovalResponse`` (via REST or WS).
4. On grant, emits ``APPROVAL_GRANTED`` and routes forward.
5. On deny, emits ``APPROVAL_DENIED`` and routes to ``failed``.
6. On timeout, emits ``APPROVAL_EXPIRED`` and routes to ``failed``.

NFR-032 / NFR-044 — every gate surfaces the workflow's budget state
in ``state.metadata[approval:<phase>:budget]`` so the reviewer sees
how much of the ceiling is still available before deciding.

M2 Substrate (Plan 01-01 — PITFALL-1)
-------------------------------------
The M2 closure adds:

* :class:`ApprovalEnvelope` — a frozen Pydantic v2 model that records
  one approval decision (Phase, tenant, project, decider, granted,
  reason).  No defaults — every field is required (Rule 2).
* :class:`ApprovalRequiredError` — a :class:`PermissionError` subclass
  that supervisors raise when an artifact-writing path runs without
  a recorded approval for the requested phase.
* :func:`require_approval_phase` — module-level decorator that wraps
  a handler so it reads ``SDLCState`` from the first positional
  argument, validates ``state.pending_approval`` against the
  decorator's ``*allowed_phases`` list, and inspects
  ``state.metadata["approval:<phase>:decision"]`` for the recorded
  decision. Raises :class:`ApprovalRequiredError` if the state is
  missing, the phase is wrong, or the decision was not granted.
* :func:`frozen_state_envelope` — helper that copies an SDLC state
  with a new envelope entry appended to ``metadata`` using
  :meth:`SDLCState.model_copy(update=..., deep=True)` semantics
  (the frozen-state contract from T-A2).

The decorator is wired onto the artifact-writing handlers under
``backend/app/api/v1/**/*.py`` (Track A T-A3) and onto the agent
services that mutate project state (Track A T-A3).

LangGraph integration (T-A1 final step): the gate now uses
:func:`langgraph.types.interrupt` to pause — instead of relying on
the older "empty-edge-set" trick (where the supervisor had no
outgoing edges to declare the pause).  :func:`interrupt` is the
modern LangGraph primitive and works with both the in-memory
``MemorySaver`` and the durable ``AsyncSqliteSaver`` checkpointer
that :mod:`app.agents.sdlc_agent` configures.
"""

from __future__ import annotations

import functools
import inspect
from datetime import datetime, timezone
from typing import Any, Callable, ParamSpec, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.agents.sdlc_state import (
    ApprovalRequest,
    ApprovalResponse,
    SDLCPhase,
    SDLCState,
)
from app.core.logging import get_logger
from app.services.event_bus import EventType, bus as default_bus

# ``workflow_budget_service`` is imported lazily inside the gate's
# ``__init__`` to avoid a circular import — Track A retrofit (T-A3)
# has ``app.services.workflow_budget`` depending on
# ``app.agents.approval_gate`` for the decorator, while the gate
# itself wants to call ``workflow_budget_service.surface_at_gate``
# for NFR-044 budget snapshots.  Resolving one direction lazily
# breaks the cycle without changing either module's public API.


APPROVAL_TIMEOUT_HOURS = 24

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# M2 Plan 01-01 — PITFALL-1 closure
# ---------------------------------------------------------------------------


class ApprovalEnvelope(BaseModel):
    """Frozen Pydantic v2 record of a single approval decision.

    Written into ``state.metadata["approval:<phase>:envelope"]`` by
    :func:`frozen_state_envelope` once an :class:`ApprovalResponse`
    has been recorded.  Every field is REQUIRED (no defaults) so
    downstream consumers (audit, scheduler timeout scan, run
    dashboards) can rely on the shape — Rule 2 ("no `= None`
    defaults on artifact payloads") forbids the convenient
    ``Optional[UUID] = None`` defaults that v1-style models used.

    frozen=True makes the envelope hashable and structurally
    immutable; ``model_copy(update=...)`` is the only legal mutation
    path, mirroring the SDLCState contract (T-A2).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    approval_id: UUID
    phase: SDLCPhase
    tenant_id: UUID
    project_id: UUID
    decided_by: UUID
    decided_at: datetime
    granted: bool
    reason: str

    @classmethod
    def from_response(
        cls,
        *,
        phase: SDLCPhase,
        tenant_id: UUID,
        project_id: UUID,
        response: ApprovalResponse,
    ) -> "ApprovalEnvelope":
        """Build an envelope from a recorded :class:`ApprovalResponse`."""
        return cls(
            approval_id=response.approval_id,
            phase=phase,
            tenant_id=UUID(str(tenant_id)),
            project_id=UUID(str(project_id)),
            decided_by=response.decided_by,
            decided_at=response.decided_at,
            granted=response.granted,
            reason=response.reason,
        )


class ApprovalRequiredError(PermissionError):
    """Raised when an artifact-writing handler runs without approval.

    Inherits from :class:`PermissionError` so callers can either
    catch the narrow class or rely on the broad built-in.  Carries
    the failing phase, run_id, and tenant_id so the audit row the
    supervisor writes can be specific.
    """

    def __init__(
        self,
        message: str,
        *,
        phase: SDLCPhase,
        run_id: UUID | None = None,
        tenant_id: UUID | None = None,
    ) -> None:
        super().__init__(message)
        self.phase = phase
        self.run_id = run_id
        self.tenant_id = tenant_id

    def __repr__(self) -> str:  # pragma: no cover — debugging aid
        return (
            f"ApprovalRequiredError(phase={self.phase!r}, "
            f"run_id={self.run_id!r}, tenant_id={self.tenant_id!r})"
        )


_P = ParamSpec("_P")
_R = TypeVar("_R")


def _decision_metadata_key(phase: SDLCPhase) -> str:
    """Stable metadata key for the recorded decision.

    The gate writes ``metadata["approval:<phase>:decision"]`` and the
    decorator reads the same key.  Centralising the format keeps the
    two in lock-step — every change happens here, every reader sees
    it on the next test run.
    """
    return f"approval:{phase}:decision"


def _envelope_metadata_key(phase: SDLCPhase) -> str:
    """Stable metadata key for the frozen :class:`ApprovalEnvelope`."""
    # Use ``phase.value`` (e.g. ``"architecture"``) rather than
    # ``phase.name`` (``"ARCHITECTURE"``) so the key matches the
    # gate's existing ``approval:<phase>:decision`` convention.
    # ``SDLCPhase`` is a ``str`` Enum so ``phase.value`` returns
    # the canonical lowercase string the supervisor writes.
    phase_str = phase.value if hasattr(phase, "value") else str(phase)
    return f"approval:{phase_str}:envelope"


def _coerce_sdlc_state(args: tuple[Any, ...]) -> SDLCState | None:
    """Return the :class:`SDLCState` argument from the wrapped call.

    The decorator accepts three call shapes:

    * Free function: ``async def handler(state, ...) -> ...`` →
      ``args[0]`` is the state.
    * Bound method on :class:`ApprovalGateNode` (the common case for
      :class:`ApprovalGateNode.__call__`): ``gate(state)`` →
      ``args[0]`` is the ``ApprovalGateNode`` instance and
      ``args[1]`` is the state.
    * Bound method on any other class (e.g. a service handler):
      ``self.foo(state)`` → we accept ``args[0]`` as the instance
      and ``args[1]`` as the state.

    Returns ``None`` when no :class:`SDLCState` is found in those
    positions so the decorator can raise a clear
    :class:`ApprovalRequiredError`.
    """
    # NOTE: ``SDLCState`` is the SAME class object that the test file
    # imports via ``from backend.app.agents.sdlc_state import SDLCState`` —
    # but the worktree has TWO copies of the module loaded if any test
    # imports ``app.agents.sdlc_state`` AND another test imports
    # ``backend.app.agents.sdlc_state`` (different parent packages
    # under ``sys.path``).  ``isinstance`` would then return False
    # because ``type(candidate) is not SDLCState`` even though the
    # objects look identical.  We side-step this by checking the
    # ``__class__.__name__`` AND the module path so we never miss a
    # same-class-different-import result.
    SDLCStateName = SDLCState.__name__
    SDLCStateModule = SDLCState.__module__
    for candidate in args[:2]:
        cand_cls = type(candidate)
        if cand_cls is SDLCState:
            return candidate
        if cand_cls.__name__ == SDLCStateName and getattr(
            cand_cls, "__module__", ""
        ).endswith(SDLCStateModule.rsplit(".", 1)[-1]):
            return candidate
        # Same class object after re-export — final fallback.
        try:
            if isinstance(candidate, SDLCState):
                return candidate
        except TypeError:
            continue
    return None


def require_approval_phase(*allowed_phases: SDLCPhase) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Module-level decorator that gates a handler on recorded approval.

    Usage::

        @require_approval_phase(SDLCPhase.ARCHITECTURE)
        async def create_adr(state: SDLCState, ...):
            ...

    The decorator enforces three checks in order:

    1. The first positional argument is an :class:`SDLCState`.
    2. ``state.pending_approval`` is set AND ``pending_approval.type``
       matches one of the allowed phases.
    3. ``state.metadata[approval:<phase>:decision].granted`` is True.

    Failure of any check raises :class:`ApprovalRequiredError` with
    the offending phase, ``run_id``, and ``tenant_id`` so the
    supervisor's audit row is informative.

    The decorator is deliberately tolerant of *missing* metadata
    (key absent → treated as "no decision recorded yet") — the
    supervisor emits the right error code and the LangGraph
    :func:`interrupt` resurfaces the pause to the user.

    Notes
    -----
    * ``*allowed_phases`` is variadic; a handler that mutates two
      phases (e.g. a cross-phase promotion) can pass both.
    * The decorator does NOT itself call :func:`interrupt` — that's
      the gate's job.  Handlers decorated with this are downstream
      of the gate; they run AFTER the supervisor has resumed.
    """

    if not allowed_phases:
        raise ValueError(
            "require_approval_phase needs at least one allowed phase; "
            "pass the SDLCPhase values the handler is permitted to run in."
        )

    allowed = tuple(allowed_phases)

    def decorator(func: Callable[_P, _R]) -> Callable[_P, _R]:
        # Stash the allowed phases on the wrapper for introspection /
        # tooling — the CI hygiene grep (Step 3) reads this attribute
        # to verify coverage without re-parsing the source AST.
        setattr(func, "__approval_required_phases__", allowed)

        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
                state = _coerce_sdlc_state(args)
                if state is None:
                    raise ApprovalRequiredError(
                        "decorated handler received no SDLCState argument",
                        phase=allowed[0],
                        run_id=None,
                        tenant_id=None,
                    )
                _enforce(state, allowed)
                return await func(*args, **kwargs)

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(func)
        def sync_wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
            state = _coerce_sdlc_state(args)
            if state is None:
                raise ApprovalRequiredError(
                    "decorated handler received no SDLCState argument",
                    phase=allowed[0],
                    run_id=None,
                    tenant_id=None,
                )
            _enforce(state, allowed)
            return func(*args, **kwargs)

        return sync_wrapper  # type: ignore[return-value]

    return decorator


def _enforce(state: SDLCState, allowed_phases: tuple[SDLCPhase, ...]) -> None:
    """Raise :class:`ApprovalRequiredError` when the state fails the gate.

    Pure function so tests can call it directly without spinning up
    a decorated handler.
    """

    pending = state.pending_approval
    if pending is None:
        raise ApprovalRequiredError(
            f"no pending_approval on state; expected one of "
            f"{[p.value for p in allowed_phases]}",
            phase=allowed_phases[0],
            run_id=state.run_id,
            tenant_id=state.tenant_id,
        )

    if pending.type not in {p.value for p in allowed_phases}:
        # Convert back to the enum so callers see ``SDLCPhase.ARCHITECTURE``
        # rather than the raw string.  Unknown strings fall through to
        # ``allowed_phases[0]`` — the error message still names the
        # requested phase.
        try:
            phase_enum = SDLCPhase(pending.type)
        except ValueError:
            phase_enum = allowed_phases[0]
        raise ApprovalRequiredError(
            f"pending_approval.type={pending.type!r} is not in "
            f"{[p.value for p in allowed_phases]}",
            phase=phase_enum,
            run_id=state.run_id,
            tenant_id=state.tenant_id,
        )

    decision_key = f"approval:{pending.type}:decision"
    decision = state.metadata.get(decision_key)
    if decision is None:
        raise ApprovalRequiredError(
            f"no recorded decision at metadata[{decision_key!r}]",
            phase=SDLCPhase(pending.type),
            run_id=state.run_id,
            tenant_id=state.tenant_id,
        )

    if not isinstance(decision, dict) or not decision.get("granted"):
        raise ApprovalRequiredError(
            f"recorded decision at metadata[{decision_key!r}] is not granted",
            phase=SDLCPhase(pending.type),
            run_id=state.run_id,
            tenant_id=state.tenant_id,
        )


def frozen_state_envelope(state: SDLCState, envelope: ApprovalEnvelope) -> SDLCState:
    """Return a new state with ``envelope`` appended to ``metadata``.

    Uses :meth:`SDLCState.model_copy` with ``update=...`` so the call
    works under frozen=True (Pydantic v2 + the T-A2 contract).
    ``deep=True`` ensures the metadata dict is cloned, not shared —
    callers can continue mutating their local copy without
    contaminating the source state.

    The envelope is written at ``metadata["approval:<phase>:envelope"]``
    so the timeout scheduler (T-A7) and the audit query layer can
    find it without scanning the entire ``metadata`` dict.
    """

    metadata = dict(state.metadata)
    metadata[_envelope_metadata_key(envelope.phase)] = envelope.model_dump(mode="json")
    return state.model_copy(
        update={
            "metadata": metadata,
            "updated_at": datetime.now(timezone.utc),
        },
        deep=True,
    )


# ---------------------------------------------------------------------------
# ApprovalGateNode — the LangGraph pause-and-resume node
# ---------------------------------------------------------------------------


class ApprovalGateNode:
    """The pause-and-resume node used at every approval boundary.

    LangGraph calls nodes with the full state. We look at
    ``state.pending_approval``:

    * Set, no decision yet → :func:`langgraph.types.interrupt` (modern
      LangGraph primitive; replaces the older "empty-edge-set" trick).
    * Set with metadata flag ``approval:<phase>:granted=True`` → forward.
    * Set with metadata flag ``approval:<phase>:granted=False`` → fail.

    The decorator :func:`require_approval_phase` is used internally
    to enforce the same check on the supervisor's pre-resume
    path so we never accidentally advance without a recorded decision.
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
        # Lazy import to break the approval_gate ↔ workflow_budget
        # circular import (see module-level note).  The fallback
        # ``None`` is preserved for tests that don't need the
        # budget snapshot.
        if budget_service is None:
            from app.services.workflow_budget import workflow_budget_service
            budget_service = workflow_budget_service
        self._budget_service = budget_service
        self._timeout_hours = timeout_hours

    # ---- LangGraph surface --------------------------------------------

    @require_approval_phase(
        SDLCPhase.ARCHITECTURE,
        SDLCPhase.SECURITY,
        SDLCPhase.DEPLOYMENT,
    )
    async def __call__(self, state: SDLCState) -> SDLCState:
        """Pause-or-resume entry point used by LangGraph.

        Behavior matrix
        ---------------
        - No ``pending_approval``              → keep current phase.
        - ``pending_approval`` + no decision  → check timeout, then
          :func:`langgraph.types.interrupt` to pause and surface the
          decision request to the human reviewer (REST/WS/UI).
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
            },
            deep=True,
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
        # T-A2: build the new metadata dict without mutating the
        # frozen source.  Pydantic v2's frozen models still allow
        # ``model_copy`` with ``update=`` and ``deep=True`` so the
        # call below remains legal.
        new_metadata = {**state.metadata, self._decision_key(pending): {
            "granted": response.granted,
            "decided_by": str(response.decided_by),
            "reason": response.reason,
            "decided_at": response.decided_at.isoformat(),
        }}
        # Stamp the frozen ApprovalEnvelope alongside the decision so
        # audit + timeout scan have a typed artifact to consume.
        envelope = ApprovalEnvelope.from_response(
            phase=SDLCPhase(pending.type),
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            response=response,
        )
        new_metadata[_envelope_metadata_key(envelope.phase)] = envelope.model_dump(mode="json")

        state = state.model_copy(
            update={
                "metadata": new_metadata,
                "updated_at": datetime.now(timezone.utc),
            },
            deep=True,
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
                EventType.APPROVAL_EXPIRED,
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

        # Modern LangGraph primitive: ``interrupt`` is the documented
        # way to pause a run for human input.  Replaces the older
        # empty-edge-set trick (where the supervisor had no outgoing
        # edges to declare the pause) — M2 Plan 01-01 step 8.
        try:
            from langgraph.types import interrupt  # local import: langgraph is heavy
        except ImportError:  # pragma: no cover — langgraph is a hard dep
            logger.warning("approval_gate.interrupt_unavailable")
            return state

        # The payload is what the human sees on the approval UI.
        # Re-using the ``ApprovalRequest`` shape keeps the contract
        # identical between the request and the resume.
        interrupt_payload = {
            "approval_id": str(pending.approval_id),
            "type": pending.type,
            "reason": pending.reason,
            "requested_at": pending.requested_at.isoformat(),
            "expires_at": pending.expires_at.isoformat(),
            "run_id": str(state.run_id),
            "tenant_id": str(state.tenant_id),
            "project_id": str(state.project_id),
            "budget_snapshot": state.metadata.get(self._budget_key(pending)),
        }
        # ``interrupt`` returns the human's response on resume.
        interrupt(interrupt_payload)
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


__all__ = [
    "APPROVAL_TIMEOUT_HOURS",
    "ApprovalEnvelope",
    "ApprovalRequiredError",
    "ApprovalGateNode",
    "approval_gate_default",
    "frozen_state_envelope",
    "require_approval_phase",
]