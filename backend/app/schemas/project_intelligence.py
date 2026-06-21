"""Pydantic v2 schemas for Project Intelligence (F-101..F-115)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.repo_ingestion import IngestionArtifactType, IngestionStatus
from app.schemas.common import ForgeBaseModel, TenantScopedModel


# ---------------------------------------------------------------------------
# Enums (mirror model enums so the API stays closed-set)
# ---------------------------------------------------------------------------


class RepoProvider(str, Enum):
    GITHUB = "github"
    GITLAB = "gitlab"
    BITBUCKET = "bitbucket"
    AZURE_DEVOPS = "azure_devops"
    OTHER = "other"


class KGNodeType(str, Enum):
    SERVICE = "service"
    MODULE = "module"
    FILE = "file"
    FUNCTION = "function"
    CLASS = "class"
    API = "api"
    DATABASE_TABLE = "database_table"
    DEPENDENCY = "dependency"
    DECISION = "decision"
    DOCUMENT = "document"
    COMPONENT = "component"


class QASourceKind(str, Enum):
    NODE = "node"
    EDGE = "edge"
    DOCUMENT = "document"
    CITATION = "citation"


# ---------------------------------------------------------------------------
# Repo + ingestion
# ---------------------------------------------------------------------------


class RepoBase(ForgeBaseModel):
    source_url: str = Field(..., min_length=4, max_length=1024)
    provider: RepoProvider = RepoProvider.GITHUB
    default_branch: str = Field(default="main", max_length=120)


class RepoCreate(RepoBase):
    project_id: UUID
    credentials_ref: str | None = Field(default=None, max_length=200)


class RepoRead(RepoBase, TenantScopedModel):
    id: UUID
    last_ingested_at: datetime | None = None
    last_commit_sha: str | None = None
    ingestion_status: IngestionStatus
    credentials_ref: str | None = None
    created_by: UUID


class RepoUpdate(ForgeBaseModel):
    default_branch: str | None = None
    credentials_ref: str | None = None


class IngestionRunRead(ForgeBaseModel):
    id: UUID
    repo_id: UUID
    started_at: datetime
    finished_at: datetime | None = None
    status: IngestionStatus
    items_processed: int
    error_message: str | None = None
    artifacts_produced: dict[str, Any] = Field(default_factory=dict)
    started_commit_sha: str | None = None
    finished_commit_sha: str | None = None


class IngestionArtifactRead(ForgeBaseModel):
    id: UUID
    ingestion_run_id: UUID
    type: IngestionArtifactType
    content_ref: str
    content_hash: str
    size_bytes: int
    created_at: datetime


class RepoCandidate(ForgeBaseModel):
    """A repo discovered via a source provider."""

    external_id: str
    full_name: str
    default_branch: str
    description: str | None = None
    url: str
    private: bool = False
    language: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RepoDiscoverRequest(ForgeBaseModel):
    project_id: UUID
    source: RepoProvider
    org: str = Field(..., min_length=1, max_length=200)
    credentials_ref: str | None = None


class RepoDiscoverResponse(ForgeBaseModel):
    candidates: list[RepoCandidate]


class IngestionStatusRead(ForgeBaseModel):
    repo_id: UUID
    status: IngestionStatus
    last_ingested_at: datetime | None = None
    last_commit_sha: str | None = None
    active_run: IngestionRunRead | None = None


# ---------------------------------------------------------------------------
# Knowledge graph
# ---------------------------------------------------------------------------


class KGNodeRead(ForgeBaseModel):
    id: UUID
    node_type: str
    name: str
    properties: dict[str, Any] = Field(default_factory=dict)
    tenant_id: UUID
    project_id: UUID
    repo_id: UUID | None = None
    freshness_at: datetime | None = None
    freshness_source: str | None = None
    created_at: datetime
    updated_at: datetime


class KGEdgeRead(ForgeBaseModel):
    id: UUID
    from_node_id: UUID
    to_node_id: UUID
    edge_type: str
    properties: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class KGFreshnessInfo(ForgeBaseModel):
    node_id: UUID
    status: str
    freshness_at: datetime | None = None
    freshness_source: str | None = None
    age_seconds: float | None = None


class KGStats(ForgeBaseModel):
    node_count: int
    edge_count: int
    node_types: dict[str, int] = Field(default_factory=dict)
    edge_types: dict[str, int] = Field(default_factory=dict)


class CypherQueryRequest(ForgeBaseModel):
    query: str = Field(..., min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class SQLQueryRequest(ForgeBaseModel):
    query: str = Field(..., min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class HybridQueryRequest(ForgeBaseModel):
    cypher: str = Field(..., min_length=1)
    sql: str = Field(..., min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class VectorSearchRequest(ForgeBaseModel):
    embedding: list[float] = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=100)
    project_id: UUID | None = None
    node_type: str | None = None


# ---------------------------------------------------------------------------
# Architecture + catalogs
# ---------------------------------------------------------------------------


class ArchitectureMap(ForgeBaseModel):
    project_id: UUID
    services: list[dict[str, Any]] = Field(default_factory=list)
    modules: list[dict[str, Any]] = Field(default_factory=list)
    components: list[dict[str, Any]] = Field(default_factory=list)
    generated_at: datetime
    summary: str | None = None


class DependencyNode(ForgeBaseModel):
    name: str
    version: str | None = None
    ecosystem: str
    is_direct: bool = True


class DependencyGraph(ForgeBaseModel):
    project_id: UUID
    nodes: list[DependencyNode] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    ecosystems: list[str] = Field(default_factory=list)
    generated_at: datetime


class APIEndpoint(ForgeBaseModel):
    service: str
    method: str
    path: str
    source: str  # openapi | graphql | grpc
    summary: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class APICatalog(ForgeBaseModel):
    project_id: UUID
    endpoints: list[APIEndpoint] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    generated_at: datetime


class DatabaseTable(ForgeBaseModel):
    name: str
    schema_name: str | None = Field(default=None, alias="schema")
    columns: list[dict[str, Any]] = Field(default_factory=list)
    relationships: list[dict[str, Any]] = Field(default_factory=list)


class DatabaseMap(ForgeBaseModel):
    project_id: UUID
    schemas: list[str] = Field(default_factory=list)
    tables: list[DatabaseTable] = Field(default_factory=list)
    generated_at: datetime


class ServiceEntry(ForgeBaseModel):
    name: str
    kind: str  # service | worker | batch | cli | library
    language: str | None = None
    framework: str | None = None
    path: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ServiceCatalog(ForgeBaseModel):
    project_id: UUID
    services: list[ServiceEntry] = Field(default_factory=list)
    generated_at: datetime


# ---------------------------------------------------------------------------
# Q&A (F-108)
# ---------------------------------------------------------------------------


class QAAskRequest(ForgeBaseModel):
    project_id: UUID
    question: str = Field(..., min_length=1, max_length=4096)
    session_id: UUID | None = None
    context_filters: dict[str, Any] | None = None


class QASource(ForgeBaseModel):
    kind: QASourceKind
    reference: str  # node id, edge id, doc id
    snippet: str | None = None
    score: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class QAAnswer(ForgeBaseModel):
    answer: str
    sources: list[QASource] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    follow_ups: list[str] = Field(default_factory=list)
    session_id: UUID | None = None
    model: str | None = None


class QAMessage(ForgeBaseModel):
    id: UUID
    role: str
    content: str
    sources: list[QASource] = Field(default_factory=list)
    created_at: datetime


class QAHistory(ForgeBaseModel):
    session_id: UUID
    project_id: UUID
    messages: list[QAMessage] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Impact analysis (F-110)
# ---------------------------------------------------------------------------


class ChangeSetItem(ForgeBaseModel):
    kind: str  # file | function | api | service | schema
    reference: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChangeSet(ForgeBaseModel):
    project_id: UUID
    changes: list[ChangeSetItem]


class ImpactEntry(ForgeBaseModel):
    kind: str
    reference: str
    relationship: str  # direct | transitive
    metadata: dict[str, Any] = Field(default_factory=dict)


class ImpactReport(ForgeBaseModel):
    project_id: UUID
    direct_impact: list[ImpactEntry] = Field(default_factory=list)
    transitive_impact: list[ImpactEntry] = Field(default_factory=list)
    risk_score: float = Field(default=0.0, ge=0.0, le=1.0)
    recommended_tests: list[str] = Field(default_factory=list)
    impacted_slas: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Snapshots (F-109)
# ---------------------------------------------------------------------------


class Snapshot(ForgeBaseModel):
    id: UUID
    project_id: UUID
    created_at: datetime
    node_count: int
    edge_count: int
    content_ref: str
    content_hash: str
    label: str | None = None


class SnapshotList(ForgeBaseModel):
    project_id: UUID
    snapshots: list[Snapshot]


class SnapshotRestoreResult(ForgeBaseModel):
    snapshot_id: UUID
    restored_node_count: int
    restored_edge_count: int
    conflicts: list[str] = Field(default_factory=list)


class SnapshotDiff(ForgeBaseModel):
    snapshot_a: UUID
    snapshot_b: UUID
    nodes_added: list[str] = Field(default_factory=list)
    nodes_removed: list[str] = Field(default_factory=list)
    edges_added: list[str] = Field(default_factory=list)
    edges_removed: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Incremental sync + conflicts (F-111)
# ---------------------------------------------------------------------------


class ConflictRecord(ForgeBaseModel):
    id: UUID
    project_id: UUID
    entity_ref: str
    sources: list[str] = Field(default_factory=list)
    detected_at: datetime
    resolution: dict[str, Any] | None = None
    status: str = "pending"  # pending | resolved | dismissed


class SyncResult(ForgeBaseModel):
    repo_id: UUID
    since_commit_sha: str | None = None
    processed_files: int = 0
    added_nodes: int = 0
    updated_nodes: int = 0
    conflicts: list[ConflictRecord] = Field(default_factory=list)
    finished_at: datetime


class ConflictResolution(ForgeBaseModel):
    conflict_id: UUID
    resolution: dict[str, Any]


__all__ = [
    "ArchitectureMap",
    "APICatalog",
    "APIEndpoint",
    "ChangeSet",
    "ChangeSetItem",
    "ConflictRecord",
    "ConflictResolution",
    "CypherQueryRequest",
    "DatabaseMap",
    "DatabaseTable",
    "DependencyGraph",
    "DependencyNode",
    "HybridQueryRequest",
    "ImpactEntry",
    "ImpactReport",
    "IngestionArtifactRead",
    "IngestionRunRead",
    "IngestionStatusRead",
    "KGNodeRead",
    "KGEdgeRead",
    "KGFreshnessInfo",
    "KGNodeType",
    "KGStats",
    "QAAnswer",
    "QAAskRequest",
    "QAHistory",
    "QAMessage",
    "QASource",
    "QASourceKind",
    "RepoBase",
    "RepoCandidate",
    "RepoCreate",
    "RepoDiscoverRequest",
    "RepoDiscoverResponse",
    "RepoProvider",
    "RepoRead",
    "RepoUpdate",
    "ServiceCatalog",
    "ServiceEntry",
    "Snapshot",
    "SnapshotDiff",
    "SnapshotList",
    "SnapshotRestoreResult",
    "SQLQueryRequest",
    "SyncResult",
    "VectorSearchRequest",
]