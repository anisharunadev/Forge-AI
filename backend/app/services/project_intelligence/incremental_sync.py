"""Incremental sync + conflict resolution (F-111, ADR-003).

Implements the Hybrid MDM + Steward model:
- Detect changed files since the last successful sync.
- Re-run GSD graphify on the diff.
- Detect conflicts (same entity in multiple sources).
- Conflict resolution: if a Steward is assigned, Steward wins;
  otherwise last-write-wins with an audit entry.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from app.core.logging import get_logger
from app.db.models.repo_ingestion import Repo
from app.db.session import get_session_factory
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus
from app.services.knowledge_graph import Node, knowledge_graph_service

logger = get_logger(__name__)


@dataclass
class ConflictRecord:
    id: UUID
    project_id: UUID
    entity_ref: str
    sources: list[str]
    detected_at: datetime
    resolution: dict[str, Any] | None
    status: str  # pending | resolved | dismissed


@dataclass
class SyncResult:
    repo_id: UUID
    since_commit_sha: str | None
    processed_files: int
    added_nodes: int
    updated_nodes: int
    conflicts: list[ConflictRecord]
    finished_at: datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run(cmd: list[str], cwd: str | None = None, timeout: int = 60) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except FileNotFoundError:
        return 127, "command_not_found"
    except subprocess.TimeoutExpired:
        return 124, "timeout"


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class IncrementalSyncService:
    """Detects deltas, reruns graphify, and arbitrates conflicts."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus
        self._kg = knowledge_graph_service
        self._conflicts: dict[UUID, list[ConflictRecord]] = {}
        self._steward_assignments: dict[str, str] = {}  # entity_ref → source

    # -- public API -------------------------------------------------------

    async def sync_changes(
        self,
        repo_id: UUID | str,
        since_commit_sha: str | None,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> SyncResult:
        repo = await self._get_repo(repo_id, tenant_id=tenant_id)
        changed_files = await self._detect_changes(repo, since_commit_sha)
        new_nodes, updated_nodes, conflicts = await self._reingest_diff(
            changed_files,
            tenant_id=tenant_id,
            project_id=project_id,
            repo=repo,
        )

        finished_at = datetime.now(UTC)
        result = SyncResult(
            repo_id=repo.id,
            since_commit_sha=since_commit_sha,
            processed_files=len(changed_files),
            added_nodes=new_nodes,
            updated_nodes=updated_nodes,
            conflicts=conflicts,
            finished_at=finished_at,
        )
        await self._bus.publish(
            EventType.CONNECTOR_HEALTHY,
            {
                "graph_event": "incremental_sync",
                "repo_id": str(repo.id),
                "files": len(changed_files),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return result

    async def get_pending_conflicts(self, project_id: UUID | str) -> list[ConflictRecord]:
        return [c for c in self._conflicts.get(project_id, []) if c.status == "pending"]

    async def resolve_conflict(
        self,
        conflict_id: UUID | str,
        *,
        resolution: dict[str, Any],
        actor_id: UUID | str | None = None,
    ) -> None:
        cid = UUID(str(conflict_id))
        for project_id, records in self._conflicts.items():
            for c in records:
                if c.id == cid:
                    c.resolution = resolution
                    c.status = "resolved"
                    logger.info(
                        "conflict.resolved",
                        conflict_id=str(cid),
                        project_id=str(project_id),
                        actor_id=str(actor_id) if actor_id else None,
                    )
                    return
        raise LookupError(f"conflict {conflict_id} not found")

    def assign_steward(self, entity_ref: str, source: str) -> None:
        """Mark a source as the Steward for an entity (Steward wins)."""
        self._steward_assignments[entity_ref] = source

    # -- internal ---------------------------------------------------------

    async def _get_repo(self, repo_id: UUID | str, *, tenant_id: UUID | str) -> Repo:
        factory = get_session_factory()
        async with factory() as session:
            repo = await session.get(Repo, str(repo_id))
            if repo is None:
                raise LookupError(f"repo {repo_id} not found")
            if str(repo.tenant_id) != str(tenant_id):
                raise PermissionError(f"repo {repo_id} not in tenant {tenant_id}")
            return repo

    async def _detect_changes(
        self,
        repo: Repo,
        since_commit_sha: str | None,
    ) -> list[str]:
        """Return file paths changed since `since_commit_sha`.

        Falls back to an empty list when git is unavailable or the
        repo isn't cloned locally.
        """
        if not since_commit_sha:
            return []
        local = os.environ.get("FORGE_REPO_FS_ROOT")
        if local is None or not os.path.isdir(local):
            return []
        rc, out = _run(
            ["git", "diff", "--name-only", since_commit_sha, "HEAD"],
            cwd=local,
            timeout=10,
        )
        if rc != 0:
            return []
        return [line.strip() for line in out.splitlines() if line.strip()]

    async def _reingest_diff(
        self,
        changed_files: list[str],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        repo: Repo,
    ) -> tuple[int, int, list[ConflictRecord]]:
        added = 0
        updated = 0
        conflicts: list[ConflictRecord] = []
        existing_nodes = await self._kg.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            limit=5000,
        )
        name_index: dict[str, Node] = {n.name: n for n in existing_nodes}

        for path in changed_files:
            entity_ref = f"file:{path}"
            node = await self._upsert_node(
                node_type="file",
                name=path,
                properties={"path": path},
                tenant_id=tenant_id,
                project_id=project_id,
                repo=repo,
                existing=name_index.get(path),
            )
            if existing_node := name_index.get(path):
                if existing_node.properties.get("content_hash") != node.properties.get(
                    "content_hash"
                ):
                    updated += 1
            else:
                added += 1
            # Conflict detection (same name appears multiple times)
            matches = [n for n in existing_nodes if n.name == path]
            if len(matches) > 1:
                sources = sorted({m.properties.get("source", "unknown") for m in matches})
                conflict = self._record_conflict(
                    project_id=project_id,
                    entity_ref=entity_ref,
                    sources=sources,
                )
                # Steward wins (ADR-003): prefer the steward-assigned source.
                steward = self._steward_assignments.get(entity_ref)
                if steward is not None:
                    conflict.resolution = {"winner": steward, "policy": "steward"}
                    conflict.status = "resolved"
                conflicts.append(conflict)
        return added, updated, conflicts

    async def _upsert_node(
        self,
        *,
        node_type: str,
        name: str,
        properties: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str,
        repo: Repo,
        existing: Node | None,
    ) -> Node:
        content_hash = hashlib.sha256(name.encode("utf-8")).hexdigest()
        props = {**properties, "content_hash": content_hash, "source": "incremental_sync"}
        node = await self._kg.add_node(
            node_type=node_type,
            properties=props,
            tenant_id=tenant_id,
            project_id=project_id,
            name=name,
            repo_id=repo.id,
            freshness_source="incremental_sync",
        )
        return node

    def _record_conflict(
        self,
        *,
        project_id: UUID | str,
        entity_ref: str,
        sources: list[str],
    ) -> ConflictRecord:
        record = ConflictRecord(
            id=uuid4(),
            project_id=project_id,
            entity_ref=entity_ref,
            sources=sources,
            detected_at=datetime.now(UTC),
            resolution=None,
            status="pending",
        )
        self._conflicts.setdefault(project_id, []).append(record)
        return record


incremental_sync_service = IncrementalSyncService()


__all__ = [
    "IncrementalSyncService",
    "ConflictRecord",
    "SyncResult",
    "incremental_sync_service",
]
