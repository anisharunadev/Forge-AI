"""F14 Async — thin LiteLLM proxy method group for long-running workloads.

Phase 3 Feature 14 wraps the LiteLLM ``/v1/files``, ``/v1/batches``,
``/v1/fine_tuning/jobs``, and ``/v1/responses`` endpoints. Data lives
upstream — Forge Backend stores only lightweight progress rows; the
real bytes, batch requests, and model artifacts sit on the proxy.

Endpoint coverage (one method per LiteLLM endpoint family from
step-78 §"LiteLLM endpoints used", F14):
  - /v1/files: create, get, delete, content
  - /v1/batches: create, get, cancel, list
  - /v1/fine_tuning/jobs: create, get, cancel, list
  - /v1/responses: create, get, cancel, input_items, compact

Sister method group to :class:`RBACClientGroup` (F12).
"""

from __future__ import annotations

from typing import Any

import httpx


class AsyncClientGroup:
    """Typed proxy for F14 long-running-workload endpoints on the LiteLLM proxy."""

    __slots__ = ("_base",)

    def __init__(self, base: httpx.AsyncClient) -> None:
        self._base = base

    @staticmethod
    def _ok(response: httpx.Response) -> dict[str, Any]:
        if not (200 <= response.status_code < 300):
            return {"_status": response.status_code, "_body": response.text[:500]}
        if not response.content:
            return {}
        try:
            return response.json()
        except Exception:  # noqa: BLE001
            return {"_raw": response.text[:500]}

    # ------------------------------------------------------------------
    # Files
    # ------------------------------------------------------------------

    async def files_create(
        self,
        *,
        purpose: str,
        content_b64: str | None = None,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"purpose": purpose}
        if content_b64 is not None:
            body["content_b64"] = content_b64
        if filename is not None:
            body["filename"] = filename
        if content_type is not None:
            body["content_type"] = content_type
        r = await self._base.post("/v1/files", json=body)
        return self._ok(r)

    async def files_get(self, file_id: str) -> dict[str, Any]:
        r = await self._base.get(f"/v1/files/{file_id}")
        return self._ok(r)

    async def files_delete(self, file_id: str) -> dict[str, Any]:
        r = await self._base.delete(f"/v1/files/{file_id}")
        return self._ok(r)

    async def files_content(self, file_id: str) -> bytes | dict[str, Any]:
        r = await self._base.get(f"/v1/files/{file_id}/content")
        if not (200 <= r.status_code < 300):
            return {"_status": r.status_code, "_body": r.text[:500]}
        return r.content

    # ------------------------------------------------------------------
    # Batches
    # ------------------------------------------------------------------

    async def batches_create(
        self,
        *,
        input_file_id: str,
        endpoint: str,
        completion_window: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "input_file_id": input_file_id,
            "endpoint": endpoint,
            "completion_window": completion_window,
        }
        if metadata is not None:
            body["metadata"] = dict(metadata)
        r = await self._base.post("/v1/batches", json=body)
        return self._ok(r)

    async def batches_get(self, batch_id: str) -> dict[str, Any]:
        r = await self._base.get(f"/v1/batches/{batch_id}")
        return self._ok(r)

    async def batches_cancel(self, batch_id: str) -> dict[str, Any]:
        r = await self._base.post(f"/v1/batches/{batch_id}/cancel")
        return self._ok(r)

    async def batches_list(self) -> dict[str, Any]:
        r = await self._base.get("/v1/batches")
        return self._ok(r)

    # ------------------------------------------------------------------
    # Fine-tuning jobs
    # ------------------------------------------------------------------

    async def ft_jobs_create(
        self,
        *,
        model: str,
        training_file: str,
        validation_file: str | None = None,
        hyperparameters: dict[str, Any] | None = None,
        suffix: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"model": model, "training_file": training_file}
        if validation_file is not None:
            body["validation_file"] = validation_file
        if hyperparameters is not None:
            body["hyperparameters"] = dict(hyperparameters)
        if suffix is not None:
            body["suffix"] = suffix
        r = await self._base.post("/v1/fine_tuning/jobs", json=body)
        return self._ok(r)

    async def ft_jobs_get(self, job_id: str) -> dict[str, Any]:
        r = await self._base.get(f"/v1/fine_tuning/jobs/{job_id}")
        return self._ok(r)

    async def ft_jobs_cancel(self, job_id: str) -> dict[str, Any]:
        r = await self._base.post(f"/v1/fine_tuning/jobs/{job_id}/cancel")
        return self._ok(r)

    async def ft_jobs_list(self) -> dict[str, Any]:
        r = await self._base.get("/v1/fine_tuning/jobs")
        return self._ok(r)

    # ------------------------------------------------------------------
    # Background responses
    # ------------------------------------------------------------------

    async def responses_create(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/v1/responses", json=payload)
        return self._ok(r)

    async def responses_get(self, response_id: str) -> dict[str, Any]:
        r = await self._base.get(f"/v1/responses/{response_id}")
        return self._ok(r)

    async def responses_cancel(self, response_id: str) -> dict[str, Any]:
        r = await self._base.post(f"/v1/responses/{response_id}/cancel")
        return self._ok(r)

    async def responses_input_items(
        self, response_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        r = await self._base.post(f"/v1/responses/{response_id}/input_items", json=payload)
        return self._ok(r)

    async def responses_compact(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/v1/responses/compact", json=payload)
        return self._ok(r)


__all__ = ["AsyncClientGroup"]
