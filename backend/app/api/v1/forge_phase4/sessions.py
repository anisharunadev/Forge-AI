"""F17 — Realtime / A2A / Long-running sessions HTTP surface."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.deps import require_permission
from app.core.security import AuthenticatedPrincipal
from app.services.phase4_sessions import (
    a2a_agent_card,
    cancel_session,
    create_session,
    extend_session,
    get_session,
    heartbeat,
    issue_realtime_client_secret,
    list_sessions,
    record_a2a_handshake,
    resume_session,
)

router = APIRouter(prefix="", tags=["phase4-sessions"])


# ── Schemas ──────────────────────────────────────────────────────────


class CreateSessionIn(BaseModel):
    session_type: str = Field(
        pattern="^(realtime|a2a|background|eval|interaction|assistant|thread)$"
    )
    agent_id: str | None = None
    metadata: dict[str, Any] | None = None


class A2AHandshakeIn(BaseModel):
    from_agent_id: str
    to_agent_id: str
    direction: str = Field(pattern="^(outbound|inbound)$")
    jwt_jti: str | None = None


# ── Sessions ─────────────────────────────────────────────────────────


@router.get("/sessions")
async def sessions_list(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
    active_only: bool = True,
    limit: int = 100,
) -> dict[str, Any]:
    return {"sessions": await list_sessions(principal.tenant_id, active_only=active_only, limit=limit)}


@router.get("/sessions/{session_id}")
async def sessions_get(
    session_id: UUID,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    row = await get_session(session_id, principal.tenant_id)
    if row is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return row


@router.post("/sessions/{session_id}/heartbeat")
async def sessions_heartbeat(
    session_id: UUID,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
    duration_ms: int | None = None,
) -> dict[str, Any]:
    return await heartbeat(session_id, principal.tenant_id, duration_ms=duration_ms)


@router.post("/sessions/{session_id}/extend")
async def sessions_extend(
    session_id: UUID,
    additional_seconds: int,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return await extend_session(
        session_id, principal.tenant_id, principal.user_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        additional_seconds=additional_seconds,
    )


@router.post("/sessions/{session_id}/cancel")
async def sessions_cancel(
    session_id: UUID,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    await cancel_session(
        session_id, principal.tenant_id, principal.user_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
    )
    return {"cancelled": True}


@router.post("/sessions/{session_id}/resume")
async def sessions_resume(
    session_id: UUID,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return await resume_session(
        session_id, principal.tenant_id, principal.user_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
    )


# ── Realtime ─────────────────────────────────────────────────────────


@router.post("/realtime/client-secret")
async def realtime_client_secret(
    session_id: UUID,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return await issue_realtime_client_secret(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        session_id=session_id,
    )


@router.post("/realtime/sessions")
async def realtime_session_create(
    body: CreateSessionIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return await create_session(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        session_type=body.session_type,
        agent_id=body.agent_id,
        metadata=body.metadata,
    )


# ── A2A ──────────────────────────────────────────────────────────────


def mount_a2a(app: Any) -> None:
    """Mount /a2a/.well-known on root app."""

    async def _well_known(request: Request) -> dict[str, Any]:
        return a2a_agent_card(str(request.base_url).rstrip("/"))

    app.add_api_route(
        "/a2a/.well-known",
        _well_known,
        methods=["GET"],
        include_in_schema=False,
    )


@router.post("/a2a/message")
async def a2a_message(
    body: A2AHandshakeIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    jti = await record_a2a_handshake(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        from_agent_id=body.from_agent_id,
        to_agent_id=body.to_agent_id,
        direction=body.direction,
        jwt_jti=body.jwt_jti,
    )
    return {"delegation_id": jti, "status": "pending"}


# ── Background responses (F17 §Background) ──────────────────────────


@router.post("/responses")
async def responses_start(
    body: CreateSessionIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    """Start a background response session (Anthropic-compat / OpenAI Responses)."""
    body.session_type = "background"
    return await create_session(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        session_type="background",
        agent_id=body.agent_id,
        metadata=body.metadata,
    )


__all__ = ["router", "mount_a2a"]