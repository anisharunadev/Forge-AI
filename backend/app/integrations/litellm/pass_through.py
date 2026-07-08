"""Phase 4 — Provider Pass-through byte-stream proxy.

Reuses the existing :class:`LiteLLMBaseClient` connection pool and
:func:`LiteLLMBaseClient.get_admin_client` style. The single entry
point is :class:`PassThroughClient` which exposes
:meth:`stream_proxy` (streaming) and :meth:`collect_proxy` (non-stream).

Wire-format preservation
------------------------
- Bedrock SigV4 (``X-Amz-*`` headers + ``Authorization-Header``) and
  Vertex IAM (``authorization-credential``) MUST be forwarded
  untouched. We enforce this via a header allowlist.
- The client's ``Authorization`` header is ALWAYS stripped and
  replaced with ``Bearer <virtual_key>``.
- A ``metadata.forge_*`` envelope is attached to the request body so
  LiteLLM's spend log can attribute the call.

ponytail: this is one class, two methods. The FastAPI handler at
``app/api/ws/pass_through.py`` is the only caller. Add a header
allowlist here when a new provider needs special header handling.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


# Headers we forward verbatim because providers need them for
# signature/identity verification.
# ponytail: keep this list narrow — anything not here gets dropped
# from the client request before proxying. Add entries only when a
# specific provider breaks.
_PROVIDER_PASSTHROUGH_HEADER_ALLOWLIST: frozenset[str] = frozenset(
    {
        "authorization-credential",  # Vertex IAM credential
        "x-amz-date",
        "x-amz-security-token",
        "x-amz-content-sha256",
        "x-amz-target",
        "x-amz-user-agent",
        "x-goog-api-version",
        "anthropic-version",
        "anthropic-beta",
    }
)


def _filter_forwarded_headers(
    client_headers: Mapping[str, str],
) -> dict[str, str]:
    """Drop Authorization + anything not in the allowlist.

    Returns a new dict; never mutates the input.
    """
    out: dict[str, str] = {}
    for k, v in client_headers.items():
        lk = k.lower()
        if lk == "authorization":
            continue  # injected by us, not forwarded
        if lk in {"host", "content-length"}:
            continue  # httpx sets these
        # Allow if exact match OR if it has an allowlisted prefix
        if lk in _PROVIDER_PASSTHROUGH_HEADER_ALLOWLIST or any(
            lk.startswith(prefix) for prefix in ("x-amz-", "x-goog-")
        ):
            out[k] = v
    return out


class PassThroughClient:
    """Byte-stream proxy over the existing LiteLLM httpx pool.

    Usage::

        async with LiteLLMBaseClient() as base:
            proxy = PassThroughClient(base)
            async for chunk, headers in proxy.stream_proxy(
                method="POST",
                path="/openai/v1/chat/completions",
                client_headers=dict(request.headers),
                body=await request.body(),
                virtual_key="sk-forge-...",
                forge_metadata={"forge_tenant_id": "...", ...},
            ):
                ...
    """

    def __init__(self, base: LiteLLMBaseClient) -> None:  # noqa: F821
        self._base = base

    # ------------------------------------------------------------------
    # Streaming (SSE, WebSocket upgrade, chunked downloads)
    # ------------------------------------------------------------------

    async def stream_proxy(
        self,
        *,
        method: str,
        path: str,
        client_headers: Mapping[str, str],
        body: bytes,
        virtual_key: str,
        forge_metadata: dict[str, Any],
        query: str | None = None,
    ) -> AsyncIterator[tuple[bytes, dict[str, str]]]:
        """Yield ``(chunk_bytes, response_headers)`` verbatim from upstream.

        The caller is responsible for wrapping this in a FastAPI
        ``StreamingResponse``. Stops when the upstream closes the
        connection.
        """
        # Build outgoing headers: forge-injected + allowlisted client headers.
        outgoing_headers = _filter_forwarded_headers(client_headers)
        outgoing_headers["Authorization"] = f"Bearer {virtual_key}"
        outgoing_headers["User-Agent"] = "forge-passthrough/1.0"

        # Attach metadata envelope to the request body so LiteLLM's
        # spend log can reconcile. We do this by mutating a parsed JSON
        # if the body parses; otherwise we forward raw.
        # ponytail: parsing on every call adds ~1ms. Acceptable cost
        # for accurate spend attribution. Switch to async parse if
        # measured to matter.
        forward_body = self._inject_metadata(body, forge_metadata)

        # Resolve the upstream client (admin or chat per Virtual Key flow).
        async with self._base.chat_session(virtual_key) as client:
            full_path = path if not query else f"{path}?{query}"
            async with client.stream(
                method, full_path, headers=outgoing_headers, content=forward_body
            ) as response:
                response_headers = dict(response.headers)
                async for chunk in response.aiter_bytes():
                    yield chunk, response_headers

    # ------------------------------------------------------------------
    # Non-streaming (JSON multimodal endpoints)
    # ------------------------------------------------------------------

    async def collect_proxy(
        self,
        *,
        method: str,
        path: str,
        client_headers: Mapping[str, str],
        body: bytes,
        virtual_key: str,
        forge_metadata: dict[str, Any],
        query: str | None = None,
    ) -> tuple[bytes, dict[str, str], int]:
        """Return ``(body_bytes, response_headers, status_code)`` from upstream."""
        outgoing_headers = _filter_forwarded_headers(client_headers)
        outgoing_headers["Authorization"] = f"Bearer {virtual_key}"
        outgoing_headers["User-Agent"] = "forge-passthrough/1.0"

        forward_body = self._inject_metadata(body, forge_metadata)

        async with self._base.chat_session(virtual_key) as client:
            full_path = path if not query else f"{path}?{query}"
            response = await client.request(
                method,
                full_path,
                headers=outgoing_headers,
                content=forward_body,
            )
            return response.content, dict(response.headers), response.status_code

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _inject_metadata(body: bytes, metadata: dict[str, Any]) -> bytes:
        """Best-effort JSON metadata injection.

        If the body is JSON, attach ``metadata.<forge_*>`` keys (don't
        overwrite caller-supplied values). If it isn't JSON (multipart,
        binary), forward as-is — spend attribution for those routes
        relies on the path-based reconciliation done by the handler.
        """
        if not body:
            return body
        try:
            import json

            parsed = json.loads(body)
        except Exception:  # noqa: BLE001
            return body
        if not isinstance(parsed, dict):
            return body
        meta = parsed.setdefault("metadata", {})
        if not isinstance(meta, dict):
            meta = {}
            parsed["metadata"] = meta
        for k, v in metadata.items():
            meta.setdefault(k, v)
        import json

        return json.dumps(parsed).encode("utf-8")


__all__ = ["PassThroughClient", "_PROVIDER_PASSTHROUGH_HEADER_ALLOWLIST"]
