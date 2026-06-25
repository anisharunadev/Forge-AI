"""Co-pilot tool: ``list_recent_adrs``.

Returns the most-recent :class:`ADR` rows for the active project. Used
by the model to answer "what's the latest architecture decision?".
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.copilot.tools.base import Tool
from app.copilot.tools.registry import tool_registry
from app.db.models.architecture import ADR
from app.db.session import get_session_factory
from app.services.rbac import COPILOT_PERMISSION_TOOL_LIST_RECENT_ADRS

logger = get_logger(__name__)


class ListRecentAdrsTool:
    """List recent ADRs for the active project (or tenant if no project)."""

    name = "list_recent_adrs"
    description = (
        "List the most recent Architecture Decision Records for the "
        "active project. Returns id, title, status, and updated_at so "
        "the model can decide which ADRs to read in full."
    )
    permission = COPILOT_PERMISSION_TOOL_LIST_RECENT_ADRS
    rate_limit_per_min = 30
    parameters_schema: dict = {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
        },
        "additionalProperties": False,
    }

    async def execute(
        self,
        args: dict,
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> dict:
        limit = int(args.get("limit") or 10)
        limit = max(1, min(limit, 50))
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(ADR).where(ADR.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(ADR.project_id == str(project_id))
            stmt = stmt.order_by(ADR.updated_at.desc()).limit(limit)
            rows = list((await session.execute(stmt)).scalars().all())
        adrs = [
            {
                "id": str(r.id),
                "number": r.number,
                "title": r.title,
                "status": r.status,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]
        logger.info(
            "copilot.tool.list_recent_adrs",
            tenant_id=str(tenant_id),
            project_id=str(project_id) if project_id else None,
            principal=principal.user_id,
            returned=len(adrs),
        )
        return {"adrs": adrs, "total": len(adrs)}


tool_registry.register(ListRecentAdrsTool())


__all__ = ["ListRecentAdrsTool"]
