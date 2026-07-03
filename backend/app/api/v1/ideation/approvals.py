"""Approval Queue REST endpoints (F-212)."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import (
    ApprovalAssignRequest,
    ApprovalDecisionRequest,
    ApprovalDelegateRequest,
    ApprovalItemCreate,
    ApprovalItemRead,
    ApprovalQueueResponse,
)
from app.services.ideation.approval_queue import approval_queue_service

router = APIRouter(prefix="/ideation/approvals", tags=["ideation"])


def _to_read(row) -> ApprovalItemRead:
    return ApprovalItemRead(
        id=row.id,
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        idea_id=row.idea_id,
        request_type=row.request_type,
        subject_id=UUID(str(row.subject_id)) if row.subject_id else None,
        payload=dict(row.payload or {}),
        status=row.status,
        requested_by=row.requested_by,
        reviewer_id=UUID(str(row.reviewer_id)) if row.reviewer_id else None,
        decided_by=UUID(str(row.decided_by)) if row.decided_by else None,
        decided_at=row.decided_at,
        reason=row.reason,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.post("", response_model=ApprovalItemRead, status_code=status.HTTP_201_CREATED)
@audit(action="ideation.approval.enqueue", target_type="approval_item")
async def enqueue_approval(
    body: ApprovalItemCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:approval:enqueue"))
) -> ApprovalItemRead:
    try:
        row = await approval_queue_service.enqueue(
            body.idea_id,
            body.request_type,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
            subject_id=body.subject_id,
            payload=body.payload,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_read(row)


@router.get("", response_model=ApprovalQueueResponse)
@audit(action="ideation.approval.list", target_type="approval_item")
async def list_approvals(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    status_filter: str | None = Query(default=None, alias="status"),
    request_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> ApprovalQueueResponse:
    rows = await approval_queue_service.get_queue(
        tenant_id=principal.tenant_id,
        user_id=principal.user_id,
        status=status_filter,
        request_type=request_type,
        limit=limit,
    )
    items = [_to_read(r) for r in rows]
    return ApprovalQueueResponse(items=items, total=len(items))


@router.post("/{approval_id}/decide", response_model=ApprovalItemRead)
@audit(action="ideation.approval.decide", target_type="approval_item")
async def decide_approval(
    approval_id: UUID,
    body: ApprovalDecisionRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:approval:decide"))
) -> ApprovalItemRead:
    try:
        row = await approval_queue_service.decide(
            approval_id,
            body.decision,
            body.reason,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_read(row)


@router.post("/{approval_id}/assign", response_model=ApprovalItemRead)
@audit(action="ideation.approval.assign", target_type="approval_item")
async def assign_approval(
    approval_id: UUID,
    body: ApprovalAssignRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:approval:assign"))
) -> ApprovalItemRead:
    try:
        row = await approval_queue_service.assign(
            approval_id,
            body.reviewer_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_read(row)


@router.post("/{approval_id}/delegate", response_model=ApprovalItemRead)
@audit(action="ideation.approval.delegate", target_type="approval_item")
async def delegate_approval(
    approval_id: UUID,
    body: ApprovalDelegateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:approval:assign"))
) -> ApprovalItemRead:
    try:
        row = await approval_queue_service.delegate(
            approval_id,
            body.new_reviewer_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(row)


__all__ = ["router"]
