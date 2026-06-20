"""
The Agent Runtime (FORA-30).

The plan-then-act execution loop every Forge sub-agent runs on top of.

Lifecycle of a run:

    1. PLAN     — validate the plan against the allow-list, refuse it
                  if any step references a tool not allowed in its
                  stage.
    2. ACT      — for each step in order: check the allow-list again
                  (defence in depth), invoke the handler under the
                  retry policy, charge the cost.
    3. OBSERVE  — the handler's result is recorded on the StepRecord;
                  no LLM is required for the observe step in v1; the
                  run captures the structured output.
    4. REFLECT  — the runtime returns the final RunRecord to the
                  caller.  The caller (a sub-agent) decides whether
                  to issue another plan (a "reflect-then-replan" loop)
                  or hand off to the next stage.

The runtime never makes a model call itself; it is the deterministic
spine the sub-agents sit on.  Model calls are step handlers.

A run produces one `RunRecord`.  The Audit system (FORA-21) reads it;
the Master Orchestrator (FORA-17) reads its `status` field.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from .allowlist import ToolAllowList
from .cost import CostBudget
from .retry import RetryConfig, retry_with_idempotency
from .schemas import (
    BudgetExceededError,
    CancelledError,
    CostSnapshot,
    IdempotencyConflictError,
    Plan,
    PlanStep,
    RetryRecord,
    RunRecord,
    RunStatus,
    Stage,
    StageStatus,
    StepExecutionError,
    StepRecord,
    ToolCall,
    ToolHandler,
    ToolNotAllowedError,
    ToolResult,
    new_run_id,
)

# Audit integration (FORA-36).  The runtime is the single emit
# boundary; every tool call passes through here.  An audit_store of
# None means "audit disabled" -- the runtime skips emission but
# preserves the same observable behaviour otherwise.
try:
    from agents.audit import (
        AuditStore,
        InMemoryStore,
        emit_run_finished as _audit_emit_run_finished,
        emit_run_started as _audit_emit_run_started,
        emit_tool_call as _audit_emit_tool_call,
    )
except ImportError:  # pragma: no cover -- audit module may be absent
    AuditStore = None  # type: ignore[assignment]
    InMemoryStore = None  # type: ignore[assignment]
    _audit_emit_tool_call = None  # type: ignore[assignment]
    _audit_emit_run_started = None  # type: ignore[assignment]
    _audit_emit_run_finished = None  # type: ignore[assignment]


_log = logging.getLogger("fora.runtime")


# A step executor is a function the runtime calls to execute one step.
# It is given the PlanStep, the handler, the cost budget, and the
# retry config; it is expected to call the handler under the retry
# policy and return a structured ToolResult plus the cost and retry
# records.  The default implementation is `_default_step_executor`;
# callers can inject their own for testing or for non-default retry
# policies.
StepExecutor = Callable[..., Tuple[ToolResult, CostSnapshot, List[RetryRecord]]]


# A stage handler is an optional callback the runtime invokes before
# entering a stage.  The plan stage calls it with the Plan; the act,
# observe, and reflect stages call it with the running RunRecord.  The
# default no-op is fine for most sub-agents; the callback exists so a
# sub-agent can stream progress to the audit log, gate on a
# pre-conditions check, or run a custom validator.
StageHandler = Callable[[Stage, Dict[str, Any]], None]


@dataclass
class RuntimeConfig:
    """The runtime's per-run configuration."""
    allowlist: ToolAllowList
    cost_budget: CostBudget
    retry: RetryConfig = field(default_factory=RetryConfig)
    run_id: str = field(default_factory=new_run_id)
    # If True, the runtime aborts the run if the plan references a
    # tool not in the allow-list *before* the first step.  Always True
    # in production; the smoke test sets it to False to exercise the
    # step-level check in isolation.
    pre_validate_plan: bool = True
    # Optional: invoked before each stage for observability.
    on_stage: Optional[StageHandler] = None
    # --- FORA-36 audit integration ------------------------------------
    # The audit store is the seam.  If set, every tool call emits
    # exactly one audit event.  `tenant_id` and `agent_id` carry the
    # identity required by the audit schema; `actor` is who initiated
    # the run (e.g. "user:alice", "agent:cto").  Defaults: a fresh
    # in-memory store with no tenant (caller is expected to set it
    # explicitly in production).  An audit_store of None means the
    # feature flag is off and no events are emitted.
    audit_store: Optional[object] = None
    tenant_id: str = ""
    agent_id: str = ""
    actor: str = ""
    request_id: str = ""


