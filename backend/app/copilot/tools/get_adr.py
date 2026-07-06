"""Co-pilot tool: ``get_adr``.

Returns one :class:`app.db.models.architecture.ADR` row in full,
including MADR-formatted ``context`` and ``decision`` markdown bodies.
Tenant-scoped.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.architecture import ADR
from app.db.session import get_session_factory
from app.services.rbac import COPILOT_PERMISSION_TOOL_GET_ADR

logger = get_logger(__name__)


class GetAdrTool:
    """Fetch one ADR by id (tenant-scoped)."""

    name = "get_adr"
    description = (
        "Fetch a single Architecture Decision Record by id, including "
        "the MADR-formatted context and decision body. Use "
        "list_recent_adrs to discover ids."
    )
    permission = COPILOT_PERMISSION_TOOL_GET_ADR
    rate_limit_per_min = 30
    parameters_schema: dict = {
        "type": "object",
        "properties": {"adr_id": {"type": "string", "minLength": 1}},
        "required": ["adr_id"],
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
        raw = args.get("adr_id")
        if not isinstance(raw, str) or not raw.strip():
            raise ToolArgumentInvalid(self.name, "adr_id is required", field="adr_id")
        adr_id = raw.strip()
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(ADR).where(
                ADR.tenant_id == str(tenant_id),
                ADR.id == adr_id,
            )
            if project_id is not None:
                stmt = stmt.where(ADR.project_id == str(project_id))
            row = (await session.execute(stmt)).scalar_one_or_none()
        if row is None:
            return {"found": False, "adr_id": adr_id}
        content = _render_adr_markdown(row)
        return {
            "found": True,
            "id": str(row.id),
            "number": row.number,
            "title": row.title,
            "status": row.status,
            "content": content,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }


def _render_adr_markdown(row: ADR) -> str:
    """Render the ADR as a MADR-flavored markdown block."""
    consequences = row.consequences or {}
    positive = consequences.get("positive") or []
    negative = consequences.get("negative") or []
    neutral = consequences.get("neutral") or []
    parts: list[str] = []
    parts.append(f"# {row.number:03d} — {row.title}")
    parts.append("")
    parts.append(f"* Status: `{row.status}`")
    parts.append("")
    parts.append("## Context")
    parts.append("")
    parts.append(row.context or "")
    parts.append("")
    parts.append("## Decision")
    parts.append("")
    parts.append(row.decision or "")
    if positive or negative or neutral:
        parts.append("")
        parts.append("## Consequences")
        if positive:
            parts.append("")
            parts.append("Positive:")
            for item in positive:
                parts.append(f"- {item}")
        if negative:
            parts.append("")
            parts.append("Negative:")
            for item in negative:
                parts.append(f"- {item}")
        if neutral:
            parts.append("")
            parts.append("Neutral:")
            for item in neutral:
                parts.append(f"- {item}")
    return "\n".join(parts).strip()


tool_registry.register(GetAdrTool())


__all__ = ["GetAdrTool"]
