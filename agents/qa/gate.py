"""
Run gate for the QA Agent.

The QA agent's TestRun is the gate token for the QA → Security
transition (workspace/memory/qa.md §5, ADR-0004 §3.2). The gate is a
first-class, injectable component: in production it posts a
`request_confirmation` interaction to the issue thread; in smoke
tests it is replaced with an in-process recorder. Either way, the
QA agent *must* call the gate, and a decision of `approved=True` is
the only path to "passed_to_security".

The shape mirrors `agents/ideation/approval.py` so the recording
pattern is identical between the two smoke tests. The payload is
different (a TestRun, not an epic), and the verdict tokens are
different (`pass`/`fail`/`needs_attention`, not just approved).
"""

from __future__ import annotations

import datetime as dt
import json
import os
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Request + decision dataclasses
# ---------------------------------------------------------------------------

@dataclass
class RunGateRequest:
    """A pending request for human approval of a QA TestRun.

    Carries the TestRun payload (already a dict via to_dict()) and a
    short summary the reviewer can read at a glance.
    """
    test_run_id: str
    test_plan_id: str
    verdict: str                # pass | fail | needs_attention
    source_pr: str
    summary: str
    test_run_payload: Dict[str, Any]
    requested_at: str = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc)
                              .strftime("%Y-%m-%dT%H:%M:%SZ"))


@dataclass
class RunGateDecision:
    """The human's response to a RunGateRequest.

    `approved=True` is the only path to `passed_to_security`. When
    `approved=False`, the agent stops the QA → Security hand-off and
    records the reason in the issue.
    """
    approved: bool
    reviewer: str
    reason: str = ""
    decided_at: str = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc)
                            .strftime("%Y-%m-%dT%H:%M:%SZ"))


# The gate is a callable that takes a RunGateRequest and returns a
# RunGateDecision. Production uses a real Paperclip interaction; the
# smoke test uses a recorder.
RunGate = Callable[[RunGateRequest], RunGateDecision]


# ---------------------------------------------------------------------------
# Production gate — posts a request_confirmation to Paperclip
# ---------------------------------------------------------------------------

class PaperclipRunGate:
    """Production gate that asks the Security lead via a Paperclip issue-thread
    interaction.

    The interaction uses `request_confirmation` with the TestRun as the
    target. When the reviewer accepts, the agent wakes with the decision
    and proceeds. When they reject, the agent stops the hand-off and
    records the reason in the issue.
    """

    def __init__(self, api_url: str, api_key: str, issue_id: str,
                 run_id: Optional[str] = None,
                 requester: str = "CTO Agent") -> None:
        self._api_url = api_url.rstrip("/")
        self._api_key = api_key
        self._issue_id = issue_id
        self._run_id = run_id
        self._requester = requester

    def __call__(self, request: RunGateRequest) -> RunGateDecision:
        body = {
            "kind": "request_confirmation",
            "idempotencyKey": f"qa-rungate:{request.test_run_id}",
            "title": f"Approve QA TestRun: {request.test_run_id} ({request.verdict})",
            "summary": request.summary,
            "continuationPolicy": "wake_assignee",
            "payload": {
                "version": 1,
                "prompt": f"Approve QA TestRun '{request.test_run_id}' "
                          f"(verdict={request.verdict}) for the Security stage?",
                "detailsMarkdown": _render_details(request),
                "acceptLabel": "Approve and pass to Security",
                "rejectLabel": "Block hand-off",
                "rejectRequiresReason": True,
                "rejectReasonLabel": "What should block the hand-off?",
                "supersedeOnUserComment": True,
            },
        }
        url = f"{self._api_url}/api/issues/{self._issue_id}/interactions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if self._run_id:
            headers["X-Paperclip-Run-Id"] = self._run_id
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"),
            headers=headers, method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp.read()
        except urllib.error.HTTPError as exc:
            # The agent should not proceed on a network failure.
            return RunGateDecision(approved=False, reviewer=self._requester,
                                   reason=f"run gate POST failed: HTTP {exc.code}")

        # The interaction is pending; the agent halts here. The run
        # resumes when the board accepts. Return a synthetic "pending"
        # decision so callers can treat it uniformly; the real decision
        # arrives in the next wake payload.
        return RunGateDecision(approved=False, reviewer="pending",
                               reason="awaiting human decision")


# ---------------------------------------------------------------------------
# Smoke-test gate — records every call and returns a pre-set decision
# ---------------------------------------------------------------------------

class RecordingRunGate:
    """In-process gate that records calls and returns a pre-set decision.

    The smoke test uses this to prove the gate was actually invoked
    (i.e. the QA → Security hand-off is real, not bypassed) without
    depending on a board user. Every `request` is appended to
    `self.requests` so the smoke test can assert on them.
    """

    def __init__(self, decision: RunGateDecision) -> None:
        self._decision = decision
        self.requests: List[RunGateRequest] = []

    def __call__(self, request: RunGateRequest) -> RunGateDecision:
        self.requests.append(request)
        return self._decision


# ---------------------------------------------------------------------------
# Card renderer
# ---------------------------------------------------------------------------

def _render_details(request: RunGateRequest) -> str:
    """Format a TestRun for the gate card."""
    payload = request.test_run_payload
    lines = [
        f"**TestRun:** {payload.get('test_run_id', '?')}",
        f"**TestPlan:** {payload.get('test_plan_id', '?')}",
        f"**Source PR:** {payload.get('source_pr', request.source_pr)}",
        "",
        f"**Status:** {payload.get('status', '?')}",
        f"**Verdict:** {payload.get('verdict', '?')}",
        f"**Mode:** {payload.get('mode', '?')}",
    ]
    if payload.get("failure_summary"):
        lines.append("")
        lines.append(f"**Failure summary:** {payload['failure_summary']}")
    tier_results = payload.get("tier_results", [])
    if tier_results:
        lines.append("")
        lines.append(f"**Tiers ({len(tier_results)}):**")
        for tr in tier_results:
            line = f"- `{tr.get('tier')}` [{tr.get('status')}]"
            if tr.get("total") is not None:
                line += f" total={tr['total']} passed={tr.get('passed', 0)} " \
                        f"failed={tr.get('failed', 0)} skipped={tr.get('skipped', 0)}"
            if tr.get("error"):
                line += f" error={tr['error']}"
            if tr.get("notes"):
                line += f"  notes: {tr['notes']}"
            lines.append(line)
    return "\n".join(lines)
