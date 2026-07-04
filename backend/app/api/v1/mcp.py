"""step-77 Slice 4 — ``/api/v1/mcp/*`` Phase 2 surface.

Phase 1 (``api/v1/mcp.py``) shipped the read-only browser over the
static ``MCP_REGISTRY``. Slice 4 keeps the read paths and adds the
write + dispatch surface from spec §Feature 8:

* ``GET    /mcp/servers``                 — list (cached, tenant-scoped)
* ``POST   /mcp/servers``                 — admin: register
* ``DELETE /mcp/servers/{name}``          — admin: unregister
* ``GET    /mcp/servers/{name}``          — detail (no secrets)
* ``POST   /mcp/servers/{name}/test``     — connection test (AC #7)
* ``GET    /mcp/servers/{name}/tools``    — enumerated tools
* ``GET    /mcp/servers/{name}/auth/status``  — token-free (AC §"Auth scope")
* ``POST   /mcp/servers/{name}/auth/refresh`` — force refresh
* ``GET    /mcp/hub``                     — public catalog
* ``POST   /mcp/call``                    — internal dispatch
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.marketplace import (
    MCPCategoryRead,
    MCPServerList,
    MCPServerRead,
)
from app.schemas.mcp_v2 import (
    MCPAuthExpiredError,
    MCPServerAuthStatus,
    MCPServerRegistration,
    MCPServerTestResult,
    MCPToolCallRequest,
    MCPToolCallResult,
    MCPToolRead,
    MCPToolTimeoutError,
)
from app.services.marketplace import (
    get_server_details,
    list_all_categories,
    list_available_servers,
)
from app.services.mcp_service import (
    MCPAuthExpired,
    MCPToolTimeout,
    mcp_service,
)
from app.services.mcp_registry import MCPCategory

router = APIRouter(prefix="/mcp", tags=["mcp"])


# ---------------------------------------------------------------------
# Catalog (Phase 1 — read-only)
# ---------------------------------------------------------------------


@router.get("/servers", response_model=MCPServerList)
@audit(action="mcp.servers.list", target_type="mcp_server")
async def list_servers(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("marketplace:read")),
    category: MCPCategory | None = Query(default=None),
) -> MCPServerList:
    items = await list_available_servers(category=category)
    return MCPServerList(total=len(items), items=[MCPServerRead(**i) for i in items])


@router.get("/servers/{name}", response_model=MCPServerRead)
@audit(action="mcp.servers.get", target_type="mcp_server")
async def get_server(
    name: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("marketplace:read")),
) -> MCPServerRead:
    details = await get_server_details(name)
    if details is None:
        raise HTTPException(status_code=404, detail=f"mcp_server {name!r} not found")
    return MCPServerRead(**details)


@router.get("/categories", response_model=list[MCPCategoryRead])
@audit(action="mcp.categories.list", target_type="mcp_category")
async def list_categories(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("marketplace:read")),
) -> list[MCPCategoryRead]:
    return [MCPCategoryRead(**i) for i in await list_all_categories()]


# ---------------------------------------------------------------------
# Registration (Phase 2 — admin write)
# ---------------------------------------------------------------------


@router.post(
    "/servers",
    response_model=MCPServerRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="mcp.servers.register", target_type="mcp_server")
async def register_server(
    body: MCPServerRegistration,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> MCPServerRead:
    """Admin register a new MCP server (spec §"Server registry")."""
    await mcp_service.register(
        server=body,
        tenant_id=principal.tenant_id,
        actor_id=getattr(principal, "user_id", None),
    )
    # Return the typed read shape; the catalog row comes back via
    # the static registry for installed packages, or an empty stub
    # for fresh registrations.
    details = await get_server_details(body.name)
    if details is None:
        # Unknown package — return a stub; the next sync will hydrate.
        return MCPServerRead(
            name=body.name,
            display_name=body.name,
            description="",
            category="custom",
            version="0.0.0",
            auth_methods=[body.auth_kind],
            config_schema={},
            capabilities=[],
        )
    return MCPServerRead(**details)


@router.delete("/servers/{name}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
@audit(action="mcp.servers.unregister", target_type="mcp_server")
async def unregister_server(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> None:
    await mcp_service.unregister(
        server_name=name,
        tenant_id=principal.tenant_id,
        actor_id=getattr(principal, "user_id", None),
    )


# ---------------------------------------------------------------------
# Connection test (AC #7)
# ---------------------------------------------------------------------


@router.post("/servers/{name}/test", response_model=MCPServerTestResult)
@audit(action="mcp.servers.test", target_type="mcp_server")
async def test_server(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("marketplace:read")),
) -> MCPServerTestResult:
    return await mcp_service.test(server_id=name, tenant_id=principal.tenant_id)


# ---------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------


@router.get("/servers/{name}/tools", response_model=list[MCPToolRead])
@audit(action="mcp.servers.tools", target_type="mcp_server")
async def list_server_tools(
    name: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("marketplace:read")),
) -> list[MCPToolRead]:
    return await mcp_service.list_tools(server_ids=[name])


# ---------------------------------------------------------------------
# Auth (token-free)
# ---------------------------------------------------------------------


@router.get("/servers/{name}/auth/status", response_model=MCPServerAuthStatus)
@audit(action="mcp.auth.status", target_type="mcp_server")
async def auth_status(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("marketplace:read")),
) -> MCPServerAuthStatus:
    try:
        return await mcp_service.auth_status(
            server_id=name, tenant_id=principal.tenant_id
        )
    except MCPAuthExpired as exc:
        from datetime import datetime, timezone
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=MCPAuthExpiredError(
                server_id=exc.server_id,
                reauth_url=exc.reauth_url,
                occurred_at=datetime.now(timezone.utc),
            ).model_dump(),
        )


@router.post("/servers/{name}/auth/refresh", response_model=dict[str, Any])
@audit(action="mcp.auth.refresh", target_type="mcp_server")
async def auth_refresh(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> dict[str, Any]:
    return await mcp_service.refresh_auth(
        server_id=name,
        tenant_id=principal.tenant_id,
        actor_id=getattr(principal, "user_id", None),
    )


# ---------------------------------------------------------------------
# Public hub (AC #10 — 500ms SLA)
# ---------------------------------------------------------------------


@router.get("/hub", response_model=list[dict[str, Any]])
@audit(action="mcp.hub.list", target_type="mcp_hub")
async def public_hub(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("marketplace:read")),
) -> list[dict[str, Any]]:
    """Public catalog — rate-limited at the upstream proxy."""
    return await mcp_service.public_hub()


# ---------------------------------------------------------------------
# Internal dispatch (used by the chat loop)
# ---------------------------------------------------------------------


@router.post("/call", response_model=MCPToolCallResult)
@audit(action="mcp.call", target_type="mcp_tool")
async def dispatch_tool_call(
    body: MCPToolCallRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("chat:write")),
) -> MCPToolCallResult:
    try:
        return await mcp_service.dispatch_tool_call(
            request=body,
            tenant_id=principal.tenant_id,
            actor_id=getattr(principal, "user_id", None),
        )
    except MCPToolTimeout as exc:
        from datetime import datetime, timezone
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=MCPToolTimeoutError(
                server_id=exc.server_id,
                tool_name=exc.tool_name,
                duration_ms=exc.duration_ms,
                occurred_at=datetime.now(timezone.utc),
            ).model_dump(),
        )


__all__ = ["router"]