class AgentRuntime:
    """The plan-then-act execution loop.  Composed of the allow-list
    enforcer, the retry helper, and the cost budget.  A sub-agent
    instantiates one of these per run."""

    def __init__(self, config: RuntimeConfig,
                 step_executor: Optional[StepExecutor] = None) -> None:
        self.config = config
        self._step_executor = step_executor or _default_step_executor

    # -- public surface -----------------------------------------------------

    def run(self, plan: Plan, inputs: Dict[str, Any],
            handlers: Dict[str, ToolHandler]) -> RunRecord:
        """Execute `plan` against the registered handlers and return a
        `RunRecord`.  `handlers` maps `step.tool` to a callable; any
        step whose tool has no handler fails with a typed
        `StepExecutionError`."""
        record = RunRecord(
            run_id=self.config.run_id,
            plan=plan,
            inputs=dict(inputs),
            started_at=_now(),
        )
        # --- FORA-36: boundary event, "run started" ---
        self._audit_emit_run_started(record)
        try:
            # --- PLAN: validate the plan against the allow-list. ---
            self._invoke_stage(Stage.PLAN, {"plan": plan})
            if self.config.pre_validate_plan:
                try:
                    self._validate_plan(plan)
                except ToolNotAllowedError as exc:
                    # The plan validation refused the plan.  Emit a
                    # tool_call event for the offending step so the
                    # audit trail is complete even on abort.
                    self._audit_emit_rejection(exc)
                    raise
            record.status = RunStatus.SUCCEEDED  # may be downgraded below

            # --- ACT: execute each step. ---
            self._invoke_stage(Stage.ACT, {"record": record})
            for step in plan.steps:
                step_record = self._execute_step(step, handlers, record)
                record.steps.append(step_record)
                # --- FORA-36: per-step audit event ---
                self._audit_emit_step(step_record)
                if step_record.status == StageStatus.FAILED:
                    record.status = RunStatus.FAILED
                    record.error = {
                        "code": step_record.result.error_code if step_record.result else "STEP_FAILED",
                        "message": step_record.result.error_message if step_record.result
                                   else f"step {step.step_id} failed",
                        "step_id": step.step_id,
                    }
                    break

            # --- OBSERVE: roll up the structured output. ---
            self._invoke_stage(STAGE_OBSERVE, {"record": record})
            if record.status == RunStatus.SUCCEEDED:
                record.output = _roll_up_output(record)

            # --- REFLECT: stamp the final record. ---
            self._invoke_stage(STAGE_REFLECT, {"record": record})

        except ToolNotAllowedError as exc:
            record.status = RunStatus.TOOL_NOT_ALLOWED
            record.error = exc.to_dict()
            _log.error("run_aborted run_id=%s code=%s", record.run_id, exc.code)
        except BudgetExceededError as exc:
            record.status = RunStatus.BUDGET_EXCEEDED
            record.error = exc.to_dict()
            _log.error("run_aborted run_id=%s code=%s", record.run_id, exc.code)
        except IdempotencyConflictError as exc:
            record.status = RunStatus.IDEMPOTENCY_CONFLICT
            record.error = exc.to_dict()
            _log.error("run_aborted run_id=%s code=%s", record.run_id, exc.code)
        except CancelledError as exc:
            record.status = RunStatus.CANCELLED
            record.error = exc.to_dict()
            _log.warning("run_cancelled run_id=%s", record.run_id)
        except StepExecutionError as exc:
            record.status = RunStatus.FAILED
            record.error = exc.to_dict()
            _log.error("run_failed run_id=%s code=%s", record.run_id, exc.code)
        except Exception as exc:  # noqa: BLE001
            record.status = RunStatus.FAILED
            record.error = {"code": "UNEXPECTED", "message": str(exc)}
            _log.exception("run_unexpected run_id=%s", record.run_id)
        finally:
            record.finished_at = _now()
            record.total_cost = self.config.cost_budget.snapshot()
            # --- FORA-36: boundary event, "run finished" ---
            self._audit_emit_run_finished(record)
        return record

    # -- internals ----------------------------------------------------------

    def _validate_plan(self, plan: Plan) -> None:
        """Refuse the plan if any step references a tool that is not
        in the allow-list for the step's stage.  A refusal here is
        fatal; the runtime never silently drops a step."""
        for step in plan.steps:
            self.config.allowlist.check(step.stage, step.tool)

    def _execute_step(self, step: PlanStep, handlers: Dict[str, ToolHandler],
                      record: RunRecord) -> StepRecord:
        """Execute one plan step under the retry + cost policy."""
        step_record = StepRecord(
            step_id=step.step_id,
            stage=step.stage,
            status=StageStatus.RUNNING,
            tool=step.tool,
            started_at=_now(),
        )
        call = ToolCall(
            call_id=f"call-{uuid.uuid4().hex[:10]}",
            tool=step.tool,
            arguments=dict(step.arguments),
            stage=step.stage,
            idempotency_key=step.idempotency_key,
        )
        step_record.call = call

        # Defence in depth: check the allow-list again at step
        # dispatch time, in case a malicious plan somehow bypassed the
        # pre-validation.  A tool that was allowed at plan-validation
        # time but is no longer in the live allow-list (e.g. a
        # mid-run revocation) is caught here.
        try:
            self.config.allowlist.check(step.stage, step.tool)
        except ToolNotAllowedError:
            step_record.status = StageStatus.FAILED
            step_record.result = ToolResult(
                call_id=call.call_id, tool=call.tool, ok=False,
                error_code="TOOL_NOT_ALLOWED",
                error_message=f"tool {call.tool!r} refused by allow-list at dispatch",
            )
            step_record.finished_at = _now()
            return step_record

        handler = handlers.get(step.tool)
        if handler is None:
            step_record.status = StageStatus.FAILED
            step_record.result = ToolResult(
                call_id=call.call_id, tool=call.tool, ok=False,
                error_code="NO_HANDLER",
                error_message=f"no handler registered for tool {call.tool!r}",
            )
            step_record.finished_at = _now()
            return step_record

        try:
            result, cost, retries = self._step_executor(
                step, handler, self.config.cost_budget,
                retry_cfg=self.config.retry,
            )
        except BudgetExceededError as exc:
            self.config.cost_budget  # ensure snapshot is up to date
            step_record.status = StageStatus.FAILED
            step_record.result = ToolResult(
                call_id=call.call_id, tool=call.tool, ok=False,
                error_code=exc.code, error_message=str(exc),
            )
            step_record.retries = []
            step_record.cost = CostSnapshot()
            step_record.finished_at = _now()
            raise
        except StepExecutionError as exc:
            step_record.status = StageStatus.FAILED
            step_record.result = ToolResult(
                call_id=call.call_id, tool=call.tool, ok=False,
                error_code=exc.context.get("error_code", exc.code),
                error_message=str(exc),
            )
            step_record.retries = []  # recorded inside retry helper
            step_record.cost = CostSnapshot()
            step_record.finished_at = _now()
            return step_record
        except IdempotencyConflictError as exc:
            step_record.status = StageStatus.FAILED
            step_record.result = ToolResult(
                call_id=call.call_id, tool=call.tool, ok=False,
                error_code=exc.code, error_message=str(exc),
            )
            step_record.retries = []
            step_record.cost = CostSnapshot()
            step_record.finished_at = _now()
            raise

        step_record.result = result
        step_record.retries = retries
        step_record.cost = cost
        step_record.status = StageStatus.SUCCEEDED if result.ok else StageStatus.FAILED
        step_record.finished_at = _now()
        return step_record

    def _invoke_stage(self, stage: Stage, payload: Dict[str, Any]) -> None:
        if self.config.on_stage is None:
            return
        try:
            self.config.on_stage(stage, payload)
        except Exception:  # noqa: BLE001
            _log.exception("stage_handler_failed stage=%s", stage.value)

    # -- FORA-36 audit integration -----------------------------------------

    def _audit_emit_run_started(self, record: RunRecord) -> None:
        """Emit the `run_started` boundary event.  No-op when the
        audit store is not configured."""
        if _audit_emit_run_started is None or self.config.audit_store is None:
            return
        if not self.config.tenant_id or not self.config.agent_id:
            _log.debug("audit_skipped reason=missing_identity")
            return
        try:
            _audit_emit_run_started(
                self.config.audit_store,
                run_id=record.run_id,
                agent_id=self.config.agent_id,
                tenant_id=self.config.tenant_id,
                actor=self.config.actor,
                request_id=self.config.request_id,
                metadata={"planId": record.plan.plan_id, "goal": record.plan.goal},
            )
        except Exception:  # noqa: BLE001
            # Audit emission must never break a run.  Log and move on.
            _log.exception("audit_emit_failed stage=run_started run_id=%s", record.run_id)

    def _audit_emit_run_finished(self, record: RunRecord) -> None:
        """Emit the `run_finished` boundary event.  Carries the
        aggregate cost so the cost summary can be reconstructed
        even if the per-step events were lost."""
        if _audit_emit_run_finished is None or self.config.audit_store is None:
            return
        if not self.config.tenant_id or not self.config.agent_id:
            return
        try:
            _audit_emit_run_finished(
                self.config.audit_store,
                run_id=record.run_id,
                agent_id=self.config.agent_id,
                tenant_id=self.config.tenant_id,
                status=record.status.value if isinstance(record.status, RunStatus) else str(record.status),
                cost_cents=int(round(record.total_cost.usd * 100)),
                prompt_tokens=record.total_cost.tokens_in,
                completion_tokens=record.total_cost.tokens_out,
                wall_ms=0.0,
                actor=self.config.actor,
                request_id=self.config.request_id,
            )
        except Exception:  # noqa: BLE001
            _log.exception("audit_emit_failed stage=run_finished run_id=%s", record.run_id)

    def _audit_emit_step(self, step_record: StepRecord) -> None:
        """Emit one `tool_call` audit event for the executed step.
        Defensive: a missing call, result, or cost field is treated
        as zero; we never raise out of the audit path."""
        if _audit_emit_tool_call is None or self.config.audit_store is None:
            return
        if not self.config.tenant_id or not self.config.agent_id:
            return
        call = step_record.call
        result = step_record.result
        if call is None:
            return
        cost = step_record.cost or CostSnapshot()
        duration_ms = result.duration_ms if result is not None else 0.0
        try:
            _audit_emit_tool_call(
                self.config.audit_store,
                run_id=self.config.run_id,
                agent_id=self.config.agent_id,
                tenant_id=self.config.tenant_id,
                stage=call.stage.value if isinstance(call.stage, Stage) else str(call.stage),
                tool=call.tool,
                arguments=call.arguments,
                output=result.output if result is not None else None,
                cost_cents=int(round(cost.usd * 100)),
                prompt_tokens=cost.tokens_in,
                completion_tokens=cost.tokens_out,
                wall_ms=float(duration_ms or 0.0),
                call_id=call.call_id,
                step_id=step_record.step_id,
                idempotency_key=call.idempotency_key,
                error_code=result.error_code if result is not None and not result.ok else "",
                actor=self.config.actor,
                request_id=self.config.request_id,
            )
        except Exception:  # noqa: BLE001
            _log.exception("audit_emit_failed stage=tool_call step_id=%s", step_record.step_id)

    def _audit_emit_rejection(self, exc: ToolNotAllowedError) -> None:
        """Emit a tool_call event for a plan that was rejected by
        the allow-list before any step ran.  The error context
        carries the offending `stage` and `tool`; we synthesise
        the rest from the empty defaults.  This keeps the audit
        trail complete when the run aborts at the plan gate."""
        if _audit_emit_tool_call is None or self.config.audit_store is None:
            return
        if not self.config.tenant_id or not self.config.agent_id:
            return
        try:
            _audit_emit_tool_call(
                self.config.audit_store,
                run_id=self.config.run_id,
                agent_id=self.config.agent_id,
                tenant_id=self.config.tenant_id,
                stage=str(exc.context.get("stage", "")),
                tool=str(exc.context.get("tool", "")),
                arguments={},
                output=None,
                cost_cents=0,
                prompt_tokens=0,
                completion_tokens=0,
                wall_ms=0.0,
                call_id="",
                step_id="",
                idempotency_key="",
                error_code=exc.code,
                actor=self.config.actor,
                request_id=self.config.request_id,
            )
        except Exception:  # noqa: BLE001
            _log.exception("audit_emit_failed stage=plan_rejection")


