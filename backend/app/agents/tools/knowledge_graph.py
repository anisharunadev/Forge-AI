"""Knowledge graph tool — LangChain ``BaseTool`` adapter.

Wraps the project knowledge graph (when available; otherwise an in-memory
shim) behind the LangChain tool interface so nodes can ``Tool.from_function``
or attach it directly to an agent executor.

Public methods
--------------
- ``query_graph(cypher)`` — run a Cypher-like query, return ``list[Node]``
- ``add_node(node)`` — upsert a node
- ``add_edge(edge)`` — upsert an edge
- :class:`KnowledgeGraphTool` — LangChain-compatible tool wrapper exposing
  :attr:`name`, :attr:`description`, :attr:`args_schema`, ``_run``, ``_arun``.
"""

from __future__ import annotations

import abc
import asyncio
import json
from dataclasses import asdict, dataclass, field
from typing import Any, ClassVar
from uuid import UUID, uuid4

from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class KGNode:
    """A node in the knowledge graph."""

    id: UUID
    label: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class KGEdge:
    """A directed edge in the knowledge graph."""

    source_id: UUID
    target_id: UUID
    relationship: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class KGQueryResult:
    nodes: list[KGNode]
    edges: list[KGEdge]

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": [
                {**asdict(n), "id": str(n.id)} for n in self.nodes
            ],
            "edges": [
                {
                    **asdict(e),
                    "source_id": str(e.source_id),
                    "target_id": str(e.target_id),
                }
                for e in self.edges
            ],
        }


# ---------------------------------------------------------------------------
# Backend protocol — the M2 substrate (when published) implements this.
# Tests can substitute an in-memory backend.
# ---------------------------------------------------------------------------

class KnowledgeGraphBackend(abc.ABC):
    """Storage abstraction so the tool can run against a real backend
    (Neo4j / Apache AGE) or an in-memory test double.
    """

    @abc.abstractmethod
    def query(self, cypher: str, params: dict[str, Any] | None = None) -> KGQueryResult: ...

    @abc.abstractmethod
    def add_node(self, node: KGNode) -> None: ...

    @abc.abstractmethod
    def add_edge(self, edge: KGEdge) -> None: ...


class InMemoryKGBackend(KnowledgeGraphBackend):
    """Tiny in-memory graph used when the real backend is unavailable.

    Accepts a Cypher-shaped dict query of the form ``{"match": label}``
    so tests can exercise the tool without a real graph.
    """

    def __init__(self) -> None:
        self._nodes: dict[UUID, KGNode] = {}
        self._edges: list[KGEdge] = []

    def query(self, cypher: str, params: dict[str, Any] | None = None) -> KGQueryResult:
        try:
            parsed = json.loads(cypher)
        except (json.JSONDecodeError, TypeError):
            # Treat the string as a label match.
            parsed = {"match": cypher}
        params = params or {}
        label = parsed.get("match") or parsed.get("label")
        if label is None:
            matched = list(self._nodes.values())
        else:
            matched = [n for n in self._nodes.values() if n.label == label]
        return KGQueryResult(nodes=matched, edges=list(self._edges))

    def add_node(self, node: KGNode) -> None:
        self._nodes[node.id] = node

    def add_edge(self, edge: KGEdge) -> None:
        self._edges.append(edge)


# ---------------------------------------------------------------------------
# LangChain tool schema + tool class
# ---------------------------------------------------------------------------

class KGQueryInput(BaseModel):
    """Input schema for :class:`KnowledgeGraphTool`."""

    cypher: str = Field(
        ...,
        description=(
            "Cypher-like query string. May be a JSON doc like "
            "'{\"match\": \"Component\"}' or a label name."
        ),
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional named parameters.",
    )


class KGAddNodeInput(BaseModel):
    label: str = Field(..., description="Node label, e.g. 'Component'.")
    properties: dict[str, Any] = Field(default_factory=dict)
    node_id: str | None = Field(default=None, description="Optional UUID for the node.")


class KGAddEdgeInput(BaseModel):
    source_id: str = Field(..., description="Source node UUID.")
    target_id: str = Field(..., description="Target node UUID.")
    relationship: str = Field(..., description="Edge type, e.g. 'DEPENDS_ON'.")
    properties: dict[str, Any] = Field(default_factory=dict)


class KnowledgeGraphTool(BaseTool):
    """LangChain-compatible wrapper over a knowledge graph backend.

    Uses :class:`KGQueryInput` for its args schema and supports both
    ``_run`` (sync) and ``_arun`` (async) interfaces.
    """

    name: str = "knowledge_graph_query"
    description: str = (
        "Query the project knowledge graph. Accepts a Cypher-like query or "
        "a JSON object like '{\"match\": \"Component\"}' to filter by label."
    )
    args_schema: type[BaseModel] = KGQueryInput
    backend: Any = Field(default_factory=InMemoryKGBackend)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    # ---- LangChain surface --------------------------------------------

    def _run(self, cypher: str, params: dict[str, Any] | None = None) -> str:
        result = self.backend.query(cypher, params)
        return json.dumps(result.to_dict(), default=str)

    async def _arun(
        self,
        cypher: str,
        params: dict[str, Any] | None = None,
    ) -> str:
        # The in-memory backend is sync; for real backends this would await.
        return await asyncio.to_thread(self._run, cypher, params)


class KnowledgeGraphAdapter:
    """High-level API used by SDLC nodes.

    Wraps :class:`KnowledgeGraphTool` with ergonomic helpers so node
    code can call ``kg.query_graph(cypher)`` directly without going
    through LangChain's tool plumbing.
    """

    TOOL_NAME: ClassVar[str] = "knowledge_graph_query"

    def __init__(self, backend: KnowledgeGraphBackend | None = None) -> None:
        self._backend = backend or InMemoryKGBackend()
        self.tool = KnowledgeGraphTool(backend=self._backend)

    @property
    def langchain_tool(self) -> KnowledgeGraphTool:
        return self.tool

    def query_graph(
        self,
        cypher: str,
        params: dict[str, Any] | None = None,
    ) -> KGQueryResult:
        return self._backend.query(cypher, params)

    def add_node(
        self,
        node: KGNode | None = None,
        *,
        label: str = "",
        properties: dict[str, Any] | None = None,
    ) -> KGNode:
        if node is None:
            if not label:
                raise ValueError("label is required when no node is supplied")
            node = KGNode(
                id=uuid4(),
                label=label,
                properties=dict(properties or {}),
            )
        self._backend.add_node(node)
        return node

    def add_edge(
        self,
        edge: KGEdge | None = None,
        *,
        source_id: UUID,
        target_id: UUID,
        relationship: str,
        properties: dict[str, Any] | None = None,
    ) -> KGEdge:
        if edge is None:
            edge = KGEdge(
                source_id=source_id,
                target_id=target_id,
                relationship=relationship,
                properties=dict(properties or {}),
            )
        self._backend.add_edge(edge)
        return edge


def build_default_kg_adapter() -> KnowledgeGraphAdapter:
    return KnowledgeGraphAdapter()


__all__ = [
    "KGNode",
    "KGEdge",
    "KGQueryResult",
    "KnowledgeGraphBackend",
    "InMemoryKGBackend",
    "KnowledgeGraphTool",
    "KnowledgeGraphAdapter",
    "KGQueryInput",
    "KGAddNodeInput",
    "KGAddEdgeInput",
    "build_default_kg_adapter",
]
