"""F-413 — Terminal Session Broadcast management endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.services.terminal.broadcast import session_broadcaster
from app.terminal.session_manager import session_manager

router = APIRouter(prefix="/terminal", tags=["terminal-broadcast"])


class BroadcasterResponse(BaseModel):
    subscription_id: str
    user_id: str
    tenant_id: str
    write: bool
    opened_at: str
    last_sent_at: str | None = None
    bytes_sent: int


class GrantRequest(BaseModel):
    user_id: str | None = Field(default=None)


class GrantResponse(BaseModel):
    ok: bool
    write_grants: int


@router.get(
    "/sessions/{session_id}/broadcasters",
    response_model=list[BroadcasterResponse],
)
@audit(action="terminal.broadcast.list", target_type="terminal_session")
async def list_broadcasters(
    session_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:read")),
) -> list[BroadcasterResponse]:
    """List current observers / writers for a session."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    rows = await session_broadcaster.list_broadcasters(session_id)
    return [BroadcasterResponse(**row) for row in rows]


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post(
    "/sessions/{session_id}/broadcast/grant",
    response_model=GrantResponse,
)
@audit(action="terminal.broadcast.grant", target_type="terminal_session")
async def grant_write(
    session_id: str,
    body: GrantRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:admin")),
) -> GrantResponse:
    """Grant broadcast write capability (RBAC: forge-admin)."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    target = body.user_id or principal.user_id
    try:
        grants = await session_broadcaster.grant_write(session_id, actor_user_id=target)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return GrantResponse(ok=True, write_grants=grants)


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post(
    "/sessions/{session_id}/broadcast/revoke",
    response_model=GrantResponse,
)
@audit(action="terminal.broadcast.revoke", target_type="terminal_session")
async def revoke_write(
    session_id: str,
    body: GrantRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:admin")),
) -> GrantResponse:
    """Revoke broadcast write capability (RBAC: forge-admin)."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    target = body.user_id or principal.user_id
    try:
        grants = await session_broadcaster.revoke_write(session_id, actor_user_id=target)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return GrantResponse(ok=True, write_grants=grants)


__all__ = ["router"]