# ---------------------------------------------------------------------------
# Default step executor
# ---------------------------------------------------------------------------

def _default_step_executor(
    step: PlanStep,
    handler: ToolHandler,
    cost_budget: CostBudget,
    retry_cfg: RetryConfig,
) -> Tuple[ToolResult, CostSnapshot, List[RetryRecord]]:
    """Run one step under the retry policy, charge the cost, and return
    a structured ToolResult plus the cost + retry records."""
    call_id = f"call-{uuid.uuid4().hex[:10]}"
    t0 = time.time()
    # `retry_with_idempotency` returns ((output_dict, cost), records).
    (output, cost), retries = retry_with_idempotency(
        step, handler, retry_cfg, cost_budget=cost_budget,
    )
    duration_ms = (time.time() - t0) * 1000
    # Charge the cost.  A BudgetExceededError raised here propagates
    # to the runtime's exception handler, which marks the run as
    # budget-exceeded and surfaces the typed error.
    cost_budget.charge(cost)
    result = ToolResult(
        call_id=call_id, tool=step.tool, ok=True,
        output=output, cost=cost, duration_ms=duration_ms,
    )
    return result, cost, retries


# Forward refs to the Stage enum so the stage names show up in logs
# without a second import block.
STAGE_OBSERVE = Stage.OBSERVE
STAGE_REFLECT = Stage.REFLECT


def _roll_up_output(record: RunRecord) -> Any:
    """The default OBSERVE step.  Returns the last successful step's
    output, plus a digest of all step outputs.  Sub-agents can replace
    this by registering a stage handler that mutates `record`."""
    successful = [s for s in record.steps if s.status == StageStatus.SUCCEEDED]
    if not successful:
        return None
    return {
        "last_output": successful[-1].result.output if successful[-1].result else None,
        "step_outputs": [
            {"step_id": s.step_id, "tool": s.tool, "output": s.result.output if s.result else None}
            for s in successful
        ],
    }


def _now() -> str:
    import datetime as dt
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
