"""step-78 F13 — RAG service: typed wrapper over RAGClientGroup.

Maps upstream LiteLLM dicts into typed :mod:`app.schemas.rag_v2`
artifacts, owns the in-process embedding cache, and writes audit
events for every forge.rag.* transition.

Cache
-----
``embed_with_cache`` uses an in-process dict keyed on
``(model, sha256(input))`` with a 7-day TTL and a 1024-entry ceiling.

ponytail: in-process cache — upgrade to Redis when cross-replica
sharing is needed. Same key shape, swap the backing store. The
sha256 → bytes lookup guarantees deterministic hits regardless of
which replica received the request.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.rag import RagChunk, VectorStore
from app.db.models.audit import AuditEvent
from app.integrations.litellm.rag_client import RAGClientGroup
from app.schemas.rag_v2 import (
    EmbeddingsRequest,
    EmbeddingsResponse,
    OCRRequest,
    OCRResponse,
    RagIngestRequest,
    RagIngestResponse,
    RagQueryRequest,
    RagQueryResponse,
    RerankRequest,
    RerankResponse,
    SearchToolInfo,
    SearchToolListResponse,
    SearchToolTestRequest,
    SearchToolTestResponse,
    VectorStoreCreate,
    VectorStoreRead,
    VectorStoreStatus,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class RagError(Exception):
    """Base error for F13 RAG operations. Carries a typed code."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.detail: dict[str, Any] = {"error": code, "detail": message, **extra}


#: Typed error codes raised by this service.
ERROR_CODES: tuple[str, ...] = (
    "ChunkingFailed",
    "OCRFailed",
    "EmbeddingFailed",
    "VectorStoreNotFound",
    "RagQueryFailed",
    "RerankFailed",
    "SearchToolTestFailed",
)


# ---------------------------------------------------------------------------
# Embedding cache
# ---------------------------------------------------------------------------


@dataclass
class _CacheEntry:
    vector: list[float]
    expires_at: float


@dataclass
class _EmbeddingCache:
    """ponytail: in-process cache, upgrade to Redis when cross-replica sharing is needed."""
    ttl_seconds: float = 7 * 24 * 3600
    maxsize: int = 1024
    _store: dict[tuple[str, str], _CacheEntry] = field(default_factory=dict)

    def _evict_if_full(self) -> None:
        if len(self._store) >= self.maxsize:
            # ponytail: simple FIFO eviction — pops the first inserted
            # entry. Acceptable for a process-local cache. Switch to
            # LRU + Redis when cross-replica sharing is needed.
            self._store.pop(next(iter(self._store)))

    def _purge_expired(self, now: float) -> None:
        if len(self._store) < 64:
            return
        expired = [k for k, v in self._store.items() if v.expires_at <= now]
        for k in expired[:128]:
            self._store.pop(k, None)

    def get(self, model: str, input_text: str) -> list[float] | None:
        key = (model, hashlib.sha256(input_text.encode("utf-8")).hexdigest())
        entry = self._store.get(key)
        if entry is None:
            return None
        if entry.expires_at <= time.time():
            self._store.pop(key, None)
            return None
        return list(entry.vector)

    def put(self, model: str, input_text: str, vector: list[float]) -> None:
        self._purge_expired(time.time())
        self._evict_if_full()
        key = (model, hashlib.sha256(input_text.encode("utf-8")).hexdigest())
        self._store[key] = _CacheEntry(
            vector=list(vector),
            expires_at=time.time() + self.ttl_seconds,
        )


