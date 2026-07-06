"""Ideation Knowledge Graph Integration service (F-208).

Wires the Ideation Center into the project knowledge graph:
- Idea → KG node (type=Idea)
- Idea ↔ related idea (vector similarity)
- Project-wide idea graph (React-Flow friendly)
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db.models.ideation import Idea
from app.db.session import get_session_factory
from app.services.knowledge_graph import Node, knowledge_graph_service
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


@dataclass
class GraphNodePayload:
    id: str
    kind: str
    label: str
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "label": self.label, "metadata": self.metadata}


@dataclass
class GraphEdgePayload:
    id: str
    source: str
    target: str
    kind: str
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "kind": self.kind,
            "metadata": self.metadata,
        }


@dataclass
class IdeaGraph:
    project_id: UUID
    nodes: list[GraphNodePayload]
    edges: list[GraphEdgePayload]
    generated_at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "project_id": str(self.project_id),
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
            "generated_at": self.generated_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Embedding helpers (LiteLLM with deterministic fallback)
# ---------------------------------------------------------------------------


def _deterministic_vector(text: str, dim: int = 64) -> list[float]:
    digest = hashlib.sha512(text.encode("utf-8")).digest()
    out: list[float] = []
    for i in range(dim):
        byte = digest[i % len(digest)]
        out.append((byte / 255.0) * 2.0 - 1.0)
    norm = math.sqrt(sum(x * x for x in out)) or 1.0
    return [x / norm for x in out]


async def _embed(text: str, *, tenant_id: UUID | str, project_id: UUID | str) -> list[float]:
    try:
        async with LiteLLMClient() as client:
            vectors = await client.embed([text], tenant_id=tenant_id, project_id=project_id)
            if vectors:
                return vectors[0]
    except Exception as exc:  # noqa: BLE001
        logger.warning("ideation_kg.embed_failed", error=str(exc))
    return _deterministic_vector(text)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    da = db = dot = 0.0
    for i in range(n):
        x = float(a[i])
        y = float(b[i])
        da += x * x
        db += y * y
        dot += x * y
    if da == 0 or db == 0:
        return 0.0
    return dot / ((da**0.5) * (db**0.5))


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class IdeationKGService:
    """Tenant-scoped ideation knowledge-graph integration."""

    def __init__(self) -> None:
        self._kg = knowledge_graph_service

    async def add_idea_to_kg(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> Node:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id
        embedding = await _embed(
            f"{idea.title or ''}\n{idea.description or ''}",
            tenant_id=tenant_id,
            project_id=effective_project_id,
        )
        return await self._kg.add_node(
            node_type="idea",
            properties={
                "idea_id": str(idea.id),
                "title": idea.title,
                "description_excerpt": (idea.description or "")[:280],
                "source": idea.source.value if hasattr(idea.source, "value") else str(idea.source),
                "status": idea.status.value if hasattr(idea.status, "value") else str(idea.status),
                "tags": list(idea.tags or []),
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            name=idea.title or "Idea",
            freshness_source="ideation_intake",
            embedding=embedding,
        )

    async def find_related_ideas(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        top_k: int = 5,
    ) -> list[Node]:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id
        embedding = await _embed(
            f"{idea.title or ''}\n{idea.description or ''}",
            tenant_id=tenant_id,
            project_id=effective_project_id,
        )
        nodes = await self._kg.vector_search(
            embedding=embedding,
            top_k=top_k + 1,  # include the seed
            tenant_id=tenant_id,
            project_id=effective_project_id,
            node_type="idea",
        )
        # Drop the seed idea from the result set.
        return [n for n in nodes if str(n.properties.get("idea_id") or "") != str(idea.id)][:top_k]

    async def get_idea_graph(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> IdeaGraph:
        # Pull all idea nodes for the project.
        nodes = await self._kg.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            node_type="idea",
            limit=500,
        )
        graph_nodes: list[GraphNodePayload] = []
        graph_edges: list[GraphEdgePayload] = []

        # Add the idea nodes themselves.
        for n in nodes:
            graph_nodes.append(
                GraphNodePayload(
                    id=f"node:{n.id}",
                    kind="idea",
                    label=n.name,
                    metadata={
                        "kg_node_id": str(n.id),
                        "properties": dict(n.properties or {}),
                    },
                )
            )

        # Connect related ideas via shared tags (cheap heuristic).
        for i, src in enumerate(nodes):
            for tgt in nodes[i + 1 :]:
                src_tags = set((src.properties or {}).get("tags") or [])
                tgt_tags = set((tgt.properties or {}).get("tags") or [])
                shared = src_tags & tgt_tags
                if shared:
                    graph_edges.append(
                        GraphEdgePayload(
                            id=f"edge:{src.id}->{tgt.id}",
                            source=f"node:{src.id}",
                            target=f"node:{tgt.id}",
                            kind="shares_tags",
                            metadata={"tags": sorted(shared)},
                        )
                    )

        return IdeaGraph(
            project_id=UUID(str(project_id)),
            nodes=graph_nodes,
            edges=graph_edges,
            generated_at=datetime.now(UTC),
        )

    async def link_idea_to_component(
        self,
        idea_id: UUID | str,
        component_node_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        relationship: str = "relates_to",
    ) -> None:
        idea_node = await self.add_idea_to_kg(idea_id, tenant_id=tenant_id, project_id=project_id)
        await self._kg.add_edge(
            from_node_id=idea_node.id,
            to_node_id=component_node_id,
            edge_type=relationship,
            properties={"idea_id": str(idea_id)},
            tenant_id=tenant_id,
            project_id=project_id,
        )

    # -- internals --------------------------------------------------------

    async def _load_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea


ideation_kg_service = IdeationKGService()


__all__ = [
    "GraphEdgePayload",
    "GraphNodePayload",
    "IdeaGraph",
    "IdeationKGService",
    "ideation_kg_service",
]
