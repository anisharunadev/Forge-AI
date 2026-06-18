"""
Runtime schemas and typed errors.

The contract every sub-agent emits and every other sub-agent reads. A
change to any of these dataclasses is a breaking change to the agent
handoff contract; bump the version in `AgentHandoff` and update the
worked example together.

Versioning: 0.1.0 (initial).  See FORA-30 acceptance criteria.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional


SCHEMA_VERSION = "0.1.0"


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Stage(str, Enum):
    """The runtime's plan-then-act loop has four explicit stages."""
    PLAN = "plan"
    ACT = "act"
    OBSERVE = "observe"
    REFLECT = "reflect"


class StageStatus(str, Enum):
    """Status of a single step within a run."""
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"        # a step that was bypassed by reflect


class RunStatus(str, Enum):
    """Status of the whole run."""
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BUDGET_EXCEEDED = "budget_exceeded"
    TOOL_NOT_ALLOWED = "tool_not_allowed"
    IDEMPOTENCY_CONFLICT = "idempotency_conflict"
    CANCELLED = "cancelled"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class RuntimeError_(Exception):
    """Base class for typed runtime errors. All runtime errors carry a
    `code` so the audit log can group on it without string-matching."""

    code: str = "RUNTIME_ERROR"

    def __init__(self, message: str, **context: Any) -> None:
        super().__init__(message)
        self.message = message
        self.context: Dict[str, Any] = dict(context)

    def to_dict(self) -> Dict[str, Any]:
        return {"code": self.code, "message": self.message, "context": self.context}


class ToolNotAllowedError(RuntimeError_):
    """The runtime tried to invoke a tool that is not in the allow-list
    for the current stage.  Always fatal: the run halts with a typed
    error; the audit log gets the attempt and the tool name."""

    code = "TOOL_NOT_ALLOWED"


class BudgetExceededError(RuntimeError_):
    """The run hit a hard token or dollar ceiling.  The runtime aborts
    the current step and surfaces a typed error; no silent overrun."""

    code = "BUDGET_EXCEEDED"


class IdempotencyConflictError(RuntimeError_):
    """A retry was attempted with the same idempotency key but a
    different payload.  This is a programming error in the caller, not
    a transient failure, and is never retried."""

    code = "IDEMPOTENCY_CONFLICT"


class StepExecutionError(RuntimeError_):
    """A step handler raised an exception that was not recoverable
    through retry.  The run halts; the failure is recorded in the
    RunRecord."""

    code = "STEP_EXECUTION_ERROR"


class CancelledError(RuntimeError_):
    """The run was cancelled (e.g. cost ceiling about to be breached,
    operator requested cancellation, parent process died)."""

    code = "CANCELLED"


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

@dataclass
class PlanStep:
    """One step in the plan.  A step is a tool call with the stage it
    belongs to and the idempotency key under which it should be
    retried."""
    step_id: str
    stage: Stage
    tool: str
    arguments: Dict[str, Any] = field(default_factory=dict)
    idempotency_key: str = ""
    # Optional description for the audit log.
    description: str = ""

    def __post_init__(self) -> None:
        if not self.idempotency_key:
            # Default: deterministic on (step_id, tool, args) so a
            # re-run of the same plan is naturally idempotent.
            self.idempotency_key = _deterministic_key(self.step_id, self.tool, self.arguments)


@dataclass
class Plan:
    """The structured plan a sub-agent emits before any tool call.

    The runtime validates this object against the tool allow-list
    BEFORE executing any step.  If any step references a tool that is
    not allowed in the step's stage, the runtime refuses the plan
    outright -- it never silently drops a step."""
    plan_id: str
    goal: str
    steps: List[PlanStep]
    issued_at: str = field(default_factory=lambda: _now())
    issued_by: str = ""                  # the sub-agent that produced it
    schema_version: str = SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["stage"] = [s.stage.value if isinstance(s.stage, Stage) else s.stage for s in self.steps]
        return out


# ---------------------------------------------------------------------------
# Cost snapshot
# ---------------------------------------------------------------------------

