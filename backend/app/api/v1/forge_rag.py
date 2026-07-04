"""step-78 F13 — `/api/forge/rag/*` HTTP surface.

Phase 3 Feature 13 (step-78 §"Feature 13 — Embeddings + Vector Stores + RAG").
13 endpoints per spec lines 435-448.

Thin HTTP layer over :class:`rag_service`. Every endpoint depends on
``Principal`` + a ``require_permission`` string. Audit events follow the
``forge.rag.*`` taxonomy from step-78 §"Audit".
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
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
    SearchToolTestRequest,
    SearchToolTestResponse,
    VectorStoreCreate,
    VectorStoreRead,
)
from app.services.rag_service import RagError, rag_service

router = APIRouter(prefix="/forge", tags=["forge.rag"])
logger = get_logger(__name__)


def _tenant_id(principal: object) -> UUID:
    tid = getattr(principal, "tenant_id", None)
    if not tid:
        raise HTTPException(status_code=403, detail="token_missing_tenant_claim")
    return UUID(tid)


def _project_id(principal: object) -> UUID:
    pid = getattr(principal, "project_id", None)
    if not pid:
        raise HTTPException(status_code=403, detail="token_missing_project_claim")
    return UUID(pid)


def _rag_error_to_http(exc: RagError) -> HTTPException:
    code_to_status = {
        "VectorStoreNotFound": status.HTTP_404_NOT_FOUND,
        "ChunkingFailed": status.HTTP_400_BAD_REQUEST,
        "OCRFailed": status.HTTP_502_BAD_GATEWAY,
        "EmbeddingFailed": status.HTTP_502_BAD_GATEWAY,
        "RagQueryFailed": status.HTTP_502_BAD_GATEWAY,
        "RerankFailed": status.HTTP_502_BAD_GATEWAY,
        "SearchToolTestFailed": status.HTTP_502_BAD_GATEWAY,
    }
    return HTTPException(
        status_code=code_to_status.get(exc.code, status.HTTP_400_BAD_REQUEST),
        detail=exc.detail,
    )


# ---------------------------------------------------------------------------
# Embeddings (2 endpoints)
# ---------------------------------------------------------------------------


@router.get("/embeddings/models", response_model=dict)
@audit(action="forge.rag.models_listed", target_type="embedding")
async def list_embedding_models(
    principal: Annotated[object, Depends(require_permission("rag:read"))],
) -> dict:
    return await rag_service.list_embedding_models(tenant_id=_tenant_id(principal))


@router.post("/embeddings", response_model=EmbeddingsResponse)
@audit(action="forge.rag.embedded", target_type="embedding")
async def embed_inputs(
    payload: EmbeddingsRequest,
    principal: Annotated[object, Depends(require_permission("rag:write"))],
) -> EmbeddingsResponse:
    return await rag_service.embed_with_cache(
        tenant_id=_tenant_id(principal),
        payload=payload,
    )


# ---------------------------------------------------------------------------
# Vector stores (3 endpoints)
# ---------------------------------------------------------------------------


@router.get(
    "/projects/{project_id}/vector-stores",
    response_model=list[VectorStoreRead],
)
@audit(action="forge.rag.stores_listed", target_type="vector_store")
async def list_vector_stores(
    project_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:read"))],
) -> list[VectorStoreRead]:
    return await rag_service.list_vector_stores(
        db=db,
        tenant_id=_tenant_id(principal),
        project_id=project_id,
    )


@router.post(
    "/projects/{project_id}/vector-stores",
    response_model=VectorStoreRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="forge.rag.store_created", target_type="vector_store")
async def create_vector_store(
    project_id: UUID,
    payload: VectorStoreCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:write"))],
) -> VectorStoreRead:
    return await rag_service.create_vector_store(
        db=db,
        tenant_id=_tenant_id(principal),
        project_id=project_id,
        payload=payload,
    )


@router.delete("/vector-stores/{vs_id}", response_model=VectorStoreRead)
@audit(action="forge.rag.store_archived", target_type="vector_store")
async def archive_vector_store(
    vs_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:write"))],
) -> VectorStoreRead:
    try:
        return await rag_service.archive_vector_store(
            db=db,
            tenant_id=_tenant_id(principal),
            project_id=_project_id(principal),
            vs_id=vs_id,
        )
    except RagError as exc:
        raise _rag_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# Files + search (2 endpoints)
# ---------------------------------------------------------------------------


@router.post("/vector-stores/{vs_id}/files", response_model=dict)
@audit(action="forge.rag.file_attached", target_type="vector_store")
async def attach_file(
    vs_id: UUID,
    payload: dict,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:write"))],
) -> dict:
    file_id = payload.get("file_id") if isinstance(payload, dict) else None
    if not file_id:
        raise HTTPException(status_code=422, detail="file_id_required")
    return await rag_service.attach_file(
        db=db,
        tenant_id=_tenant_id(principal),
        project_id=_project_id(principal),
        vs_id=vs_id,
        file_id=str(file_id),
    )


@router.get("/vector-stores/{vs_id}/search", response_model=dict)
@audit(action="forge.rag.searched", target_type="vector_store")
async def vector_search(
    vs_id: UUID,
    principal: Annotated[object, Depends(require_permission("rag:read"))],
    q: str = Query(..., min_length=1),
    top_k: int = Query(10, ge=1, le=100),
) -> dict:
    return await rag_service.vector_search(
        tenant_id=_tenant_id(principal),
        vs_id=str(vs_id),
        query=q,
        top_k=top_k,
    )


# ---------------------------------------------------------------------------
# RAG ingest / query / rerank (3 endpoints)
# ---------------------------------------------------------------------------


@router.post("/rag/ingest", response_model=RagIngestResponse)
@audit(action="forge.rag.ingested", target_type="rag")
async def rag_ingest(
    payload: RagIngestRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:write"))],
) -> RagIngestResponse:
    try:
        return await rag_service.ingest_document(
            db=db,
            tenant_id=_tenant_id(principal),
            project_id=_project_id(principal),
            payload=payload,
        )
    except RagError as exc:
        raise _rag_error_to_http(exc) from exc


@router.post("/rag/query", response_model=RagQueryResponse)
@audit(action="forge.rag.queried", target_type="rag")
async def rag_query(
    payload: RagQueryRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:read"))],
) -> RagQueryResponse:
    try:
        return await rag_service.query(
            db=db,
            tenant_id=_tenant_id(principal),
            project_id=_project_id(principal),
            payload=payload,
        )
    except RagError as exc:
        raise _rag_error_to_http(exc) from exc


@router.post("/rag/rerank", response_model=RerankResponse)
@audit(action="forge.rag.reranked", target_type="rag")
async def rag_rerank(
    payload: RerankRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:write"))],
) -> RerankResponse:
    try:
        return await rag_service.rerank(
            db=db,
            tenant_id=_tenant_id(principal),
            project_id=_project_id(principal),
            payload=payload,
        )
    except RagError as exc:
        raise _rag_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# OCR (1 endpoint)
# ---------------------------------------------------------------------------


@router.post("/ocr", response_model=OCRResponse)
@audit(action="forge.rag.ocr_done", target_type="ocr")
async def ocr_file(
    payload: OCRRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:write"))],
) -> OCRResponse:
    try:
        return await rag_service.ocr_file(
            db=db,
            tenant_id=_tenant_id(principal),
            project_id=_project_id(principal),
            payload=payload,
        )
    except RagError as exc:
        raise _rag_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# Search tools (2 endpoints)
# ---------------------------------------------------------------------------


@router.get("/search-tools", response_model=dict)
@audit(action="forge.rag.search_tools_listed", target_type="search_tool")
async def list_search_tools(
    principal: Annotated[object, Depends(require_permission("rag:read"))],
) -> dict:
    return (await rag_service.list_search_tools(tenant_id=_tenant_id(principal))).model_dump()


@router.post("/search-tools/{tool_id}/test", response_model=SearchToolTestResponse)
@audit(action="forge.rag.search_tool_tested", target_type="search_tool")
async def test_search_tool(
    tool_id: str,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:read"))],
    payload: SearchToolTestRequest | None = None,
) -> SearchToolTestResponse:
    try:
        return await rag_service.test_search_tool(
            db=db,
            tenant_id=_tenant_id(principal),
            project_id=_project_id(principal),
            tool_id=tool_id,
            payload=payload,
        )
    except RagError as exc:
        raise _rag_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# Stats (1 endpoint)
# ---------------------------------------------------------------------------


@router.get("/rag/stats", response_model=dict)
@audit(action="forge.rag.stats_read", target_type="rag")
async def rag_stats(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rag:read"))],
) -> dict:
    return await rag_service.stats(db=db, tenant_id=_tenant_id(principal))