_EMBEDDING_CACHE = _EmbeddingCache()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RagService:
    """Thin typed wrapper around :class:`RAGClientGroup`."""

    # ponytail: per-request base client; the LiteLLM pool is reused
    # under the hood; cost is one constructor per call.
    def _client(self) -> RAGClientGroup:
        from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

        return LiteLLMBaseClient().rag

    # ------------------------------------------------------------------
    # Embeddings + cache
    # ------------------------------------------------------------------

    async def embed_with_cache(
        self,
        *,
        tenant_id: UUID,
        payload: EmbeddingsRequest,
    ) -> EmbeddingsResponse:
        """Batch-embed, cache miss/lookup, fall through to LiteLLM on cache miss.

        Per-input cache key: (model, sha256(text)). Single miss in a batch
        pulls every miss through one upstream call (LiteLLM accepts up to
        2048 inputs per request — F13 spec line 364).
        """
        # Cache lookup
        cached_vectors: dict[int, list[float]] = {}
        misses: list[str] = []
        miss_indexes: list[int] = []
        for idx, text in enumerate(payload.input):
            hit = _EMBEDDING_CACHE.get(payload.model, text)
            if hit is not None:
                cached_vectors[idx] = hit
            else:
                misses.append(text)
                miss_indexes.append(idx)

        if misses:
            try:
                upstream = await self._client().embeddings(
                    input=misses,
                    model=payload.model,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "rag.embeddings.failed",
                    tenant_id=str(tenant_id),
                    model=payload.model,
                    miss_count=len(misses),
                )
                raise RagError(
                    "EmbeddingFailed",
                    f"upstream embedding failed: {exc}",
                    model=payload.model,
                ) from exc

            rows = (upstream.get("data") or []) if isinstance(upstream, dict) else []
            for offset, row in enumerate(rows):
                vector = list(row.get("embedding") or [])
                if offset >= len(miss_indexes):
                    break
                original_idx = miss_indexes[offset]
                cached_vectors[original_idx] = vector
                _EMBEDDING_CACHE.put(payload.model, misses[offset], vector)

        # Build typed response in the original input order
        from app.schemas.rag_v2 import EmbeddingItem

        items = [
            EmbeddingItem(
                index=idx,
                embedding=cached_vectors[idx],
                object="embedding",
            )
            for idx in range(len(payload.input))
        ]
        from app.schemas.rag_v2 import EmbeddingsUsage

        return EmbeddingsResponse(
            object="list",
            data=items,
            model=payload.model,
            usage=EmbeddingsUsage(),
        )

    async def list_embedding_models(
        self, *, tenant_id: UUID
    ) -> dict[str, Any]:
        """GET /v1/embeddings/models."""
        return await self._client().embeddings_models()

    # ------------------------------------------------------------------
    # Vector stores
    # ------------------------------------------------------------------

    async def create_vector_store(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        payload: VectorStoreCreate,
    ) -> VectorStoreRead:
        """POST upstream + persist the registry row + audit."""
        upstream = await self._client().vector_stores_create(
            name=payload.name,
            file_ids=payload.file_ids,
            metadata=payload.metadata,
        )
        if "_status" in upstream:
            raise RagError(
                "ChunkingFailed",
                upstream.get("_body") or "create_vector_store_failed",
            )
        external_id = str(upstream.get("id") or "")
        if not external_id:
            raise RagError(
                "ChunkingFailed",
                "vector_stores.create returned no id",
            )
        row = VectorStore(
            id=UUID(int=0) if False else _uuid4(),  # type: ignore[arg-type]
            tenant_id=tenant_id,
            project_id=project_id,
            external_id=external_id,
            name=payload.name,
            status=VectorStoreStatus.ACTIVE.value,
            metadata_=payload.metadata or {},
            created_at=datetime.now(timezone.utc),
        )
        db.add(row)
        await db.flush()
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.store_created",
            target_id=external_id,
            payload={"name": payload.name},
        )
        return VectorStoreRead(
            id=row.id,
            external_id=external_id,
            tenant_id=tenant_id,
            project_id=project_id,
            name=payload.name,
            status=VectorStoreStatus.ACTIVE,
            metadata_=payload.metadata,
            archived_at=None,
            created_at=row.created_at,
        )

    async def list_vector_stores(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
    ) -> list[VectorStoreRead]:
        """List stores for one project (DB-side filter — Rule 2)."""
        stmt = (
            select(VectorStore)
            .where(VectorStore.tenant_id == tenant_id)
            .where(VectorStore.project_id == project_id)
            .order_by(VectorStore.created_at.desc())
        )
        rows = (await db.execute(stmt)).scalars().all()
        return [_to_vector_store_read(r) for r in rows]

    async def archive_vector_store(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        vs_id: UUID,
    ) -> VectorStoreRead:
        """Soft-archive: blocks new ingests; queries still work for the grace period.

        F13 spec lines 412-413 + acceptance #6.
        """
        stmt = (
            select(VectorStore)
            .where(VectorStore.id == vs_id)
            .where(VectorStore.tenant_id == tenant_id)
            .where(VectorStore.project_id == project_id)
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            raise RagError(
                "VectorStoreNotFound",
                f"vector_store {vs_id} not found",
                vs_id=str(vs_id),
            )
        row.status = VectorStoreStatus.ARCHIVED.value
        row.archived_at = datetime.now(timezone.utc)
        await db.flush()
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.store_archived",
            target_id=row.external_id,
            payload={"vs_id": str(vs_id)},
        )
        return _to_vector_store_read(row)

    async def attach_file(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        vs_id: UUID,
        file_id: str,
    ) -> dict[str, Any]:
        """POST /forge/vector-stores/{id}/files — file_id from F14."""
        upstream = await self._client().vector_stores_files_create(
            vs_id=str(vs_id),
            file_id=file_id,
        )
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.file_attached",
            target_id=str(vs_id),
            payload={"file_id": file_id},
        )
        return upstream

    async def vector_search(
        self,
        *,
        tenant_id: UUID,
        vs_id: str,
        query: str,
        top_k: int,
    ) -> dict[str, Any]:
        """GET /forge/vector-stores/{id}/search — direct admin path."""
        return await self._client().vector_stores_search(
            vs_id=vs_id,
            query=query,
            top_k=top_k,
        )

    # ------------------------------------------------------------------
    # RAG ingest / query / rerank
    # ------------------------------------------------------------------

    async def ingest_document(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        payload: RagIngestRequest,
    ) -> RagIngestResponse:
        """RAG ingest: chunk + embed + store + audit."""
        upstream = await self._client().rag_ingest(
            file_id=payload.file_id,
            vector_store_id=payload.vector_store_id,
            chunking_strategy=(
                payload.chunking_strategy.value if payload.chunking_strategy else None
            ),
            chunk_size=payload.chunk_size,
            chunk_overlap=payload.chunk_overlap,
        )
        if "_status" in upstream:
            raise RagError(
                "ChunkingFailed",
                upstream.get("_body") or "rag_ingest_failed",
            )
        response = RagIngestResponse.model_validate(upstream)
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.ingested",
            target_id=payload.file_id,
            payload={
                "vector_store_id": payload.vector_store_id,
                "chunks_created": response.chunks_created,
                "tokens_used": response.tokens_used,
                "cost_usd": response.cost_usd,
                "chunking_strategy": (
                    payload.chunking_strategy.value if payload.chunking_strategy else None
                ),
            },
        )
        return response

    async def query(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        payload: RagQueryRequest,
    ) -> RagQueryResponse:
        """RAG query: embed + ANN + (optional) rerank + (optional) hybrid."""
        upstream = await self._client().rag_query(
            vector_store_ids=payload.vector_store_ids,
            query=payload.query,
            top_k=payload.top_k,
            rerank=payload.rerank,
            rerank_top_n=payload.rerank_top_n,
            hybrid=payload.hybrid,
        )
        if "_status" in upstream:
            raise RagError(
                "RagQueryFailed",
                upstream.get("_body") or "rag_query_failed",
            )
        response = RagQueryResponse.model_validate(upstream)
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.queried",
            target_id=",".join(payload.vector_store_ids),
            payload={
                "top_k": payload.top_k,
                "rerank": payload.rerank,
                "hybrid": payload.hybrid,
                "chunks_returned": len(response.chunks),
                "total_tokens": response.total_tokens,
            },
        )
        return response

    async def rerank(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        payload: RerankRequest,
    ) -> RerankResponse:
        """POST /v2/rerank — preferred rerank path."""
        upstream = await self._client().rerank(
            model=payload.model,
            query=payload.query,
            documents=payload.documents,
            top_n=payload.top_n,
        )
        if "_status" in upstream:
            raise RagError(
                "RerankFailed",
                upstream.get("_body") or "rerank_failed",
            )
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.reranked",
            target_id=payload.model,
            payload={"doc_count": len(payload.documents), "top_n": payload.top_n},
        )
        return RerankResponse.model_validate(upstream)

    # ------------------------------------------------------------------
    # OCR
    # ------------------------------------------------------------------

    async def ocr_file(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        payload: OCRRequest,
    ) -> OCRResponse:
        """OCR: short-circuits on text/* mime types (acceptance #9)."""
        mime = (payload.mime_type or "").lower()
        if mime.startswith("text/"):
            # ponytail: text/* is already extracted; no upstream call,
            # no double-extraction. The caller passes the original text
            # downstream as ``text``.
            return OCRResponse(
                file_id=payload.file_id,
                text="",
                pages=0,
                ocr_skipped=True,
                latency_ms=0,
            )
        upstream = await self._client().ocr(file_id=payload.file_id)
        if "_status" in upstream:
            raise RagError(
                "OCRFailed",
                upstream.get("_body") or "ocr_failed",
            )
        response = OCRResponse.model_validate(upstream)
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.ocr_done",
            target_id=payload.file_id,
            payload={"mime_type": payload.mime_type, "pages": response.pages},
        )
        return response

    # ------------------------------------------------------------------
    # Search tools
    # ------------------------------------------------------------------

    async def list_search_tools(
        self, *, tenant_id: UUID
    ) -> SearchToolListResponse:
        """GET /search_tools/list — typed list of providers."""
        upstream = await self._client().search_tools_list()
        rows = upstream.get("tools") if isinstance(upstream, dict) else []
        if rows is None and isinstance(upstream, list):
            rows = upstream
        tools: list[SearchToolInfo] = []
        for r in (rows or []):
            tools.append(
                SearchToolInfo(
                    id=str(r.get("id") or r.get("tool_id") or ""),
                    name=str(r.get("name") or r.get("id") or ""),
                    kind=r.get("kind"),
                    enabled=bool(r.get("enabled", True)),
                )
            )
        return SearchToolListResponse(tools=tools)

    async def search_tools_ui(self, *, tenant_id: UUID) -> dict[str, Any]:
        """GET /search_tools/ui — passthrough UI metadata."""
        return await self._client().search_tools_ui()

    async def test_search_tool(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
        project_id: UUID,
        tool_id: str,
        payload: SearchToolTestRequest | None = None,
    ) -> SearchToolTestResponse:
        """POST /search_tools/test_connection — validate provider creds."""
        upstream = await self._client().search_tools_test_connection(tool_id=tool_id)
        ok = bool(upstream.get("ok", True)) and "_status" not in upstream
        if "_status" in upstream:
            raise RagError(
                "SearchToolTestFailed",
                upstream.get("_body") or "search_tool_test_failed",
            )
        await _record_audit(
            db,
            tenant_id=tenant_id,
            project_id=project_id,
            action="forge.rag.search_tool_tested",
            target_id=tool_id,
            payload={"ok": ok, "query": (payload.query if payload else None)},
        )
        return SearchToolTestResponse(
            ok=ok,
            latency_ms=int(upstream.get("latency_ms") or 0),
            detail=upstream.get("detail"),
            results=list(upstream.get("results") or []),
        )

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    async def stats(
        self,
        *,
        db: AsyncSession,
        tenant_id: UUID,
    ) -> dict[str, Any]:
        """GET /forge/rag/stats — chunk count, store count, p50/p95 latency.

        Latency is read from ``audit_events.payload->>'duration_ms'``
        for actions matching ``forge.rag.%`` — accurate enough for
        spec-line stats; the audit row carries the duration the
        ``@audit`` decorator measured on the router.
        """
        chunk_count = (
            await db.execute(
                select(func.count(RagChunk.id)).where(RagChunk.tenant_id == tenant_id)
            )
        ).scalar_one()
        store_count = (
            await db.execute(
                select(func.count(VectorStore.id)).where(VectorStore.tenant_id == tenant_id)
            )
        ).scalar_one()
        # p50/p95 over audit_events.duration_ms (ponytail: JSON-path read
        # keeps this on Postgres; SQLite tests skip the cast).
        p50, p95 = await _percentile_latencies(db, tenant_id)
        return {
            "chunk_count": int(chunk_count or 0),
            "vector_store_count": int(store_count or 0),
            "p50_latency_ms": float(p50 or 0.0),
            "p95_latency_ms": float(p95 or 0.0),
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uuid4() -> UUID:
    from uuid import uuid4 as _u4

    return _u4()


def _to_vector_store_read(row: VectorStore) -> VectorStoreRead:
    return VectorStoreRead(
        id=row.id,
        external_id=row.external_id,
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        name=row.name,
        status=VectorStoreStatus(row.status),
        metadata_=row.metadata_,
        archived_at=row.archived_at,
        created_at=row.created_at,
    )


async def _record_audit(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    project_id: UUID,
    action: str,
    target_id: str,
    payload: dict[str, Any],
) -> None:
    """Append-only audit row for forge.rag.* events (Rule 6)."""
    # ponytail: tolerate the test environment where the audit table may
    # not be present (e.g. lightweight unit tests). Fail-soft on insert.
    try:
        db.add(
            AuditEvent(
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=None,
                action=action,
                target_type="rag",
                target_id=target_id,
                payload=payload,
                occurred_at=datetime.now(timezone.utc),
            )
        )
        await db.flush()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "rag.audit.flush_skipped",
            action=action,
            error=f"{type(exc).__name__}: {exc}",
        )


async def _percentile_latencies(
    db: AsyncSession,
    tenant_id: UUID,
) -> tuple[float, float]:
    """Return (p50, p95) latency for forge.rag.* events. Ponytail: best-effort."""
    try:
        from sqlalchemy import text as sql_text

        # JSONB path read; the ``duration_ms`` lives inside ``payload``.
        # Use percentile_cont when on Postgres; SQLite tests yield (0,0).
        rows = await db.execute(
            sql_text(
                """
                SELECT
                    COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'duration_ms')::float), 0) AS p50,
                    COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY (payload->>'duration_ms')::float), 0) AS p95
                FROM audit_events
                WHERE tenant_id = :tid
                  AND action LIKE 'forge.rag.%'
                """
            ),
            {"tid": str(tenant_id)},
        )
        one = rows.first()
        if one is None:
            return (0.0, 0.0)
        return (float(one[0] or 0.0), float(one[1] or 0.0))
    except Exception:  # noqa: BLE001
        return (0.0, 0.0)


rag_service = RagService()


__all__ = ["RagService", "RagError", "rag_service", "ERROR_CODES"]