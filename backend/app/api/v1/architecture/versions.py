"""F-307 API router."""
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.services.architecture.versioning import ArchitectureVersioningService

router = APIRouter(prefix="/api/v1/architecture", tags=["architecture-versions"])


class VersionCreateRequest(BaseModel):
    artifact_type: str
    artifact_id: UUID
    snapshot_reason: str


class RollbackRequest(BaseModel):
    artifact_type: str
    artifact_id: UUID
    version_id: UUID


def get_versioning_service() -> ArchitectureVersioningService:
    return ArchitectureVersioningService()
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post("/versions")
async def create_version(
    req: VersionCreateRequest,
    service: ArchitectureVersioningService = Depends(get_versioning_service),
):
    return await service.create_version(req.artifact_type, req.artifact_id, req.snapshot_reason, UUID("00000000-0000-0000-0000-000000000000"))


@router.get("/versions")
async def list_versions(
    artifact_type: str = Query(...),
    artifact_id: UUID = Query(...),
    service: ArchitectureVersioningService = Depends(get_versioning_service),
):
    return await service.list_versions(artifact_type, artifact_id)


@router.get("/versions/diff")
async def diff_versions(
    version_a: UUID = Query(...),
    version_b: UUID = Query(...),
    service: ArchitectureVersioningService = Depends(get_versioning_service),
):
    return await service.diff_versions(version_a, version_b)
@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post("/versions/rollback")
async def rollback(
    req: RollbackRequest,
    service: ArchitectureVersioningService = Depends(get_versioning_service),
):
    return await service.rollback_to_version(req.artifact_type, req.artifact_id, req.version_id, UUID("00000000-0000-0000-0000-000000000000"))
