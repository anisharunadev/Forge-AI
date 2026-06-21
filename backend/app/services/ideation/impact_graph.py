"""Architecture Impact Graph service (F-203).

Given an Idea's analysis, walk the project knowledge graph to identify
which services / modules / dependencies would change and which tests
would need updates. Returns a React-Flow-friendly node+edge list plus
an `ImpactComparison` for cross-idea comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import UUID, uuid4

from app.core.logging import get_logger
from app.db.models.ideation import Idea, IdeaAnalysis
from app.db.session import get_session_factory
from app.services.knowledge_graph import knowledge_graph_service

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses (stable shapes — separate from API schemas so the service
# has no dependency on Pydantic for internal reasoning).
# ---------------------------------------------------------------------------


@dataclass
class GraphNode:
    id: str
    kind: str
    label: str
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "label": self.label, "metadata": self.metadata}


@dataclass
class GraphEdge:
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
class ImpactGraph:
    idea_id: UUID
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    generated_at: datetime
    summary: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "idea_id": str(self.idea_id),
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
            "generated_at": self.generated_at.isoformat(),
            "summary": self.summary,
        }


@dataclass
class ImpactEntry:
    idea_id: UUID
    affected_services: int
    affected_dependencies: int
    recommended_tests: int
    total_impact_score: float


@dataclass
class ComparisonResult:
    entries: list[ImpactEntry]
    compared_at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "entries": [
                {
                    "idea_id": str(e.idea_id),
                    "affected_services": e.affected_services,
                    "affected_dependencies": e.affected_dependencies,
                    "recommended_tests": e.recommended_tests,
                    "total_impact_score": e.total_impact_score,
                }
                for e in self.entries
            ],
            "compared_at": self.compared_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _keyword_tokens(text: str) -> set[str]:
    return {w.lower().strip(".,;:()[]{}!?'\"") for w in text.split() if len(w) > 3}


def _test_names_for(components: Iterable[GraphNode]) -> list[str]:
    """Map a list of KG nodes to conventional test names."""
    out: list[str] = []
    for c in components:
        kind = c.kind
        label = c.label
        if kind == "service":
            out.append(f"integration::test_service_{label}")
        elif kind == "module":
            out.append(f"unit::test_module_{label}")
        elif kind == "function":
            out.append(f"unit::test_{label}")
        elif kind == "api":
            out.append(f"contract::test_{label.replace('/', '_').replace('{', '').replace('}', '')}")
        elif kind == "database_table":
            out.append(f"db::test_table_{label}")
        elif kind == "dependency":
            out.append(f"compat::test_dep_{label}")
        else:
            out.append(f"smoke::{kind}_{label}")
    return sorted(set(out))[:25]


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ImpactGraphService:
    """Tenant-scoped impact graph builder."""

    def __init__(self) -> None:
        self._kg = knowledge_graph_service
        # cache: idea_id -> ImpactGraph
        self._cache: dict[str, ImpactGraph] = {}

    async def build_impact_graph(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> ImpactGraph:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = str(project_id or idea.project_id)
        analysis = await self._latest_analysis(idea.id)

        # Build tokens from the idea description + analysis keywords.
        tokens = _keyword_tokens(idea.title or "") | _keyword_tokens(idea.description or "")
        if analysis is not None:
            for t in analysis.target_users:
                tokens |= _keyword_tokens(t)
            for t in analysis.success_metrics:
                tokens |= _keyword_tokens(t)
            for t in analysis.risks:
                tokens |= _keyword_tokens(t)

        nodes: dict[str, GraphNode] = {}
        edges: dict[str, GraphEdge] = {}

        # Root node = the idea itself, so React-Flow always has an anchor.
        idea_root = GraphNode(
            id=f"idea:{idea.id}",
            kind="idea",
            label=idea.title or "Idea",
            metadata={"idea_id": str(idea.id)},
        )
        nodes[idea_root.id] = idea_root

        # Pull all project nodes; keep types most likely to be affected.
        try:
            project_nodes = await self._kg.list_nodes(
                tenant_id=tenant_id,
                project_id=effective_project_id,
                limit=500,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("impact_graph.kg_list_failed", error=str(exc))
            project_nodes = []

        relevant_types = {"service", "module", "function", "api", "database_table", "dependency", "component"}
        relevant: list = [n for n in project_nodes if n.node_type in relevant_types]

        for n in relevant:
            label_tokens = _keyword_tokens(n.name)
            score = len(tokens & label_tokens)
            if score == 0 and n.properties:
                # Allow property text to contribute to relevance.
                for prop_value in (n.properties or {}).values():
                    if isinstance(prop_value, str):
                        score += len(tokens & _keyword_tokens(prop_value))
            if score == 0:
                continue
            graph_node = GraphNode(
                id=f"node:{n.id}",
                kind=n.node_type,
                label=n.name,
                metadata={
                    "relevance_score": score,
                    "freshness_at": n.freshness_at.isoformat() if n.freshness_at else None,
                    "properties": dict(n.properties or {}),
                },
            )
            nodes[graph_node.id] = graph_node
            edge = GraphEdge(
                id=f"edge:{idea_root.id}->{graph_node.id}",
                source=idea_root.id,
                target=graph_node.id,
                kind="affects",
                metadata={"relevance_score": score},
            )
            edges[edge.id] = edge

        # Add transitive 1-hop edges between impacted nodes so the graph
        # captures downstream dependencies that may need updates.
        impacted_ids = list(nodes.keys())
        impacted_node_ids = [
            n_id.replace("node:", "") for n_id in impacted_ids if n_id.startswith("node:")
        ]
        for impacted_id in impacted_node_ids[:25]:  # cap to keep latency sane
            try:
                forward = await self._kg.list_edges(
                    tenant_id=tenant_id,
                    project_id=effective_project_id,
                    from_node_id=impacted_id,
                    limit=50,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("impact_graph.kg_edges_failed", error=str(exc))
                continue
            for e in forward:
                target = f"node:{e.to_node_id}"
                if target not in nodes:
                    continue
                eid = f"edge:{impacted_id}->{e.to_node_id}"
                edges[eid] = GraphEdge(
                    id=eid,
                    source=f"node:{impacted_id}",
                    target=target,
                    kind=e.edge_type,
                    metadata={"properties": dict(e.properties or {})},
                )

        graph = ImpactGraph(
            idea_id=idea.id,
            nodes=list(nodes.values()),
            edges=list(edges.values()),
            generated_at=datetime.now(timezone.utc),
            summary=self._summary(nodes, edges),
        )
        self._cache[str(idea.id)] = graph
        return graph

    async def get_impact_graph(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> ImpactGraph | None:
        cached = self._cache.get(str(idea_id))
        if cached is not None:
            return cached
        try:
            return await self.build_impact_graph(idea_id, tenant_id=tenant_id)
        except LookupError:
            return None

    async def compare_impact(
        self,
        idea_ids: list[UUID | str],
        *,
        tenant_id: UUID | str,
    ) -> ComparisonResult:
        entries: list[ImpactEntry] = []
        for raw_id in idea_ids:
            try:
                graph = await self.build_impact_graph(raw_id, tenant_id=tenant_id)
            except (LookupError, PermissionError):
                continue
            services = sum(1 for n in graph.nodes if n.kind == "service")
            deps = sum(1 for n in graph.nodes if n.kind == "dependency")
            tests = len(_test_names_for(graph.nodes))
            score = round(min(1.0, 0.1 * services + 0.05 * deps + 0.02 * len(graph.nodes)), 2)
            entries.append(
                ImpactEntry(
                    idea_id=graph.idea_id,
                    affected_services=services,
                    affected_dependencies=deps,
                    recommended_tests=tests,
                    total_impact_score=score,
                )
            )
        entries.sort(key=lambda e: e.total_impact_score, reverse=True)
        return ComparisonResult(entries=entries, compared_at=datetime.now(timezone.utc))

    # -- internals --------------------------------------------------------

    def _summary(self, nodes: dict[str, GraphNode], edges: dict[str, GraphEdge]) -> str:
        kinds: dict[str, int] = {}
        for n in nodes.values():
            kinds[n.kind] = kinds.get(n.kind, 0) + 1
        bits = ", ".join(f"{count} {kind}" for kind, count in sorted(kinds.items()))
        return f"Impact graph: {bits or 'no relevant components'}; {len(edges)} edges"

    async def _load_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea

    async def _latest_analysis(self, idea_id: UUID | str) -> IdeaAnalysis | None:
        factory = get_session_factory()
        async with factory() as session:
            from sqlalchemy import select

            stmt = select(IdeaAnalysis).where(IdeaAnalysis.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.analyzed_at, reverse=True)
        return rows[0]

    @staticmethod
    def _new_id() -> str:
        return str(uuid4())


# Public exports
def _graph_to_dict(graph: ImpactGraph) -> dict[str, Any]:
    return graph.to_dict()


impact_graph_service = ImpactGraphService()


__all__ = [
    "ComparisonResult",
    "GraphEdge",
    "GraphNode",
    "ImpactEntry",
    "ImpactGraph",
    "ImpactGraphService",
    "impact_graph_service",
]
