"""step-77 Slice 5 — LiteLLM Tools registry proxy.

Thin wrapper over the LiteLLM Tools endpoints named in
``docs/goals/step-77.md`` §Feature 10. Sibling to
:mod:`app.integrations.litellm.guardrail_apply`,
:mod:`app.integrations.litellm.policies_apply`, and
:mod:`app.integrations.litellm.mcp_apply`.

Endpoints covered:

* ``GET    /v1/tool/list``                    — full tool registry
* ``GET    /v1/tool/{name}/detail``           — one tool's full record
* ``GET    /v1/tool/{name}/logs``             — invocation log
* ``GET    /v1/tool/{name}/overrides``        — per-tool overrides
* ``PUT    /v1/tool/{name}/overrides``        — set per-tool overrides
* ``DELETE /v1/tool/{name}``                  — soft-archive
* ``GET    /search_tools/list``               — search-tool catalog
* ``POST   /search_tools/test_connection``    — search-tool reachability
* ``GET    /search_tools/ui``                 — UI picker metadata

Failure policy: every method returns ``None`` / ``[]`` / typed empty
when the proxy is unreachable. The service layer is the only place
that may choose fail-open vs fail-closed.
"""

from __future__ import annotations

import time
from typing import Any

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------


async def list_tools(
    *,
    kind: str | None = None,
    server_id: str | None = None,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /v1/tool/list`` with optional filters."""
    params: dict[str, Any] = {}
    if kind:
        params["kind"] = kind
    if server_id:
        params["server_id"] = server_id

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/v1/tool/list", params=params)
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("tools") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_tool_detail(
    name: str,
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /v1/tool/{name}/detail``."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get(f"/v1/tool/{name}/detail")
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------


async def list_logs(
    *,
    name: str,
    since_hours: int = 24,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /v1/tool/{name}/logs`` — every invocation in the window.

    AC #2: hashes only — no raw payloads. We coerce both
    ``arguments_hash`` and ``result_hash`` into the typed result even
    when the proxy omits them.
    """
    params = {"since_hours": since_hours}

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get(f"/v1/tool/{name}/logs", params=params)
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        rows: list[dict[str, Any]]
        if isinstance(raw, list):
            rows = raw
        elif isinstance(raw, dict):
            rows = raw.get("logs") or raw.get("data") or raw.get("items") or []
        else:
            rows = []
        normalized: list[dict[str, Any]] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            r.setdefault("arguments_hash", "")
            r.setdefault("result_hash", "")
            normalized.append(r)
        return normalized

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Overrides
# ---------------------------------------------------------------------


async def get_overrides(
    *,
    name: str,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /v1/tool/{name}/overrides``."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get(f"/v1/tool/{name}/overrides")
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def put_overrides(
    *,
    name: str,
    overrides: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``PUT /v1/tool/{name}/overrides``."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.put(f"/v1/tool/{name}/overrides", json=overrides)
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Soft-delete
# ---------------------------------------------------------------------


async def archive_tool(
    *,
    name: str,
    base_client: LiteLLMBaseClient | None = None,
) -> bool:
    """``DELETE /v1/tool/{name}`` — soft-archive (AC #5)."""

    async def _call(client: LiteLLMBaseClient) -> bool:
        response = await client.admin_client.delete(f"/v1/tool/{name}")
        return response.status_code < 400 or response.status_code == 404

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Search tools
# ---------------------------------------------------------------------


async def list_search_tools(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /search_tools/list`` — search-tool catalog."""

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/search_tools/list")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("tools") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def test_search_tool(
    *,
    tool_id: str,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /search_tools/test_connection``.

    AC #7 — returns ``{reachable: false}`` on unreachable, never a 500.
    """
    body = {"tool_id": tool_id}

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        started = time.monotonic()
        try:
            response = await client.admin_client.post("/search_tools/test_connection", json=body)
        except Exception as exc:  # noqa: BLE001
            return {
                "reachable": False,
                "latency_ms": int((time.monotonic() - started) * 1000),
                "error": str(exc)[:200],
            }
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if response.status_code >= 400:
            return {
                "reachable": False,
                "latency_ms": elapsed_ms,
                "error": response.text[:200],
            }
        raw = response.json() or {}
        raw.setdefault("reachable", True)
        raw.setdefault("latency_ms", elapsed_ms)
        return raw

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def list_search_tools_ui(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /search_tools/ui`` — UI picker metadata."""

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/search_tools/ui")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("tools") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


__all__ = [
    "archive_tool",
    "get_overrides",
    "get_tool_detail",
    "list_logs",
    "list_search_tools",
    "list_search_tools_ui",
    "list_tools",
    "put_overrides",
    "test_search_tool",
]
