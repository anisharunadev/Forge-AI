"""
Human approval gate for the Ideation Agent.

The gate is a first-class, injectable component. In production it
posts a `request_confirmation` interaction to the issue thread; in
smoke tests it is replaced with an in-process recorder. Either way,
the agent *must* call the gate, and a decision of `approved` is the
only path to "Architect-ready".
"""

from __future__ import annotations

import datetime as dt
import json
import os
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class ApprovalRequest:
    """A pending request for human approval of an epic."""
    epic_id: str
    title: str
    summary: str
    epic_payload: Dict[str, Any]
    requested_at: str = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc)
                              .strftime("%Y-%m-%dT%H:%M:%SZ"))


@dataclass
class ApprovalDecision:
    """The human's response to an ApprovalRequest."""
    approved: bool
    reviewer: str
    reason: str = ""
    decided_at: str = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc)
                            .strftime("%Y-%m-%dT%H:%M:%SZ"))


# The gate is a callable that takes an ApprovalRequest and returns an
# ApprovalDecision. Production uses a real one (Paperclip interaction);
# smoke tests use a recorder (see smoke_test.py).
ApprovalGate = Callable[[ApprovalRequest], ApprovalDecision]


class PaperclipApprovalGate:
    """Production gate that asks the CEO via a Paperclip issue-thread interaction.

    The interaction uses `request_confirmation` with the epic as the
    target. When the CEO accepts, the agent wakes with the decision
    and proceeds. When they reject, the agent stops and records the
    reason in the issue.
    """

    def __init__(self, api_url: str, api_key: str, issue_id: str,
                 run_id: Optional[str] = None,
                 requester: str = "CTO Agent") -> None:
        self._api_url = api_url.rstrip("/")
        self._api_key = api_key
        self._issue_id = issue_id
        self._run_id = run_id
        self._requester = requester

    def __call__(self, request: ApprovalRequest) -> ApprovalDecision:
        # Build the interaction payload.
        body = {
            "kind": "request_confirmation",
            "idempotencyKey": f"ideation-approval:{request.epic_id}",
            "title": f"Approve epic: {request.title}",
            "summary": request.summary,
            "continuationPolicy": "wake_assignee",
            "payload": {
                "version": 1,
                "prompt": f"Approve epic '{request.title}' to pass to the Architect stage?",
                "detailsMarkdown": _render_details(request),
                "acceptLabel": "Approve and pass to Architect",
                "rejectLabel": "Request changes",
                "rejectRequiresReason": True,
                "rejectReasonLabel": "What should change?",
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
            return ApprovalDecision(approved=False, reviewer=self._requester,
                                    reason=f"approval POST failed: HTTP {exc.code}")

        # The interaction is now pending. The agent halts here; the
        # run resumes when the board accepts. We return a synthetic
        # "pending" decision so callers can treat it uniformly; the
        # real decision arrives in the next wake payload.
        return ApprovalDecision(approved=False, reviewer="pending",
                                reason="awaiting human decision")


class RecordingApprovalGate:
    """In-process gate that records calls and returns a pre-set decision.

    The smoke test uses this to prove the gate was actually invoked
    (i.e. the approval flow is real, not bypassed) without depending
    on a board user.
    """

    def __init__(self, decision: ApprovalDecision) -> None:
        self._decision = decision
        self.requests: List[ApprovalRequest] = []

    def __call__(self, request: ApprovalRequest) -> ApprovalDecision:
        self.requests.append(request)
        return self._decision


def _render_details(request: ApprovalRequest) -> str:
    """Format an epic for the approval card."""
    payload = request.epic_payload
    lines = [
        f"**Epic:** {payload.get('title', '?')}",
        "",
        f"**Problem:** {payload.get('problem_statement', '?')}",
        "",
        f"**Solution:** {payload.get('proposed_solution', '?')}",
        "",
        f"**Effort:** {payload.get('effort', '?')} — {payload.get('effort_rationale', '')}",
        f"**Risk:** {payload.get('risk', '?')} — {payload.get('risk_summary', '')}",
        "",
        f"**User stories ({len(payload.get('user_stories', []))}):**",
    ]
    for us in payload.get("user_stories", []):
        lines.append(f"- `{us['id']}` [{us['priority']}, {us['story_points']}pt] "
                     f"{us['role']} → {us['capability']}")
    lines.append("")
    lines.append(f"**Acceptance criteria ({len(payload.get('acceptance_criteria', []))}):**")
    for ac in payload.get("acceptance_criteria", []):
        lines.append(f"- `{ac['id']}` Given {ac['given']} / When {ac['when']} / "
                     f"Then {ac['then']}")
    lines.append("")
    lines.append(f"**Dependencies ({len(payload.get('dependencies', []))}):**")
    for dep in payload.get("dependencies", []):
        lines.append(f"- {dep['type']}: {dep['name']} — {dep.get('note', '')}")
    lines.append("")
    arch = payload.get("architecture_impact", {})
    if arch:
        lines.append("**Architecture impact:**")
        for area in ("services", "data_model_changes", "api_changes", "cross_cutting"):
            for item in arch.get(area, []):
                lines.append(f"- {area}: {item}")
    return "\n".join(lines)
