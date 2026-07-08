"""F-307 API router.

Day 1 mock-removal track E: the GET endpoint now scopes by
(tenant_id, project_id) via the principal, threads the DB session
into ``ArchitectureVersioningService``, and serializes the result via
``ArchitectureVersionResponse``. The legacy free-form dataclass
response shape is replaced; this is a breaking change to the wire
format and Track F (frontend) updates ``useArchitectureVersions``
to consume the new fields (``id``, ``tenant_id``, ``project_id``).
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.architecture import ArchitectureVersionRow
from app.db.session import get_session_factory
from app.schemas.architecture import (
    ArchitectureVersionListResponse,
    ArchitectureVersionResponse,
)
from app.services.architecture.versioning import ArchitectureVersioningService

router = APIRouter(prefix="/api/v1/architecture", tags=["architecture-versions"])


class VersionCreateRequest(BaseModel):
    artifact_type: str
    artifact_id: UUID
    snapshot_reason: str
    project_id: UUID | None = None


class RollbackRequest(BaseModel):
    artifact_type: str
    artifact_id: UUID
    version_id: UUID
    project_id: UUID | None = None


def _serialize(row: ArchitectureVersionRow) -> ArchitectureVersionResponse:
    """Materialize a DB row into the response schema."""
    return ArchitectureVersionResponse(
        id=row.id,
        artifact_type=row.artifact_type,
        artifact_id=row.artifact_id,
        version_number=row.version_number,
        content_hash=row.content_hash,
        snapshot_reason=row.snapshot_reason,
        actor_id=row.actor_id,
        created_at=row.created_at,
        tenant_id=row.tenant_id,
        project_id=row.project_id,
    )


def _resolve_project_id(principal: AuthenticatedPrincipal, override: UUID | None) -> UUID:
    project_id = override or principal.project_id
    if project_id is None:
        raise HTTPException(status_code=400, detail="project_id_required")
    return project_id


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/versions", response_model=ArchitectureVersionResponse, status_code=201)
@audit(action="architecture.version.create", target_type="architecture_version")
async def create_version(
    req: VersionCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> ArchitectureVersionResponse:
    project_id = _resolve_project_id(principal, req.project_id)
    factory = get_session_factory()
    async with factory() as session:
        service = ArchitectureVersioningService(session=session)
        created = await service.create_version(
            artifact_type=req.artifact_type,
            artifact_id=req.artifact_id,
            snapshot_reason=req.snapshot_reason,
            actor_id=principal.user_id,
            tenant_id=principal.tenant_id,
            project_id=project_id,
        )
        await session.commit()
        row = await session.get(ArchitectureVersionRow, created.version_id)
    if row is None:  # pragma: no cover — defensive
        raise HTTPException(status_code=500, detail="version_not_persisted")
    return _serialize(row)


@router.get("/versions", response_model=ArchitectureVersionListResponse)
@audit(action="architecture.version.list", target_type="architecture_version")
async def list_versions(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    artifact_type: str = Query(...),
    artifact_id: UUID = Query(...),
    project_id: UUID | None = Query(default=None),
) -> ArchitectureVersionListResponse:
    resolved_project_id = _resolve_project_id(principal, project_id)
    factory = get_session_factory()
    async with factory() as session:
        service = ArchitectureVersioningService(session=session)
        rows = await service.list_versions(
            artifact_type=artifact_type,
            artifact_id=artifact_id,
            tenant_id=principal.tenant_id,
            project_id=resolved_project_id,
        )
    return ArchitectureVersionListResponse(
        items=[_serialize(r) for r in rows],
        total=len(rows),
    )


@router.get("/versions/diff")
async def diff_versions(
    version_a: UUID = Query(...),
    version_b: UUID = Query(...),
    service: ArchitectureVersioningService = Depends(ArchitectureVersioningService),
):
    return await service.diff_versions(version_a, version_b)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/versions/rollback", response_model=ArchitectureVersionResponse)
@audit(action="architecture.version.rollback", target_type="architecture_version")
async def rollback(
    req: RollbackRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> ArchitectureVersionResponse:
    project_id = _resolve_project_id(principal, req.project_id)
    factory = get_session_factory()
    async with factory() as session:
        service = ArchitectureVersioningService(session=session)
        created = await service.rollback_to_version(
            artifact_type=req.artifact_type,
            artifact_id=req.artifact_id,
            version_id=req.version_id,
            actor_id=principal.user_id,
            tenant_id=principal.tenant_id,
            project_id=project_id,
        )
        await session.commit()
        row = await session.get(ArchitectureVersionRow, created.version_id)
    if row is None:  # pragma: no cover — defensive
        raise HTTPException(status_code=500, detail="version_not_persisted")
    return _serialize(row)
