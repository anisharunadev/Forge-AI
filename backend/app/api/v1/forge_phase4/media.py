"""F16 — Multimodal (audio / image / video / moderation) HTTP surface.

All endpoints are thin pass-throughs to LiteLLM's media routes. Per-tenant
enablement is gated by ``forge.media.enabled``. Each successful call
emits the matching ``forge.media.*`` audit event.

ponytail: eight endpoints, one helper. New media route → add a
one-liner that delegates to :func:`_proxy`.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from app.core.config import settings
from app.core.logging import get_logger
from app.core.phase4_audit_events import Phase4AuditAction
from app.core.phase4_errors import PassThroughDisabled
from app.core.security import AuthenticatedPrincipal
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

logger = get_logger(__name__)

router = APIRouter(prefix="/media", tags=["phase4-media"])


async def _require_media_enabled(principal: AuthenticatedPrincipal) -> AuthenticatedPrincipal:
    """Single dependency for all media endpoints — flips PassThroughDisabled."""

    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Tenant, principal.tenant_id)
        if row is None:
            raise HTTPException(status_code=404, detail="tenant_not_found")
        flags = (row.settings or {}).get("feature_flags") or {}
        if not bool((flags.get("forge.media.enabled") or {}).get("value")):
            raise PassThroughDisabled("media")
    return principal


async def _proxy(
    request: Request,
    *,
    upstream_path: str,
    audit_action: Phase4AuditAction,
    principal: AuthenticatedPrincipal,
    content_type_override: str | None = None,
) -> Response:
    """Forward the request body to LiteLLM and stream the response back."""
    body = await request.body()
    headers = {
        "Authorization": f"Bearer {settings.litellm_admin_key}",
        "Content-Type": content_type_override
        or request.headers.get("content-type", "application/json"),
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        response = await client.request(
            request.method,
            f"{settings.litellm_base_url}{upstream_path}",
            params=request.query_params,
            headers=headers,
            content=body,
        )

    await audit_service.record(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        action=audit_action.value,
        target_type="media",
        target_id=upstream_path,
        payload={"status_code": response.status_code, "method": request.method},
    )

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers={
            k: v
            for k, v in response.headers.items()
            if k.lower() not in {"content-length", "transfer-encoding", "connection"}
        },
        media_type=response.headers.get("content-type"),
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/audio/speech")
async def audio_speech(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path="/audio/speech",
        audit_action=Phase4AuditAction.MEDIA_AUDIO_GENERATED,
        principal=principal,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/audio/transcriptions")
async def audio_transcriptions(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path="/audio/transcriptions",
        audit_action=Phase4AuditAction.MEDIA_TRANSCRIBED,
        principal=principal,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/images/generations")
async def image_generations(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path="/images/generations",
        audit_action=Phase4AuditAction.MEDIA_IMAGE_GENERATED,
        principal=principal,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/images/edits")
async def image_edits(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path="/images/edits",
        audit_action=Phase4AuditAction.MEDIA_IMAGE_EDITED,
        principal=principal,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/videos")
async def videos_start(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    """Async video generation — returns job id immediately."""
    return await _proxy(
        request,
        upstream_path="/videos",
        audit_action=Phase4AuditAction.MEDIA_VIDEO_STARTED,
        principal=principal,
    )


@router.get("/videos/{job_id}")
async def videos_poll(
    job_id: str,
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path=f"/v1/videos/{job_id}",
        audit_action=Phase4AuditAction.MEDIA_VIDEO_COMPLETED,
        principal=principal,
    )


@router.get("/videos/{job_id}/content")
async def videos_content(
    job_id: str,
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path=f"/v1/videos/{job_id}/content",
        audit_action=Phase4AuditAction.MEDIA_VIDEO_COMPLETED,
        principal=principal,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/moderations")
async def moderations(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path="/moderations",
        audit_action=Phase4AuditAction.MEDIA_MODERATION_RUN,
        principal=principal,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/containers")
async def containers_start(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path="/v1/containers",
        audit_action=Phase4AuditAction.PROVIDER_ACCESSED,
        principal=principal,
    )


@router.get("/containers/{container_id}")
async def containers_status(
    container_id: str,
    request: Request,
    principal: AuthenticatedPrincipal = Depends(_require_media_enabled),
) -> Response:
    return await _proxy(
        request,
        upstream_path=f"/v1/containers/{container_id}",
        audit_action=Phase4AuditAction.PROVIDER_ACCESSED,
        principal=principal,
    )


__all__ = ["router"]
