"""Knowledge Graph service backed by Apache AGE (PostgreSQL 17 + pgvector).

Graph nodes are persisted in `kg_nodes` and `kg_edges` tables that mirror
the AGE vertex/edge model. When AGE is unavailable the service falls back
to plain SQL over the same tables so tests and local dev still work.

Every node write is mirrored to the freshness ledger so downstream consumers
(F-101..F-115) can decide whether to trust the data.
"""

from __future__ import annotations

import enum
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Index, String, select, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.logging import get_logger
from app.db.base import ARRAY, Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.session import get_session_factory
from app.services.event_bus import EventType, bus as default_bus
from app.services.freshness_ledger import FreshnessRecord, freshness_ledger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# ORM models (kg_nodes + kg_edges). Real AGE persists cypher vertices into
# the same tables; we expose a SQLAlchemy surface so it survives tests.
# ---------------------------------------------------------------------------


class KGNode(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A graph node — function, file, service, decision, doc, etc."""

    __tablename__ = "kg_nodes"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    repo_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    node_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    embedding: Mapped[list[float] | None] = mapped_column(
        "embedding", ARRAY(item_type="float"), nullable=True
    )
    freshness_at: Mapped[datetime | None] = mapped_column(nullable=True)
    freshness_source: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_kg_nodes_tenant_project_type", "tenant_id", "project_id", "node_type"),
        Index("ix_kg_nodes_freshness", "tenant_id", "freshness_at"),
    )


class KGEdge(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A graph edge between two KGNode rows."""

    __tablename__ = "kg_edges"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    from_node_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    to_node_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    edge_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    properties: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_kg_edges_from", "from_node_id"),
        Index("ix_kg_edges_to", "to_node_id"),
        Index("ix_kg_edges_type", "edge_type"),
    )


# ---------------------------------------------------------------------------
# Domain enums + dataclasses
# ---------------------------------------------------------------------------


class GraphStatus(str, enum.Enum):
    """Ingestion lifecycle of a knowledge graph node."""

    OK = "ok"
    STALE = "stale"
    MISSING = "missing"


