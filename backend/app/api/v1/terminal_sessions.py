"""Terminal session HTTP entry point (step-71 wiring).

A thin wrapper around `session_manager.create_session(...)` so the
frontend can mint a backend session before opening the WebSocket at
`/ws/terminal/{session_id}`. The session id is server-issued (UUID4);
the frontend uses it both for the store entry and the WS URL.

The WS handler at `app.api.ws.terminal` already enforces tenant scoping
and RBAC — this endpoint just needs the same auth + permission gate.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import AuthenticatedPrincipal, get_current_principal, require_permission
from app.core.audit import audit
from app.terminal.session_manager import AgentType, session_manager

router = APIRouter(prefix="/terminal", tags=["terminal-sessions"])


class CreateSessionRequest(BaseModel):
    agent_type: AgentType
    workspace_path: str = Field(default="default", min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CreateSessionResponse(BaseModel):
    id: str
    agent_type: AgentType
    websocket_path: str


@router.post(
    "/sessions",
    response_model=CreateSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="terminal.session.create", target_type="terminal_session")
async def create_session(
    body: CreateSessionRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:connect")),
) -> CreateSessionResponse:
    """Mint a new terminal session and return its server-issued id."""
    if principal.project_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_required",
        )
    try:
        session = await session_manager.create_session(
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            user_id=principal.user_id,
            agent_type=body.agent_type,
            workspace_path=body.workspace_path,
            metadata=body.metadata,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return CreateSessionResponse(
        id=session.id,
        agent_type=session.agent_type,
        websocket_path=f"/ws/terminal/{session.id}",
    )


__all__ = ["router"]