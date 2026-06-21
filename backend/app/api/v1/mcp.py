"""MCP registry REST endpoints.

Exposes the in-process `MCP_REGISTRY` (see `app.services.mcp_registry`)
as a read-only HTTP API. These endpoints back the Connector Center
marketplace tab and the agent runtime's capability discovery.

All routes are read-only, multi-tenant (any authenticated principal
with `marketplace:read` can browse), and async.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.services.marketplace import (
    get_server_details,
    list_all_categories,
    list_available_servers,
)
from app.services.mcp_registry import MCPCategory
from app.schemas.marketplace import (
    MCPCategoryRead,
    MCPServerRead,
    MCPServerList,
)

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("/servers", response_model=MCPServerList)
@audit(action="mcp.servers.list", target_type="mcp_server")
async def list_servers(
    principal: Principal,
    _perm: Principal = require_permission("marketplace:read"),
    category: Optional[MCPCategory] = Query(
        default=None,
        description="Filter by MCP category",
    ),
) -> MCPServerList:
    """List all registered MCP servers, optionally filtered by category."""
    items = await list_available_servers(category=category)
    return MCPServerList(total=len(items), items=[MCPServerRead(**i) for i in items])


@router.get("/servers/{name}", response_model=MCPServerRead)
@audit(action="mcp.servers.get", target_type="mcp_server")
async def get_server(
    name: str,
    principal: Principal,
    _perm: Principal = require_permission("marketplace:read"),
) -> MCPServerRead:
    """Get full details for a single MCP server by name."""
    details = await get_server_details(name)
    if details is None:
        raise HTTPException(status_code=404, detail=f"mcp_server {name!r} not found")
    return MCPServerRead(**details)


@router.get("/categories", response_model=list[MCPCategoryRead])
@audit(action="mcp.categories.list", target_type="mcp_category")
async def list_categories(
    principal: Principal,
    _perm: Principal = require_permission("marketplace:read"),
) -> list[MCPCategoryRead]:
    """Return the closed set of MCP categories."""
    items = await list_all_categories()
    return [MCPCategoryRead(**i) for i in items]


__all__ = ["router"]