@dataclass
class Node:
    """Result of an add_node / query call."""

    id: UUID
    node_type: str
    name: str
    properties: dict[str, Any]
    tenant_id: UUID
    project_id: UUID
    repo_id: UUID | None
    freshness_at: datetime | None
    freshness_source: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm(cls, row: KGNode) -> "Node":
        return cls(
            id=row.id,
            node_type=row.node_type,
            name=row.name,
            properties=dict(row.properties or {}),
            tenant_id=row.tenant_id if isinstance(row.tenant_id, UUID) else UUID(str(row.tenant_id)),
            project_id=row.project_id if isinstance(row.project_id, UUID) else UUID(str(row.project_id)),
            repo_id=row.repo_id,
            freshness_at=row.freshness_at,
            freshness_source=row.freshness_source,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


@dataclass
class Edge:
    """Result of an add_edge / query call."""

    id: UUID
    from_node_id: UUID
    to_node_id: UUID
    edge_type: str
    properties: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm(cls, row: KGEdge) -> "Edge":
        return cls(
            id=row.id,
            from_node_id=row.from_node_id,
            to_node_id=row.to_node_id,
            edge_type=row.edge_type,
            properties=dict(row.properties or {}),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


@dataclass
class FreshnessInfo:
    """Combined DB + freshness ledger view of how fresh a node is."""

    node_id: UUID
    status: GraphStatus
    freshness_at: datetime | None
    freshness_source: str | None
    age_seconds: float | None


@dataclass
class GraphStats:
    """Aggregate counts for an API response."""

    node_count: int
    edge_count: int
    node_types: dict[str, int] = field(default_factory=dict)
    edge_types: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class KnowledgeGraphService:
    """CRUD + query surface for the project knowledge graph."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    # -- writes -----------------------------------------------------------

    async def add_node(
        self,
        node_type: str,
        properties: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str,
        *,
        name: str | None = None,
        repo_id: UUID | str | None = None,
        embedding: list[float] | None = None,
        freshness_source: str = "graphify",
    ) -> Node:
        """Persist a node and stamp its freshness (Rule: freshness ledger)."""
        self._ensure_tenant_isolation(tenant_id)
        resolved_name = name or str(properties.get("name") or properties.get("id") or uuid4())
        now = datetime.now(timezone.utc)
        factory = get_session_factory()
        async with factory() as session:
            row = KGNode(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                repo_id=str(repo_id) if repo_id else None,
                node_type=node_type,
                name=resolved_name,
                properties=properties,
                embedding=list(embedding) if embedding else None,
                freshness_at=now,
                freshness_source=freshness_source,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            node = Node.from_orm(row)

        # Freshness ledger is required by DL-027.
        await freshness_ledger.mark_fresh(
            node_id=str(node.id),
            source=freshness_source,
            at=now,
            tenant_id=tenant_id,
            metadata={"node_type": node_type, "project_id": str(project_id)},
        )
        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "graph_event": "node_added",
                "node_id": str(node.id),
                "node_type": node_type,
            },
            tenant_id=tenant_id,
            project_id=project_id,
        )
        logger.info(
            "kg.node_added",
            node_id=str(node.id),
            node_type=node_type,
            tenant_id=str(tenant_id),
        )
        return node

    async def add_edge(
        self,
        from_node_id: UUID | str,
        to_node_id: UUID | str,
        edge_type: str,
        properties: dict[str, Any],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> Edge:
        """Persist an edge between two nodes."""
        self._ensure_tenant_isolation(tenant_id)
        factory = get_session_factory()
        async with factory() as session:
            row = KGEdge(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                from_node_id=str(from_node_id),
                to_node_id=str(to_node_id),
                edge_type=edge_type,
                properties=properties,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)
            edge = Edge.from_orm(row)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "graph_event": "edge_added",
                "edge_id": str(edge.id),
                "from": str(from_node_id),
                "to": str(to_node_id),
                "edge_type": edge_type,
            },
            tenant_id=tenant_id,
            project_id=project_id,
        )
        return edge

    # -- reads ------------------------------------------------------------

    async def get_node(
        self,
        node_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> Node | None:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(KGNode, str(node_id))
            if row is None or str(row.tenant_id) != str(tenant_id):
                return None
            return Node.from_orm(row)

    async def list_nodes(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        node_type: str | None = None,
        limit: int = 100,
    ) -> list[Node]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(KGNode).where(KGNode.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(KGNode.project_id == str(project_id))
            if node_type is not None:
                stmt = stmt.where(KGNode.node_type == node_type)
            stmt = stmt.order_by(KGNode.created_at.desc()).limit(max(1, min(limit, 1000)))
            rows = list((await session.execute(stmt)).scalars().all())
            return [Node.from_orm(r) for r in rows]

    async def backlinks_for(
        self,
        node_id: UUID | str,
        *,
        tenant_id: UUID | str,
        limit: int = 100,
    ) -> list[Node]:
        """Return source nodes for every incoming edge of ``node_id``.

        Mirrors the Obsidian-style "Referenced by" semantics in the
        frontend inspector panel. Backlinks are deduplicated by source
        node id and ordered by the most recent edge insertion (newest
        edge first) — the same ordering contract used by ``list_edges``.

        Caller is responsible for confirming ``node_id`` exists for the
        tenant first; this method only reads edges. Use ``get_node``
        to surface a 404 from the API layer.
        """
        self._ensure_tenant_isolation(tenant_id)
        factory = get_session_factory()
        async with factory() as session:
            edge_stmt = (
                select(KGEdge)
                .where(KGEdge.tenant_id == str(tenant_id))
                .where(KGEdge.to_node_id == str(node_id))
                .order_by(KGEdge.created_at.desc())
                .limit(max(1, min(limit, 1000)))
            )
            edges = list((await session.execute(edge_stmt)).scalars().all())

            seen_source_ids: set[str] = set()
            ordered_source_ids: list[str] = []
            for edge in edges:
                src_id = str(edge.from_node_id)
                if src_id in seen_source_ids:
                    continue
                seen_source_ids.add(src_id)
                ordered_source_ids.append(src_id)

            if not ordered_source_ids:
                return []

            node_stmt = (
                select(KGNode)
                .where(KGNode.tenant_id == str(tenant_id))
                .where(KGNode.id.in_(ordered_source_ids))
            )
            rows = {
                str(r.id): r
                for r in list((await session.execute(node_stmt)).scalars().all())
            }

        # Re-order the resolved rows to match the edge-recency ordering.
        return [
            Node.from_orm(rows[src_id])
            for src_id in ordered_source_ids
            if src_id in rows
        ]

    async def list_edges(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        from_node_id: UUID | str | None = None,
        to_node_id: UUID | str | None = None,
        edge_type: str | None = None,
        limit: int = 100,
    ) -> list[Edge]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(KGEdge).where(KGEdge.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(KGEdge.project_id == str(project_id))
            if from_node_id is not None:
                stmt = stmt.where(KGEdge.from_node_id == str(from_node_id))
            if to_node_id is not None:
                stmt = stmt.where(KGEdge.to_node_id == str(to_node_id))
            if edge_type is not None:
                stmt = stmt.where(KGEdge.edge_type == edge_type)
            stmt = stmt.order_by(KGEdge.created_at.desc()).limit(max(1, min(limit, 1000)))
            rows = list((await session.execute(stmt)).scalars().all())
            return [Edge.from_orm(r) for r in rows]

    # -- query interfaces -------------------------------------------------

    async def query_cypher(self, query: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        """Execute a Cypher query.

        When AGE is unavailable the query is translated to SQL via
        `_cypher_to_sql_bridge` so the API contract stays the same.
        """
        factory = get_session_factory()
        async with factory() as session:
            translated_sql, label = self._cypher_to_sql_bridge(query)
            if translated_sql is not None:
                merged = dict(params or {})
                merged["label"] = label
                return await self._execute_sql(session, translated_sql, merged)
            # Real AGE path would use `cypher` from agtype — not available,
            # so we surface a structured error rather than silently losing
            # data. Callers should rely on hybrid_query / SQL for now.
            raise NotImplementedError(
                "Apache AGE not available — use query_sql or hybrid_query"
            )

    async def query_sql(self, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        factory = get_session_factory()
        async with factory() as session:
            return await self._execute_sql(session, sql, params)

    async def hybrid_query(
        self,
        cypher_part: str,
        sql_part: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Run a cypher and a sql query; merge results by row order.

        Cypher results are appended first; the SQL rows then join by
        matching `id` if present, else appended. Keeps the API simple.
        """
        merged: dict[str, dict[str, Any]] = {}
        params = params or {}
        factory = get_session_factory()
        async with factory() as session:
            sql_rows = await self._execute_sql(session, sql_part, params)
            for row in sql_rows:
                key = str(row.get("id") or uuid4())
                merged.setdefault(key, {}).update(row)
            try:
                cypher_rows = await self.query_cypher(cypher_part, params)
            except NotImplementedError:
                cypher_rows = []
            for row in cypher_rows:
                key = str(row.get("id") or uuid4())
                merged.setdefault(key, {}).update(row)
        return list(merged.values())

    async def vector_search(
        self,
        embedding: list[float],
        *,
        top_k: int = 10,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        node_type: str | None = None,
    ) -> list[Node]:
        """Cosine-similarity nearest neighbors over stored embeddings.

        Real deployment uses pgvector `<=>`; here we compute cosine
        similarity in Python over the most recent 500 nodes (enough for
        tests; production swaps in pgvector).
        """
        self._ensure_tenant_isolation(tenant_id)
        if not embedding:
            return []
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(KGNode)
                .where(KGNode.tenant_id == str(tenant_id))
                .where(KGNode.embedding.is_not(None))
            )
            if project_id is not None:
                stmt = stmt.where(KGNode.project_id == str(project_id))
            if node_type is not None:
                stmt = stmt.where(KGNode.node_type == node_type)
            stmt = stmt.order_by(KGNode.created_at.desc()).limit(500)
            rows = list((await session.execute(stmt)).scalars().all())
        scored: list[tuple[float, KGNode]] = []
        for r in rows:
            emb = list(r.embedding or [])
            sim = _cosine(embedding, emb)
            scored.append((sim, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [Node.from_orm(r) for _, r in scored[: max(1, top_k)]]

    # -- freshness --------------------------------------------------------

    async def get_node_freshness(
        self,
        node_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> FreshnessInfo:
        node = await self.get_node(node_id, tenant_id=tenant_id)
        if node is None:
            return FreshnessInfo(
                node_id=node_id if isinstance(node_id, UUID) else UUID(str(node_id)),
                status=GraphStatus.MISSING,
                freshness_at=None,
                freshness_source=None,
                age_seconds=None,
            )
        record: FreshnessRecord | None = await freshness_ledger.get_freshness(
            str(node_id), tenant_id=tenant_id
        )
        if record is None:
            return FreshnessInfo(
                node_id=node.id,
                status=GraphStatus.STALE,
                freshness_at=node.freshness_at,
                freshness_source=node.freshness_source,
                age_seconds=None,
            )
        age = (datetime.now(timezone.utc) - record.at).total_seconds()
        return FreshnessInfo(
            node_id=node.id,
            status=GraphStatus.OK,
            freshness_at=record.at,
            freshness_source=record.source,
            age_seconds=round(age, 3),
        )

    async def mark_stale_nodes(
        self,
        max_age_seconds: int,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> int:
        """Batch-mark nodes whose `freshness_at` is older than max_age_seconds.

        Updates the DB column; the freshness ledger is left untouched (it
        expires via Redis TTL) so the read path stays consistent.
        """
        factory = get_session_factory()
        cutoff = datetime.now(timezone.utc).timestamp() - max_age_seconds
        cutoff_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc)
        async with factory() as session:
            stmt = (
                select(KGNode)
                .where(KGNode.tenant_id == str(tenant_id))
                .where(KGNode.freshness_at.is_not(None))
                .where(KGNode.freshness_at < cutoff_dt)
            )
            if project_id is not None:
                stmt = stmt.where(KGNode.project_id == str(project_id))
            rows = list((await session.execute(stmt)).scalars().all())
            count = 0
            for r in rows:
                r.freshness_source = "stale"
                count += 1
            await session.commit()
        logger.info(
            "kg.marked_stale",
            tenant_id=str(tenant_id),
            marked=count,
            max_age_seconds=max_age_seconds,
        )
        return count

    # -- stats ------------------------------------------------------------

    async def stats(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> GraphStats:
        factory = get_session_factory()
        async with factory() as session:
            node_q = (
                select(KGNode.node_type, KGNode.id)
                .where(KGNode.tenant_id == str(tenant_id))
            )
            edge_q = (
                select(KGEdge.edge_type, KGEdge.id)
                .where(KGEdge.tenant_id == str(tenant_id))
            )
            if project_id is not None:
                node_q = node_q.where(KGNode.project_id == str(project_id))
                edge_q = edge_q.where(KGEdge.project_id == str(project_id))
            nodes = list((await session.execute(node_q)).all())
            edges = list((await session.execute(edge_q)).all())
        node_types: dict[str, int] = {}
        for nt, _ in nodes:
            node_types[nt] = node_types.get(nt, 0) + 1
        edge_types: dict[str, int] = {}
        for et, _ in edges:
            edge_types[et] = edge_types.get(et, 0) + 1
        return GraphStats(
            node_count=len(nodes),
            edge_count=len(edges),
            node_types=node_types,
            edge_types=edge_types,
        )

    # -- helpers ----------------------------------------------------------

    def _ensure_tenant_isolation(self, tenant_id: UUID | str | None) -> None:
        if tenant_id is None or str(tenant_id) == "":
            raise ValueError("tenant_id is required (Rule 2)")

    def _cypher_to_sql_bridge(self, cypher: str) -> tuple[str, str] | None:
        """Translate a tiny subset of Cypher to SQL when AGE is missing.

        Supported: `MATCH (n:Type) RETURN n` → `SELECT * FROM kg_nodes WHERE
        node_type = 'Type'`. Anything more complex returns None and the
        caller falls back to SQL.
        """
        if not cypher:
            return None
        simple = re.match(
            r"^\s*MATCH\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*RETURN\s+([a-zA-Z_][a-zA-Z0-9_]*|\*)\s*$",
            cypher.strip(),
            flags=re.IGNORECASE,
        )
        if not simple:
            return None
        var, label, ret = simple.groups()
        # ponytail: literal SQL — bandit B608 passes. ``label`` is bound
        # via :label; ``cols`` is restricted to either '*' or a quoted
        # identifier (whitelisted by the regex above).
        cols = "*" if ret == "*" else f'"{ret}".*'
        sql = (
            "SELECT {cols} FROM kg_nodes "
            "WHERE node_type = :label "
            "LIMIT 500"
        ).format(cols=cols)
        # Caller passes the outer params dict; we add ``label`` here.
        return sql, label


    async def _execute_sql(
        self,
        session: Any,
        sql: str,
        params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Run a raw SQL statement with bound params and return rows as dicts."""
        bound = {self._bind_key(k): v for k, v in (params or {}).items()}
        try:
            result = await session.execute(text(sql), bound)
        except Exception:
            logger.exception("kg.sql_failed", sql=sql[:200])
            raise
        rows = result.mappings().all()
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append({k: _jsonify(v) for k, v in dict(row).items()})
        return out

    @staticmethod
    def _bind_key(raw: str) -> str:
        # SQLAlchemy wants :name params; Cypher uses {name}. Pass-through.
        return raw


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    da = 0.0
    db = 0.0
    dot = 0.0
    for i in range(n):
        x = float(a[i])
        y = float(b[i])
        da += x * x
        db += y * y
        dot += x * y
    if da == 0 or db == 0:
        return 0.0
    return dot / ((da ** 0.5) * (db ** 0.5))


def _jsonify(value: Any) -> Any:
    """Convert SQLAlchemy-returned values into JSON-serializable forms."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (list, tuple)):
        return [_jsonify(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonify(v) for k, v in value.items()}
    if hasattr(value, "hex"):
        return value.hex
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


knowledge_graph_service = KnowledgeGraphService()


__all__ = [
    "KnowledgeGraphService",
    "KGNode",
    "KGEdge",
    "Node",
    "Edge",
    "FreshnessInfo",
    "GraphStatus",
    "GraphStats",
    "knowledge_graph_service",
]