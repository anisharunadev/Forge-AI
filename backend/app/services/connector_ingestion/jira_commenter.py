"""Jira commenter (Pillar 1 — Phase 1).

Posts a status comment back to Jira when an ideation stage completes
(approval granted/denied in Phase 2, validator pass/fail in Phase 2,
SDLC agent completion in Phase 2). Phase 1 only wires the seam — no
automatic subscribers are registered yet; callers invoke
``JiraCommenter.post(...)`` directly from the service that owns the
stage transition.

The contract:

- Looks up the Jira connector for ``(tenant_id, project_id)``.
- Calls MCP ``jira`` ``add_comment`` with a plain-text body shaped
  ``[stage] outcome by actor at iso_ts\\nReport: link\\nForge run: …``.
- Emits an ``AuditService.record`` (Rule 6) regardless of outcome.
- Idempotent: same inputs → same body text, but Jira itself de-dupes
  via the created timestamp. We don't try to suppress repeat calls —
  the caller decides when to post.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from app.agents.tools.mcp_client import MCPClient
from app.core.logging import get_logger
from app.db.models.connector import Connector, ConnectorType
from app.services.audit_service import audit_service
from app.services.connector_manager import connector_manager

logger = get_logger(__name__)


class JiraCommenter:
    """Post a plain-text status comment to a Jira issue."""

    def __init__(self, mcp: MCPClient | None = None) -> None:
        self._mcp = mcp or MCPClient()

    async def post(
        self,
        *,
        issue_key: str,
        stage: str,
        outcome: str,
        actor_id: UUID | str,
        report_link: str | None,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        forge_run_id: str | None = None,
    ) -> bool:
        """Post a comment to ``issue_key``. Returns True on success."""
        if not issue_key:
            return False

        connector = await self._resolve_connector(tenant_id, project_id)
        if connector is None:
            await audit_service.record(
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
                action="jira.comment.skipped",
                target_type="jira_issue",
                target_id=str(issue_key),
                payload={"reason": "no_connector", "stage": stage, "outcome": outcome},
            )
            return False

        body = _render_body(
            stage=stage,
            outcome=outcome,
            actor_id=actor_id,
            report_link=report_link,
            forge_run_id=forge_run_id,
        )
        result = await self._mcp.call_server(
            "jira",
            "add_comment",
            {
                "issueIdOrKey": issue_key,
                "body": body,
                "__connector_id": str(connector.id),
            },
        )
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action="jira.comment.post" if result.ok else "jira.comment.failed",
            target_type="jira_issue",
            target_id=str(issue_key),
            payload={
                "stage": stage,
                "outcome": outcome,
                "connector_id": str(connector.id),
                "forge_run_id": forge_run_id,
                "ok": result.ok,
                "error": result.error,
            },
        )
        if not result.ok:
            logger.warning(
                "jira_comment.failed",
                issue_key=issue_key,
                stage=stage,
                error=result.error,
            )
        return result.ok

    async def _resolve_connector(
        self, tenant_id: UUID | str, project_id: UUID | str | None
    ) -> Connector | None:
        try:
            rows = await connector_manager.list_connectors(
                tenant_id=tenant_id, project_id=project_id
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("jira_comment.connector_list_failed", error=str(exc))
            return None
        for c in rows:
            if c.type == ConnectorType.JIRA or str(c.type) == "jira":
                return c
        return None


def _render_body(
    *,
    stage: str,
    outcome: str,
    actor_id: UUID | str,
    report_link: str | None,
    forge_run_id: str | None,
) -> str:
    iso = datetime.now(UTC).isoformat()
    lines = [f"[{stage}] {outcome} by {actor_id} at {iso}"]
    if report_link:
        lines.append(f"Report: {report_link}")
    if forge_run_id:
        lines.append(f"Forge run: {forge_run_id}")
    return "\n".join(lines)


__all__ = ["JiraCommenter"]
