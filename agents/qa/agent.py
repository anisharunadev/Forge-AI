"""
QA Agent (FORA-43) — the v1 deterministic scaffold.

Public surface:

    with QaAgent(...) as agent:
        result = agent.run(test_plan)

The agent:

    1. Collects input signals (PR diff, tech-stack, conventions).
    2. Validates the TestPlan (rejects malformed plans fast).
    3. Runs every tier's generator in TIER_RUN_ORDER.
    4. Builds a TestRun (with per-tier pass/fail) and a CoverageReport.
    5. Calls the run gate (when one is wired) and emits
       `passed_to_security=True` only on a real approval — the QA →
       Security hand-off is a gate, not a free pass.
    6. Returns an AgentResult that downstream stages (Security,
       DevOps) can read directly.

The v1 agent never calls a real LLM. The generators emit well-formed
skeleton files; an LLM-driven synthesis path slots in at Phase 2.
"""

from __future__ import annotations

import datetime as dt
import os
import sys
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from .collectors import (  # noqa: E402
    collect_conventions,
    collect_pr_diff,
    collect_tech_stack,
)
from .gate import RunGate, RunGateRequest, RunGateDecision  # noqa: E402
from .generators import build_coverage_report, run_generators  # noqa: E402
from .github_publisher import (  # noqa: E402
    GitHubPublisher,
    NoOpPublisher,
    PublishError,
    PublishMeta,
    make_publisher,
)
from .schemas import (  # noqa: E402
    CoverageReport,
    InputSignal,
    TestPlan,
    TestRun,
)


@dataclass
class AgentResult:
    """The outcome of one QaAgent.run() call.

    Statuses (mirrors TestRun.status):

    * ``passed``        — every required tier passed; coverage artifact attached.
    * ``partial``       — some required tiers passed; some are
                          ``not_implemented``; nothing failed.
    * ``failed``        — at least one tier failed.
    * ``blocked``       — plan validation failed or upstream signal missing.

    `passed_to_security` is the QA → Security hand-off token. It is
    True only when (a) the run's verdict is pass or needs_attention
    AND (b) the run gate approved. A plan validation failure or a
    missing run gate never produces `passed_to_security=True`.

    `publish_meta` (FORA-49) carries the publisher outcome when the
    agent opened or updated a `qa/test-gen` PR. It defaults to None
    on the no-publish path and is always None on a blocked result.
    """
    status: str
    test_run: Optional[Dict[str, Any]] = None
    coverage_report: Optional[Dict[str, Any]] = None
    signals: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    emitted_files: List[str] = field(default_factory=list)
    validation_errors: List[str] = field(default_factory=list)
    error: Optional[str] = None
    passed_to_security: bool = False
    gate_decision: Optional[Dict[str, Any]] = None
    gate_requests: int = 0
    v1_mode: bool = False
    publish_meta: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "test_run": self.test_run,
            "coverage_report": self.coverage_report,
            "signals": self.signals,
            "emitted_files": self.emitted_files,
            "validation_errors": self.validation_errors,
            "error": self.error,
            "passed_to_security": self.passed_to_security,
            "gate_decision": self.gate_decision,
            "gate_requests": self.gate_requests,
            "v1_mode": self.v1_mode,
            "publish_meta": self.publish_meta,
        }


