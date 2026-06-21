"""F-306 API router."""
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from app.services.architecture.traceability import TraceabilityService

router = APIRouter(prefix="/api/v1/architecture", tags=["architecture-traceability"])


def get_traceability_service() -> TraceabilityService:
    return TraceabilityService()


@router.get("/traceability")
async def get_traceability(
    project_id: UUID = Query(...),
    service: TraceabilityService = Depends(get_traceability_service),
):
    return await service.build_matrix(tenant_id=UUID("00000000-0000-0000-0000-000000000000"), project_id=project_id)


@router.get("/lineage/{artifact_type}/{artifact_id}")
async def get_lineage(
    artifact_type: str,
    artifact_id: UUID,
    direction: str = Query("both"),
    service: TraceabilityService = Depends(get_traceability_service),
):
    return await service.get_lineage(artifact_type, artifact_id, direction)


@router.get("/orphans")
async def get_orphans(
    project_id: UUID = Query(...),
    service: TraceabilityService = Depends(get_traceability_service),
):
    return await service.find_orphans(tenant_id=UUID("00000000-0000-0000-0000-000000000000"), project_id=project_id)


@router.get("/breaking-changes/{contract_id}")
async def get_breaking_changes(
    contract_id: UUID,
    service: TraceabilityService = Depends(get_traceability_service),
):
    return await service.find_breaking_changes(contract_id)
