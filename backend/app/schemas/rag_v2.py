"""step-78 F13 — RAG / Embeddings / Vector Stores / OCR schemas.

Typed artifacts for the F13 surface. Fields mirror the upstream LiteLLM
``/v1/embeddings``, ``/v1/vector_stores``, ``/v1/rag/*``, ``/v2/rerank``,
``/v1/ocr``, and ``/search_tools/*`` shapes so the HTTP layer can hand
back the same payload the proxy returns, plus derived fields
(e.g. ``embedding`` row, ``chunks`` list) when the spec asks for them.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class VectorStoreStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class ChunkingStrategy(str, Enum):
    RECURSIVE = "recursive"
    SEMANTIC = "semantic"
    FIXED = "fixed"
    NONE = "none"


class OCRMime(str, Enum):
    PDF = "application/pdf"
    PNG = "image/png"
    JPEG = "image/jpeg"
    WEBP = "image/webp"
    TIFF = "image/tiff"


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------


class EmbeddingsRequest(ForgeBaseModel):
    """POST /forge/embeddings payload."""

    input: list[str] = Field(..., min_length=1, max_length=2048)
    model: str = Field(default="text-embedding-3-small")


class EmbeddingItem(ForgeBaseModel):
    """Single embedding vector + its index in the input batch."""

    index: int = 0
    embedding: list[float]
    object: str = "embedding"


class EmbeddingsUsage(ForgeBaseModel):
    prompt_tokens: int = 0
    total_tokens: int = 0


class EmbeddingsResponse(ForgeBaseModel):
    """POST /forge/embeddings response."""

    object: str = "list"
    data: list[EmbeddingItem]
    model: str
    usage: EmbeddingsUsage = EmbeddingsUsage()


# ---------------------------------------------------------------------------
# Vector stores
# ---------------------------------------------------------------------------


class VectorStoreCreate(ForgeBaseModel):
    """POST /forge/projects/{id}/vector-stores payload."""

    name: str | None = None
    file_ids: list[str] | None = None
    metadata: dict[str, Any] | None = None


class VectorStoreRead(ForgeBaseModel):
    """Vector store typed artifact."""

    id: UUID
    external_id: str
    tenant_id: UUID
    project_id: UUID
    name: str | None = None
    status: VectorStoreStatus = VectorStoreStatus.ACTIVE
    metadata_: dict[str, Any] | None = None
    archived_at: datetime | None = None
    created_at: datetime


class VectorStoreFileAttach(ForgeBaseModel):
    """POST /forge/vector-stores/{id}/files payload."""

    file_id: str


# ---------------------------------------------------------------------------
# RAG ingest / query
# ---------------------------------------------------------------------------


class RagIngestRequest(ForgeBaseModel):
    """POST /forge/rag/ingest payload."""

    file_id: str
    vector_store_id: str
    chunking_strategy: ChunkingStrategy | None = None
    chunk_size: int | None = Field(default=None, ge=64, le=8192)
    chunk_overlap: int | None = Field(default=None, ge=0, le=4096)


class RagIngestResponse(ForgeBaseModel):
    """POST /forge/rag/ingest response."""

    chunks_created: int = 0
    tokens_used: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0


class RagChunk(ForgeBaseModel):
    """One retrieved chunk. Matches F13 spec line 381."""

    text: str
    score: float
    source_file_id: str | None = None
    source_chunk_id: str | None = None
    metadata: dict[str, Any] | None = None


class RagQueryRequest(ForgeBaseModel):
    """POST /forge/rag/query payload."""

    vector_store_ids: list[str] = Field(..., min_length=1)
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=100)
    rerank: bool = False
    rerank_top_n: int | None = Field(default=None, ge=1, le=100)
    hybrid: bool = False


class RagQueryResponse(ForgeBaseModel):
    """POST /forge/rag/query response."""

    chunks: list[RagChunk] = Field(default_factory=list)
    total_tokens: int = 0
    latency_ms: int = 0


# ---------------------------------------------------------------------------
# Rerank
# ---------------------------------------------------------------------------


class RerankRequest(ForgeBaseModel):
    """POST /forge/rag/rerank payload."""

    model: str = Field(default="cohere/rerank-english-v3.0")
    query: str = Field(..., min_length=1)
    documents: list[str] = Field(..., min_length=1)
    top_n: int | None = Field(default=None, ge=1, le=100)


class RerankItem(ForgeBaseModel):
    index: int
    relevance_score: float
    document: str | None = None


class RerankResponse(ForgeBaseModel):
    results: list[RerankItem] = Field(default_factory=list)
    model: str | None = None


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------


class OCRRequest(ForgeBaseModel):
    """POST /forge/ocr payload."""

    file_id: str
    mime_type: str | None = None


class OCRResponse(ForgeBaseModel):
    """POST /forge/ocr response."""

    file_id: str
    text: str
    pages: int = 0
    ocr_skipped: bool = False
    latency_ms: int = 0


# ---------------------------------------------------------------------------
# Search tools
# ---------------------------------------------------------------------------


class SearchToolInfo(ForgeBaseModel):
    """One external search provider."""

    id: str
    name: str
    kind: str | None = None
    enabled: bool = True


class SearchToolListResponse(ForgeBaseModel):
    tools: list[SearchToolInfo] = Field(default_factory=list)


class SearchToolTestRequest(ForgeBaseModel):
    """POST /forge/search-tools/{id}/test payload."""

    query: str | None = None


class SearchToolTestResponse(ForgeBaseModel):
    ok: bool
    latency_ms: int = 0
    detail: str | None = None
    results: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------


class RagStatsResponse(ForgeBaseModel):
    """GET /forge/rag/stats response."""

    chunk_count: int = 0
    vector_store_count: int = 0
    p50_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0


__all__ = [
    "ChunkingStrategy",
    "EmbeddingItem",
    "EmbeddingsRequest",
    "EmbeddingsResponse",
    "EmbeddingsUsage",
    "OCRRequest",
    "OCRResponse",
    "OCRMime",
    "RagChunk",
    "RagIngestRequest",
    "RagIngestResponse",
    "RagQueryRequest",
    "RagQueryResponse",
    "RagStatsResponse",
    "RerankItem",
    "RerankRequest",
    "RerankResponse",
    "SearchToolInfo",
    "SearchToolListResponse",
    "SearchToolTestRequest",
    "SearchToolTestResponse",
    "VectorStoreCreate",
    "VectorStoreFileAttach",
    "VectorStoreRead",
    "VectorStoreStatus",
]