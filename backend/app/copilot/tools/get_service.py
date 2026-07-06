"""Co-pilot tool: ``get_service``.

Returns one :class:`app.db.models.architecture_services.Service` row
plus its incoming/outgoing :class:`KGEdge` rows as a flat dependency
list. Tenant-scoped — a cross-tenant lookup returns ``None`` (which
the tool surfaces as a ``not_found`` flag without leaking the row's
existence to other tenants).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.architecture_services import Service
from app.db.session import get_session_factory
from app.services.knowledge_graph import KGEdge
from app.services.rbac import COPILOT_PERMISSION_TOOL_GET_SERVICE

logger = get_logger(__name__)


class GetServiceTool:
    """Fetch a single service + its dependency edges."""

    name = "get_service"
    description = (
        "Fetch a service by id, including its name, description, owner "
        "team, and direct dependencies (incoming + outgoing edges in "
        "the knowledge graph)."
    )
    permission = COPILOT_PERMISSION_TOOL_GET_SERVICE
    rate_limit_per_min = 30
    parameters_schema: dict = {
        "type": "object",
        "properties": {"service_id": {"type": "string", "minLength": 1}},
        "required": ["service_id"],
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
        raw = args.get("service_id")
        if not isinstance(raw, str) or not raw.strip():
            raise ToolArgumentInvalid(
                self.name, "service_id is required (uuid)", field="service_id"
            )
        service_id = raw.strip()

        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Service).where(
                Service.tenant_id == str(tenant_id),
                Service.id == service_id,
            )
            if project_id is not None:
                stmt = stmt.where(Service.project_id == str(project_id))
            row = (await session.execute(stmt)).scalar_one_or_none()
            if row is None:
                logger.info(
                    "copilot.tool.get_service.not_found",
                    tenant_id=str(tenant_id),
                    principal=principal.user_id,
                    service_id=service_id,
                )
                return {"found": False, "service_id": service_id}
            edge_stmt = select(KGEdge).where(
                KGEdge.tenant_id == str(tenant_id),
                or_(KGEdge.from_node_id == service_id, KGEdge.to_node_id == service_id),
            )
            edges = list((await session.execute(edge_stmt)).scalars().all())

        dependencies = [
            {
                "edge_id": str(e.id),
                "edge_type": e.edge_type,
                "from_node_id": str(e.from_node_id),
                "to_node_id": str(e.to_node_id),
                "direction": "outgoing" if str(e.from_node_id) == service_id else "incoming",
            }
            for e in edges
        ]
        return {
            "found": True,
            "id": str(row.id),
            "name": row.name,
            "service_key": row.service_key,
            "description": row.description or "",
            "owner_team": row.owner_team,
            "lifecycle": str(
                row.lifecycle.value if hasattr(row.lifecycle, "value") else row.lifecycle
            ),
            "tier": row.tier,
            "tags": list(row.tags or []),
            "repo_url": (f"/architecture/services/{row.id}" if row.id else None),
            "dependencies": dependencies,
        }


tool_registry.register(GetServiceTool())


__all__ = ["GetServiceTool"]