@dataclass
class CostSnapshot:
    """A point-in-time view of the run's cost.  Both tokens and dollars
    are tracked; the runtime uses the dollar ceiling as the hard stop
    and the token count for reporting."""
    tokens_in: int = 0
    tokens_out: int = 0
    usd: float = 0.0

    def __add__(self, other: "CostSnapshot") -> "CostSnapshot":
        return CostSnapshot(
            tokens_in=self.tokens_in + other.tokens_in,
            tokens_out=self.tokens_out + other.tokens_out,
            usd=self.usd + other.usd,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Tool I/O
# ---------------------------------------------------------------------------

@dataclass
class ToolCall:
    """A normalised tool invocation as recorded by the runtime."""
    call_id: str
    tool: str
    arguments: Dict[str, Any]
    stage: Stage
    idempotency_key: str
    started_at: str = field(default_factory=lambda: _now())


@dataclass
class ToolResult:
    """A normalised tool response.  The runtime records success and
    failure uniformly; the failure carries a typed code so the audit
    log can group on it."""
    call_id: str
    tool: str
    ok: bool
    output: Any = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    duration_ms: float = 0.0
    cost: CostSnapshot = field(default_factory=CostSnapshot)
    finished_at: str = field(default_factory=lambda: _now())


# ---------------------------------------------------------------------------
# Run record (the audit-trail artefact)
# ---------------------------------------------------------------------------


@dataclass
class RetryRecord:
    """One retry attempt.  The runtime records the attempt number, the
    idempotency key, and the outcome so the audit log can prove that
    retries did not duplicate side effects."""
    attempt: int
    idempotency_key: str
    tool: str
    ok: bool
    error_code: Optional[str] = None
    duration_ms: float = 0.0


@dataclass
class StepRecord:
    """The full record of one plan step: tool call, retries, final
    result, cost, and outcome.  This is the unit the audit system
    consumes."""
    step_id: str
    stage: Stage
    status: StageStatus
    tool: str
    call: Optional[ToolCall] = None
    result: Optional[ToolResult] = None
    retries: List[RetryRecord] = field(default_factory=list)
    cost: CostSnapshot = field(default_factory=CostSnapshot)
    started_at: str = ""
    finished_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["stage"] = self.stage.value
        out["status"] = self.status.value
        if self.call is not None:
            out["call"] = asdict(self.call)
            out["call"]["stage"] = self.call.stage.value
        if self.result is not None:
            out["result"] = asdict(self.result)
        out["retries"] = [asdict(r) for r in self.retries]
        return out


@dataclass
class RunRecord:
    """The full audit-trail artefact the runtime produces for one run.

    The Audit system (FORA-21) reads this object; downstream stages
    read its `output` field; the Master Orchestrator (FORA-17) reads
    the `status` to decide whether to advance, retry, or block."""
    run_id: str
    plan: Plan
    inputs: Dict[str, Any]
    output: Any = None
    status: RunStatus = RunStatus.SUCCEEDED
    steps: List[StepRecord] = field(default_factory=list)
    total_cost: CostSnapshot = field(default_factory=CostSnapshot)
    started_at: str = field(default_factory=lambda: _now())
    finished_at: str = ""
    error: Optional[Dict[str, Any]] = None
    schema_version: str = SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["status"] = self.status.value
        out["plan"] = self.plan.to_dict()
        out["steps"] = [s.to_dict() for s in self.steps]
        out["total_cost"] = self.total_cost.to_dict()
        return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _deterministic_key(*parts: Any) -> str:
    """Stable hash for default idempotency keys.  The same plan produces
    the same keys across runs, which is the property retry safety
    depends on."""
    import hashlib
    import json
    payload = json.dumps(parts, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def new_run_id() -> str:
    return f"run-{uuid.uuid4().hex[:12]}"


# A type alias for a tool handler.  The runtime calls the handler with
# the PlanStep; the handler returns a (result_dict, cost_snapshot) pair
# or raises.  Handlers MUST be idempotent: a re-invocation with the
# same idempotency_key must be a no-op (or, at worst, return the same
# result without producing new side effects).
ToolHandlerResult = tuple[Dict[str, Any], CostSnapshot]
ToolHandler = Callable[[PlanStep], ToolHandlerResult]
