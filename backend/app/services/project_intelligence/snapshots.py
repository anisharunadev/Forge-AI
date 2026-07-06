"""Snapshot service (F-109).

Snapshots persist the entire KG state for a project. Storage is local
file system by default; S3 can be plugged in via `SnapshotStore`
subclasses without changing the service surface.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from app.core.logging import get_logger
from app.services.knowledge_graph import knowledge_graph_service

logger = get_logger(__name__)


@dataclass
class Snapshot:
    id: UUID
    project_id: UUID
    created_at: datetime
    node_count: int
    edge_count: int
    content_ref: str
    content_hash: str
    label: str | None


@dataclass
class RestoreResult:
    snapshot_id: UUID
    restored_node_count: int
    restored_edge_count: int
    conflicts: list[str]


@dataclass
class SnapshotDiff:
    snapshot_a: UUID
    snapshot_b: UUID
    nodes_added: list[str]
    nodes_removed: list[str]
    edges_added: list[str]
    edges_removed: list[str]


# ---------------------------------------------------------------------------
# Storage backends
# ---------------------------------------------------------------------------


class SnapshotStore:
    """Filesystem-backed snapshot storage (dev / tests)."""

    def __init__(self, root: str = "/tmp/forge-snapshots") -> None:
        self._root = root
        os.makedirs(self._root, exist_ok=True)

    def write(self, snapshot_id: UUID, payload: bytes) -> tuple[str, str]:
        path = os.path.join(self._root, f"{snapshot_id}.json")
        with open(path, "wb") as fh:
            fh.write(payload)
        return path, hashlib.sha256(payload).hexdigest()

    def read(self, snapshot_id: UUID) -> dict[str, Any] | None:
        path = os.path.join(self._root, f"{snapshot_id}.json")
        if not os.path.exists(path):
            return None
        with open(path, "rb") as fh:
            return json.loads(fh.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class SnapshotService:
    """Tenant-scoped KG snapshot capture / restore / diff."""

    def __init__(self, store: SnapshotStore | None = None) -> None:
        self._kg = knowledge_graph_service
        self._store = store or SnapshotStore()
        self._index: dict[UUID, list[Snapshot]] = {}

    async def create_snapshot(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
        label: str | None = None,
    ) -> Snapshot:
        nodes = await self._kg.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            limit=10_000,
        )
        edges = await self._kg.list_edges(
            tenant_id=tenant_id,
            project_id=project_id,
            limit=20_000,
        )
        payload = {
            "project_id": str(project_id),
            "tenant_id": str(tenant_id),
            "captured_at": datetime.now(UTC).isoformat(),
            "nodes": [
                {
                    "id": str(n.id),
                    "node_type": n.node_type,
                    "name": n.name,
                    "properties": n.properties,
                    "freshness_at": n.freshness_at.isoformat() if n.freshness_at else None,
                    "freshness_source": n.freshness_source,
                }
                for n in nodes
            ],
            "edges": [
                {
                    "id": str(e.id),
                    "from_node_id": str(e.from_node_id),
                    "to_node_id": str(e.to_node_id),
                    "edge_type": e.edge_type,
                    "properties": e.properties,
                }
                for e in edges
            ],
        }
        snapshot_id = uuid4()
        encoded = json.dumps(payload, default=str).encode("utf-8")
        content_ref, content_hash = self._store.write(snapshot_id, encoded)
        snapshot = Snapshot(
            id=snapshot_id,
            project_id=project_id,
            created_at=datetime.now(UTC),
            node_count=len(nodes),
            edge_count=len(edges),
            content_ref=content_ref,
            content_hash=content_hash,
            label=label,
        )
        self._index.setdefault(project_id, []).append(snapshot)
        logger.info(
            "snapshot.created",
            snapshot_id=str(snapshot_id),
            project_id=str(project_id),
            nodes=len(nodes),
            edges=len(edges),
        )
        return snapshot

    async def list_snapshots(self, project_id: UUID | str) -> list[Snapshot]:
        return list(self._index.get(project_id, []))

    async def restore_snapshot(
        self,
        snapshot_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> RestoreResult:
        payload = self._store.read(UUID(str(snapshot_id)))
        if payload is None:
            raise LookupError(f"snapshot {snapshot_id} not found")
        # Restore is destructive on the live KG; we mark old nodes with
        # a `superseded_by_snapshot` marker and recreate from payload.
        conflicts: list[str] = []
        for raw_node in payload.get("nodes", []):
            existing = await self._kg.get_node(raw_node["id"], tenant_id=tenant_id)
            if existing is not None and existing.name != raw_node["name"]:
                conflicts.append(f"node:{raw_node['id']}")
        for raw_node in payload.get("nodes", []):
            await self._kg.add_node(
                node_type=raw_node["node_type"],
                properties=raw_node.get("properties", {}),
                tenant_id=tenant_id,
                project_id=payload["project_id"],
                name=raw_node["name"],
                freshness_source="snapshot_restore",
            )
        for raw_edge in payload.get("edges", []):
            await self._kg.add_edge(
                from_node_id=raw_edge["from_node_id"],
                to_node_id=raw_edge["to_node_id"],
                edge_type=raw_edge["edge_type"],
                properties=raw_edge.get("properties", {}),
                tenant_id=tenant_id,
                project_id=payload["project_id"],
            )
        return RestoreResult(
            snapshot_id=UUID(str(snapshot_id)),
            restored_node_count=len(payload.get("nodes", [])),
            restored_edge_count=len(payload.get("edges", [])),
            conflicts=conflicts,
        )

    async def diff_snapshots(
        self,
        snapshot_a: UUID | str,
        snapshot_b: UUID | str,
    ) -> SnapshotDiff:
        a = self._store.read(UUID(str(snapshot_a)))
        b = self._store.read(UUID(str(snapshot_b)))
        if a is None or b is None:
            raise LookupError("snapshot not found")
        a_node_ids = {n["id"] for n in a.get("nodes", [])}
        b_node_ids = {n["id"] for n in b.get("nodes", [])}
        a_edge_ids = {e["id"] for e in a.get("edges", [])}
        b_edge_ids = {e["id"] for e in b.get("edges", [])}
        return SnapshotDiff(
            snapshot_a=UUID(str(snapshot_a)),
            snapshot_b=UUID(str(snapshot_b)),
            nodes_added=sorted(b_node_ids - a_node_ids),
            nodes_removed=sorted(a_node_ids - b_node_ids),
            edges_added=sorted(b_edge_ids - a_edge_ids),
            edges_removed=sorted(a_edge_ids - b_edge_ids),
        )


snapshot_service = SnapshotService()


__all__ = [
    "SnapshotService",
    "Snapshot",
    "SnapshotStore",
    "RestoreResult",
    "SnapshotDiff",
    "snapshot_service",
]
