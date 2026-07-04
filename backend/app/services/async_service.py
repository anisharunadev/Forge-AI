"""step-78 F14 — Async service: long-running workloads over LiteLLM proxy.

Wraps :class:`app.integrations.litellm.async_client.AsyncClientGroup` and
maps the upstream dicts into the typed :mod:`app.schemas.async_v2`
artifacts. Audit events go through the same ``audit(...)`` decorator
the router uses — this service stays method-shaped (no free-form
``return await upstream`` paths) so the HTTP layer is truly thin.

Note on persistence (ponytail): real bytes, batch requests, and
fine-tuned model artifacts live upstream on the LiteLLM proxy. Forge
Backend keeps a lightweight ``forge_async_jobs`` row for audit +
cross-tenant progress lookups; the proxy is the source of truth.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.integrations.litellm.async_client import AsyncClientGroup
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.schemas.async_v2 import (
    BatchCreate,
    BatchRead,
    BatchResultsResponse,
    FileCreate,
    FileRead,
    FineTuneJobCreate,
    FineTuneJobRead,
    CompactRequest,
    ResponseCreate,
    ResponseInputItemsRequest,
    ResponseRead,
)

logger = get_logger(__name__)


class AsyncError(Exception):
    """Base error for F14 async operations. Carries a typed code."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.detail: dict[str, Any] = {"error": code, "detail": message, **extra}


#: Typed error codes raised by this service.
ERROR_CODES: tuple[str, ...] = (
    "fine_tune_uncancelable",
    "batch_not_cancellable",
    "file_not_found",
    "batch_not_found",
    "job_not_found",
    "response_not_found",
)


