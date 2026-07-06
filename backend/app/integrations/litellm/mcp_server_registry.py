"""F-829e — MCP server registry (read-only browser).

Thin wrapper over the LiteLLM ``/mcp/servers`` endpoint. Phase B
delivers the *read* path only (FORA-827 replacement — the LiteLLM
admin UI remains the surface for CRUD on MCP server config).
Forge's contribution is a Steward-visible card list so the user can
audit which MCP servers are reachable from the AI gateway.

Rules respected:
* Rule 1 — LiteLLM is the only LLM gateway; this module talks to it
  via :class:`LiteLLMBaseClient` (httpx).
* OQ-34 — the LiteLLM admin UI is the escape hatch for managing
  MCP server config; the Forge UI is read-only.

Failure policy: a failed fetch returns an empty list (fail-open —
the UI shows the empty state and a toast).
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


class MCPServerRegistry:
    """Read-only LiteLLM MCP server browser.

    The response shape from LiteLLM is best-effort normalized to a
    stable ``MCPServer`` shape (see ``MCPServerInfo`` below) so the
    frontend does not have to handle LiteLLM's evolving payload.
    """

    def __init__(self, base_client_factory: Any | None = None) -> None:
        self._base_client_factory = base_client_factory

    async def list_servers(self) -> list[dict[str, Any]]:
        """Return the registered LiteLLM MCP servers.

        Returns an empty list on error (logged at WARNING). The
        frontend renders the empty state with a CTA pointing at the
        LiteLLM admin UI.
        """
        try:
            response = await self._admin_get("/mcp/servers")
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.mcp_servers.list_failed",
                error=str(exc),
                error_type=type(exc).__name__,
            )
            return []

        rows = self._extract_servers(response)
        if not rows:
            logger.info(
                "litellm.mcp_servers.list_empty",
                detail="LiteLLM returned no MCP servers — verify MCP plugin is enabled",
            )
        return rows

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    async def _admin_get(self, path: str) -> dict[str, Any]:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.get(path)
                return self._parse(response)
        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.get(path)
            return self._parse(response)

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------
    @staticmethod
    def _parse(response: Any) -> dict[str, Any]:
        if response is None:
            return {}
        try:
            return response.json() or {}
        except Exception:
            return {}

    @staticmethod
    def _extract_servers(response: dict[str, Any] | None) -> list[dict[str, Any]]:
        """Normalize the LiteLLM ``/mcp/servers`` response shape.

        LiteLLM returns either a top-level array or a wrapped object
        (``{"servers": [...]}``). We accept both and coerce each row
        to ``{id, name, transport, command, url, scopes, status}``.
        Unknown keys are preserved in ``raw``.
        """
        if not response:
            return []
        rows: list[Any]
        if isinstance(response, list):
            rows = response
        elif isinstance(response, dict):
            for key in ("servers", "data", "items"):
                if key in response and isinstance(response[key], list):
                    rows = response[key]
                    break
            else:
                if "server_name" in response or "name" in response or "id" in response:
                    rows = [response]
                else:
                    return []
        else:
            return []

        normalized: list[dict[str, Any]] = []
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            sid = raw.get("server_id") or raw.get("id") or raw.get("server_name") or raw.get("name")
            if not sid:
                continue
            normalized.append(
                {
                    "id": str(sid),
                    "name": raw.get("alias")
                    or raw.get("display_name")
                    or raw.get("server_name")
                    or raw.get("name")
                    or str(sid),
                    "transport": raw.get("transport") or raw.get("type") or "stdio",
                    "command": raw.get("command") or "",
                    "url": raw.get("url") or "",
                    "scopes": list(raw.get("scopes") or []),
                    "status": raw.get("status") or "active",
                    "raw": raw,
                }
            )
        return normalized


# Module-level singleton (mirrors `audit_service.py:49`).
mcp_server_registry = MCPServerRegistry()


__all__ = ["MCPServerRegistry", "mcp_server_registry"]
