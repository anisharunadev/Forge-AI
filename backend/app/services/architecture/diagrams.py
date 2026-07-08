"""F-311: Diagram service — DB-backed C4 / dataflow / sequence diagrams.

Day 2 mock-removal track H. Replaces the previous frontend
``MOCK_DIAGRAMS`` fixture (3 C4 diagrams) with a real read path.

The service issues two queries: one for the diagram rows (scoped by
``tenant_id`` + ``project_id``) and one walk that fans out into the
node / edge tables via a single JOIN. The router hands it a session;
calls without an injected session use the global factory for tests.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select

from app.db.models.architecture import (
    ArchitectureDiagram,
    DiagramEdgeRow,
    DiagramNodeRow,
)
from app.db.session import get_session_factory

logger = logging.getLogger(__name__)


class DiagramService:
    """Read-only service for architecture diagrams.

    Routers pass an open ``AsyncSession`` via ``session=``; tests may
    omit it (the service falls back to ``get_session_factory()``).
    """

    def __init__(self, session=None):
        self._session = session

    async def list_diagrams(self, tenant_id: UUID, project_id: UUID) -> list[dict]:
        """List every diagram for a tenant+project with nested nodes/edges.

        Returns a list of dicts shaped to match ``C4DiagramResponse``
        so the router can hand it directly to ``model_validate``.
        """
        factory = get_session_factory()
        async with factory() as session:
            diagrams = (
                (
                    await session.execute(
                        select(ArchitectureDiagram).where(
                            ArchitectureDiagram.tenant_id == tenant_id,
                            ArchitectureDiagram.project_id == project_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            diagram_ids = [d.id for d in diagrams]
            nodes_by_diagram: dict[UUID, list[DiagramNodeRow]] = {d.id: [] for d in diagrams}
            edges_by_diagram: dict[UUID, list[DiagramEdgeRow]] = {d.id: [] for d in diagrams}
            if diagram_ids:
                rows = (
                    (
                        await session.execute(
                            select(DiagramNodeRow).where(DiagramNodeRow.diagram_id.in_(diagram_ids))
                        )
                    )
                    .scalars()
                    .all()
                )
                for n in rows:
                    nodes_by_diagram.setdefault(n.diagram_id, []).append(n)
                edge_rows = (
                    (
                        await session.execute(
                            select(DiagramEdgeRow).where(DiagramEdgeRow.diagram_id.in_(diagram_ids))
                        )
                    )
                    .scalars()
                    .all()
                )
                for e in edge_rows:
                    edges_by_diagram.setdefault(e.diagram_id, []).append(e)

        results: list[dict] = []
        for diagram in diagrams:
            results.append(
                {
                    "id": str(diagram.id),
                    "name": diagram.name,
                    "level": diagram.level,
                    "description": diagram.description,
                    "tenant_id": diagram.tenant_id,
                    "project_id": diagram.project_id,
                    "created_at": diagram.created_at,
                    "updated_at": diagram.updated_at,
                    "nodes": [
                        # Wire shape mirrors the previous MOCK_DIAGRAMS
                        # node: ``id`` is the string key the SVG
                        # renderer keys edges by. The DB still stores
                        # the UUID separately (we need it for FK joins).
                        {
                            "id": n.node_key,
                            "label": n.label,
                            "layer": n.layer,
                            "x": n.x,
                            "y": n.y,
                            "details": n.details,
                        }
                        for n in nodes_by_diagram.get(diagram.id, [])
                    ],
                    "edges": [
                        {
                            "id": str(e.id),
                            "source": e.source_node_key,
                            "target": e.target_node_key,
                            "label": e.label,
                        }
                        for e in edges_by_diagram.get(diagram.id, [])
                    ],
                }
            )
        return results


__all__ = ["DiagramService"]
