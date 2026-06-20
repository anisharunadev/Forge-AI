"""
Shared test helpers.  Keeps the test files small and consistent with
the audit test style (FORA-36).
"""

from __future__ import annotations

import json
import os
import sys
from typing import Callable, List, Tuple


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
EVIDENCE_DIR = os.path.abspath(os.path.join(HERE, "..", "evidence"))
os.makedirs(EVIDENCE_DIR, exist_ok=True)


def write_evidence(test: str, scenario: str, payload: dict) -> None:
    path = os.path.join(EVIDENCE_DIR, f"{test}_{scenario}.json")
    with open(path, "w", encoding="utf-8") as fp:
        json.dump(payload, fp, indent=2, sort_keys=True, default=str)


ScenarioResult = Tuple[dict, List[str]]
ScenarioFn = Callable[[], ScenarioResult]


def run(scenarios: List[Tuple[str, ScenarioFn]], *, test_name: str) -> int:
    """Run every (name, fn) pair, print `OK` / `FAIL`, return exit code."""
    failures_total: List[str] = []
    for name, fn in scenarios:
        try:
            summary, failures = fn()
        except Exception as exc:  # noqa: BLE001 -- tests should report, not raise
            failures = [f"scenario {name!r} raised {type(exc).__name__}: {exc}"]
            summary = {}
        write_evidence(test_name, name, {"summary": summary, "failures": failures})
        if failures:
            failures_total.append(f"[{name}] " + "; ".join(failures))
            print(f"FAIL {name}")
            for f in failures:
                print(f"  - {f}")
        else:
            print(f"OK   {name}")
    if failures_total:
        print(f"\n{test_name}: FAIL ({len(failures_total)} scenario(s) failed)")
        return 1
    print(f"\n{test_name}: OK ({len(scenarios)} scenario(s))")
    return 0


def populate_tenant_runs(
    store,
    tenant_id: str,
    *,
    runs: int = 10,
    tools: Tuple[str, ...] = ("llm.invoke", "jira.createIssue", "github.createPr"),
    stages: Tuple[str, ...] = ("ideation", "architect", "dev"),
    cost_per_event: int = 10,
) -> None:
    """Populate `runs` runs in `tenant_id` with a 3-event run record
    (started / 1 tool call / finished).  Cost is a constant so the
    expected totals are easy to assert."""
    from agents.audit import emit_run_finished, emit_run_started, emit_tool_call
    for r in range(runs):
        run_id = f"run-{tenant_id}-{r:03d}"
        emit_run_started(store, run_id=run_id, agent_id=f"agent-{r % 3}",
                         tenant_id=tenant_id, actor=f"user:{tenant_id}")
        for i, tool in enumerate(tools):
            stage = stages[i % len(stages)]
            emit_tool_call(
                store,
                run_id=run_id, agent_id=f"agent-{r % 3}", tenant_id=tenant_id,
                stage=stage, tool=tool,
                arguments={"i": i, "tenant": tenant_id, "run": r},
                output={"ok": True},
                cost_cents=cost_per_event,
                prompt_tokens=10, completion_tokens=5, wall_ms=10.0,
            )
        emit_run_finished(
            store, run_id=run_id, agent_id=f"agent-{r % 3}", tenant_id=tenant_id,
            status="succeeded",
            cost_cents=len(tools) * cost_per_event,
            prompt_tokens=len(tools) * 10,
            completion_tokens=len(tools) * 5,
            wall_ms=float(len(tools) * 10),
        )
