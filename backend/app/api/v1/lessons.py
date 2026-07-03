"""F-002-LESSON — REST surface (Step-64 Sub-step B).

Endpoints are the Steward-facing review queue. All write endpoints
require the ``lessons:decide`` permission; reads require
``lessons:read``. Auto-writes (subscriber-created candidates) never
come through here — they land via the event bus.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, Principal, require_permission, get_current_principal
from app.db.models.lesson import LessonStatus
from app.services.audit_service import audit_service
from app.schemas.lesson import (
    LessonCandidateListResponse,
    LessonCandidateWire,
    LessonDecideRequest,
    LessonDecisionResult,
    MonthlyDigest,
)
from app.services.lesson_service import LessonService, _to_wire

router = APIRouter(prefix="/lessons", tags=["lessons"])


@router.get("", response_model=LessonCandidateListResponse)
async def list_lessons(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
    _perm: None = Depends(require_permission("lessons:read")),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="One of pending / approved / rejected. Omit for all.",
    ),
    limit: int = Query(default=100, ge=1, le=500),
) -> LessonCandidateListResponse:
    target_status: LessonStatus | None = None
    if status_filter is not None:
        try:
            target_status = LessonStatus(status_filter)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    svc = LessonService()
    rows = await svc.list_candidates(
        db, tenant_id=principal.tenant_id, status=target_status, limit=limit
    )
    counts = await svc.count_by_status(db, tenant_id=principal.tenant_id)
    return LessonCandidateListResponse(
        items=[_to_wire(r) for r in rows],
        total=len(rows),
        pending_count=counts["pending"],
        approved_count=counts["approved"],
        rejected_count=counts["rejected"],
    )


@router.post("/{lesson_id}/approve", response_model=LessonDecisionResult)
async def approve_lesson(
    lesson_id: UUID,
    body: LessonDecideRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
    _perm: None = Depends(require_permission("lessons:decide")),
) -> LessonDecisionResult:
    return await _decide(
        db,
        principal=principal,
        lesson_id=lesson_id,
        decision=LessonStatus.APPROVED,
        body=body,
    )


@router.post("/{lesson_id}/reject", response_model=LessonDecisionResult)
async def reject_lesson(
    lesson_id: UUID,
    body: LessonDecideRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
    _perm: None = Depends(require_permission("lessons:decide")),
) -> LessonDecisionResult:
    return await _decide(
        db,
        principal=principal,
        lesson_id=lesson_id,
        decision=LessonStatus.REJECTED,
        body=body,
    )


async def _decide(
    db: AsyncSession,
    *,
    principal: Any,
    lesson_id: UUID,
    decision: LessonStatus,
    body: LessonDecideRequest,
) -> LessonDecisionResult:
    svc = LessonService()
    try:
        result = await svc.decide(
            db,
            tenant_id=principal.tenant_id,
            candidate_id=lesson_id,
            decision=decision,
            editor_id=body.editor_id,
            review_notes=body.review_notes,
            title_override=body.title_override,
            body_override=body.body_override,
            proposed_skill_name_override=body.proposed_skill_name_override,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="lesson_not_found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await audit_service.record(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
        action=f"lessons.{decision.value}",
        target_type="lesson_candidate",
        target_id=str(lesson_id),
        payload={
            "promoted_template_id": str(result.promoted_template_id)
            if result.promoted_template_id
            else None,
            "promoted_skill_name": result.promoted_skill_name,
        },
    )
    return result


@router.get("/digest", response_model=MonthlyDigest)
async def monthly_digest(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
    _perm: None = Depends(require_permission("lessons:read")),
    period_start: datetime | None = Query(default=None),
    period_end: datetime | None = Query(default=None),
) -> MonthlyDigest:
    svc = LessonService()
    return await svc.build_monthly_digest(
        db,
        tenant_id=principal.tenant_id,
        period_start=period_start,
        period_end=period_end,
    )


__all__ = ["router"]
