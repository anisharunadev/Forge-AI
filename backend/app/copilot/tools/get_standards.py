"""Co-pilot tool: ``get_standards``.

Returns :class:`Standard` rows by ``name`` (case-insensitive). Standards
are tenant-scoped, optionally project-scoped. Used by the model to
answer "what's our policy on X?".
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.standard import Standard
from app.db.session import get_session_factory
from app.services.rbac import COPILOT_PERMISSION_TOOL_GET_STANDARDS

logger = get_logger(__name__)


class GetStandardsTool:
    """Fetch org standards by name (case-insensitive, exact match)."""

    name = "get_standards"
    description = (
        "Fetch one or more organization standards by their key (the "
        "standard's name). Standards are coding / process rules that "
        "apply tenant-wide or project-wide."
    )
    permission = COPILOT_PERMISSION_TOOL_GET_STANDARDS
    rate_limit_per_min = 30
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "keys": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
            },
        },
        "required": ["keys"],
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
        keys = args.get("keys")
        if not isinstance(keys, list) or not keys or not all(isinstance(k, str) for k in keys):
            raise ToolArgumentInvalid(
                self.name, "keys must be a non-empty list of strings", field="keys"
            )
        normalized = [k.strip() for k in keys if isinstance(k, str) and k.strip()]
        if not normalized:
            raise ToolArgumentInvalid(
                self.name, "keys must contain at least one non-empty string", field="keys"
            )

        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Standard).where(
                Standard.tenant_id == str(tenant_id),
                func.lower(Standard.name).in_([k.lower() for k in normalized]),
                Standard.status == "active",
            )
            rows = list((await session.execute(stmt)).scalars().all())

        found = {
            r.name.lower(): {
                "key": r.name,
                "name": r.name,
                "content": r.content,
                "version": r.version,
                "metadata": dict(r.metadata_ or {}),
            }
            for r in rows
        }
        standards = [found[k.lower()] for k in normalized if k.lower() in found]
        missing = [k for k in normalized if k.lower() not in found]
        return {"standards": standards, "missing": missing}


tool_registry.register(GetStandardsTool())


__all__ = ["GetStandardsTool"]
