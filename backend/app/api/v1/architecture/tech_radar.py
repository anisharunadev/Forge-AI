"""Day 2 mock-removal track G — Tech Radar REST router.

Replaces the hard-coded ``MOCK_TECH_RADAR`` fixture in
``apps/forge/lib/architecture/mock-fixtures.ts`` with real DB rows.

Endpoints
---------
- ``GET  /api/v1/architecture/tech-radar`` — list blips for
  ``(tenant_id, project_id)``.
- ``POST /api/v1/architecture/tech-radar`` — add a new blip (audit +
  Idempotency-Key per Rule 6).
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.architecture import TechRadarEntry
from app.db.session import get_session_factory
from app.schemas.architecture import (
    TechRadarCreateRequest,
    TechRadarEntryResponse,
    TechRadarListResponse,
)
from app.services.architecture.tech_radar import TechRadarService

router = APIRouter(prefix="/api/v1/architecture", tags=["architecture-tech-radar"])


def _serialize(row: TechRadarEntry) -> TechRadarEntryResponse:
    return TechRadarEntryResponse(
        id=row.id,
        name=row.name,
        quadrant=row.quadrant,
        ring=row.ring,
        description=row.description,
        rationale=row.rationale,
        owner=row.owner,
        prev_ring=row.prev_ring,
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _resolve_project_id(principal: AuthenticatedPrincipal, override: UUID | None) -> UUID:
    project_id = override or principal.project_id
    if project_id is None:
        raise HTTPException(status_code=400, detail="project_id_required")
    return project_id


@router.get("/tech-radar", response_model=TechRadarListResponse)
@audit(action="architecture.tech_radar.list", target_type="tech_radar_entry")
async def list_tech_radar(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
) -> TechRadarListResponse:
    """List all blips in a (tenant, project) scope."""
    resolved_project_id = _resolve_project_id(principal, project_id)
    factory = get_session_factory()
    async with factory() as session:
        service = TechRadarService(session=session)
        rows = await service.list_entries(
            tenant_id=principal.tenant_id,
            project_id=resolved_project_id,
        )
    return TechRadarListResponse(
        items=[_serialize(r) for r in rows],
        total=len(rows),
    )


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/tech-radar", response_model=TechRadarEntryResponse, status_code=201)
@audit(action="architecture.tech_radar.create", target_type="tech_radar_entry")
async def create_tech_radar(
    req: TechRadarCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> TechRadarEntryResponse:
    project_id = _resolve_project_id(principal, req.project_id)
    factory = get_session_factory()
    async with factory() as session:
        service = TechRadarService(session=session)
        row = await service.create_entry(
            tenant_id=principal.tenant_id,
            project_id=project_id,
            name=req.name,
            quadrant=req.quadrant,
            ring=req.ring,
            description=req.description,
            rationale=req.rationale,
            owner=req.owner,
            prev_ring=req.prev_ring,
        )
        await session.commit()
        fresh = await session.get(TechRadarEntry, row.id)
    if fresh is None:  # pragma: no cover -- defensive
        raise HTTPException(status_code=500, detail="tech_radar_not_persisted")
    return _serialize(fresh)