class QaAgent:
    """The QA agent. Composes collectors, generators, the coverage
    report builder, the run gate, and the GitHub publisher."""

    def __init__(self,
                 collectors: Optional[Dict[str, Callable[[], InputSignal]]] = None,
                 out_dir: Optional[str] = None,
                 run_gate: Optional[RunGate] = None,
                 github_client: Optional[Any] = None,
                 publish: bool = False) -> None:
        # Collectors are injectable; defaults read the checked-in
        # workspace files. The phase-2 wiring swaps a collector for
        # an MCP-backed one without changing the agent.
        self._collectors = collectors or {
            "pr_diff":    lambda: collect_pr_diff(),
            "tech_stack": lambda: collect_tech_stack(),
            "conventions": lambda: collect_conventions(),
        }
        self._out_dir = out_dir
        # Optional: when present, the agent asks the gate for approval
        # before allowing the QA → Security hand-off. A missing gate
        # blocks the hand-off (the smoke test wires a recorder).
        self._run_gate = run_gate
        # FORA-49: when `publish=True` and a `github_client` is wired,
        # the agent runs the publish flow at the end of `run()`.
        # The default is `publish=False` so existing callers and the
        # smoke test never accidentally hit GitHub.
        self._github_client = github_client
        self._publish = bool(publish)

    # ------------------------------------------------------------------
    # Public surface
    # ------------------------------------------------------------------

    def run(self, test_plan: TestPlan) -> AgentResult:
        """Execute one full QA run. Returns an AgentResult."""
        v1_mode = bool(test_plan.v1_marker)

        # 1. Validate the plan first — refuse to run on a broken plan.
        validation_errors = test_plan.validate()
        if validation_errors:
            return AgentResult(
                status="blocked",
                validation_errors=validation_errors,
                error="test_plan failed schema validation; not eligible to run",
                v1_mode=v1_mode,
            )

        # 2. Collect signals (best-effort; missing source -> mode=error).
        signals = self._collect_signals()

        # 3. Run every tier.
        run: TestRun = run_generators(
            test_plan, signals, out_dir=self._out_dir,
        )

        # 4. Build coverage report.
        coverage: CoverageReport = build_coverage_report(run)

        # 5. Collect the emitted file paths for the orchestrator.
        emitted: List[str] = []
        for tr in run.tier_results:
            for c in tr.cases:
                if c.evidence and c.evidence not in emitted:
                    emitted.append(c.evidence)

        # 6. Run-gate hand-off. A real run gate is mandatory for the
        # QA → Security transition; the smoke test wires a recorder
        # that proves the gate was called.
        gate_requests = 0
        gate_decision: Optional[Dict[str, Any]] = None
        passed_to_security = False
        verdict = run.verdict
        run_payload = run.to_dict()
        # The source PR is needed for the gate card even when the
        # TestRun payload (in v1) does not carry it. Lift it from
        # the plan to keep the gate's contract stable.
        run_payload.setdefault("source_pr", test_plan.source_pr)

        # 7. FORA-49: publish to `qa/test-gen` when wired. The
        # publisher runs AFTER the run gate so a failed validation
        # never opens a follow-up PR. Publish failures are
        # recorded on the run payload but do not flip the run
        # status — a broken publish is observable, not a verdict.
        publish_meta_dict: Optional[Dict[str, Any]] = None
        if self._publish and emitted:
            try:
                publisher = make_publisher(
                    test_plan,
                    client=self._github_client,
                    publish=True,
                )
            except PublishError as exc:
                publish_meta_dict = {
                    "mode": "noop",
                    "source_pr": test_plan.source_pr,
                    "branch": GitHubPublisher.BRANCH,
                    "error": str(exc),
                }
            else:
                with publisher:
                    files_to_commit = _read_emitted_files(emitted)
                    publish_meta = publisher.publish(files_to_commit)
                publish_meta_dict = publish_meta.to_dict()
            run_payload["publish_meta"] = publish_meta_dict
        elif emitted and not self._publish:
            # Wire the NoOp meta so the evidence JSON always has a
            # well-formed publish_meta object and downstream
            # readers can tell `mode="noop"` from `mode=None`.
            noop = NoOpPublisher(source_pr=test_plan.source_pr)
            with noop:
                publish_meta_dict = noop.publish(
                    [{"path": p, "content": ""} for p in emitted]
                ).to_dict()
            run_payload["publish_meta"] = publish_meta_dict

        if self._run_gate is None:
            gate_decision = {
                "approved": False,
                "reviewer": "none",
                "reason": "no run gate wired; cannot pass to security",
            }
        else:
            gate_requests = 1
            request = RunGateRequest(
                test_run_id=run.test_run_id,
                test_plan_id=run.test_plan_id,
                verdict=verdict,
                source_pr=test_plan.source_pr,
                summary=(
                    f"{test_plan.source_pr} verdict={verdict} "
                    f"status={run.status} tiers={len(run.tier_results)}"
                ),
                test_run_payload=run_payload,
            )
            decision: RunGateDecision = self._run_gate(request)
            gate_decision = {
                "approved": decision.approved,
                "reviewer": decision.reviewer,
                "reason": decision.reason,
                "decided_at": decision.decided_at,
            }
            passed_to_security = bool(decision.approved)

        return AgentResult(
            status=run.status,
            test_run=run_payload,
            coverage_report=coverage.to_dict(),
            signals={k: v.to_dict() for k, v in signals.items()},
            emitted_files=emitted,
            passed_to_security=passed_to_security,
            gate_decision=gate_decision,
            gate_requests=gate_requests,
            v1_mode=v1_mode,
            publish_meta=publish_meta_dict,
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _collect_signals(self) -> Dict[str, InputSignal]:
        signals: Dict[str, InputSignal] = {}
        for name, collect in self._collectors.items():
            try:
                signals[name] = collect()
            except Exception as exc:  # noqa: BLE001
                # Best-effort: never let a single broken collector kill
                # the whole run. The failure is recorded as mode=error
                # so the audit log can group on it.
                signals[name] = InputSignal(
                    source=name, fetched_at=_now(), mode="error",
                    summary=f"collection failed: {exc}",
                )
        return signals


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_emitted_files(paths: List[str]) -> List[Dict[str, str]]:
    """Read each emitted test file off disk so the publisher can commit it.

    The QA agent writes the skeleton files under `out_dir`; the
    publisher's contract is "give me a list of (path, content)
    pairs to commit on the `qa/test-gen` branch". We read the bytes
    here so the publisher stays a pure MCP-driven component.

    Missing files are reported as empty content; the publisher
    still records the path so the audit log shows what was
    intended to commit.
    """
    out: List[Dict[str, str]] = []
    for p in paths:
        try:
            with open(p, "r", encoding="utf-8") as fp:
                content = fp.read()
        except (FileNotFoundError, IsADirectoryError, OSError):
            content = ""
        out.append({"path": p, "content": content})
    return out


def new_run_id() -> str:
    return f"qa-{uuid.uuid4().hex[:12]}"
