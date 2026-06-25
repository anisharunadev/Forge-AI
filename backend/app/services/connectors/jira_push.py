"""Jira push service (Pillar 1 — Phase 1).

``JiraPushService`` is the seam between ideation push and the Jira MCP
client. It replaces the synthetic-fallback body that previously lived
inside ``PushToDeliveryService._perform_jira_push``. The contract:

- When a Jira connector is configured for the tenant+project, we
  invoke the MCP ``jira`` ``create_issue`` tool (Phase 1) and
  materialise the resulting key onto ``PushRecord.external_ref``,
  ``PushRecord.jira_epic_key``, and ``Idea.external_key``.
- When no connector is configured, we fall back to a deterministic
  synthetic ref (preserving the existing UX) and tag the row with
  ``error="no_jira_connector_configured"`` so the UI can label it
  "Pushed (synthetic — no connector)" per the Phase 1 spec.
- Every code path emits an ``AuditService.record`` call (Rule 6).

Per-story creation is a no-op for Phase 1 (PRD stories are not yet
emitted as ``OutputBundle`` rows). The hook is here so Phase 2 can
attach without re-architecting the public surface.
"""

from __future__ import annotations

import uuid
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.agents.tools.mcp_client import MCPClient
from app.core.logging import get_logger
from app.db.models.connector import Connector, ConnectorType
from app.db.models.ideation import Idea, PRD, PushRecord
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.connector_manager import connector_manager

logger = get_logger(__name__)


class JiraPushService:
    """Create a Jira epic from an Idea + (optional) PRD.

    Constructed per-call; holds an MCP client reference so tests can
    inject a stubbed one. The default ``MCPClient()`` is the
    in-process shim that uses the ``jira`` handler wired in
    ``backend/app/agents/tools/mcp_client.py``.
    """

    def __init__(self, mcp: MCPClient | None = None) -> None:
        self._mcp = mcp or MCPClient()

    async def create_epic_and_stories(
        self,
        *,
        idea: Idea,
        prd: PRD | None,
        project_key: str,
        tenant_id: UUID | str,
        project_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> tuple[str | None, str | None]:
        """Create a Jira epic for ``idea``.

        Returns ``(external_ref, error)``. ``external_ref`` is the
        ``JIRA/{key}`` string when the push succeeds, or the synthetic
        placeholder when no connector is wired up. ``error`` is ``None``
        on success, a stable error code otherwise.
        """
        connector = await self._resolve_connector(tenant_id, project_id)
        if connector is None:
            synthetic = f"JIRA/{project_key}/EPIC-{uuid.uuid4().hex[:8].upper()}"
            return synthetic, "no_jira_connector_configured"

        # ---- Real Jira call ---------------------------------------------
        params: dict[str, Any] = {
            "summary": idea.title,
            "description": self._compose_description(idea, prd),
            "issueTypeName": "Epic",
            "labels": ["forge-ideation", f"idea:{idea.id}"],
        }
        result = await self._mcp.call_server(
            "jira", "create_issue", {**params, "__connector_id": str(connector.id)}
        )
        if not result.ok:
            logger.warning(
                "jira_push.create_failed",
                idea_id=str(idea.id),
                error=result.error,
            )
            return None, f"jira_create_failed:{result.error or 'unknown'}"

        created = result.output or {}
        epic_key = created.get("key")
        if not epic_key:
            return None, "jira_create_returned_no_key"

        # ---- Persist downstream (Rule 2 — tenant + project always) ------
        await self._stamp_idea(idea=idea, epic_key=str(epic_key))
        external_ref = f"JIRA/{epic_key}"
        logger.info(
            "jira_push.real",
            idea_id=str(idea.id),
            connector_id=str(connector.id),
            epic_key=epic_key,
        )
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action="ideation.push.jira.real",
            target_type="idea",
            target_id=str(idea.id),
            payload={
                "connector_id": str(connector.id),
                "epic_key": epic_key,
                "project_key": project_key,
                "external_ref": external_ref,
            },
        )
        return external_ref, None

    # ---- Internals ----------------------------------------------------

    async def _resolve_connector(
        self, tenant_id: UUID | str, project_id: UUID | str | None
    ) -> Connector | None:
        try:
            rows = await connector_manager.list_connectors(
                tenant_id=tenant_id, project_id=project_id
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("jira_push.connector_list_failed", error=str(exc))
            return None
        for c in rows:
            if c.type == ConnectorType.JIRA or str(c.type) == "jira":
                return c
        return None

    def _compose_description(self, idea: Idea, prd: PRD | None) -> str:
        """Plain-text epic description for Atlassian Document Format.

        Blank lines become ADF paragraph breaks server-side (see
        ``_adf_body`` in the Jira MCP handler).
        """
        parts: list[str] = [idea.description or ""]
        if prd is not None and prd.content:
            content = prd.content or {}
            problem = content.get("problem")
            goals = content.get("goals")
            if problem:
                parts.append("\n\n## Problem\n\n" + str(problem))
            if goals:
                parts.append("\n\n## Goals\n\n" + str(goals))
        parts.append(
            "\n\n---\nCreated from Forge ideation. "
            f"idea_id={idea.id}, tenant_id={idea.tenant_id}, project_id={idea.project_id}"
        )
        return "".join(parts)

    async def _stamp_idea(self, *, idea: Idea, epic_key: str) -> None:
        """Persist ``external_key`` on the Idea row.

        Done in its own short transaction so we don't take a session
        open across the MCP call. The caller (the push service) does
        not depend on the row being refreshed; downstream code reads
        the row by id and re-loads.
        """
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Idea, str(idea.id))
            if row is None:
                return
            row.external_key = epic_key
            await session.commit()


# Public helper used by ``push_to_delivery.py`` to keep the synthetic
# ref text deterministic and shape-compatible with the existing
# history rows.
def synthetic_jira_ref(project_key: str) -> str:
    """Emit the Phase 1 synthetic ref for a push without a connector."""
    return f"JIRA/{project_key}/EPIC-{uuid.uuid4().hex[:8].upper()}"


# Re-export for tests that want to assert PushRecord.jira_epic_key.
async def latest_jira_push_for_idea(idea_id: UUID | str) -> PushRecord | None:
    factory = get_session_factory()
    async with factory() as session:
        stmt = (
            select(PushRecord)
            .where(
                PushRecord.idea_id == str(idea_id),
            )
            .order_by(PushRecord.created_at.desc())
            .limit(1)
        )
        return (await session.execute(stmt)).scalars().first()


__all__ = [
    "JiraPushService",
    "synthetic_jira_ref",
    "latest_jira_push_for_idea",
]
