"""F-414 — Terminal Knowledge Context endpoints."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.services.terminal.knowledge_context import ContextItem, knowledge_context
from app.terminal.session_manager import session_manager
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/terminal", tags=["terminal-context"])


class ContextItemResponse(BaseModel):
    id: str
    type: str
    title: str
    summary: str
    relevance_score: float
    deep_link: str
    source_id: str | None = None
    extra: dict[str, Any]


def _to_response(item: ContextItem) -> ContextItemResponse:
    return ContextItemResponse(**item.to_dict())


@router.get(
    "/sessions/{session_id}/context",
    response_model=list[ContextItemResponse],
)
@audit(action="terminal.context.list", target_type="terminal_session")
async def list_context(
    session_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:read"))
) -> list[ContextItemResponse]:
    """Top-N inline context items for a session."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    items = await knowledge_context.get_context_for_session(session_id)
    return [_to_response(i) for i in items]
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/sessions/{session_id}/context/refresh",
    response_model=list[ContextItemResponse],
)
@audit(action="terminal.context.refresh", target_type="terminal_session")
async def refresh_context(
    session_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:write"))
) -> list[ContextItemResponse]:
    """Force-refresh the inline context cache."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    items = await knowledge_context.refresh_context(session_id)
    return [_to_response(i) for i in items]


@router.get(
    "/sessions/{session_id}/context/{item_id}",
    response_model=ContextItemResponse,
)
@audit(action="terminal.context.get", target_type="terminal_session")
async def get_context_item(
    session_id: str,
    item_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:read"))
) -> ContextItemResponse:
    """Get a specific context item by id."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    item = await knowledge_context.get_context_item(session_id, item_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="item_not_found",
        )
    return _to_response(item)


__all__ = ["router"]
