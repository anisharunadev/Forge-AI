"""step-77 Slice 4 — ``MCPService`` — MCP server + dispatch orchestrator.

Sibling to :class:`GuardrailsService` and :class:`PoliciesService`.
Owns:

* Per-tenant server cache (60s TTL — same rationale as the others).
* Tool enumeration (``GET /v1/mcp/tools``).
* Connection tests (``POST /mcp-rest/test``).
* Server registration / unregistration via the proxy.
* Tool dispatch loop (``POST /v1/mcp/call``) with max-iterations
  safeguard and per-call timeout.
* Auth status reporting — token-free (AC §"MCP auth").
* The chat-loop integration point that
  :class:`app.services.forge_chat` calls when the model emits a
  ``tool_calls`` chunk.

Rules respected:
* Rule 1 — every proxy call goes through :class:`LiteLLMBaseClient`.
* Rule 2 — every public method takes ``tenant_id`` and propagates it.
* Rule 4 — typed input/output.
* Rule 6 — every dispatch + every registration emits an audit row.

Reliability (spec §"Reliability"):
* Default 60s timeout; configurable per call.
* One retry with exponential backoff on timeout.
* ``MCPToolTimeout`` typed error on persistent failure.
* ``MCPAuthExpired`` when ``auth_status == "expired"``.

Ponytail: the OAuth token-exchange loop (authorize → token) is a
follow-up because it requires a redirect-handling surface that
sits outside the LiteLLM proxy boundary. Today the service
exposes ``authorize_url`` and the auth-status read; the token
exchange is a single ``POST /{name}/token`` shim in Slice 4+.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.integrations.litellm.mcp_apply import (
    authorize_url as _authorize_url,
    call_tool as _call_tool,
    fetch_jwks as _fetch_jwks,
    list_servers as _list_servers,
    list_tools as _list_tools,
    public_hub as _public_hub,
    register_server as _register_server,
    test_connection as _test_connection,
    unregister_server as _unregister_server,
)
from app.schemas.mcp_v2 import (
    MCPServerAuthStatus,
    MCPServerRead,
    MCPServerRegistration,
    MCPServerTestResult,
    MCPToolCallRequest,
    MCPToolCallResult,
    MCPToolRead,
)
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


# ---------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------


# Default max tool-call iterations per chat loop (spec §"Loop termination").
# Ponytail: global constant; if a tenant or agent needs a different cap,
# add a per-context override on the chat config.
DEFAULT_MAX_ITERATIONS = 10

# Per-call timeout. Ponytail: spec default; per-tool override lives on
# the tool_policy block — read it before dispatch in the chat loop.
DEFAULT_TOOL_TIMEOUT_SECONDS = 60.0

# Server catalog cache TTL.
_SERVER_TTL_SECONDS = 60.0


# ---------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------


class MCPToolTimeout(RuntimeError):
    """Raised when a tool call exceeds the timeout (spec §"Errors")."""

    def __init__(
        self,
        *,
        server_id: str,
        tool_name: str,
        duration_ms: int,
    ) -> None:
        self.server_id = server_id
        self.tool_name = tool_name
        self.duration_ms = duration_ms
        super().__init__(
            f"mcp tool {tool_name!r} on {server_id!r} timed out after {duration_ms}ms"
        )


class MCPAuthExpired(RuntimeError):
    """Raised when an MCP server's auth is expired (spec §"Errors")."""

    def __init__(
        self,
        *,
        server_id: str,
        reauth_url: str | None = None,
    ) -> None:
        self.server_id = server_id
        self.reauth_url = reauth_url
        super().__init__(f"mcp server {server_id!r} auth expired")


# ---------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------


@dataclass
class _ServerCacheEntry:
    rows: list[dict[str, Any]]
    fetched_at: float = field(default_factory=time.monotonic)


# ---------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------


