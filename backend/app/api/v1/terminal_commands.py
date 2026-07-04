"""F-411 — Command Center Integration endpoints."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.services.terminal.command_integration import (
    OutputChunk,
    command_integration,
)
# `OutputChunk` is referenced via the local `_chunk_dict` helper below.
from app.terminal.session_manager import AgentType, session_manager
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/terminal", tags=["terminal-commands"])


class LaunchCommandRequest(BaseModel):
    forge_cmd: str = Field(..., min_length=3)
    args: dict[str, Any] = Field(default_factory=dict)
    agent_type: AgentType | None = None


class LaunchCommandResponse(BaseModel):
    session_id: str
    websocket_url: str
    agent_type: str


class InjectCommandRequest(BaseModel):
    command: str = Field(..., min_length=1)


class InjectCommandResponse(BaseModel):
    ok: bool


class OutputResponse(BaseModel):
    output: list[dict[str, Any]]
    new_cursor: int
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/commands/launch",
    response_model=LaunchCommandResponse,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="terminal.commands.launch", target_type="terminal_session")
async def launch_command(
    body: LaunchCommandRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:connect"))
) -> LaunchCommandResponse:
    """Launch a terminal session bound to a forge-* command."""
    if principal.project_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_required",
        )
    try:
        session = await command_integration.launch_session_for_command(
            forge_cmd=body.forge_cmd,
            args=body.args,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            user_id=principal.user_id,
            agent_type=body.agent_type,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return LaunchCommandResponse(
        session_id=session.id,
        websocket_url=f"/ws/terminal/{session.id}",
        agent_type=session.agent_type.value,
    )
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/sessions/{session_id}/inject",
    response_model=InjectCommandResponse,
)
@audit(action="terminal.inject", target_type="terminal_session")
async def inject_command(
    session_id: str,
    body: InjectCommandRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:write"))
) -> InjectCommandResponse:
    """Pipe a command into a running session."""
    session = await session_manager.get_session(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    if session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="tenant_mismatch",
        )
    try:
        await command_integration.inject_command(session_id, body.command)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    return InjectCommandResponse(ok=True)


@router.get(
    "/sessions/{session_id}/output",
    response_model=OutputResponse,
)
@audit(action="terminal.output.poll", target_type="terminal_session")
async def get_output(
    session_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:read")),
    since: Annotated[int, Query(ge=0)] = 0,
) -> OutputResponse:
    """Poll buffered session output since the given cursor."""
    session = await session_manager.get_session(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )
    if session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="tenant_mismatch",
        )
    chunks, new_cursor = await command_integration.get_command_output(
        session_id, since_cursor=since
    )
    return OutputResponse(
        output=[_chunk_dict(c) for c in chunks],
        new_cursor=new_cursor,
    )


def _chunk_dict(chunk: OutputChunk) -> dict[str, Any]:
    return {
        "cursor": chunk.cursor,
        "data": chunk.data.decode("utf-8", errors="replace"),
        "occurred_at": chunk.occurred_at.isoformat(),
    }


__all__ = ["router"]
