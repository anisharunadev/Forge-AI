"""step-77 Slice 5 — ``/api/v1/tools/*`` Phase 2 surface.

Spec §Feature 10 Forge Backend contract:

* ``GET    /tools``                       — list (filterable)
* ``GET    /tools/{name}`                 — detail
* ``GET    /tools/{name}/logs``           — invocation log
* ``GET    /tools/{name}/overrides``      — current overrides
* ``PUT    /tools/{name}/overrides``      — admin: set overrides
* ``DELETE /tools/{name}``                — admin: archive
* ``GET    /search-tools``                — search-tool picker
* ``POST   /search-tools/{id}/test``      — connection test
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.common import Page
from app.schemas.tools_v2 import (
    SearchToolTestResult,
    ToolLogRead,
    ToolOverrideUpdate,
    ToolOverrides,
    ToolRead,
)
from app.services.tools_service import tools_service

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("", response_model=Page[ToolRead])
@audit(action="tools.list", target_type="litellm_tool")
async def list_tools(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tools:read")),
    kind: str | None = Query(default=None),
    server_id: str | None = Query(default=None),
) -> Page[ToolRead]:
    items = await tools_service.list(
        tenant_id=principal.tenant_id, kind=kind, server_id=server_id
    )
    return Page(items=items, total=len(items))


@router.get("/{name}", response_model=ToolRead)
@audit(action="tools.detail", target_type="litellm_tool")
async def get_tool(
    name: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tools:read")),
) -> ToolRead:
    detail = await tools_service.detail(name)
    if detail is None:
        raise HTTPException(status_code=404, detail="tool not found")
    return detail


@router.get("/{name}/logs", response_model=Page[ToolLogRead])
@audit(action="tools.logs", target_type="litellm_tool")
async def get_tool_logs(
    name: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tools:read")),
    since_hours: int = Query(default=24, ge=1, le=24 * 30),
) -> Page[ToolLogRead]:
    items = await tools_service.logs(name=name, since_hours=since_hours)
    return Page(items=items, total=len(items))


@router.get("/{name}/overrides", response_model=ToolOverrides | None)
@audit(action="tools.overrides.get", target_type="litellm_tool")
async def get_tool_overrides(
    name: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tools:read")),
) -> ToolOverrides | None:
    return await tools_service.get_overrides(name=name)


@router.put("/{name}/overrides", response_model=ToolOverrides)
@audit(action="tools.overrides.set", target_type="litellm_tool")
async def put_tool_overrides(
    name: str,
    body: ToolOverrideUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> ToolOverrides:
    result = await tools_service.set_overrides(
        name=name,
        overrides=body.overrides,
        tenant_id=principal.tenant_id,
        actor_id=getattr(principal, "user_id", None),
    )
    if result is None:
        # Proxy unavailable — echo what the caller asked for so the
        # UI's optimistic update doesn't break.
        return body.overrides
    return result


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
@audit(action="tools.archive", target_type="litellm_tool")
async def archive_tool(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> None:
    await tools_service.archive(
        name=name,
        tenant_id=principal.tenant_id,
        actor_id=getattr(principal, "user_id", None),
    )


@router.get("/search-tools", response_model=Page[dict[str, Any]])
@audit(action="tools.search.list", target_type="litellm_search_tool")
async def list_search_tools(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tools:read")),
) -> Page[dict[str, Any]]:
    items = await tools_service.search_tools_ui()
    return Page(items=items, total=len(items))


@router.post(
    "/search-tools/{tool_id}/test",
    response_model=SearchToolTestResult,
)
@audit(action="tools.search.test", target_type="litellm_search_tool")
async def test_search_tool(
    tool_id: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("tools:read")),
) -> SearchToolTestResult:
    return await tools_service.test_search_tool(tool_id=tool_id)


__all__ = ["router"]