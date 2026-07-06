"""F13 RAG — thin LiteLLM proxy method group for embeddings / vector stores / RAG.

Phase 3 Feature 13 (step-78 §"Feature 13 — Embeddings + Vector Stores + RAG").

Endpoint coverage (one method per LiteLLM endpoint family from step-78 §"LiteLLM endpoints used", F13):
  - /v1/embeddings
  - /v1/vector_stores: create, list, get, delete, files_attach, search
  - /v1/rag/ingest, /rag/query
  - /v1/rerank, /v2/rerank
  - /v1/ocr
  - /search_tools/list, /search_tools/test_connection, /search_tools/ui
  - /v1/indexes

Auth: mirrors F12 RBACClientGroup + F14 AsyncClientGroup exactly. Most methods
use the admin client (master key) because LiteLLM manages vector stores /
RAG / OCR / search-tools as platform-level resources. Embedding routes
additionally accept a per-tenant Virtual Key via :meth:`embeddings`
(F13 spec line 425 — embeddings need tenant attribution for spend).
"""

from __future__ import annotations

from typing import Any

import httpx


class RAGClientGroup:
    """Typed proxy for F13 embeddings / vector store / RAG / OCR endpoints."""

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
    # Embeddings
    # ------------------------------------------------------------------

    async def embeddings(
        self,
        *,
        input: list[str] | str,
        model: str,
    ) -> dict[str, Any]:
        """POST /v1/embeddings — tenant Virtual Key auth (callers may override).

        F13 spec line 425: pass ``model`` + ``input``; returns the
        OpenAI-shaped ``{data: [{embedding, index}], model, usage}`` body.
        """
        body: dict[str, Any] = {"model": model, "input": input}
        r = await self._base.post("/v1/embeddings", json=body)
        return self._ok(r)

    async def embeddings_models(self) -> dict[str, Any]:
        """GET /v1/embeddings/models — list models the proxy exposes for embed."""
        r = await self._base.get("/v1/embeddings/models")
        return self._ok(r)

    # ------------------------------------------------------------------
    # Vector stores
    # ------------------------------------------------------------------

    async def vector_stores_create(
        self,
        *,
        name: str | None = None,
        file_ids: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """POST /v1/vector_stores — create."""
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if file_ids is not None:
            body["file_ids"] = list(file_ids)
        if metadata is not None:
            body["metadata"] = dict(metadata)
        r = await self._base.post("/v1/vector_stores", json=body)
        return self._ok(r)

    async def vector_stores_list(self) -> dict[str, Any]:
        """GET /v1/vector_stores — list all stores."""
        r = await self._base.get("/v1/vector_stores")
        return self._ok(r)

    async def vector_stores_get(self, vs_id: str) -> dict[str, Any]:
        """GET /v1/vector_stores/{id}."""
        r = await self._base.get(f"/v1/vector_stores/{vs_id}")
        return self._ok(r)

    async def vector_stores_delete(self, vs_id: str) -> dict[str, Any]:
        """DELETE /v1/vector_stores/{id}."""
        r = await self._base.delete(f"/v1/vector_stores/{vs_id}")
        return self._ok(r)

    async def vector_stores_search(
        self,
        *,
        vs_id: str,
        query: str,
        top_k: int = 10,
    ) -> dict[str, Any]:
        """GET /v1/vector_stores/{id}/search?q=...&top_k=..."""
        params: dict[str, Any] = {"q": query, "top_k": top_k}
        r = await self._base.get(f"/v1/vector_stores/{vs_id}/search", params=params)
        return self._ok(r)

    async def vector_stores_files_create(
        self,
        *,
        vs_id: str,
        file_id: str,
    ) -> dict[str, Any]:
        """POST /v1/vector_stores/{id}/files — attach file from F14 files."""
        body = {"file_id": file_id}
        r = await self._base.post(f"/v1/vector_stores/{vs_id}/files", json=body)
        return self._ok(r)

    # ------------------------------------------------------------------
    # RAG ingest / query
    # ------------------------------------------------------------------

    async def rag_ingest(
        self,
        *,
        file_id: str,
        vector_store_id: str,
        chunking_strategy: str | None = None,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
    ) -> dict[str, Any]:
        """POST /v1/rag/ingest — chunk + embed + store. Returns chunks_created/tokens_used/cost_usd/latency_ms."""
        body: dict[str, Any] = {
            "file_id": file_id,
            "vector_store_id": vector_store_id,
        }
        if chunking_strategy is not None:
            body["chunking_strategy"] = chunking_strategy
        if chunk_size is not None:
            body["chunk_size"] = int(chunk_size)
        if chunk_overlap is not None:
            body["chunk_overlap"] = int(chunk_overlap)
        r = await self._base.post("/v1/rag/ingest", json=body)
        return self._ok(r)

    async def rag_query(
        self,
        *,
        vector_store_ids: list[str],
        query: str,
        top_k: int = 10,
        rerank: bool = False,
        rerank_top_n: int | None = None,
        hybrid: bool = False,
    ) -> dict[str, Any]:
        """POST /rag/query — ANN + optional rerank + hybrid BM25/vector."""
        body: dict[str, Any] = {
            "vector_store_ids": list(vector_store_ids),
            "query": query,
            "top_k": int(top_k),
            "rerank": bool(rerank),
            "hybrid": bool(hybrid),
        }
        if rerank_top_n is not None:
            body["rerank_top_n"] = int(rerank_top_n)
        r = await self._base.post("/rag/query", json=body)
        return self._ok(r)

    # ------------------------------------------------------------------
    # Rerank
    # ------------------------------------------------------------------

    async def rerank(
        self,
        *,
        model: str,
        query: str,
        documents: list[str],
        top_n: int | None = None,
    ) -> dict[str, Any]:
        """POST /v2/rerank — preferred path. Falls back to /v1/rerank at the service layer."""
        body: dict[str, Any] = {
            "model": model,
            "query": query,
            "documents": list(documents),
        }
        if top_n is not None:
            body["top_n"] = int(top_n)
        r = await self._base.post("/v2/rerank", json=body)
        return self._ok(r)

    # ------------------------------------------------------------------
    # OCR
    # ------------------------------------------------------------------

    async def ocr(self, *, file_id: str) -> dict[str, Any]:
        """POST /v1/ocr — extract text from PDF / image. Short-circuits on text/* upstream."""
        body = {"file_id": file_id}
        r = await self._base.post("/v1/ocr", json=body)
        return self._ok(r)

    # ------------------------------------------------------------------
    # Search tools
    # ------------------------------------------------------------------

    async def search_tools_list(self) -> dict[str, Any]:
        """GET /search_tools/list — enumerate external providers."""
        r = await self._base.get("/search_tools/list")
        return self._ok(r)

    async def search_tools_test_connection(self, *, tool_id: str) -> dict[str, Any]:
        """POST /search_tools/test_connection — validate provider creds."""
        body = {"tool_id": tool_id}
        r = await self._base.post("/search_tools/test_connection", json=body)
        return self._ok(r)

    async def search_tools_ui(self) -> dict[str, Any]:
        """GET /search_tools/ui — UI metadata for picker."""
        r = await self._base.get("/search_tools/ui")
        return self._ok(r)

    # ------------------------------------------------------------------
    # Indexes (hybrid BM25+vector)
    # ------------------------------------------------------------------

    async def indexes_create(self, *, payload: dict[str, Any]) -> dict[str, Any]:
        """POST /v1/indexes — custom hybrid index."""
        r = await self._base.post("/v1/indexes", json=payload)
        return self._ok(r)


__all__ = ["RAGClientGroup"]
