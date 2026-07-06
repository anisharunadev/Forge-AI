"""step-78 F14 — `/api/forge/files|…` HTTP surface.

Phase 3 Feature 14. Thin HTTP layer over :class:`async_service`.
Long-running workloads (file uploads, batches, fine-tuning,
background responses) live upstream on the LiteLLM proxy; this
router scopes them per-tenant and emits the ``forge.{files,batches,
fine_tuning,responses}.*`` audit events.

Routes mirror step-78 §"Forge Backend contract" (lines 547-566):

    POST   /forge/files
    GET    /forge/files/{file_id}
    GET    /forge/files/{file_id}/content
    DELETE /forge/files/{file_id}
    POST   /forge/batches
    GET    /forge/batches
    GET    /forge/batches/{batch_id}
    POST   /forge/batches/{batch_id}/cancel
    GET    /forge/batches/{batch_id}/results
    POST   /forge/fine-tuning/jobs
    GET    /forge/fine-tuning/jobs
    GET    /forge/fine-tuning/jobs/{job_id}
    POST   /forge/fine-tuning/jobs/{job_id}/cancel
    POST   /forge/responses
    GET    /forge/responses/{response_id}
    GET    /forge/responses/{response_id}/stream
    POST   /forge/responses/{response_id}/cancel
    POST   /forge/responses/{response_id}/input_items
    POST   /forge/responses/compact
    POST   /forge/jobs/ws              (ponytail stub: 501)
    GET    /forge/health/ws            (ponytail SSE upgrade marker)
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.api.deps import require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.schemas.async_v2 import (
    BatchCreate,
    BatchRead,
    BatchResultsResponse,
    CompactRequest,
    FileCreate,
    FileRead,
    FineTuneJobCreate,
    FineTuneJobRead,
    ResponseCreate,
    ResponseInputItemsRequest,
    ResponseRead,
)
from app.services.async_service import AsyncError, async_service

router = APIRouter(prefix="/forge", tags=["forge.async"])
logger = get_logger(__name__)


def _tenant_id(principal: object) -> UUID:
    tid = getattr(principal, "tenant_id", None)
    if not tid:
        raise HTTPException(status_code=403, detail="token_missing_tenant_claim")
    return UUID(tid)


def _async_error_to_http(exc: AsyncError) -> HTTPException:
    code_to_status = {
        "fine_tune_uncancelable": status.HTTP_409_CONFLICT,
        "batch_not_cancellable": status.HTTP_409_CONFLICT,
        "file_not_found": status.HTTP_404_NOT_FOUND,
        "batch_not_found": status.HTTP_404_NOT_FOUND,
        "job_not_found": status.HTTP_404_NOT_FOUND,
        "response_not_found": status.HTTP_404_NOT_FOUND,
        "fine_tune_create_failed": status.HTTP_400_BAD_REQUEST,
        "batch_create_failed": status.HTTP_400_BAD_REQUEST,
        "response_create_failed": status.HTTP_400_BAD_REQUEST,
    }
    return HTTPException(
        status_code=code_to_status.get(exc.code, status.HTTP_400_BAD_REQUEST),
        detail=exc.detail,
    )


# ---------------------------------------------------------------------------
# Files (4 endpoints)
# ---------------------------------------------------------------------------


@router.post("/files", response_model=FileRead, status_code=status.HTTP_201_CREATED)
@audit(action="forge.files.uploaded", target_type="file")
async def upload_file(
    payload: FileCreate,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> FileRead:
    try:
        return await async_service.upload_file(tenant_id=_tenant_id(principal), payload=payload)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.get("/files/{file_id}", response_model=FileRead)
@audit(action="forge.files.read", target_type="file")
async def get_file(
    file_id: str,
    principal: Annotated[object, Depends(require_permission("async:read"))],
) -> FileRead:
    try:
        return await async_service.get_file(tenant_id=_tenant_id(principal), file_id=file_id)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.get("/files/{file_id}/content")
@audit(action="forge.files.downloaded", target_type="file")
async def download_file(
    file_id: str,
    principal: Annotated[object, Depends(require_permission("async:read"))],
):
    try:
        blob = await async_service.download_file(tenant_id=_tenant_id(principal), file_id=file_id)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc
    return Response(content=blob, media_type="application/octet-stream")


@router.delete("/files/{file_id}", status_code=status.HTTP_200_OK)
@audit(action="forge.files.deleted", target_type="file")
async def delete_file(
    file_id: str,
    principal: Annotated[object, Depends(require_permission("async:delete"))],
) -> dict:
    try:
        return await async_service.delete_file(tenant_id=_tenant_id(principal), file_id=file_id)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# Batches (5 endpoints)
# ---------------------------------------------------------------------------


@router.post("/batches", response_model=BatchRead, status_code=status.HTTP_201_CREATED)
@audit(action="forge.batches.submitted", target_type="batch")
async def submit_batch(
    payload: BatchCreate,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> BatchRead:
    try:
        return await async_service.create_batch(tenant_id=_tenant_id(principal), payload=payload)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.get("/batches", response_model=list[BatchRead])
@audit(action="forge.batches.listed", target_type="batch")
async def list_batches(
    principal: Annotated[object, Depends(require_permission("async:read"))],
    limit: int = Query(20, ge=1, le=100),
) -> list[BatchRead]:
    return await async_service.list_batches(tenant_id=_tenant_id(principal))


@router.get("/batches/{batch_id}", response_model=BatchRead)
@audit(action="forge.batches.read", target_type="batch")
async def get_batch(
    batch_id: str,
    principal: Annotated[object, Depends(require_permission("async:read"))],
) -> BatchRead:
    try:
        return await async_service.get_batch(tenant_id=_tenant_id(principal), batch_id=batch_id)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.post("/batches/{batch_id}/cancel", response_model=BatchRead)
@audit(action="forge.batches.cancelled", target_type="batch")
async def cancel_batch(
    batch_id: str,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> BatchRead:
    try:
        return await async_service.cancel_batch(tenant_id=_tenant_id(principal), batch_id=batch_id)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.get("/batches/{batch_id}/results", response_model=BatchResultsResponse)
@audit(action="forge.batches.results_read", target_type="batch")
async def batch_results(
    batch_id: str,
    principal: Annotated[object, Depends(require_permission("async:read"))],
) -> BatchResultsResponse:
    try:
        return await async_service.batch_results(tenant_id=_tenant_id(principal), batch_id=batch_id)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# Fine-tuning (4 endpoints)
# ---------------------------------------------------------------------------


@router.post(
    "/fine-tuning/jobs",
    response_model=FineTuneJobRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="forge.fine_tuning.started", target_type="fine_tune_job")
async def create_fine_tune_job(
    payload: FineTuneJobCreate,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> FineTuneJobRead:
    try:
        return await async_service.create_fine_tune_job(
            tenant_id=_tenant_id(principal), payload=payload
        )
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.get("/fine-tuning/jobs", response_model=list[FineTuneJobRead])
@audit(action="forge.fine_tuning.listed", target_type="fine_tune_job")
async def list_fine_tune_jobs(
    principal: Annotated[object, Depends(require_permission("async:read"))],
    limit: int = Query(20, ge=1, le=100),
) -> list[FineTuneJobRead]:
    return await async_service.list_fine_tune_jobs(tenant_id=_tenant_id(principal))


@router.get("/fine-tuning/jobs/{job_id}", response_model=FineTuneJobRead)
@audit(action="forge.fine_tuning.read", target_type="fine_tune_job")
async def get_fine_tune_job(
    job_id: str,
    principal: Annotated[object, Depends(require_permission("async:read"))],
) -> FineTuneJobRead:
    try:
        return await async_service.get_fine_tune_job(tenant_id=_tenant_id(principal), job_id=job_id)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.post("/fine-tuning/jobs/{job_id}/cancel", response_model=FineTuneJobRead)
@audit(action="forge.fine_tuning.cancelled", target_type="fine_tune_job")
async def cancel_fine_tune_job(
    job_id: str,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> FineTuneJobRead:
    try:
        return await async_service.cancel_fine_tune_job(
            tenant_id=_tenant_id(principal), job_id=job_id
        )
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


# ---------------------------------------------------------------------------
# Background responses (7 endpoints)
# ---------------------------------------------------------------------------


@router.post("/responses", response_model=ResponseRead, status_code=status.HTTP_202_ACCEPTED)
@audit(action="forge.responses.started", target_type="response")
async def start_response(
    payload: ResponseCreate,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> ResponseRead:
    try:
        return await async_service.start_response(tenant_id=_tenant_id(principal), payload=payload)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.get("/responses/{response_id}", response_model=ResponseRead)
@audit(action="forge.responses.polled", target_type="response")
async def get_response(
    response_id: str,
    principal: Annotated[object, Depends(require_permission("async:read"))],
) -> ResponseRead:
    try:
        return await async_service.get_response(
            tenant_id=_tenant_id(principal), response_id=response_id
        )
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.get("/responses/{response_id}/stream")
@audit(action="forge.responses.streamed", target_type="response")
async def stream_response(
    response_id: str,
    principal: Annotated[object, Depends(require_permission("async:read"))],
):
    try:
        sse = await async_service.stream_response(
            tenant_id=_tenant_id(principal), response_id=response_id
        )
        return sse  # StreamingResponse (sets media_type = text/event-stream)
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.post("/responses/{response_id}/cancel", response_model=ResponseRead)
@audit(action="forge.responses.cancelled", target_type="response")
async def cancel_response(
    response_id: str,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> ResponseRead:
    try:
        return await async_service.cancel_response(
            tenant_id=_tenant_id(principal), response_id=response_id
        )
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.post("/responses/{response_id}/input_items", response_model=dict)
@audit(action="forge.responses.items_appended", target_type="response")
async def append_response_inputs(
    response_id: str,
    payload: ResponseInputItemsRequest,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> dict:
    try:
        return await async_service.append_response_inputs(
            tenant_id=_tenant_id(principal),
            response_id=response_id,
            payload=payload,
        )
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.post("/responses/compact", response_model=dict)
@audit(action="forge.responses.compacted", target_type="response")
async def compact_response(
    payload: CompactRequest,
    principal: Annotated[object, Depends(require_permission("async:write"))],
) -> dict:
    try:
        return await async_service.compact_response(
            tenant_id=_tenant_id(principal), payload=payload
        )
    except AsyncError as exc:
        raise _async_error_to_http(exc) from exc


@router.post("/jobs/ws", status_code=status.HTTP_501_NOT_IMPLEMENTED)
@audit(action="forge.jobs.ws_unsupported", target_type="ws")
async def jobs_ws_stub(
    principal: Annotated[object, Depends(require_permission("async:read"))],
) -> dict:
    """ponytail: WS at this path would need a dedicated WebSocket
    endpoint (not a POST). The SSE stream at ``/forge/responses/{id}/stream``
    is the F14 contract surface; this stub exists only so clients that
    hit the old path get a 501 with a clear migration message rather
    than a 404.
    """
    return {
        "event": "ws_unsupported_in_async_rest",
        "message": "use /forge/responses/{id}/stream (SSE)",
    }


@router.get("/health/ws", response_model=dict)
@audit(action="forge.jobs.ws_health", target_type="ws")
async def ws_health(
    principal: Annotated[object, Depends(require_permission("async:read"))],
) -> dict:
    return {
        "event": "ws_unsupported_in_async_rest",
        "sse_stream_path": "/forge/responses/{id}/stream",
        "transport": "sse",
    }
