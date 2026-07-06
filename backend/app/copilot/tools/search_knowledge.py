"""Co-pilot tool: ``search_knowledge``.

Hybrid search over the project knowledge graph. The query is run as a
SQL predicate over :class:`app.services.knowledge_graph.KGNode` rows;
``node_types`` narrows to a set of node kinds (service, adr, file, …).
Results are scoped by ``tenant_id`` and ``project_id`` (Rule 2).

The model sees a small list of nodes with a label + snippet. Detailed
property reads are deferred to :class:`get_service` / :class:`get_adr`.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.copilot import CopilotConversation  # noqa: F401  (loads model)
from app.db.models.standard import Standard  # noqa: F401  (loads model)
from app.db.models.template import Template  # noqa: F401  (loads model)
from app.db.session import get_session_factory
from app.services.knowledge_graph import KGNode
from app.services.rbac import COPILOT_PERMISSION_TOOL_SEARCH_KNOWLEDGE

logger = get_logger(__name__)


class SearchKnowledgeTool:
    """Hybrid search over the tenant-scoped KG nodes."""

    name = "search_knowledge"
    description = (
        "Search the project knowledge graph by free-text query. "
        "Returns matching nodes (services, ADRs, files, docs) with a "
        "label, kind, and short snippet. Use get_service / get_adr for "
        "full detail on a specific node."
    )
    permission = COPILOT_PERMISSION_TOOL_SEARCH_KNOWLEDGE
    rate_limit_per_min = 30
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "minLength": 1},
            "node_types": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional whitelist of node kinds.",
            },
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 5},
        },
        "required": ["query"],
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
        query = args.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ToolArgumentInvalid(self.name, "query must be a non-empty string", field="query")
        node_types = args.get("node_types")
        if node_types is not None and (
            not isinstance(node_types, list) or not all(isinstance(t, str) for t in node_types)
        ):
            raise ToolArgumentInvalid(
                self.name, "node_types must be a list of strings", field="node_types"
            )
        limit = int(args.get("limit") or 5)
        limit = max(1, min(limit, 50))

        factory = get_session_factory()
        async with factory() as session:
            stmt = select(KGNode).where(KGNode.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(KGNode.project_id == str(project_id))
            if node_types:
                stmt = stmt.where(KGNode.node_type.in_(node_types))
            # Search in ``name`` via portable ILIKE. The JSONB properties
            # column is filtered in Python below so this query works on
            # both Postgres (where JSONB ``->>`` would be ideal) and the
            # SQLite test engine (where ``astext`` is unavailable).
            like = f"%{query.strip()}%"
            stmt = stmt.where(KGNode.name.ilike(like))
            # Bound the candidate set — production uses pgvector + tsquery.
            stmt = stmt.order_by(KGNode.updated_at.desc()).limit(max(limit * 4, 50))
            rows = list((await session.execute(stmt)).scalars().all())

        needle = query.strip().lower()
        rows = [r for r in rows if _matches(r, needle)][:limit]  # noqa: E501

        nodes = [
            {
                "id": str(r.id),
                "label": r.name,
                "kind": r.node_type,
                "snippet": _snippet(r.properties),
            }
            for r in rows
        ]
        logger.info(
            "copilot.tool.search_knowledge",
            tenant_id=str(tenant_id),
            project_id=str(project_id) if project_id else None,
            principal=principal.user_id,
            query=query,
            matched=len(nodes),
        )
        return {"nodes": nodes, "total": len(nodes)}


def _snippet(properties: dict[str, Any] | None) -> str:
    """Build a short description snippet from KG node properties."""
    if not properties:
        return ""
    for key in ("description", "summary", "doc", "decision", "content"):
        val = properties.get(key)
        if isinstance(val, str) and val.strip():
            text = val.strip()
            return text if len(text) <= 240 else f"{text[:237]}..."
    return ""


def _matches(row: KGNode, needle: str) -> bool:
    """Return True if the row's name or properties mention the needle."""
    if needle in (row.name or "").lower():
        return True
    props = row.properties or {}
    name = props.get("name")
    if isinstance(name, str) and needle in name.lower():
        return True
    for key in ("description", "summary", "doc", "decision", "content"):
        val = props.get(key)
        if isinstance(val, str) and needle in val.lower():
            return True
    return False


# Register on import.
tool_registry.register(SearchKnowledgeTool())


__all__ = ["SearchKnowledgeTool"]
