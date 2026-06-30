"""Knowledge graph nodes and edges (F-115).

The graph is the cross-source linkage layer: every domain entity
(ADR, service, repo, API, risk, idea) appears as a node; relationships
between entities appear as edges. The spec calls for ~200 nodes and
~350 edges in the acme-corp demo seed.
"""

from __future__ import annotations

from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    ARRAY,
    JSONB,
    Base,
    GUID,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class GraphNodeKind(str, Enum):
    """Discriminator for node types in the graph."""

    ADR = "adr"
    SERVICE = "service"
    REPO = "repo"
    API = "api"
    DATABASE = "database"
    RISK = "risk"
    IDEA = "idea"
    USER = "user"
    PROJECT = "project"
    STANDARD = "standard"
    POLICY = "policy"
    CONFLICT = "conflict"
    DOC = "doc"


class GraphEdgeKind(str, Enum):
    """Discriminator for edge types in the graph."""

    SUPERSEDES = "supersedes"
    REFERENCES = "references"
    IMPLEMENTS = "implements"
    OWNS = "owns"
    DEPENDS_ON = "depends_on"
    CONFLICTS_WITH = "conflicts_with"
    GOVERNED_BY = "governed_by"
    DOCUMENTS = "documents"
    DEPLOYS = "deploys"


class GraphNode(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """A node in the cross-source knowledge graph."""

    __tablename__ = "graph_nodes"

    node_key: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[GraphNodeKind] = mapped_column(
        SAEnum(GraphNodeKind, name="graph_node_kind"),
        nullable=False,
    )
    label: Mapped[str] = mapped_column(String(500), nullable=False)
    source_table: Mapped[str] = mapped_column(String(100), nullable=False)
    source_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)

    __table_args__ = (
        UniqueConstraint("tenant_id", "node_key", name="uq_graph_nodes_tenant_key"),
        Index("ix_graph_nodes_tenant_kind", "tenant_id", "kind"),
        Index("ix_graph_nodes_source", "source_table", "source_id"),
    )


class GraphEdge(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    """An edge in the cross-source knowledge graph."""

    __tablename__ = "graph_edges"

    edge_key: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[GraphEdgeKind] = mapped_column(
        SAEnum(GraphEdgeKind, name="graph_edge_kind"),
        nullable=False,
    )
    from_node_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False
    )
    to_node_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False
    )
    weight: Mapped[float] = mapped_column(default=1.0, nullable=False)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("tenant_id", "edge_key", name="uq_graph_edges_tenant_key"),
        Index("ix_graph_edges_tenant_kind", "tenant_id", "kind"),
        Index("ix_graph_edges_from_node", "from_node_id"),
        Index("ix_graph_edges_to_node", "to_node_id"),
    )


__all__ = [
    "GraphEdge",
    "GraphEdgeKind",
    "GraphNode",
    "GraphNodeKind",
]