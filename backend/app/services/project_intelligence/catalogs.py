"""Catalog services (F-105 API, F-106 DB, F-107 Services).

Each catalog reads from the knowledge graph (services, modules) and
parses manifests already loaded by the ingestion pipeline to produce a
project-scoped view of the system's surface area.
"""

from __future__ import annotations

import json
import os as _os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.repo_ingestion import IngestionArtifact, IngestionArtifactType, IngestionRun, Repo
from app.db.session import get_session_factory
from app.services.knowledge_graph import knowledge_graph_service

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class APIEndpoint:
    service: str
    method: str
    path: str
    source: str
    summary: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class APICatalog:
    project_id: UUID
    endpoints: list[APIEndpoint]
    sources: list[str]
    generated_at: datetime


@dataclass
class DatabaseTable:
    name: str
    schema_name: str | None
    columns: list[dict[str, Any]]
    relationships: list[dict[str, Any]]


@dataclass
class DatabaseMap:
    project_id: UUID
    schemas: list[str]
    tables: list[DatabaseTable]
    generated_at: datetime


@dataclass
class ServiceEntry:
    name: str
    kind: str
    language: str | None
    framework: str | None
    path: str | None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ServiceCatalog:
    project_id: UUID
    services: list[ServiceEntry]
    generated_at: datetime


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class CatalogService:
    """Aggregates per-project API / DB / Service catalogs from the KG."""

    def __init__(self) -> None:
        self._kg = knowledge_graph_service

    # -- F-105: API catalog -------------------------------------------------

    async def get_api_catalog(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> APICatalog:
        manifests = await self._load_latest_manifests(tenant_id=tenant_id)
        endpoints: list[APIEndpoint] = []
        sources: set[str] = set()

        # FastAPI/Flask routes from Python files
        endpoints.extend(_extract_python_routes(manifests.get("python", {})))
        # Express/Nest routes from JS
        endpoints.extend(_extract_node_routes(manifests.get("node", {})))
        # OpenAPI specs (when shipped)
        for spec_path, spec in (manifests.get("openapi") or {}).items():
            endpoints.extend(_extract_openapi(spec_path, spec))
            sources.add("openapi")

        # GraphQL: best-effort — any .graphql file counts as a schema
        if manifests.get("graphql"):
            sources.add("graphql")
        # gRPC: any .proto file counts
        if manifests.get("grpc"):
            sources.add("grpc")

        return APICatalog(
            project_id=project_id,
            endpoints=endpoints,
            sources=sorted(sources) or ["heuristic"],
            generated_at=datetime.now(timezone.utc),
        )

    # -- F-106: database map -----------------------------------------------

    async def get_database_map(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> DatabaseMap:
        manifests = await self._load_latest_manifests(tenant_id=tenant_id)
        tables: list[DatabaseTable] = []
        schemas: set[str] = set()

        # Alembic / Prisma / Django / SQLAlchemy models
        for path, content in (manifests.get("python") or {}).items():
            if path.endswith("alembic/versions") or "migration" in path:
                for t in _extract_sql_tables(content):
                    tables.append(t)
                    if t.schema_name:
                        schemas.add(t.schema_name)

        # Prisma schema
        for path, content in (manifests.get("node") or {}).items():
            if path.endswith("schema.prisma"):
                for t in _extract_prisma_models(content):
                    tables.append(t)
                    schemas.add(t.schema_name or "public")

        return DatabaseMap(
            project_id=project_id,
            schemas=sorted(schemas) or ["public"],
            tables=tables,
            generated_at=datetime.now(timezone.utc),
        )

    # -- F-107: service catalog -------------------------------------------

    async def get_service_catalog(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> ServiceCatalog:
        # Read directly from the KG (architecture_discovery wrote them).
        service_nodes = await self._kg.list_nodes(
            tenant_id=tenant_id,
            project_id=project_id,
            node_type="service",
            limit=500,
        )
        services: list[ServiceEntry] = []
        for n in service_nodes:
            props = n.properties or {}
            services.append(
                ServiceEntry(
                    name=n.name,
                    kind=str(props.get("kind") or "service"),
                    language=props.get("language"),
                    framework=props.get("framework"),
                    path=props.get("path"),
                    metadata=props,
                )
            )
        # Heuristics: Dockerfiles / k8s manifests also yield services.
        manifests = await self._load_latest_manifests(tenant_id=tenant_id)
        for path, content in (manifests.get("deploy") or {}).items():
            base = path.rsplit("/", 1)[-1]
            services.append(
                ServiceEntry(
                    name=base,
                    kind="deployable",
                    language=None,
                    framework=None,
                    path=path,
                    metadata={"source": "manifest", "size": len(content)},
                )
            )
        return ServiceCatalog(
            project_id=project_id,
            services=services,
            generated_at=datetime.now(timezone.utc),
        )

    # -- helpers ----------------------------------------------------------

    async def _load_latest_manifests(
        self, *, tenant_id: UUID | str
    ) -> dict[str, dict[str, str]]:
        """Return a category-keyed dict of latest manifest paths → content."""
        out: dict[str, dict[str, str]] = {
            "node": {},
            "python": {},
            "openapi": {},
            "graphql": {},
            "grpc": {},
            "deploy": {},
        }
        factory = get_session_factory()
        async with factory() as session:
            # Find the most recent successful run per repo, join via KG.
            stmt = (
                select(IngestionRun)
                .where(IngestionRun.status == "success")
                .order_by(IngestionRun.started_at.desc())
                .limit(20)
            )
            runs = list((await session.execute(stmt)).scalars().all())
            for run in runs:
                stmt_art = select(IngestionArtifact).where(
                    IngestionArtifact.ingestion_run_id == run.id
                )
                for art in (await session.execute(stmt_art)).scalars():
                    if not _os.path.exists(art.content_ref):
                        continue
                    try:
                        with open(art.content_ref, "rb") as fh:
                            content = fh.read().decode("utf-8", errors="replace")
                    except OSError:
                        continue
                    bucket = _bucket_for_artifact(art.content_ref, content)
                    if bucket is None:
                        continue
                    out[bucket][art.content_ref] = content
        return out


def _bucket_for_artifact(path: str, content: str) -> str | None:
    name = path.rsplit("/", 1)[-1].lower()
    if name.endswith(".proto"):
        return "grpc"
    if name.endswith(".graphql") or name.endswith(".gql"):
        return "graphql"
    if name in {"openapi.json", "openapi.yaml", "swagger.json", "swagger.yaml"}:
        return "openapi"
    if name in {"package.json", "schema.prisma"}:
        return "node"
    if name.endswith(".py") or name == "requirements.txt":
        return "python"
    if name in {"Dockerfile", "docker-compose.yml"} or "/k8s/" in path:
        return "deploy"
    return None


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------


_PYTHON_ROUTE_RE = re.compile(
    r"@(?:app|router|bp|api)\.(get|post|put|delete|patch|options|head)\(\s*['\"]([^'\"]+)['\"]"
)


def _extract_python_routes(python_files: dict[str, str]) -> list[APIEndpoint]:
    out: list[APIEndpoint] = []
    for path, content in python_files.items():
        for m in _PYTHON_ROUTE_RE.finditer(content):
            out.append(
                APIEndpoint(
                    service=path.split("/", 1)[0] if "/" in path else path,
                    method=m.group(1).upper(),
                    path=m.group(2),
                    source="heuristic:python",
                    metadata={"file": path},
                )
            )
    return out


_NODE_ROUTE_RE = re.compile(
    r"(?:app|router)\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]"
)


def _extract_node_routes(node_files: dict[str, str]) -> list[APIEndpoint]:
    out: list[APIEndpoint] = []
    for path, content in node_files.items():
        for m in _NODE_ROUTE_RE.finditer(content):
            out.append(
                APIEndpoint(
                    service=path.split("/", 1)[0] if "/" in path else path,
                    method=m.group(1).upper(),
                    path=m.group(2),
                    source="heuristic:node",
                    metadata={"file": path},
                )
            )
    return out


def _extract_openapi(path: str, content: str) -> list[APIEndpoint]:
    out: list[APIEndpoint] = []
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        # YAML → trivial regex fallback
        for line in content.splitlines():
            if line.strip().startswith("/"):
                out.append(
                    APIEndpoint(
                        service=path,
                        method="GET",
                        path=line.strip().rstrip(":"),
                        source="openapi:yaml-fallback",
                    )
                )
        return out
    paths = data.get("paths") or {}
    for route, methods in paths.items():
        for method in ("get", "post", "put", "delete", "patch"):
            if method in methods:
                out.append(
                    APIEndpoint(
                        service=path,
                        method=method.upper(),
                        path=route,
                        source="openapi",
                        summary=(methods[method].get("summary") if isinstance(methods[method], dict) else None),
                    )
                )
    return out


_SQL_CREATE_TABLE = re.compile(
    r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:\"?([\w]+)\"?\.)?\"?([\w]+)\"?\s*\(([^;]+)\)",
    re.IGNORECASE | re.DOTALL,
)


def _extract_sql_tables(content: str) -> list[DatabaseTable]:
    out: list[DatabaseTable] = []
    for m in _SQL_CREATE_TABLE.finditer(content):
        schema = m.group(1)
        name = m.group(2)
        body = m.group(3)
        columns: list[dict[str, Any]] = []
        for line in body.split(","):
            s = line.strip()
            if not s:
                continue
            parts = s.split()
            if len(parts) >= 2:
                columns.append({"name": parts[0].strip('"'), "type": parts[1]})
        out.append(DatabaseTable(name=name, schema_name=schema, columns=columns, relationships=[]))
    return out


_PRISMA_MODEL = re.compile(r"model\s+(\w+)\s*\{([^}]+)\}", re.DOTALL)


def _extract_prisma_models(content: str) -> list[DatabaseTable]:
    out: list[DatabaseTable] = []
    for m in _PRISMA_MODEL.finditer(content):
        name = m.group(1)
        body = m.group(2)
        columns = []
        for line in body.splitlines():
            s = line.strip()
            if not s or s.startswith("//"):
                continue
            parts = s.split()
            if len(parts) >= 2:
                columns.append({"name": parts[0], "type": parts[1]})
        out.append(DatabaseTable(name=name, schema_name="public", columns=columns, relationships=[]))
    return out


catalog_service = CatalogService()


__all__ = [
    "CatalogService",
    "APICatalog",
    "APIEndpoint",
    "DatabaseMap",
    "DatabaseTable",
    "ServiceCatalog",
    "ServiceEntry",
    "catalog_service",
]