"""Push to Delivery REST endpoints (F-213)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.ideation import (
    PushAllRequest,
    PushHistoryResponse,
    PushRecordRead,
    PushResult,
    PushToConfluenceRequest,
    PushToJiraRequest,
)
from app.services.ideation.push_to_delivery import push_to_delivery_service

router = APIRouter(prefix="/ideation/ideas", tags=["ideation"])


def _push_to_read(record) -> PushRecordRead:
    return PushRecordRead(
        id=record.id,
        tenant_id=record.tenant_id,
        project_id=record.project_id,
        idea_id=record.idea_id,
        target=record.target,
        external_ref=record.external_ref,
        config=dict(record.config or {}),
        status=record.status,
        actor_id=record.actor_id,
        error=record.error,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.post("/{idea_id}/push/jira", response_model=PushResult)
@audit(action="ideation.push.jira", target_type="idea")
async def push_to_jira(
    idea_id: UUID,
    body: PushToJiraRequest,
    principal: Principal,
    _perm: Principal = require_permission("ideation:push"),
) -> PushResult:
    try:
        result = await push_to_delivery_service.push_to_jira(
            idea_id,
            body.project_key,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PushResult(
        target=result.target,
        success=result.success,
        external_ref=result.external_ref,
        error=result.error,
        record_id=result.record_id,
    )


@router.post("/{idea_id}/push/confluence", response_model=PushResult)
@audit(action="ideation.push.confluence", target_type="idea")
async def push_to_confluence(
    idea_id: UUID,
    body: PushToConfluenceRequest,
    principal: Principal,
    _perm: Principal = require_permission("ideation:push"),
) -> PushResult:
    try:
        result = await push_to_delivery_service.push_to_confluence(
            idea_id,
            body.space_key,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PushResult(
        target=result.target,
        success=result.success,
        external_ref=result.external_ref,
        error=result.error,
        record_id=result.record_id,
    )


@router.post("/{idea_id}/push/architecture", response_model=PushResult)
@audit(action="ideation.push.architecture", target_type="idea")
async def push_to_architecture(
    idea_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("ideation:push"),
) -> PushResult:
    try:
        result = await push_to_delivery_service.push_to_architecture(
            idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PushResult(
        target=result.target,
        success=result.success,
        external_ref=result.external_ref,
        error=result.error,
        record_id=result.record_id,
    )


@router.post("/{idea_id}/push/all", response_model=list[PushResult])
@audit(action="ideation.push.all", target_type="idea")
async def push_all(
    idea_id: UUID,
    body: PushAllRequest,
    principal: Principal,
    _perm: Principal = require_permission("ideation:push"),
) -> list[PushResult]:
    try:
        results = await push_to_delivery_service.push_all(
            idea_id,
            config={
                "jira_project": body.jira_project,
                "confluence_space": body.confluence_space,
                "architecture": body.architecture,
            },
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [
        PushResult(
            target=r.target,
            success=r.success,
            external_ref=r.external_ref,
            error=r.error,
            record_id=r.record_id,
        )
        for r in results
    ]


@router.get("/{idea_id}/push/history", response_model=PushHistoryResponse)
@audit(action="ideation.push.history", target_type="idea")
async def push_history(
    idea_id: UUID,
    principal: Principal,
    limit: int = Query(default=50, ge=1, le=500),
    _perm: Principal = require_permission("ideation:read"),
) -> PushHistoryResponse:
    try:
        rows = await push_to_delivery_service.push_history(
            idea_id, tenant_id=principal.tenant_id, limit=limit
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    items = [_push_to_read(r) for r in rows]
    return PushHistoryResponse(items=items, total=len(items))


__all__ = ["router"]
