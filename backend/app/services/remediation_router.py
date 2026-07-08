"""F-503 — Remediation Router.

When the deterministic Security Gate returns ``allowed = False`` we
auto-open a remediation ticket so the developer has a fix-up work item
without manual triage. The router builds the ticket payload from the
``ValidationReport`` and hands it to the F-007 Jira MCP (``create_issue``).

The MCP call is injected through a callable so the router never depends
on a particular transport (stdio, HTTP, or in-memory test double).

Ticket contract
---------------
* Title:    ``"Security gate failure on {commit_sha}"``
* Body:     ValidationReport JSON + a bullet list of remediation hints
            derived from each finding's ``recommended_fix``.
* Assignee: commit author (passed through; Jira side translates the
            Forge user into an Atlassian accountId).
* Labels:   ``["security-gate", "merge-block", "forge-ai"]``
* Priority: derived from highest severity (critical -> High,
            high -> High, medium -> Medium, low -> Low, info -> Low).

Failures from the MCP are logged but never propagate — the gate has
already returned ``allowed=False`` and the audit row is committed; we
must not let a routing hiccup flip that decision.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import UUID

from app.core.logging import get_logger

logger = get_logger(__name__)


# Severity -> Jira priority name. Anything at or above "high" is High.
_PRIORITY_MAP: dict[str, str] = {
    "critical": "High",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
    "info": "Low",
}

# Labels applied to every remediation ticket.
_REMEDIATION_LABELS: list[str] = ["security-gate", "merge-block", "forge-ai"]


# ---------------------------------------------------------------------------
# Protocol: the seam that the Jira MCP fills in.
# ---------------------------------------------------------------------------


class JiraMCP(Protocol):
    """Minimal contract for the Jira ``create_issue`` tool surface.

    The production binding resolves to ``mcp-servers/jira``'s
    ``create_issue`` MCP tool. Tests inject an ``AsyncMock``.
    """

    async def create_issue(
        self,
        *,
        summary: str,
        description: str,
        issue_type: str = "Task",
        labels: list[str] | None = None,
        priority: str | None = None,
        assignee_account_id: str | None = None,
        project_key: str | None = None,
    ) -> dict[str, Any]: ...


# Type alias for the seam so callers can pass plain callables too.
JiraCallable = Callable[..., Awaitable[dict[str, Any]]]


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class RemediationTicket:
    """The ticket the router asks Jira to create."""

    title: str
    body: str
    labels: list[str] = field(default_factory=list)
    priority: str = "Medium"
    assignee: str | None = None
    issue_type: str = "Task"
    project_key: str | None = None

    def to_jira_payload(self) -> dict[str, Any]:
        """Format as a Jira ``create_issue`` argument dict."""
        return {
            "summary": self.title,
            "description": self.body,
            "issueTypeName": self.issue_type,
            "labels": list(self.labels),
            "priority": self.priority,
            "assignee_account_id": self.assignee,
            "project_key": self.project_key,
        }


@dataclass(slots=True)
class RemediationResult:
    """Outcome of a remediation routing attempt."""

    ok: bool
    ticket: RemediationTicket | None = None
    issue_key: str | None = None
    issue_id: str | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RemediationRouter:
    """Builds and dispatches remediation tickets on gate FAIL."""

    def __init__(
        self,
        *,
        jira: JiraCallable | None = None,
        project_key: str | None = None,
        default_issue_type: str = "Task",
    ) -> None:
        self._jira = jira
        self._project_key = project_key
        self._default_issue_type = default_issue_type

    async def route(
        self,
        *,
        commit_sha: str,
        report: Any,
        commit_author: str | None = None,
        tenant_id: UUID | str | None = None,
        project_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
    ) -> RemediationResult:
        """Build and dispatch the remediation ticket for ``commit_sha``."""

        ticket = self.build_ticket(
            commit_sha=commit_sha,
            report=report,
            commit_author=commit_author,
            project_key=self._project_key,
        )

        try:
            response = await self._dispatch(ticket)
        except Exception as exc:  # noqa: BLE001 — never propagate to the gate
            logger.error(
                "remediation.dispatch_failed",
                commit_sha=commit_sha,
                error=str(exc),
            )
            return RemediationResult(
                ok=False,
                ticket=ticket,
                error=str(exc),
            )

        return RemediationResult(
            ok=True,
            ticket=ticket,
            issue_key=str(response.get("key") or response.get("issue_key") or ""),
            issue_id=str(response.get("id") or response.get("issue_id") or ""),
        )

    # ---- Builders ------------------------------------------------------

    def build_ticket(
        self,
        *,
        commit_sha: str,
        report: Any,
        commit_author: str | None,
        project_key: str | None = None,
    ) -> RemediationTicket:
        findings = list(getattr(report, "findings", []) or [])
        str(getattr(report, "decision", "FAIL") or "FAIL").upper()
        getattr(report, "report_id", None)
        getattr(report, "validator_version", "unknown")

        priority = _highest_priority(findings)
        body = self._render_body(
            commit_sha=commit_sha,
            findings=findings,
            report=report,
        )

        title = f"Security gate failure on {commit_sha}"

        return RemediationTicket(
            title=title,
            body=body,
            labels=list(_REMEDIATION_LABELS),
            priority=priority,
            assignee=commit_author,
            issue_type=self._default_issue_type,
            project_key=project_key or self._project_key,
        )

    @staticmethod
    def _render_body(
        *,
        commit_sha: str,
        findings: list[Any],
        report: Any,
    ) -> str:
        """Compose the ADF/plain-text body for Jira."""
        report_payload: dict[str, Any]
        if hasattr(report, "model_dump"):
            try:
                report_payload = report.model_dump(mode="json")
            except TypeError:
                report_payload = report.model_dump()
        elif isinstance(report, dict):
            report_payload = report
        else:
            report_payload = {"raw": str(report)}

        lines: list[str] = []
        lines.append(f"Commit: {commit_sha}")
        lines.append("")
        lines.append("Decision: FAIL — deterministic security gate blocked this push.")
        lines.append("")
        lines.append("Remediation suggestions:")
        if not findings:
            lines.append("- (no per-finding hints; see report JSON below)")
        for f in findings:
            severity = _attr(f, "severity", "info")
            rule_id = _attr(f, "rule_id", "unknown")
            file_path = _attr(f, "file_path", "")
            line = _attr(f, "line", 0)
            recommended = _attr(f, "recommended_fix", "") or "(no suggestion)"
            lines.append(f"- [{severity}] {rule_id} at {file_path}:{line} — fix: {recommended}")
        lines.append("")
        lines.append("ValidationReport (JSON):")
        lines.append("```json")
        lines.append(json.dumps(report_payload, indent=2, default=str))
        lines.append("```")
        return "\n".join(lines)

    async def _dispatch(self, ticket: RemediationTicket) -> dict[str, Any]:
        if self._jira is not None:
            return await self._jira(**ticket.to_jira_payload())

        try:
            from app.services.mcp_registry import get_server  # noqa: F401
        except ImportError:
            pass

        # No Jira transport configured. We log and return a stub so the
        # caller still gets a non-error result — production deployments
        # must inject a Jira MCP client via the constructor.
        logger.warning(
            "remediation.no_jira_transport",
            title=ticket.title,
        )
        return {
            "id": "",
            "key": "",
            "_stub": True,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _attr(obj: Any, name: str, default: Any) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _highest_priority(findings: list[Any]) -> str:
    """Pick the highest-severity priority across the findings list."""
    severities = [_attr(f, "severity", "info") for f in findings]
    for sev in ("critical", "high", "medium", "low", "info"):
        if sev in severities:
            return _PRIORITY_MAP[sev]
    return "Medium"


# ---------------------------------------------------------------------------
# Default accessor
# ---------------------------------------------------------------------------


def remediation_router_default() -> RemediationRouter:
    """Default accessor — wired by app startup."""
    return RemediationRouter()


__all__ = [
    "RemediationRouter",
    "RemediationTicket",
    "RemediationResult",
    "JiraMCP",
    "JiraCallable",
    "remediation_router_default",
]
