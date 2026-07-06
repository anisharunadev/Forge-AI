"""Co-pilot tool: ``get_template``.

Returns a :class:`Template` by ``type`` (the unique key per artifact
kind). Templates are the scaffolding the model fills when generating
artifacts; surfacing them lets the model produce well-shaped outputs.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.template import Template
from app.db.session import get_session_factory
from app.services.rbac import COPILOT_PERMISSION_TOOL_GET_TEMPLATE

logger = get_logger(__name__)


class GetTemplateTool:
    """Fetch a single template by its key."""

    name = "get_template"
    description = (
        "Fetch a template by its key (e.g. 'adr-madr', 'risk-register'). "
        "Returns the template body and the variable schema the model "
        "must fill when generating an artifact."
    )
    permission = COPILOT_PERMISSION_TOOL_GET_TEMPLATE
    rate_limit_per_min = 30
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "template_key": {"type": "string", "minLength": 1},
        },
        "required": ["template_key"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        args: dict[str, Any],
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> dict[str, Any]:
        key = args.get("template_key")
        if not isinstance(key, str) or not key.strip():
            raise ToolArgumentInvalid(self.name, "template_key is required", field="template_key")
        template_key = key.strip()
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(Template)
                .where(
                    Template.tenant_id == str(tenant_id),
                    Template.type == template_key,
                )
                .order_by(Template.version.desc())
                .limit(1)
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
        if row is None:
            return {"found": False, "key": template_key}
        return {
            "found": True,
            "key": row.type,
            "name": row.name,
            "version": row.version,
            "content": dict(row.content or {}),
            "variables": list(row.variables or []),
        }


tool_registry.register(GetTemplateTool())


__all__ = ["GetTemplateTool"]
