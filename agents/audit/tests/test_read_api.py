"""
Read API tests (FORA-36 deliverable: read API for board/CEO
inspection; tenant-scoped).

The board view pulls a single run and reconstructs the agent's
decision path; the cost summary is what FORA-75 reads.  The
tenant gate is the security boundary.
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.audit import (  # noqa: E402
    AuditReader,
    InMemoryStore,
    emit_run_finished,
    emit_run_started,
    emit_tool_call,
)


def _populate_two_tenants() -> InMemoryStore:
    store = InMemoryStore()
    for tenant, run in [("acme", "r1"), ("acme", "r2"), ("globex", "r1")]:
        emit_run_started(
            store, run_id=run, agent_id="agent-1", tenant_id=tenant,
            actor=f"user:{tenant}",
        )
        for i in range(3):
            emit_tool_call(
                store, run_id=run, agent_id="agent-1", tenant_id=tenant,
                stage="act", tool=f"t{i}",
                arguments={"i": i, "tenant": tenant},
                output={"ok": True},
                cost_cents=10 * (i + 1),
                prompt_tokens=100 * (i + 1),
                completion_tokens=50 * (i + 1),
                wall_ms=10.0 * (i + 1),
            )
        emit_run_finished(
            store, run_id=run, agent_id="agent-1", tenant_id=tenant,
            status="succeeded",
            cost_cents=60, prompt_tokens=600, completion_tokens=300,
            wall_ms=60.0,
        )
    return store


def _scenario_read_run_reconstructs_decision_path() -> tuple[dict, list[str]]:
    """AC: "A board user can pull the audit trail for a single
    run and reconstruct the agent's decision path."  The reader
    returns events in append order; the chain is intact."""
    store = _populate_two_tenants()
    reader = AuditReader(store)
    result = reader.read_run("acme", "r1")
    failures: list[str] = []
    if not result.chain_ok:
        failures.append(f"chain failed: {result.breaks}")
    if len(result.events) != 5:
        failures.append(f"expected 5 events (start + 3 calls + finish), got {len(result.events)}")
    # The first event is run_started; the last is run_finished.
    if result.events and result.events[0].event_type.value != "run_started":
        failures.append(f"first event type {result.events[0].event_type.value!r}")
    if result.events and result.events[-1].event_type.value != "run_finished":
        failures.append(f"last event type {result.events[-1].event_type.value!r}")
    return {"events": len(result.events), "chainOk": result.chain_ok}, failures


def _scenario_tenant_isolation() -> tuple[dict, list[str]]:
    """AC: tenant-scoped.  An acme reader cannot see globex events;
    a get() with the wrong tenant returns None even if the event
    id exists."""
    store = _populate_two_tenants()
    reader = AuditReader(store)
    acme_runs = {e.run_id for e in reader.read_tenant("acme")}
    globex_runs = {e.run_id for e in reader.read_tenant("globex")}
    failures: list[str] = []
    if "r1" not in acme_runs or "r2" not in acme_runs:
        failures.append(f"acme reader missing runs: {acme_runs}")
    if "r1" not in globex_runs:
        failures.append(f"globex reader missing r1: {globex_runs}")
    if acme_runs & globex_runs and "r1" in (acme_runs & globex_runs):
        # r1 is shared by name across tenants, so the runs themselves
        # are isolated but the names collide.  Check the events.
        acme_r1 = reader.read_run("acme", "r1").events
        globex_r1 = reader.read_run("globex", "r1").events
        acme_ids = {e.event_id for e in acme_r1}
        globex_ids = {e.event_id for e in globex_r1}
        if acme_ids & globex_ids:
            failures.append("event ids leak across tenants")
    # get() with a globex event id, queried as acme, must return None.
    globex_event_id = reader.read_run("globex", "r1").events[0].event_id
    cross = reader.get("acme", globex_event_id)
    if cross is not None:
        failures.append("cross-tenant get() returned an event; expected None")
    return {"acmeRuns": sorted(acme_runs), "globexRuns": sorted(globex_runs)}, failures


def _scenario_cost_summary_for_finance() -> tuple[dict, list[str]]:
    """AC: "Cost-tracking system 0.6 reads from this store rather
    than maintaining a parallel ledger."  The shape is the contract
    FORA-75 consumes.

    The summary is the sum across ALL events in the run, including
    the boundary `run_finished` event (which itself carries the
    aggregate cost as defence in depth).  3 tool calls at
    10+20+30 = 60 cents + the 60 cents on run_finished = 120 cents.
    `byTool` exposes 4 buckets: the three tool names plus a
    `<boundary>` bucket for the run_started/run_finished events."""
    store = _populate_two_tenants()
    reader = AuditReader(store)
    summary = reader.cost_summary("acme", "r1")
    failures: list[str] = []
    if summary["totalCostCents"] != 120:
        failures.append(f"totalCostCents={summary['totalCostCents']}, expected 120")
    if summary["totalPromptTokens"] != 1200:
        failures.append(f"totalPromptTokens={summary['totalPromptTokens']}, expected 1200")
    if summary["totalCompletionTokens"] != 600:
        failures.append(f"totalCompletionTokens={summary['totalCompletionTokens']}, expected 600")
    if summary["eventCount"] != 5:
        failures.append(f"eventCount={summary['eventCount']}, expected 5")
    by_tool = summary["byTool"]
    # 3 distinct tool names + 1 boundary bucket for run_started/run_finished.
    if len(by_tool) != 4:
        failures.append(f"byTool keys={sorted(by_tool)}, expected 4 (3 tools + 1 boundary)")
    # The per-tool bucket is the source of truth for per-tool cost.
    if by_tool.get("t0", {}).get("costCents") != 10:
        failures.append(f"t0.costCents={by_tool.get('t0', {}).get('costCents')}, expected 10")
    if by_tool.get("t2", {}).get("costCents") != 30:
        failures.append(f"t2.costCents={by_tool.get('t2', {}).get('costCents')}, expected 30")
    return {"totalCostCents": summary["totalCostCents"],
            "byToolKeys": sorted(by_tool)}, failures


def _scenario_verify_run_fast_path() -> tuple[dict, list[str]]:
    """The verify_run path is the cheap chain check; the board
    view calls it before rendering."""
    store = _populate_two_tenants()
    reader = AuditReader(store)
    ok, breaks = reader.verify_run("acme", "r1")
    failures: list[str] = []
    if not ok:
        failures.append(f"verify_run failed: {breaks}")
    if breaks:
        failures.append(f"verify_run reported {len(breaks)} breaks")
    return {"ok": ok, "breaks": len(breaks)}, failures


def main() -> int:
    print("=" * 72)
    print("Audit system — test_read_api (FORA-36: tenant-scoped read API)")
    print("=" * 72)
    scenarios = [
        ("AC read_run reconstructs the agent's decision path (board view)",
         _scenario_read_run_reconstructs_decision_path),
        ("AC tenant isolation: cross-tenant get() returns None",
         _scenario_tenant_isolation),
        ("AC cost_summary shape is the contract FORA-75 consumes",
         _scenario_cost_summary_for_finance),
        ("AC verify_run fast path is correct",
         _scenario_verify_run_fast_path),
    ]
    evidence: dict = {"scenarios": {}}
    all_failures: list[str] = []
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
    out_path = os.path.join(out_dir, "test_read_api.json")
    with open(out_path, "w") as fp:
        json.dump(evidence, fp, indent=2, default=str)
    print(f"\nEvidence: {out_path}")
    print("=" * 72)
    if all_failures:
        print("FAIL")
        return 1
    print("OK: read API reconstructs the decision path, "
          "is tenant-scoped, and exposes the cost summary for FORA-75")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