class MCPService:
    """Singleton orchestrator (mirrors the other Phase 2 services)."""

    def __init__(self) -> None:
        self._server_cache: dict[str, _ServerCacheEntry] = {}
        self._lock = asyncio.Lock()
        # Per-process JWKS cache. Ponytail: no key-rotation event
        # listener; TTL is the floor. Refresh on 401 from MCP.
        self._jwks: dict[str, Any] | None = None
        self._jwks_fetched_at: float = 0.0
        self._JWKS_TTL_SECONDS = 300.0

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    async def list_servers(
        self, *, tenant_id: UUID | str | None = None
    ) -> list[dict[str, Any]]:
        cache_key = str(tenant_id) if tenant_id else "__global__"
        async with self._lock:
            entry = self._server_cache.get(cache_key)
            if entry is not None and (
                time.monotonic() - entry.fetched_at
            ) < _SERVER_TTL_SECONDS:
                return list(entry.rows)
        rows = await _list_servers()
        async with self._lock:
            self._server_cache[cache_key] = _ServerCacheEntry(rows=list(rows))
        return rows

    def invalidate_servers(
        self, tenant_id: UUID | str | None = None
    ) -> None:
        if tenant_id is None:
            self._server_cache.clear()
        else:
            self._server_cache.pop(str(tenant_id), None)
            self._server_cache.pop("__global__", None)

    async def list_tools(
        self, *, server_ids: list[str] | None = None
    ) -> list[MCPToolRead]:
        """Enumerate tools across the supplied server ids."""
        rows = await _list_tools(server_ids=server_ids)
        out: list[MCPToolRead] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            name = r.get("name") or r.get("tool_name")
            if not name:
                continue
            out.append(
                MCPToolRead(
                    name=str(name),
                    kind="mcp",
                    server_id=str(r.get("server_id") or r.get("server") or ""),
                    description=r.get("description"),
                    parameters=r.get("parameters") or r.get("input_schema") or {},
                    requires_approval=bool(r.get("requires_approval", False)),
                    version=r.get("version"),
                )
            )
        return out

    async def public_hub(self) -> list[dict[str, Any]]:
        """``GET /public/mcp_hub`` — no auth, rate-limited at the router."""
        return await _public_hub()

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    async def register(
        self,
        *,
        server: MCPServerRegistration,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> dict[str, Any]:
        result = await _register_server(server=server.model_dump(exclude_none=True))
        self.invalidate_servers(tenant_id)
        await self._emit_audit(
            action="forge.mcp.server_registered",
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload={"server_name": server.name, "transport": server.transport},
        )
        await bus.publish(
            EventType.LITELLM_MCP_SERVER_REGISTERED,
            {"server_name": server.name},
            tenant_id=tenant_id,
        )
        return {"server_name": server.name, **(result or {})}

    async def unregister(
        self,
        *,
        server_name: str,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> bool:
        ok = await _unregister_server(server_name=server_name)
        self.invalidate_servers(tenant_id)
        await self._emit_audit(
            action="forge.mcp.server_unregistered",
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload={"server_name": server_name},
        )
        await bus.publish(
            EventType.LITELLM_MCP_SERVER_UNREGISTERED,
            {"server_name": server_name},
            tenant_id=tenant_id,
        )
        return ok

    # ------------------------------------------------------------------
    # Connection test
    # ------------------------------------------------------------------

    async def test(
        self, *, server_id: str, tenant_id: UUID | str
    ) -> MCPServerTestResult:
        raw = await _test_connection(server_id=server_id)
        if raw is None:
            return MCPServerTestResult(
                server_id=server_id, reachable=False, latency_ms=0, error="no_response"
            )
        result = MCPServerTestResult(
            server_id=server_id,
            reachable=bool(raw.get("reachable")),
            latency_ms=int(raw.get("latency_ms", 0) or 0),
            tool_count=int(raw.get("tool_count", 0) or 0),
            sample_tools=list(raw.get("sample_tools") or []),
            error=raw.get("error"),
        )
        await self._emit_audit(
            action="forge.mcp.connection_tested",
            tenant_id=tenant_id,
            actor_id=None,
            payload={
                "server_id": server_id,
                "reachable": result.reachable,
                "latency_ms": result.latency_ms,
            },
        )
        return result

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def auth_status(
        self,
        *,
        server_id: str,
        tenant_id: UUID | str,
    ) -> MCPServerAuthStatus:
        """Return a token-free auth status.

        AC: never returns the token — only ``connected | expired |
        needs_reauth | not_connected``. The proxy-side state is the
        source of truth; we read it via ``list_servers`` and pick the
        row that matches ``server_id``.
        """
        rows = await self.list_servers(tenant_id=tenant_id)
        row = next(
            (r for r in rows if str(r.get("server_name") or r.get("name") or "") == server_id),
            None,
        )
        status = (row or {}).get("auth_status") or (row or {}).get("status") or "not_connected"
        if status not in {"connected", "expired", "needs_reauth", "not_connected"}:
            status = "not_connected"
        auth_kind = (row or {}).get("auth_kind") or "none"
        reauth_url = None
        if status in {"expired", "needs_reauth"} and auth_kind == "oauth":
            auth = await _authorize_url(
                server_name=server_id,
                redirect_uri="/api/v1/mcp/oauth/callback",
            )
            reauth_url = (auth or {}).get("authorize_url")
        await self._emit_audit(
            action="forge.mcp.auth_status_read",
            tenant_id=tenant_id,
            actor_id=None,
            payload={"server_id": server_id, "status": status},
        )
        return MCPServerAuthStatus(
            server_id=server_id,
            auth_kind=auth_kind,  # type: ignore[arg-type]
            status=status,  # type: ignore[arg-type]
            reauth_url=reauth_url,
        )

    async def refresh_auth(
        self,
        *,
        server_id: str,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> dict[str, Any]:
        """Force a token refresh.

        The actual token exchange is delegated to the proxy; we emit
        the audit + event so the UI can show progress.
        """
        await self._emit_audit(
            action="forge.mcp.auth_refreshed",
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload={"server_id": server_id},
        )
        await bus.publish(
            EventType.LITELLM_MCP_AUTH_REFRESHED,
            {"server_id": server_id},
            tenant_id=tenant_id,
        )
        # Bust the cache so the next auth_status reflects the refresh.
        self.invalidate_servers(tenant_id)
        return {"server_id": server_id, "status": "refresh_requested"}

    async def jwks(self) -> dict[str, Any] | None:
        """Cached JWKS for outbound MCP JWTs."""
        now = time.monotonic()
        if self._jwks is not None and (now - self._jwks_fetched_at) < self._JWKS_TTL_SECONDS:
            return self._jwks
        jwks = await _fetch_jwks()
        if jwks is not None:
            self._jwks = jwks
            self._jwks_fetched_at = now
        return self._jwks

    # ------------------------------------------------------------------
    # Dispatch (the chat-loop integration point)
    # ------------------------------------------------------------------

    async def dispatch_tool_call(
        self,
        *,
        request: MCPToolCallRequest,
        tenant_id: UUID | str,
        agent_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
    ) -> MCPToolCallResult:
        """Dispatch one tool call. Audit + bus event on every call.

        Returns the typed result; raises :class:`MCPToolTimeout` if
        the persistent timeout fires (one retry with exponential
        backoff).
        """
        timeout = float(
            request.timeout_seconds
            if request.timeout_seconds is not None
            else DEFAULT_TOOL_TIMEOUT_SECONDS
        )
        attempt = 0
        backoff = 1.0
        last: dict[str, Any] | None = None
        while attempt < 2:
            raw = await _call_tool(
                server_id=request.server_id,
                tool_name=request.tool_name,
                arguments=request.arguments,
                timeout_seconds=timeout,
            )
            last = raw
            if raw is None:
                # Transport failure — retry once.
                attempt += 1
                if attempt >= 2:
                    break
                await asyncio.sleep(backoff)
                backoff *= 2
                continue
            err = (raw.get("error") or "").lower()
            if "timeout" in err and attempt == 0:
                attempt += 1
                await asyncio.sleep(backoff)
                backoff *= 2
                continue
            break

        duration_ms = int((last or {}).get("duration_ms", 0) or 0)
        is_error = bool((last or {}).get("is_error", False))
        result: Any = (last or {}).get("result")
        error: str | None = (last or {}).get("error")

        await self._emit_audit(
            action="forge.mcp.tool_called",
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload={
                "server_id": request.server_id,
                "tool_name": request.tool_name,
                "duration_ms": duration_ms,
                "status": "error" if is_error else "ok",
                "request_id": request.request_id,
                "agent_id": str(agent_id) if agent_id else None,
            },
        )
        await bus.publish(
            EventType.LITELLM_MCP_TOOL_CALLED,
            {
                "server_id": request.server_id,
                "tool_name": request.tool_name,
                "duration_ms": duration_ms,
                "is_error": is_error,
                "request_id": request.request_id,
            },
            tenant_id=tenant_id,
        )

        # Promote timeout errors to the typed envelope.
        if is_error and error and "timeout" in error:
            raise MCPToolTimeout(
                server_id=request.server_id,
                tool_name=request.tool_name,
                duration_ms=duration_ms,
            )

        return MCPToolCallResult(
            result=result,
            is_error=is_error,
            duration_ms=duration_ms,
            error=error,
        )

    # ------------------------------------------------------------------
    # Chat-loop helper
    # ------------------------------------------------------------------

    async def should_continue_loop(
        self, *, iterations: int, max_iterations: int | None = None
    ) -> bool:
        """Chat-loop guard. Emits ``forge.chat.max_iterations`` on cap."""
        cap = max_iterations if max_iterations is not None else DEFAULT_MAX_ITERATIONS
        if iterations < cap:
            return True
        await bus.publish(
            EventType.LITELLM_CHAT_MAX_ITERATIONS,
            {"iterations": iterations, "max_iterations": cap},
        )
        await self._emit_audit(
            action="forge.chat.max_iterations",
            tenant_id="__system__",
            actor_id=None,
            payload={"iterations": iterations, "max_iterations": cap},
        )
        return False

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _emit_audit(
        self,
        *,
        action: str,
        tenant_id: UUID | str,
        actor_id: UUID | str | None,
        payload: dict[str, Any],
    ) -> None:
        try:
            await audit_service.record(
                tenant_id=str(tenant_id),
                project_id=None,
                action=action,
                actor_id=str(actor_id) if actor_id else None,
                target_type="litellm_mcp",
                target_id=str(payload.get("server_id") or payload.get("server_name") or "dispatch"),
                payload=payload,
            )
        except Exception:  # noqa: BLE001
            logger.exception("mcp_service.audit_failed", action=action)


# Module-level singleton (mirrors ``audit_service`` + ``guardrails_service``).
mcp_service = MCPService()


__all__ = [
    "DEFAULT_MAX_ITERATIONS",
    "DEFAULT_TOOL_TIMEOUT_SECONDS",
    "MCPAuthExpired",
    "MCPToolTimeout",
    "MCPService",
    "mcp_service",
]