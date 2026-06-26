"""Roadmap REST endpoints (F-205)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.ideation import (
    RoadmapAddItem,
    RoadmapCreate,
    RoadmapListResponse,
    RoadmapRead,
    RoadmapRemoveItem,
    RoadmapUpdate,
)
from app.services.ideation.roadmap_generator import roadmap_generator

router = APIRouter(prefix="/ideation/roadmaps", tags=["ideation"])


def _to_read(roadmap) -> RoadmapRead:
    return RoadmapRead(
        id=roadmap.id,
        tenant_id=roadmap.tenant_id,
        project_id=roadmap.project_id,
        name=roadmap.name,
        horizon=roadmap.horizon,
        theme=roadmap.theme,
        status=roadmap.status,
        items=list(roadmap.items or []),
        generated_by=roadmap.generated_by,
        approved_by=roadmap.approved_by,
        created_at=roadmap.created_at,
        updated_at=roadmap.updated_at,
    )


@router.post("", response_model=RoadmapRead, status_code=status.HTTP_201_CREATED)
@audit(action="ideation.roadmap.generate", target_type="roadmap")
async def generate_roadmap(
    body: RoadmapCreate,
    principal: Principal,
    _perm: Principal = require_permission("ideation:roadmap"),
) -> RoadmapRead:
    try:
        roadmap = await roadmap_generator.generate_roadmap(
            body.project_id,
            tenant_id=principal.tenant_id,
            horizon=body.horizon.value if hasattr(body.horizon, "value") else str(body.horizon),
            top_n=body.top_n,
            name=body.name,
            theme=body.theme,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(roadmap)


@router.get("", response_model=RoadmapListResponse)
@audit(action="ideation.roadmap.list", target_type="roadmap")
async def list_roadmaps(
    principal: Principal,
    project_id: UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _perm: Principal = require_permission("ideation:read"),
) -> RoadmapListResponse:
    rows = await roadmap_generator.list_roadmaps(
        tenant_id=principal.tenant_id,
        project_id=project_id or principal.project_id,
        limit=limit,
    )
    items = [_to_read(r) for r in rows]
    return RoadmapListResponse(items=items, total=len(items))


@router.get("/{roadmap_id}", response_model=RoadmapRead)
@audit(action="ideation.roadmap.get", target_type="roadmap")
async def get_roadmap(
    roadmap_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("ideation:read"),
) -> RoadmapRead:
    try:
        roadmap = await roadmap_generator.get_roadmap(
            roadmap_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(roadmap)


@router.patch("/{roadmap_id}", response_model=RoadmapRead)
@audit(action="ideation.roadmap.update", target_type="roadmap")
async def update_roadmap(
    roadmap_id: UUID,
    body: RoadmapUpdate,
    principal: Principal,
    _perm: Principal = require_permission("ideation:roadmap"),
) -> RoadmapRead:
    try:
        roadmap = await roadmap_generator.update_roadmap(
            roadmap_id,
            tenant_id=principal.tenant_id,
            name=body.name,
            theme=body.theme,
            items=[item.model_dump() for item in body.items] if body.items else None,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(roadmap)


@router.post("/{roadmap_id}/approve", response_model=RoadmapRead)
@audit(action="ideation.roadmap.approve", target_type="roadmap")
async def approve_roadmap(
    roadmap_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("ideation:roadmap:approve"),
) -> RoadmapRead:
    try:
        roadmap = await roadmap_generator.approve_roadmap(
            roadmap_id,
            actor_id=principal.user_id,
            tenant_id=principal.tenant_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(roadmap)


@router.post("/{roadmap_id}/regenerate", response_model=RoadmapRead)
@audit(action="ideation.roadmap.regenerate", target_type="roadmap")
async def regenerate_roadmap(
    roadmap_id: UUID,
    principal: Principal,
    top_n: int | None = Query(default=None, ge=1, le=100),
    _perm: Principal = require_permission("ideation:roadmap"),
) -> RoadmapRead:
    try:
        roadmap = await roadmap_generator.regenerate_roadmap(
            roadmap_id,
            tenant_id=principal.tenant_id,
            top_n=top_n,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(roadmap)


@router.post("/{roadmap_id}/items", response_model=RoadmapRead)
@audit(action="ideation.roadmap.add_item", target_type="roadmap")
async def add_to_roadmap(
    roadmap_id: UUID,
    body: RoadmapAddItem,
    principal: Principal,
    _perm: Principal = require_permission("ideation:roadmap"),
) -> RoadmapRead:
    try:
        roadmap = await roadmap_generator.add_to_roadmap(
            roadmap_id,
            body.idea_id,
            body.position,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
            note=body.note,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(roadmap)


@router.delete(
    "/{roadmap_id}/items/{idea_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    response_class=Response,
)
@audit(action="ideation.roadmap.remove_item", target_type="roadmap")
@audit(action="ideation.roadmap.remove_item", target_type="roadmap")
async def remove_from_roadmap(
    roadmap_id: UUID,
    idea_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("ideation:roadmap"),
):
    try:
        roadmap = await roadmap_generator.remove_from_roadmap(
            roadmap_id,
            idea_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(roadmap)


__all__ = ["router"]
