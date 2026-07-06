"""SDLC state model — the typed state that flows through the LangGraph supervisor.

F-017 orchestration, F-301..F-310 partial.

This module is intentionally self-contained: Pydantic v2 model definitions only,
no imports from the broader backend. Downstream modules (sdlc_agent.py,
nodes/*.py) compose these models with services and tools.

Design notes
------------
* ``SDLCState`` is the canonical state carried by LangGraph's ``StateGraph``.
  It is serializable to JSON for checkpointing and stable across replays.
* ``SDLCPhase`` mirrors the canonical SDLC phases plus three terminal /
  blocking states (``DONE``, ``FAILED``, ``BLOCKED_APPROVAL``).
* All cost math uses :class:`decimal.Decimal` to avoid float drift over
  long-running workflows.
* ``phase_history`` is an append-only audit trail (Rule 4 — append-only).
* ``pending_approval`` drives the conditional routing in the supervisor
  graph; setting it to non-None pauses the run until an ``ApprovalResponse``
  is recorded.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SDLCPhase(str, Enum):
    """The full SDLC phase enum, plus terminal/blocking states."""

    DISCOVERY = "discovery"
    PLANNING = "planning"
    ARCHITECTURE = "architecture"
    IMPLEMENTATION = "implementation"
    TESTING = "testing"
    SECURITY = "security"
    REVIEW = "review"
    DEPLOYMENT = "deployment"
    DONE = "done"
    FAILED = "failed"
    BLOCKED_APPROVAL = "blocked_approval"

    @classmethod
    def terminal(cls) -> tuple[SDLCPhase, ...]:
        """Phases that indicate the run has ended."""
        return (cls.DONE, cls.FAILED)

    @classmethod
    def requires_approval(cls) -> tuple[SDLCPhase, ...]:
        """Phases that transition through an approval gate (Rule 3)."""
        return (cls.ARCHITECTURE, cls.SECURITY, cls.DEPLOYMENT)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _new_uuid() -> UUID:
    return uuid.uuid4()


class Message(BaseModel):
    """A single message in the SDLC run's conversation history.

    Follows a LangChain-compatible shape (``role`` + ``content``) so the
    state can be fed straight into LiteLLM chat calls.
    """

    model_config = ConfigDict(frozen=False)

    role: Literal["system", "user", "assistant", "tool"]
    content: str
    name: str | None = None
    tool_call_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PhaseTransition(BaseModel):
    """Append-only audit row for every phase change.

    Fields
    ------
    from_phase:
        The phase the run was in before the transition. ``None`` for the
        initial transition into ``DISCOVERY``.
    to_phase:
        The new phase.
    at:
        UTC timestamp.
    actor_id:
        User / system that triggered the transition. ``None`` for
        autonomous transitions by the supervisor.
    reason:
        Free-text rationale (e.g. ``"approval_granted"``,
        ``"hook_pre_phase_completed"``).
    """

    model_config = ConfigDict(frozen=True)

    from_phase: SDLCPhase | None
    to_phase: SDLCPhase
    at: datetime = Field(default_factory=_utcnow)
    actor_id: UUID | None = None
    reason: str = ""


class ArtifactRef(BaseModel):
    """Reference to a typed artifact produced by a phase."""

    model_config = ConfigDict(frozen=False)

    artifact_id: UUID
    type: str
    version: int = 1
    phase: SDLCPhase
    content_hash: str
    summary: str = ""


class ApprovalRequest(BaseModel):
    """Snapshot of an open approval gate.

    The persistent record lives in :class:`app.db.models.approval.ApprovalRequest`.
    This model is the in-state mirror used by the LangGraph conditional
    router to know whether to pause the run.
    """

    model_config = ConfigDict(frozen=False)

    approval_id: UUID
    type: Literal["architecture", "security", "deployment"] = "architecture"
    required_role: str
    requested_at: datetime = Field(default_factory=_utcnow)
    expires_at: datetime
    target_artifact_id: UUID | None = None
    reason: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class ApprovalResponse(BaseModel):
    """Decision recorded against a pending :class:`ApprovalRequest`."""

    model_config = ConfigDict(frozen=False)

    approval_id: UUID
    granted: bool
    decided_by: UUID
    decided_at: datetime = Field(default_factory=_utcnow)
    reason: str = ""


class ErrorRecord(BaseModel):
    """Structured error captured in :attr:`SDLCState.errors`."""

    model_config = ConfigDict(frozen=True)

    phase: SDLCPhase | None
    error_type: str
    message: str
    occurred_at: datetime = Field(default_factory=_utcnow)
    recoverable: bool = False


class SDLCState(BaseModel):
    """The full state object threaded through the LangGraph supervisor.

    Why this shape
    --------------
    * ``run_id`` doubles as the LangGraph ``thread_id`` for checkpointing.
    * ``current_phase`` drives routing; ``phase_history`` is the audit.
    * ``artifacts`` is keyed by artifact type so nodes can find prior
      outputs without scanning ``phase_history``.
    * ``pending_approval`` is the single switch that pauses the graph:
      ``None`` means "keep going", any value means "wait".
    * ``cost_so_far`` is updated incrementally; cost / duration guards
      read it each tick.

    Frozen-state contract (M2 Plan 01-01 — T-A2)
    -------------------------------------------
    ``model_config.frozen=True`` makes the model structurally
    immutable: assigning to ``state.current_phase = ...`` raises
    ``ValidationError``.  The only legal mutation path is
    ``state.model_copy(update=..., deep=True)``, which returns a new
    instance with the requested fields swapped.

    Every mutator on this model (``with_phase``, ``add_artifact``,
    ``add_error``, ``add_message``, ``add_cost``,
    ``set_pending_approval``) already returned a new state via
    ``model_copy(update=...)`` — T-A2 just adds ``deep=True`` so the
    nested ``metadata`` / ``artifacts`` dicts are cloned, not shared.
    Callers that mutating-assigned to ``state.foo`` will now see a
    clear ``ValidationError`` at runtime instead of silently
    corrupting the LangGraph checkpoint.
    """

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        arbitrary_types_allowed=False,
        frozen=True,
    )

    run_id: UUID = Field(default_factory=_new_uuid)
    tenant_id: UUID
    project_id: UUID
    actor_id: UUID

    current_phase: SDLCPhase = SDLCPhase.DISCOVERY
    phase_history: list[PhaseTransition] = Field(default_factory=list)
    artifacts: dict[str, ArtifactRef] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)
    messages: list[Message] = Field(default_factory=list)
    pending_approval: ApprovalRequest | None = None
    errors: list[ErrorRecord] = Field(default_factory=list)
    cost_so_far: Decimal = Decimal("0")
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    metadata: dict[str, Any] = Field(default_factory=dict)

    # ------------------------------------------------------------------
    # Validators
    # ------------------------------------------------------------------

    @field_validator("cost_so_far")
    @classmethod
    def _cost_non_negative(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("cost_so_far must be non-negative")
        return v

    # ------------------------------------------------------------------
    # Mutators (all return a new state to be checkpoint-friendly)
    # ------------------------------------------------------------------

    def with_phase(
        self,
        to_phase: SDLCPhase,
        *,
        actor_id: UUID | None = None,
        reason: str = "",
    ) -> SDLCState:
        """Return a copy with ``current_phase`` set and a history row appended.

        T-A2 contract: ``deep=True`` ensures ``phase_history`` is a
        fresh list, not a shared reference into the frozen source.
        Callers can keep appending to ``returned.phase_history`` in
        their own context without contaminating the LangGraph
        checkpoint that originated ``self``.
        """
        if to_phase == self.current_phase:
            return self
        transition = PhaseTransition(
            from_phase=self.current_phase,
            to_phase=to_phase,
            actor_id=actor_id,
            reason=reason,
        )
        return self.model_copy(
            update={
                "current_phase": to_phase,
                "phase_history": [*self.phase_history, transition],
                "updated_at": _utcnow(),
            },
            deep=True,
        )

    def add_artifact(self, key: str, ref: ArtifactRef) -> SDLCState:
        return self.model_copy(
            update={
                "artifacts": {**self.artifacts, key: ref},
                "updated_at": _utcnow(),
            },
            deep=True,
        )

    def add_error(self, err: ErrorRecord) -> SDLCState:
        return self.model_copy(
            update={
                "errors": [*self.errors, err],
                "updated_at": _utcnow(),
            },
            deep=True,
        )

    def add_message(self, message: Message) -> SDLCState:
        return self.model_copy(
            update={
                "messages": [*self.messages, message],
                "updated_at": _utcnow(),
            },
            deep=True,
        )

    def add_cost(self, cost: Decimal) -> SDLCState:
        if cost < 0:
            raise ValueError("cost increment must be non-negative")
        return self.model_copy(
            update={
                "cost_so_far": (self.cost_so_far + cost),
                "updated_at": _utcnow(),
            },
            deep=True,
        )

    def set_pending_approval(self, approval: ApprovalRequest | None) -> SDLCState:
        return self.model_copy(
            update={
                "pending_approval": approval,
                "updated_at": _utcnow(),
            },
            deep=True,
        )

    def as_langgraph_state(self) -> dict[str, Any]:
        """Dump to a JSON-safe dict suitable for LangGraph checkpointing."""
        return self.model_dump(mode="json")

    @classmethod
    def from_langgraph_state(cls, payload: dict[str, Any]) -> SDLCState:
        """Reconstruct a :class:`SDLCState` from a checkpointed dict.

        Decimal and UUID fields are coerced back from JSON strings.
        """

        if "cost_so_far" in payload:
            payload = {**payload, "cost_so_far": Decimal(str(payload["cost_so_far"]))}
        return cls.model_validate(payload)


__all__ = [
    "SDLCPhase",
    "Message",
    "PhaseTransition",
    "ArtifactRef",
    "ApprovalRequest",
    "ApprovalResponse",
    "ErrorRecord",
    "SDLCState",
]