class AsyncService:
    """Thin typed wrapper around :class:`AsyncClientGroup`.

    Each public method:

    1. Calls a single ``AsyncClientGroup`` method.
    2. Validates the upstream ``_status`` error envelope if present.
    3. Returns a schema from :mod:`app.schemas.async_v2`.

    No DB writes, no global state — just shape adaptation + typed
    errors so the router can map them to HTTP 4xx shapes consistently.
    """

    # ponytail: a per-request base client. The LiteLLM pool is reused
    # under the hood; cost is one constructor per call.
    def _client(self) -> AsyncClientGroup:
        return LiteLLMBaseClient().async_

    # ------------------------------------------------------------------
    # Files
    # ------------------------------------------------------------------

    async def upload_file(
        self, *, tenant_id: UUID, payload: FileCreate
    ) -> FileRead:
        upstream = await self._client().files_create(
            purpose=payload.purpose.value,
            content_b64=payload.content_b64,
            filename=payload.filename,
            content_type=payload.content_type,
        )
        return self._shape_file(upstream)

    async def get_file(
        self, *, tenant_id: UUID, file_id: str
    ) -> FileRead:
        upstream = await self._client().files_get(file_id)
        if "_status" in upstream:
            raise AsyncError("file_not_found", f"file {file_id} not found", file_id=file_id)
        return self._shape_file(upstream)

    async def delete_file(
        self, *, tenant_id: UUID, file_id: str
    ) -> dict[str, Any]:
        upstream = await self._client().files_delete(file_id)
        if "_status" in upstream and upstream.get("_status") not in (200, 204):
            raise AsyncError("file_not_found", f"file {file_id} not found", file_id=file_id)
        return upstream if upstream else {"deleted": True, "id": file_id}

    async def download_file(
        self, *, tenant_id: UUID, file_id: str
    ) -> bytes:
        upstream = await self._client().files_content(file_id)
        if isinstance(upstream, dict) and "_status" in upstream:
            raise AsyncError("file_not_found", f"file {file_id} not found", file_id=file_id)
        return upstream  # bytes

    # ------------------------------------------------------------------
    # Batches
    # ------------------------------------------------------------------

    async def create_batch(
        self, *, tenant_id: UUID, payload: BatchCreate
    ) -> BatchRead:
        upstream = await self._client().batches_create(
            input_file_id=payload.input_file_id,
            endpoint=payload.endpoint,
            completion_window=payload.completion_window,
            metadata=payload.metadata,
        )
        if "_status" in upstream:
            raise AsyncError("batch_create_failed", upstream.get("_body", "create failed"))
        return BatchRead.model_validate(upstream)

    async def list_batches(self, *, tenant_id: UUID) -> list[BatchRead]:
        upstream = await self._client().batches_list()
        rows = upstream.get("data") if isinstance(upstream, dict) else []
        return [BatchRead.model_validate(r) for r in (rows or [])]

    async def get_batch(
        self, *, tenant_id: UUID, batch_id: str
    ) -> BatchRead:
        upstream = await self._client().batches_get(batch_id)
        if "_status" in upstream:
            raise AsyncError("batch_not_found", f"batch {batch_id} not found", batch_id=batch_id)
        return BatchRead.model_validate(upstream)

    async def cancel_batch(
        self, *, tenant_id: UUID, batch_id: str
    ) -> BatchRead:
        upstream = await self._client().batches_cancel(batch_id)
        if "_status" in upstream and upstream.get("_status") not in (200, 204):
            status = (upstream.get("_body") or "").lower()
            if "completed" in status or "cancelled" in status:
                raise AsyncError(
                    "batch_not_cancellable",
                    f"batch {batch_id} cannot be cancelled",
                    batch_id=batch_id,
                )
            raise AsyncError("batch_not_found", f"batch {batch_id} not found", batch_id=batch_id)
        return BatchRead.model_validate(upstream)

    async def batch_results(
        self, *, tenant_id: UUID, batch_id: str
    ) -> BatchResultsResponse:
        batch = await self.get_batch(tenant_id=tenant_id, batch_id=batch_id)
        raw_bytes = b""
        if batch.output_file_id:
            raw_bytes = await self.download_file(
                tenant_id=tenant_id, file_id=batch.output_file_id
            )
        text = raw_bytes.decode("utf-8", errors="replace") if raw_bytes else ""
        lines = [ln for ln in text.splitlines() if ln.strip()]
        parsed = []
        for ln in lines:
            try:
                parsed.append(json.loads(ln))
            except json.JSONDecodeError:
                # ponytail: tolerate vendor-side shapes; keep line as raw text.
                parsed.append({"raw": ln})
        return BatchResultsResponse(
            batch_id=batch_id,
            output_file_id=batch.output_file_id,
            raw=batch.model_dump(),
            jsonl_content=text or None,
            line_count=len(lines),
            parsed_lines=parsed,
        )

    # ------------------------------------------------------------------
    # Fine-tuning
    # ------------------------------------------------------------------

    async def create_fine_tune_job(
        self, *, tenant_id: UUID, payload: FineTuneJobCreate
    ) -> FineTuneJobRead:
        upstream = await self._client().ft_jobs_create(
            model=payload.model,
            training_file=payload.training_file,
            validation_file=payload.validation_file,
            hyperparameters=(
                payload.hyperparameters.model_dump() if payload.hyperparameters else None
            ),
            suffix=payload.suffix,
        )
        if "_status" in upstream:
            raise AsyncError("fine_tune_create_failed", upstream.get("_body", "create failed"))
        return FineTuneJobRead.model_validate(upstream)

    async def list_fine_tune_jobs(self, *, tenant_id: UUID) -> list[FineTuneJobRead]:
        upstream = await self._client().ft_jobs_list()
        rows = upstream.get("data") if isinstance(upstream, dict) else []
        return [FineTuneJobRead.model_validate(r) for r in (rows or [])]

    async def get_fine_tune_job(
        self, *, tenant_id: UUID, job_id: str
    ) -> FineTuneJobRead:
        upstream = await self._client().ft_jobs_get(job_id)
        if "_status" in upstream:
            raise AsyncError("job_not_found", f"job {job_id} not found", job_id=job_id)
        return FineTuneJobRead.model_validate(upstream)

    async def cancel_fine_tune_job(
        self, *, tenant_id: UUID, job_id: str
    ) -> FineTuneJobRead:
        job = await self.get_fine_tune_job(tenant_id=tenant_id, job_id=job_id)
        uncancelable_states = {"running", "succeeded", "cancelled", "cancelling"}
        if job.status in uncancelable_states:
            raise AsyncError(
                "fine_tune_uncancelable",
                f"fine-tune job in status {job.status!r} cannot be cancelled",
                job_id=job_id,
                status=job.status,
            )
        upstream = await self._client().ft_jobs_cancel(job_id)
        if "_status" in upstream and upstream.get("_status") not in (200, 204):
            raise AsyncError("fine_tune_uncancelable", upstream.get("_body", ""), job_id=job_id)
        return FineTuneJobRead.model_validate(upstream) if upstream else job

    # ------------------------------------------------------------------
    # Background responses
    # ------------------------------------------------------------------

    async def start_response(
        self, *, tenant_id: UUID, payload: ResponseCreate
    ) -> ResponseRead:
        upstream = await self._client().responses_create(payload.model_dump(exclude_none=True))
        if "_status" in upstream:
            raise AsyncError("response_create_failed", upstream.get("_body", "create failed"))
        return ResponseRead.model_validate(upstream)

    async def get_response(
        self, *, tenant_id: UUID, response_id: str
    ) -> ResponseRead:
        upstream = await self._client().responses_get(response_id)
        if "_status" in upstream:
            raise AsyncError(
                "response_not_found", f"response {response_id} not found", response_id=response_id
            )
        return ResponseRead.model_validate(upstream)

    async def cancel_response(
        self, *, tenant_id: UUID, response_id: str
    ) -> ResponseRead:
        upstream = await self._client().responses_cancel(response_id)
        if "_status" in upstream and upstream.get("_status") not in (200, 204):
            raise AsyncError(
                "response_not_found", f"response {response_id} not found", response_id=response_id
            )
        return ResponseRead.model_validate(upstream)

    async def append_response_inputs(
        self,
        *,
        tenant_id: UUID,
        response_id: str,
        payload: ResponseInputItemsRequest,
    ) -> dict[str, Any]:
        upstream = await self._client().responses_input_items(
            response_id, payload.model_dump()
        )
        if "_status" in upstream:
            raise AsyncError(
                "response_not_found", f"response {response_id} not found", response_id=response_id
            )
        return upstream if upstream else {"appended": True, "count": len(payload.items)}

    async def compact_response(
        self, *, tenant_id: UUID, payload: CompactRequest
    ) -> dict[str, Any]:
        upstream = await self._client().responses_compact(payload.model_dump())
        if "_status" in upstream:
            raise AsyncError(
                "response_not_found",
                f"response {payload.response_id} not found",
                response_id=payload.response_id,
            )
        return upstream if upstream else {"compacted": True, "response_id": payload.response_id}

    # ------------------------------------------------------------------
    # SSE stream (ponytail: a single-turn generator that yields the
    # current snapshot until upstream reports a terminal status; the
    # long-poll version uses a tight delay-free loop on the local cache.
    # Full chunk-by-chunk SSE lands when LiteLLM exposes the streaming
    # endpoint family.)
    # ------------------------------------------------------------------

    async def stream_response(
        self, *, tenant_id: UUID, response_id: str
    ) -> Any:
        from fastapi.responses import StreamingResponse

        async def _gen():
            # ponytail: SSE stub — emit one snapshot per poll. Phase
            # upgrade: replays the real chunked encoder from
            # ``chat_stream`` when LiteLLM adds ``/v1/responses/stream``.
            while True:
                snap = await self.get_response(
                    tenant_id=tenant_id, response_id=response_id
                )
                chunk = (
                    f"event: response.snapshot\ndata: "
                    f"{snap.model_dump_json()}\n\n"
                )
                yield chunk.encode("utf-8")
                if snap.status.value in {"completed", "cancelled", "failed"}:
                    yield b"event: response.end\ndata: {}\n\n"
                    return

        return StreamingResponse(_gen(), media_type="text/event-stream")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _shape_file(upstream: dict[str, Any]) -> FileRead:
        # ponytail: free-form files envelope → typed FileRead. We
        # tolerate the upstream variants (OpenAI / Azure / LiteLLM
        # sometimes nest under ``data``).
        if isinstance(upstream, dict) and "data" in upstream and isinstance(upstream["data"], list) and upstream["data"]:
            upstream = upstream["data"][0]
        if "_status" in upstream:
            raise AsyncError("file_not_found", upstream.get("_body", "file not found"))
        return FileRead.model_validate(upstream)


async_service = AsyncService()


__all__ = ["AsyncService", "AsyncError", "async_service", "ERROR_CODES"]
