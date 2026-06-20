"""
End-to-end smoke test for the audit + runtime integration
(FORA-36 AC: "Every tool call from a sub-agent emits exactly one
audit event.").

Drives the runtime through a real 3-step plan, then asserts:

    1. Exactly 5 events landed in the audit store (run_started,
       3 tool_calls, run_finished).
    2. The tool_call events carry the schema fields from the
       issue body, in the right place.
    3. The chain is intact (verify_run returns ok=True).
    4. A failed step (allowlist rejection) still emits an event
       so the audit trail is complete even on abort.
    5. The cost summary derives from the audit events alone.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.audit import AuditReader, InMemoryStore  # noqa: E402
from agents.audit.schema import AuditEventType  # noqa: E402
from agents.runtime import (  # noqa: E402
    AgentRuntime,
    CostBudget,
    CostSnapshot,
    Plan,
    PlanStep,
    RetryConfig,
    RuntimeConfig,
    Stage,
    ToolAllowList,
)


class CountingHandler:
    def __init__(self) -> None:
        self.calls: List[str] = []

    def __call__(self, step: PlanStep):
        self.calls.append(step.tool)
        return ({"echo": step.arguments, "ok": True},
                CostSnapshot(tokens_in=20, tokens_out=10, usd=0.02))


def _runtime_with_audit(allowlist: ToolAllowList, store: InMemoryStore,
                        *, tenant: str = "acme", agent: str = "agent-1",
                        actor: str = "user:alice") -> AgentRuntime:
    return AgentRuntime(RuntimeConfig(
        allowlist=allowlist,
        cost_budget=CostBudget(max_usd=10.0),
        retry=RetryConfig(max_attempts=1, initial_backoff_s=0.01,
                          max_backoff_s=0.05, total_budget_s=2.0),
        run_id="run-audit-1",
        audit_store=store,
        tenant_id=tenant,
        agent_id=agent,
        actor=actor,
        request_id="req-xyz",
    ))


def _scenario_runtime_emits_one_event_per_tool_call() -> Tuple[Dict[str, Any], List[str]]:
    """AC1: every tool call emits exactly one audit event.  A
    3-step plan produces 3 tool_call events (plus 2 boundaries)."""
    store = InMemoryStore()
    rt = _runtime_with_audit(
        ToolAllowList.of({Stage.ACT: {"echo"}}),
        store,
    )
    h = CountingHandler()
    plan = Plan(
        plan_id="plan-1", goal="emit 3 events",
        steps=[
            PlanStep(step_id="s1", stage=Stage.ACT, tool="echo", arguments={"i": 1}),
            PlanStep(step_id="s2", stage=Stage.ACT, tool="echo", arguments={"i": 2}),
            PlanStep(step_id="s3", stage=Stage.ACT, tool="echo", arguments={"i": 3}),
        ],
    )
    record = rt.run(plan, inputs={}, handlers={"echo": h})
    reader = AuditReader(store)
    events = store.list_for_run("acme", "run-audit-1")
    failures: List[str] = []
    if record.status.value != "succeeded":
        failures.append(f"runtime status={record.status.value!r}, expected 'succeeded'")
    if len(events) != 5:
        failures.append(f"expected 5 events (start+3+finish), got {len(events)}")
    tool_calls = [e for e in events if e.event_type == AuditEventType.TOOL_CALL]
    if len(tool_calls) != 3:
        failures.append(f"expected 3 tool_call events, got {len(tool_calls)}")
    ok, breaks = reader.verify_run("acme", "run-audit-1")
    if not ok:
        failures.append(f"chain did not verify: {breaks}")
    # Each tool_call must carry the required fields.
    for i, ev in enumerate(tool_calls):
        d = ev.to_dict()
        for f in ("runId", "agentId", "tenantId", "stage", "tool",
                  "inputDigest", "outputDigest", "costCents",
                  "promptTokens", "completionTokens", "wallMs"):
            if f not in d:
                failures.append(f"tool_call {i} missing field {f!r}")
    if tool_calls and tool_calls[0].agent_id != "agent-1":
        failures.append(f"agent_id={tool_calls[0].agent_id!r}, expected 'agent-1'")
    if tool_calls and tool_calls[0].actor != "user:alice":
        failures.append(f"actor={tool_calls[0].actor!r}, expected 'user:alice'")
    if tool_calls and tool_calls[0].request_id != "req-xyz":
        failures.append(f"request_id={tool_calls[0].request_id!r}, expected 'req-xyz'")
    # Cost must be recorded in cents (USD 0.02 -> 2 cents).
    if tool_calls and tool_calls[0].cost_cents != 2:
        failures.append(f"cost_cents={tool_calls[0].cost_cents}, expected 2")
    return {
        "events": len(events),
        "toolCalls": len(tool_calls),
        "chainOk": ok,
    }, failures


def _scenario_failed_step_still_emits() -> Tuple[Dict[str, Any], List[str]]:
    """AC: a step that fails (allowlist rejection at plan validation)
    still emits a tool_call audit event.  The chain is complete
    even on abort so the board view can see what was attempted."""
    store = InMemoryStore()
    rt = _runtime_with_audit(
        ToolAllowList.of({Stage.ACT: {"good_tool"}}),
        store,
    )
    h = CountingHandler()
    plan = Plan(
        plan_id="plan-bad", goal="reference a forbidden tool",
        steps=[PlanStep(step_id="s1", stage=Stage.ACT, tool="forbidden_tool",
                        arguments={})],
    )
    record = rt.run(plan, inputs={}, handlers={"good_tool": h, "forbidden_tool": h})
    events = store.list_for_run("acme", "run-audit-1")
    failures: List[str] = []
    if record.status.value != "tool_not_allowed":
        failures.append(f"runtime status={record.status.value!r}, expected 'tool_not_allowed'")
    if len(events) != 3:
        failures.append(f"expected 3 events (start + 1 tool_call + finish), got {len(events)}")
    # The single tool_call must carry the typed error code and
    # the offending tool name.
    tool_calls = [e for e in events if e.event_type == AuditEventType.TOOL_CALL]
    if not tool_calls or tool_calls[0].error_code != "TOOL_NOT_ALLOWED":
        failures.append(
            f"tool_call error_code={tool_calls[0].error_code if tool_calls else None!r}, "
            f"expected 'TOOL_NOT_ALLOWED'"
        )
    if not tool_calls or tool_calls[0].tool != "forbidden_tool":
        failures.append(
            f"tool_call tool={tool_calls[0].tool if tool_calls else None!r}, "
            f"expected 'forbidden_tool'"
        )
    ok, breaks = AuditReader(store).verify_run("acme", "run-audit-1")
    if not ok:
        failures.append(f"chain broken after failed step: {breaks}")
    return {
        "events": len(events),
        "errorCode": tool_calls[0].error_code if tool_calls else None,
        "tool": tool_calls[0].tool if tool_calls else None,
        "chainOk": ok,
    }, failures


def _scenario_cost_summary_derives_from_audit() -> Tuple[Dict[str, Any], List[str]]:
    """AC: cost tracking 0.6 reads from this store rather than a
    parallel ledger.  The summary is the sum across all events,
    including the run_finished boundary event (which itself
    carries the aggregate cost as defence in depth)."""
    store = InMemoryStore()
    rt = _runtime_with_audit(
        ToolAllowList.of({Stage.ACT: {"echo"}}),
        store,
    )
    h = CountingHandler()
    plan = Plan(
        plan_id="plan-cost", goal="reconstruct cost from audit",
        steps=[
            PlanStep(step_id="s1", stage=Stage.ACT, tool="echo", arguments={"i": 1}),
            PlanStep(step_id="s2", stage=Stage.ACT, tool="echo", arguments={"i": 2}),
        ],
    )
    rt.run(plan, inputs={}, handlers={"echo": h})
    summary = AuditReader(store).cost_summary("acme", "run-audit-1")
    failures: List[str] = []
    # 2 tool calls at 2 cents each = 4 cents; the run_finished
    # boundary event also carries the aggregate (4 cents) for
    # defence in depth.  Total = 8 cents, 80 prompt tokens,
    # 40 completion tokens, 4 events.
    if summary["totalCostCents"] != 8:
        failures.append(f"totalCostCents={summary['totalCostCents']}, expected 8")
    if summary["totalPromptTokens"] != 80:
        failures.append(f"totalPromptTokens={summary['totalPromptTokens']}, expected 80")
    if summary["totalCompletionTokens"] != 40:
        failures.append(f"totalCompletionTokens={summary['totalCompletionTokens']}, expected 40")
    if summary["eventCount"] != 4:
        failures.append(f"eventCount={summary['eventCount']}, expected 4")
    return {
        "totalCostCents": summary["totalCostCents"],
        "eventCount": summary["eventCount"],
    }, failures


def _scenario_audit_disabled_keeps_runtime_clean() -> Tuple[Dict[str, Any], List[str]]:
    """The feature-flag path: no audit_store means no events are
    emitted and the runtime behaves exactly as before."""
    rt = AgentRuntime(RuntimeConfig(
        allowlist=ToolAllowList.of({Stage.ACT: {"echo"}}),
        cost_budget=CostBudget(max_usd=10.0),
        retry=RetryConfig(max_attempts=1, initial_backoff_s=0.01,
                          max_backoff_s=0.05, total_budget_s=2.0),
        run_id="run-no-audit",
        audit_store=None,
        tenant_id="",
        agent_id="",
    ))
    h = CountingHandler()
    plan = Plan(
        plan_id="plan-na", goal="no audit",
        steps=[PlanStep(step_id="s1", stage=Stage.ACT, tool="echo", arguments={})],
    )
    record = rt.run(plan, inputs={}, handlers={"echo": h})
    failures: List[str] = []
    if record.status.value != "succeeded":
        failures.append(f"status={record.status.value!r}, expected 'succeeded'")
    if len(h.calls) != 1:
        failures.append(f"handler called {len(h.calls)} times, expected 1")
    return {"auditStore": "None", "ok": True}, failures


def main() -> int:
    print("=" * 72)
    print("Audit + Runtime — integration smoke test (FORA-36 AC1: one event per call)")
    print("=" * 72)
    scenarios = [
        ("AC1 runtime emits one audit event per tool call (3-step plan)",
         _scenario_runtime_emits_one_event_per_tool_call),
        ("AC failed step (allowlist rejection) still emits an event",
         _scenario_failed_step_still_emits),
        ("AC cost summary derives from the audit events (FORA-75 contract)",
         _scenario_cost_summary_derives_from_audit),
        ("AC audit disabled (feature flag off) keeps runtime clean",
         _scenario_audit_disabled_keeps_runtime_clean),
    ]
    evidence: Dict[str, Any] = {"scenarios": {}}
    all_failures: List[str] = []
    for name, fn in scenarios:
        print(f"\n[{name}]")
        try:
            data, failures = fn()
        except Exception as exc:  # noqa: BLE001
            failures = [f"scenario raised: {exc!r}"]
            data = {"error": str(exc)}
        evidence["scenarios"][name] = data
        if failures:
            for f in failures:
                print(f"  FAIL: {f}")
                all_failures.append(f"{name}: {f}")
        else:
            print("  OK")
    out_dir = os.path.join(ROOT, "agents", "audit", "evidence")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "test_runtime_integration.json")
    with open(out_path, "w") as fp:
        json.dump(evidence, fp, indent=2, default=str)
    print(f"\nEvidence: {out_path}")
    print("=" * 72)
    if all_failures:
        print("FAIL")
        return 1
    print("OK: runtime integration emits one event per tool call, "
          "covers failed steps, and exposes the cost summary FORA-75 consumes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
