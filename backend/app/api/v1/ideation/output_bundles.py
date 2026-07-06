"""Output Bundle REST endpoints (F-211)."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import OutputBundleRead
from app.services.ideation.output_bundle import output_bundle_service

router = APIRouter(prefix="/ideation", tags=["ideation"])


def _to_read(bundle) -> OutputBundleRead:
    return OutputBundleRead(
        id=bundle.id,
        tenant_id=bundle.tenant_id,
        project_id=bundle.project_id,
        idea_id=bundle.idea_id,
        bundle=dict(bundle.bundle or {}),
        storage_ref=bundle.storage_ref,
        created_at=bundle.created_at,
        updated_at=bundle.updated_at,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "/ideas/{idea_id}/bundles",
    response_model=OutputBundleRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="ideation.bundle.create", target_type="output_bundle")
async def create_bundle(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:bundle")),
) -> OutputBundleRead:
    try:
        bundle = await output_bundle_service.create_bundle(
            idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(bundle)


@router.get("/bundles/{bundle_id}", response_model=OutputBundleRead)
@audit(action="ideation.bundle.get", target_type="output_bundle")
async def get_bundle(
    bundle_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read")),
) -> OutputBundleRead:
    bundle = await output_bundle_service.get_bundle(bundle_id, tenant_id=principal.tenant_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail=f"bundle {bundle_id} not found")
    return _to_read(bundle)


@router.get("/bundles/{bundle_id}/export")
@audit(action="ideation.bundle.export", target_type="output_bundle")
async def export_bundle(
    bundle_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    fmt: str = Query(default="json"),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read")),
) -> Response:
    try:
        body = await output_bundle_service.export_bundle(
            bundle_id, fmt, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media_type = "application/json"
    if fmt == "zip":
        media_type = "application/zip"
    elif fmt == "tar":
        media_type = "application/x-tar"
    elif fmt == "pdf":
        media_type = "application/pdf"
    filename = f"bundle.{fmt}"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


__all__ = ["router"]
