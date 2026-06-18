"""
Ideation Agent — the first concrete sub-agent of the SDLC pipeline.

Public surface:

    with IdeationAgent(...) as agent:
        result = agent.run(input_brief)

The agent:

    1. Collects input signals from the configured sources.
       - GitHub MCP and Jira MCP are first-class and required.
       - Zendesk / Confluence / SonarQube / Market Intel are best-effort.
    2. Synthesizes a structured Epic from the signals.
    3. Validates the epic against the schema.
    4. Calls the human approval gate.
       - Approval  -> returns a `passed_to_architect` result.
       - Rejection -> returns a `rejected` result with the reason.
       - Pending   -> returns a `pending_human_review` result (production).
"""

from __future__ import annotations

import datetime as dt
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents._shared.mcp_client import StdioMcpClient  # noqa: E402

from .approval import (  # noqa: E402
    ApprovalDecision,
    ApprovalGate,
    ApprovalRequest,
    PaperclipApprovalGate,
    RecordingApprovalGate,
)
from .collectors import (  # noqa: E402
    collect_confluence,
    collect_github,
    collect_jira,
    collect_market_intel,
    collect_sonarqube,
    collect_zendesk,
)
from .schemas import Epic, InputSignal  # noqa: E402
from .synthesizer import synthesize  # noqa: E402


@dataclass
class AgentResult:
    """The outcome of an Ideation Agent run."""
    status: str                           # "passed_to_architect" | "rejected" | "pending_human_review"
    epic: Optional[Dict[str, Any]] = None
    signals: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    mcp_calls: List[Dict[str, Any]] = field(default_factory=list)
    approval_requests: int = 0
    approval_decision: Optional[Dict[str, Any]] = None
    validation_errors: List[str] = field(default_factory=list)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "epic": self.epic,
            "signals": self.signals,
            "mcp_calls": self.mcp_calls,
            "approval_requests": self.approval_requests,
            "approval_decision": self.approval_decision,
            "validation_errors": self.validation_errors,
            "error": self.error,
        }


class IdeationAgent:
    """The agent. Composes collectors, the synthesizer, and the approval gate."""

    def __init__(self, github_client: StdioMcpClient, jira_client: StdioMcpClient,
                 approval_gate: Optional[ApprovalGate] = None,
                 collectors: Optional[Dict[str, Callable[[Any], InputSignal]]] = None) -> None:
        self.github_client = github_client
        self.jira_client = jira_client
        self.approval_gate = approval_gate
        self._collectors = collectors or {
            "jira":         lambda: collect_jira(self.jira_client),
            "github":       lambda: collect_github(self.github_client),
            "zendesk":      lambda: collect_zendesk(),
            "confluence":   lambda: collect_confluence(),
            "sonarqube":    lambda: collect_sonarqube(),
            "market_intel": lambda: collect_market_intel(),
        }
        self._mcp_call_log: List[Dict[str, Any]] = []

    def run(self, input_brief: str = "") -> AgentResult:
        """Execute one full agent run. Returns an AgentResult."""
        signals: Dict[str, InputSignal] = {}
        for name, collect in self._collectors.items():
            try:
                signals[name] = collect()
            except Exception as exc:  # noqa: BLE001
                # Best-effort collection: record the failure and continue.
                signals[name] = InputSignal(
                    source=name, fetched_at=_now(), mode="error",
                    summary=f"collection failed: {exc}",
                )

        # Capture MCP call provenance for the audit trail.
        self._mcp_call_log = [
            {"server": "github", "tool": c.tool, "args": c.arguments,
             "ok": c.error is None, "error": c.error, "duration_ms": round(c.duration_ms, 1)}
            for c in self.github_client.call_log
        ] + [
            {"server": "jira", "tool": c.tool, "args": c.arguments,
             "ok": c.error is None, "error": c.error, "duration_ms": round(c.duration_ms, 1)}
            for c in self.jira_client.call_log
        ]

        # Synthesize the epic.
        epic = synthesize(signals)

        # Validate the epic before going anywhere near the human.
        validation_errors = epic.validate()
        signal_dicts = {k: v.to_dict() for k, v in signals.items()}
        if validation_errors:
            return AgentResult(
                status="rejected",
                epic=epic.to_dict(),
                signals=signal_dicts,
                mcp_calls=self._mcp_call_log,
                validation_errors=validation_errors,
                error="epic failed schema validation; not eligible for approval",
            )

        # Approval gate is mandatory; bypass is not allowed.
        if self.approval_gate is None:
            return AgentResult(
                status="rejected",
                epic=epic.to_dict(),
                signals=signal_dicts,
                mcp_calls=self._mcp_call_log,
                validation_errors=[],
                error="no approval gate configured; refusing to pass to Architect",
            )

        approval_request = ApprovalRequest(
            epic_id=epic.id, title=epic.title,
            summary=_approval_summary(epic),
            epic_payload=epic.to_dict(),
        )
        decision: ApprovalDecision = self.approval_gate(approval_request)

        if decision.approved:
            return AgentResult(
                status="passed_to_architect",
                epic=epic.to_dict(),
                signals=signal_dicts,
                mcp_calls=self._mcp_call_log,
                approval_requests=1,
                approval_decision=_decision_to_dict(decision),
            )
        if decision.reviewer == "pending":
            return AgentResult(
                status="pending_human_review",
                epic=epic.to_dict(),
                signals=signal_dicts,
                mcp_calls=self._mcp_call_log,
                approval_requests=1,
                approval_decision=_decision_to_dict(decision),
            )
        return AgentResult(
            status="rejected",
            epic=epic.to_dict(),
            signals=signal_dicts,
            mcp_calls=self._mcp_call_log,
            approval_requests=1,
            approval_decision=_decision_to_dict(decision),
            error=f"approval rejected: {decision.reason}",
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _approval_summary(epic: Epic) -> str:
    return (f"Epic {epic.id} — {epic.title}. "
            f"{len(epic.user_stories)} stories, {len(epic.acceptance_criteria)} AC. "
            f"Effort {epic.effort}, risk {epic.risk}.")


def _decision_to_dict(decision: ApprovalDecision) -> Dict[str, Any]:
    return {
        "approved": decision.approved,
        "reviewer": decision.reviewer,
        "reason": decision.reason,
        "decided_at": decision.decided_at,
    }
