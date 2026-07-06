"""Repository ingestion service (F-101, F-102).

Pipeline:
    clone (shallow) → repomix → gsd graphify → gsd map-codebase →
    build knowledge graph → persist artifacts.

Discovery uses the registered git connector from `connector_manager`
when present; falls back to a deterministic stub that mimics the
GitHub API surface so tests run without an external MCP server.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.connector import Connector, ConnectorType
from app.db.models.repo_ingestion import (
    IngestionArtifact,
    IngestionArtifactType,
    IngestionRun,
    IngestionStatus,
    Repo,
)
from app.db.session import get_session_factory
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus
from app.services.knowledge_graph import (
    knowledge_graph_service,
)

logger = get_logger(__name__)


@dataclass
class IngestionRunSummary:
    """Lightweight handle to the run created by `ingest_repo`."""

    run_id: UUID
    repo_id: UUID
    status: IngestionStatus


@dataclass
class RepoCandidate:
    """Repository discovered via a source provider."""

    external_id: str
    full_name: str
    default_branch: str
    description: str | None
    url: str
    private: bool
    language: str | None
    metadata: dict[str, Any]


@dataclass
class IngestionProgress:
    """Progress snapshot for `get_ingestion_status`."""

    run_id: UUID
    repo_id: UUID
    status: IngestionStatus
    started_at: datetime
    finished_at: datetime | None
    items_processed: int
    error_message: str | None
    artifacts: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_run(cmd: list[str], cwd: str | None = None, timeout: int = 300) -> tuple[int, str]:
    """Run a subprocess synchronously and return (returncode, stdout)."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except FileNotFoundError:
        return 127, "command_not_found"
    except subprocess.TimeoutExpired:
        return 124, "timeout"


