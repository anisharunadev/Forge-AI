"""Architecture discovery service (F-103, F-104).

Detects services, modules, components and dependency declarations from
ingested repos, then materializes them as nodes/edges in the knowledge
graph. Heuristics cover the most common ecosystems.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.repo_ingestion import (
    IngestionArtifact,
    IngestionArtifactType,
    IngestionRun,
    Repo,
)
from app.db.session import get_session_factory
from app.services.event_bus import bus as default_bus
from app.services.knowledge_graph import knowledge_graph_service

logger = get_logger(__name__)


# Ecosystem → manifest file patterns.
MANIFEST_PATTERNS: dict[str, tuple[str, ...]] = {
    "node": ("package.json",),
    "python": ("requirements.txt", "pyproject.toml", "Pipfile"),
    "go": ("go.mod",),
    "rust": ("Cargo.toml",),
    "java": ("pom.xml", "build.gradle", "build.gradle.kts"),
    "ruby": ("Gemfile",),
    "dotnet": ("*.csproj",),
}


@dataclass
class ArchitectureMap:
    project_id: UUID
    services: list[dict[str, Any]]
    modules: list[dict[str, Any]]
    components: list[dict[str, Any]]
    generated_at: datetime
    summary: str | None


@dataclass
class DependencyNode:
    name: str
    version: str | None
    ecosystem: str
    is_direct: bool


@dataclass
class DependencyGraph:
    project_id: UUID
    nodes: list[DependencyNode]
    edges: list[dict[str, Any]]
    ecosystems: list[str]
    generated_at: datetime


class ArchitectureDiscoveryService:
    """Detects architecture + dependencies and stores in the KG."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus
        self._kg = knowledge_graph_service

    # -- Architecture -----------------------------------------------------

    async def discover_architecture(
        self,
        repo_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> ArchitectureMap:
        repo = await self._get_repo(repo_id, tenant_id=tenant_id)
        tree = await self._load_repo_tree(repo)

        services: list[dict[str, Any]] = []
        modules: list[dict[str, Any]] = []
        components: list[dict[str, Any]] = []

        for svc in _detect_services(tree):
            services.append(svc)
        for module in _detect_modules(tree):
            modules.append(module)
        for component in _detect_components(tree):
            components.append(component)

        # Persist as knowledge graph nodes
        for svc in services:
            await self._kg.add_node(
                node_type="service",
                properties=svc,
                tenant_id=tenant_id,
                project_id=project_id,
                name=svc.get("name", "unknown"),
                repo_id=repo.id,
                freshness_source="architecture_discovery",
            )

        summary = f"{len(services)} services, {len(modules)} modules, {len(components)} components"

        return ArchitectureMap(
            project_id=project_id,
            services=services,
            modules=modules,
            components=components,
            generated_at=datetime.now(UTC),
            summary=summary,
        )

    async def get_architecture_for_project(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> ArchitectureMap:
        nodes = await self._kg.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            node_type="service",
            limit=500,
        )
        services = [
            {
                "name": n.name,
                "properties": n.properties,
                "freshness_at": n.freshness_at.isoformat() if n.freshness_at else None,
            }
            for n in nodes
        ]
        return ArchitectureMap(
            project_id=project_id,
            services=services,
            modules=[],
            components=[],
            generated_at=datetime.now(UTC),
            summary=f"{len(services)} services (read from KG)",
        )

    # -- Dependencies -----------------------------------------------------

    async def discover_dependencies(
        self,
        repo_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> DependencyGraph:
        repo = await self._get_repo(repo_id, tenant_id=tenant_id)
        tree = await self._load_repo_tree(repo)

        nodes: list[DependencyNode] = []
        edges: list[dict[str, Any]] = []
        ecosystems: set[str] = set()

        for ecosystem, patterns in MANIFEST_PATTERNS.items():
            for path in tree:
                base = os.path.basename(path)
                if not any(_matches(base, p) for p in patterns):
                    continue
                ecosystems.add(ecosystem)
                deps = _parse_manifest(ecosystem, tree[path])
                for dep in deps:
                    nodes.append(dep)
                    edges.append(
                        {
                            "from": repo.source_url,
                            "to": f"{ecosystem}:{dep.name}",
                            "type": "depends_on",
                        }
                    )

        return DependencyGraph(
            project_id=project_id,
            nodes=nodes,
            edges=edges,
            ecosystems=sorted(ecosystems),
            generated_at=datetime.now(UTC),
        )

    async def get_dependency_graph_for_project(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> DependencyGraph:
        # Stored in KG via "dependency" node_type; read them back here.
        nodes = await self._kg.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            node_type="dependency",
            limit=2000,
        )
        edges = await self._kg.list_edges(
            tenant_id=tenant_id,
            project_id=project_id,
            edge_type="depends_on",
            limit=2000,
        )
        return DependencyGraph(
            project_id=project_id,
            nodes=[
                DependencyNode(
                    name=n.name,
                    version=str(n.properties.get("version") or "") or None,
                    ecosystem=str(n.properties.get("ecosystem") or "unknown"),
                    is_direct=bool(n.properties.get("is_direct", True)),
                )
                for n in nodes
            ],
            edges=[
                {
                    "from": str(e.from_node_id),
                    "to": str(e.to_node_id),
                    "type": e.edge_type,
                }
                for e in edges
            ],
            ecosystems=sorted({str(n.properties.get("ecosystem") or "unknown") for n in nodes}),
            generated_at=datetime.now(UTC),
        )

    # -- helpers ----------------------------------------------------------

    async def _get_repo(
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

    async def _load_repo_tree(self, repo: Repo) -> dict[str, str]:
        """Load the latest successful ingestion run's repo tarball into memory.

        For Phase 6 we synthesize a stub tree (or load from local clone
        if REPO_FS_ROOT is set). Real implementations pull the tarball
        from artifact storage.
        """
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(IngestionRun)
                .where(IngestionRun.repo_id == repo.id)
                .order_by(IngestionRun.started_at.desc())
                .limit(1)
            )
            run = (await session.execute(stmt)).scalars().first()
            if run is None:
                return {}
            stmt2 = select(IngestionArtifact).where(
                IngestionArtifact.ingestion_run_id == run.id,
                IngestionArtifact.type == IngestionArtifactType.REPO_TARBALL,
            )
            art = (await session.execute(stmt2)).scalars().first()

        if art is not None and os.path.exists(art.content_ref):
            return _walk_local(art.content_ref)
        return _synth_tree_for_stub(repo)


def _walk_local(root: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for r, _, files in os.walk(root):
        for f in files:
            full = os.path.join(r, f)
            rel = os.path.relpath(full, root)
            try:
                with open(full, "rb") as fh:
                    out[rel] = fh.read().decode("utf-8", errors="replace")
            except OSError:
                continue
    return out


def _synth_tree_for_stub(repo: Repo) -> dict[str, str]:
    """Synthetic tree used when no tarball exists yet."""
    return {
        "package.json": json.dumps(
            {"name": repo.source_url.rsplit("/", 1)[-1], "dependencies": {"fastapi": "^0.110"}}
        ),
        "requirements.txt": "fastapi>=0.110\npydantic>=2.6\n",
        "README.md": f"# {repo.source_url}\n\nForge stub repo.",
    }


def _matches(name: str, pattern: str) -> bool:
    if "*" not in pattern:
        return name == pattern
    import fnmatch

    return fnmatch.fnmatch(name, pattern)


def _detect_services(tree: dict[str, str]) -> list[dict[str, Any]]:
    """Service = top-level dir containing a manifest file."""
    services: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in tree:
        head = path.split("/", 1)[0] if "/" in path else path
        if head in seen:
            continue
        manifests_in_dir = [p for p in tree if p.startswith(head + "/") or p == head]
        for mf in manifests_in_dir:
            base = os.path.basename(mf)
            for ecosystem, patterns in MANIFEST_PATTERNS.items():
                if any(_matches(base, p) for p in patterns):
                    services.append(
                        {
                            "name": head,
                            "kind": "service",
                            "language": ecosystem,
                            "framework": None,
                            "path": head,
                            "metadata": {"detected_via": base},
                        }
                    )
                    seen.add(head)
                    break
    return services


def _detect_modules(tree: dict[str, str]) -> list[dict[str, Any]]:
    """Module = second-level directory inside a service."""
    modules: list[dict[str, Any]] = []
    for path in tree:
        parts = path.split("/")
        if len(parts) < 2:
            continue
        module = parts[1]
        if module.startswith(".") or module in {"node_modules", "dist", "build", "__pycache__"}:
            continue
        modules.append({"name": module, "path": f"{parts[0]}/{module}"})
    # Dedup
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for m in modules:
        if m["path"] in seen:
            continue
        seen.add(m["path"])
        unique.append(m)
    return unique[:100]


def _detect_components(tree: dict[str, str]) -> list[dict[str, Any]]:
    """Component = Dockerfile, k8s manifest, terraform file."""
    components: list[dict[str, Any]] = []
    for path in tree:
        base = os.path.basename(path)
        if base in {"Dockerfile", "docker-compose.yml"} or base.endswith(".yaml"):  # noqa: SIM102
            if "k8s" in path or "kubernetes" in path or base == "Dockerfile":
                components.append({"name": base, "path": path, "kind": "deployable"})
    return components[:50]


def _parse_manifest(ecosystem: str, content: str) -> list[DependencyNode]:
    if ecosystem == "node":
        return _parse_package_json(content)
    if ecosystem == "python":
        return _parse_requirements(content)
    if ecosystem == "go":
        return _parse_go_mod(content)
    if ecosystem == "rust":
        return _parse_cargo_toml(content)
    if ecosystem == "java":
        return _parse_pom_xml(content)
    return []


def _parse_package_json(content: str) -> list[DependencyNode]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []
    deps: list[DependencyNode] = []
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        for name, version in (data.get(section) or {}).items():
            deps.append(
                DependencyNode(name=name, version=str(version), ecosystem="node", is_direct=True)
            )
    return deps


def _parse_requirements(content: str) -> list[DependencyNode]:
    deps: list[DependencyNode] = []
    for line in content.splitlines():
        line = line.strip()  # noqa: PLW2901
        if not line or line.startswith("#"):
            continue
        if "==" in line:
            name, version = line.split("==", 1)
            deps.append(
                DependencyNode(
                    name=name.strip(), version=version.strip(), ecosystem="python", is_direct=True
                )
            )
        else:
            deps.append(
                DependencyNode(
                    name=line.split(";")[0].strip(),
                    version=None,
                    ecosystem="python",
                    is_direct=True,
                )
            )
    return deps


def _parse_go_mod(content: str) -> list[DependencyNode]:
    deps: list[DependencyNode] = []
    in_block = False
    for line in content.splitlines():
        line = line.strip()  # noqa: PLW2901
        if not line:
            continue
        if line.startswith("require ("):
            in_block = True
            continue
        if in_block and line == ")":
            in_block = False
            continue
        if in_block or line.startswith("require "):
            parts = line.replace("require ", "").split()
            if len(parts) >= 2:
                deps.append(
                    DependencyNode(name=parts[0], version=parts[1], ecosystem="go", is_direct=True)
                )
    return deps


def _parse_cargo_toml(content: str) -> list[DependencyNode]:
    deps: list[DependencyNode] = []
    in_deps = False
    for line in content.splitlines():
        s = line.strip()
        if s.startswith("[dependencies]"):
            in_deps = True
            continue
        if s.startswith("[") and s != "[dependencies]":
            in_deps = False
        if in_deps and "=" in s:
            name, version = s.split("=", 1)
            deps.append(
                DependencyNode(
                    name=name.strip(),
                    version=version.strip().strip('"'),
                    ecosystem="rust",
                    is_direct=True,
                )
            )
    return deps


def _parse_pom_xml(content: str) -> list[DependencyNode]:
    import re as _re

    pattern = _re.compile(
        r"<dependency>\s*<groupId>([^<]+)</groupId>\s*<artifactId>([^<]+)</artifactId>\s*<version>([^<]+)</version>",
        _re.DOTALL,
    )
    deps: list[DependencyNode] = []
    for m in pattern.finditer(content):
        deps.append(
            DependencyNode(
                name=f"{m.group(1)}:{m.group(2)}",
                version=m.group(3),
                ecosystem="java",
                is_direct=True,
            )
        )
    return deps


architecture_discovery_service = ArchitectureDiscoveryService()


__all__ = [
    "ArchitectureDiscoveryService",
    "ArchitectureMap",
    "DependencyGraph",
    "DependencyNode",
    "architecture_discovery_service",
]