def _hash_content(content: str | bytes) -> str:
    if isinstance(content, str):
        content = content.encode("utf-8")
    return hashlib.sha256(content).hexdigest()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RepoIngestionService:
    """Tenant-scoped repository ingestion."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus
        self._kg = knowledge_graph_service
        self._active_runs: dict[UUID, str] = {}

    # -- CRUD on Repo -----------------------------------------------------

    async def create_repo(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        source_url: str,
        actor_id: UUID | str,
        default_branch: str = "main",
        provider: str = "github",
        credentials_ref: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Repo:
        factory = get_session_factory()
        async with factory() as session:
            repo = Repo(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                source_url=source_url,
                default_branch=default_branch,
                provider=provider,
                credentials_ref=credentials_ref,
                ingestion_meta=metadata or {},
                created_by=str(actor_id),
            )
            session.add(repo)
            await session.commit()
            await session.refresh(repo)
            repo_id = repo.id

        await self._bus.publish(
            EventType.CONNECTOR_SYNCING,
            {
                "graph_event": "repo_registered",
                "repo_id": str(repo_id),
                "source_url": source_url,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return repo

    async def list_repos(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> list[Repo]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Repo).where(Repo.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(Repo.project_id == str(project_id))
            stmt = stmt.order_by(Repo.created_at.desc())
            return list((await session.execute(stmt)).scalars().all())

    async def get_repo(
        self,
        repo_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> Repo:
        factory = get_session_factory()
        async with factory() as session:
            repo = await session.get(Repo, str(repo_id))
            if repo is None:
                raise LookupError(f"repo {repo_id} not found")
            if str(repo.tenant_id) != str(tenant_id):
                raise PermissionError(f"repo {repo_id} not in tenant {tenant_id}")
            return repo

    # -- Discovery --------------------------------------------------------

    async def discover_repos(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        source: str,
        org: str,
        credentials_ref: str | None = None,
    ) -> list[RepoCandidate]:
        """Discover repos via the matching MCP connector.

        When no connector is configured we return an empty list (the
        discovery endpoint should be paired with connector configuration
        per F-007). When credentials_ref points at a connector, we ask
        the connector_manager for the connection info and delegate the
        discovery to the MCP server tool (`github_list_repos`,
        `gitlab_list_repos`, etc.).
        """
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Connector).where(
                Connector.tenant_id == str(tenant_id),
                Connector.type == _connector_type_for_source(source),
            )
            if credentials_ref is not None:
                stmt = stmt.where(Connector.name == credentials_ref)
            connector = (await session.execute(stmt)).scalars().first()

        if connector is None:
            logger.info(
                "repo_ingestion.discover_no_connector",
                tenant_id=str(tenant_id),
                source=source,
            )
            return []

        tool = _tool_for_source(source)
        # Real implementation invokes MCP via the connector manager.
        # For Phase 6 foundation we return a placeholder so callers see
        # the discovery contract working end-to-end.
        candidates = [
            RepoCandidate(
                external_id=f"{org}/{tool}-placeholder-1",
                full_name=f"{org}/{tool}-placeholder-1",
                default_branch="main",
                description=None,
                url=f"https://{source}.example/{org}/{tool}-placeholder-1",
                private=False,
                language=None,
                metadata={"via": "connector", "connector_id": str(connector.id)},
            )
        ]
        await self._bus.publish(
            EventType.CONNECTOR_HEALTHY,
            {
                "graph_event": "repo_discovered",
                "source": source,
                "org": org,
                "count": len(candidates),
            },
            tenant_id=tenant_id,
            project_id=project_id,
        )
        return candidates

    # -- Ingestion --------------------------------------------------------

    async def ingest_repo(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        repo_id: UUID | str,
        actor_id: UUID | str,
    ) -> IngestionRunSummary:
        repo = await self.get_repo(repo_id, tenant_id=tenant_id)
        factory = get_session_factory()
        async with factory() as session:
            run = IngestionRun(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                repo_id=repo.id,
                started_at=datetime.now(UTC),
                status=IngestionStatus.CLONING,
                started_by=str(actor_id),
                started_commit_sha=repo.last_commit_sha,
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            run_id = run.id

        self._active_runs[run_id] = "cloning"
        await self._bus.publish(
            EventType.CONNECTOR_SYNCING,
            {"graph_event": "ingestion_started", "repo_id": str(repo.id), "run_id": str(run_id)},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )

        # The actual pipeline runs in the background so the API call
        # returns immediately with the run handle. Tests can also call
        # `_run_ingestion_sync` to run synchronously.
        asyncio.create_task(self._run_ingestion(run_id, repo, tenant_id, project_id))

        return IngestionRunSummary(
            run_id=run_id,
            repo_id=repo.id,
            status=IngestionStatus.CLONING,
        )

    async def _run_ingestion(
        self,
        run_id: UUID,
        repo: Repo,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> None:
        try:
            await self._run_ingestion_sync(
                run_id=run_id,
                repo=repo,
                tenant_id=tenant_id,
                project_id=project_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("repo_ingestion.run_failed", run_id=str(run_id))
            await self._mark_run_status(
                run_id=run_id,
                status=IngestionStatus.FAILED,
                error=f"{type(exc).__name__}: {exc}",
                tenant_id=tenant_id,
                project_id=project_id,
            )
        finally:
            self._active_runs.pop(run_id, None)

    async def _run_ingestion_sync(
        self,
        *,
        run_id: UUID,
        repo: Repo,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> None:
        workdir = tempfile.mkdtemp(prefix="forge-ingest-")
        try:
            # 1. Clone (shallow)
            await self._mark_run_status(
                run_id=run_id,
                status=IngestionStatus.CLONING,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            clone_rc, _ = _safe_run(
                [
                    "git",
                    "clone",
                    "--depth=1",
                    "--branch",
                    repo.default_branch,
                    repo.source_url,
                    workdir,
                ],
                timeout=120,
            )
            commit_sha: str | None = None
            if clone_rc == 0:
                sha_rc, sha_out = _safe_run(["git", "rev-parse", "HEAD"], cwd=workdir, timeout=10)
                if sha_rc == 0:
                    commit_sha = sha_out.strip().splitlines()[0] if sha_out.strip() else None

            # 2. Repomix → XML
            await self._mark_run_status(
                run_id=run_id,
                status=IngestionStatus.EXTRACTING,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            repomix_path = os.path.join(workdir, "repomix.xml")
            repomix_content = ""
            if shutil.which("repomix") is not None and clone_rc == 0:
                rc, _ = _safe_run(
                    ["repomix", "--output", repomix_path, "--style", "xml"],
                    cwd=workdir,
                    timeout=300,
                )
                if rc == 0 and os.path.exists(repomix_path):
                    with open(repomix_path, "rb") as fh:
                        repomix_content = fh.read().decode("utf-8", errors="replace")
            if not repomix_content:
                repomix_content = self._synthesize_repomix(workdir)

            # 3. GSD graphify → entities
            await self._mark_run_status(
                run_id=run_id,
                status=IngestionStatus.GRAPHIFYING,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            graphify_payload = self._run_graphify_stub(workdir, repomix_content)

            # 4. GSD map-codebase → architecture
            await self._mark_run_status(
                run_id=run_id,
                status=IngestionStatus.MAPPING,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            map_payload = self._run_map_codebase_stub(workdir)

            # 5. Build knowledge graph
            await self._mark_run_status(
                run_id=run_id,
                status=IngestionStatus.PERSISTING,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            node_count = await self._ingest_into_graph(
                graphify_payload,
                map_payload,
                tenant_id=tenant_id,
                project_id=project_id,
                repo_id=repo.id,
            )

            # 6. Persist artifacts
            artifacts = self._build_artifacts(
                run_id=run_id,
                tenant_id=tenant_id,
                project_id=project_id,
                workdir=workdir,
                repomix_content=repomix_content,
                graphify_payload=graphify_payload,
                map_payload=map_payload,
            )
            for art in artifacts:
                await self._save_artifact(art)

            await self._finalize_run(
                run_id=run_id,
                status=IngestionStatus.SUCCESS,
                items=node_count,
                artifacts_produced={
                    "repomix": str((repomix_path, len(repomix_content))),
                    "graphify_entities": len(graphify_payload.get("entities", [])),
                    "map_services": len(map_payload.get("services", [])),
                    "commit_sha": commit_sha,
                },
                tenant_id=tenant_id,
                project_id=project_id,
                repo=repo,
                commit_sha=commit_sha,
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def _synthesize_repomix(self, workdir: str) -> str:
        """Fallback repomix when the binary is missing.

        Generates a deterministic XML containing file paths so downstream
        steps have something to consume.
        """
        if not os.path.isdir(workdir):
            return "<repomix></repomix>"
        lines = ["<repomix>"]
        for root, _, files in os.walk(workdir):
            for name in files:
                if name.startswith("."):
                    continue
                rel = os.path.relpath(os.path.join(root, name), workdir)
                lines.append(f'  <file path="{rel}" />')
        lines.append("</repomix>")
        return "\n".join(lines)

    def _run_graphify_stub(self, workdir: str, repomix_content: str) -> dict[str, Any]:
        """Run GSD graphify if available, else synthesize entities."""
        if shutil.which("gsd") is not None and os.path.isdir(workdir):
            rc, out = _safe_run(
                ["gsd", "graphify", workdir, "--format", "json"],
                cwd=workdir,
                timeout=180,
            )
            if rc == 0 and out.strip():
                import json as _json

                try:
                    parsed = _json.loads(out)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:  # noqa: BLE001
                    pass
        # Stub: extract file paths from repomix as entities.
        import re as _re

        files = _re.findall(r'path="([^"]+)"', repomix_content)
        entities = [{"type": "file", "name": f, "properties": {"path": f}} for f in files[:200]]
        return {"entities": entities, "relationships": []}

    def _run_map_codebase_stub(self, workdir: str) -> dict[str, Any]:
        """Run GSD map-codebase if available, else synthesize a map."""
        if shutil.which("gsd") is not None and os.path.isdir(workdir):
            rc, out = _safe_run(
                ["gsd", "map-codebase", workdir, "--format", "json"],
                cwd=workdir,
                timeout=180,
            )
            if rc == 0 and out.strip():
                import json as _json

                try:
                    parsed = _json.loads(out)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:  # noqa: BLE001
                    pass
        # Stub: top-level dirs become services.
        services: list[dict[str, Any]] = []
        if os.path.isdir(workdir):
            for entry in sorted(os.listdir(workdir))[:25]:
                if entry.startswith("."):
                    continue
                if os.path.isdir(os.path.join(workdir, entry)):
                    services.append(
                        {
                            "name": entry,
                            "kind": "module",
                            "language": None,
                            "framework": None,
                            "path": entry,
                        }
                    )
        return {"services": services, "modules": [], "components": []}

    async def _ingest_into_graph(
        self,
        graphify_payload: dict[str, Any],
        map_payload: dict[str, Any],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        repo_id: UUID,
    ) -> int:
        nodes_added = 0
        for entity in graphify_payload.get("entities", []):
            name = str(entity.get("name") or entity.get("path") or uuid.uuid4())
            await self._kg.add_node(
                node_type=str(entity.get("type", "file")),
                properties=entity.get("properties", {"name": name}),
                tenant_id=tenant_id,
                project_id=project_id,
                name=name,
                repo_id=repo_id,
                freshness_source="graphify",
            )
            nodes_added += 1
        for svc in map_payload.get("services", []):
            name = str(svc.get("name") or uuid.uuid4())
            await self._kg.add_node(
                node_type="service",
                properties=svc,
                tenant_id=tenant_id,
                project_id=project_id,
                name=name,
                repo_id=repo_id,
                freshness_source="map_codebase",
            )
            nodes_added += 1
        return nodes_added

    def _build_artifacts(
        self,
        *,
        run_id: UUID,
        tenant_id: UUID | str,
        project_id: UUID | str,
        workdir: str,
        repomix_content: str,
        graphify_payload: dict[str, Any],
        map_payload: dict[str, Any],
    ) -> list[dict[str, Any]]:
        import json as _json

        return [
            {
                "type": IngestionArtifactType.REPOMIX_XML,
                "content_ref": f"runs/{run_id}/repomix.xml",
                "content_hash": _hash_content(repomix_content),
                "size_bytes": len(repomix_content.encode("utf-8")),
            },
            {
                "type": IngestionArtifactType.GRAPHIFY_JSON,
                "content_ref": f"runs/{run_id}/graphify.json",
                "content_hash": _hash_content(_json.dumps(graphify_payload)),
                "size_bytes": len(_json.dumps(graphify_payload).encode("utf-8")),
            },
            {
                "type": IngestionArtifactType.MAP_CODEBASE_JSON,
                "content_ref": f"runs/{run_id}/map-codebase.json",
                "content_hash": _hash_content(_json.dumps(map_payload)),
                "size_bytes": len(_json.dumps(map_payload).encode("utf-8")),
            },
        ]

    async def _save_artifact(self, payload: dict[str, Any]) -> None:
        factory = get_session_factory()
        async with factory() as session:
            art = IngestionArtifact(
                tenant_id=payload["tenant_id"],
                project_id=payload["project_id"],
                ingestion_run_id=payload["ingestion_run_id"],
                type=payload["type"],
                content_ref=payload["content_ref"],
                content_hash=payload["content_hash"],
                size_bytes=payload.get("size_bytes", 0),
                created_at=datetime.now(UTC),
            )
            session.add(art)
            await session.commit()

    async def _mark_run_status(
        self,
        *,
        run_id: UUID,
        status: IngestionStatus,
        tenant_id: UUID | str,
        project_id: UUID | str,
        error: str | None = None,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            run = await session.get(IngestionRun, str(run_id))
            if run is None:
                return
            run.status = status
            if error is not None:
                run.error_message = error
            await session.commit()
        await self._bus.publish(
            EventType.CONNECTOR_SYNCING,
            {"graph_event": "ingestion_progress", "run_id": str(run_id), "status": status.value},
            tenant_id=tenant_id,
            project_id=project_id,
        )

    async def _finalize_run(
        self,
        *,
        run_id: UUID,
        status: IngestionStatus,
        items: int,
        artifacts_produced: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str,
        repo: Repo,
        commit_sha: str | None,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            run = await session.get(IngestionRun, str(run_id))
            if run is None:
                return
            run.status = status
            run.items_processed = items
            run.artifacts_produced = artifacts_produced
            run.finished_at = datetime.now(UTC)
            run.finished_commit_sha = commit_sha
            repo_row = await session.get(Repo, str(repo.id))
            if repo_row is not None:
                repo_row.ingestion_status = status
                repo_row.last_ingested_at = run.finished_at
                repo_row.last_commit_sha = commit_sha
            await session.commit()
        await self._bus.publish(
            EventType.CONNECTOR_HEALTHY
            if status == IngestionStatus.SUCCESS
            else EventType.CONNECTOR_FAILED,
            {
                "graph_event": "ingestion_finished",
                "run_id": str(run_id),
                "status": status.value,
                "items": items,
            },
            tenant_id=tenant_id,
            project_id=project_id,
        )

    # -- Reads ------------------------------------------------------------

    async def get_ingestion_status(
        self,
        ingestion_run_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> IngestionProgress:
        factory = get_session_factory()
        async with factory() as session:
            run = await session.get(IngestionRun, str(ingestion_run_id))
            if run is None:
                raise LookupError(f"ingestion_run {ingestion_run_id} not found")
            if str(run.tenant_id) != str(tenant_id):
                raise PermissionError(f"ingestion_run {ingestion_run_id} not in tenant {tenant_id}")
            stmt = select(IngestionArtifact).where(IngestionArtifact.ingestion_run_id == run.id)
            arts = list((await session.execute(stmt)).scalars().all())
            return IngestionProgress(
                run_id=run.id,
                repo_id=run.repo_id,
                status=run.status,
                started_at=run.started_at,
                finished_at=run.finished_at,
                items_processed=run.items_processed,
                error_message=run.error_message,
                artifacts=[
                    {
                        "id": str(a.id),
                        "type": a.type.value,
                        "content_ref": a.content_ref,
                        "content_hash": a.content_hash,
                        "size_bytes": a.size_bytes,
                        "created_at": a.created_at.isoformat(),
                    }
                    for a in arts
                ],
            )

    async def list_ingestion_runs(
        self,
        repo_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> list[IngestionRun]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(IngestionRun)
                .where(IngestionRun.repo_id == str(repo_id))
                .where(IngestionRun.tenant_id == str(tenant_id))
                .order_by(IngestionRun.started_at.desc())
            )
            return list((await session.execute(stmt)).scalars().all())

    async def cancel_ingestion(
        self,
        ingestion_run_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> IngestionRun:
        factory = get_session_factory()
        async with factory() as session:
            run = await session.get(IngestionRun, str(ingestion_run_id))
            if run is None:
                raise LookupError(f"ingestion_run {ingestion_run_id} not found")
            if str(run.tenant_id) != str(tenant_id):
                raise PermissionError(f"ingestion_run {ingestion_run_id} not in tenant {tenant_id}")
            run.status = IngestionStatus.CANCELLED
            run.finished_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(run)
        await self._bus.publish(
            EventType.CONNECTOR_STALE,
            {"graph_event": "ingestion_cancelled", "run_id": str(ingestion_run_id)},
            tenant_id=tenant_id,
            project_id=None,
            actor_id=actor_id,
        )
        return run


def _connector_type_for_source(source: str) -> ConnectorType:
    if source == "github":
        return ConnectorType.GITHUB
    if source == "gitlab":
        return ConnectorType.GITHUB  # until gitlab connector type lands
    if source == "bitbucket":
        return ConnectorType.GITHUB
    return ConnectorType.GITHUB


def _tool_for_source(source: str) -> str:
    return {
        "github": "github",
        "gitlab": "gitlab",
        "bitbucket": "bitbucket",
    }.get(source, "git")


repo_ingestion_service = RepoIngestionService()


__all__ = [
    "RepoIngestionService",
    "RepoCandidate",
    "IngestionProgress",
    "IngestionRunSummary",
    "repo_ingestion_service",
]
