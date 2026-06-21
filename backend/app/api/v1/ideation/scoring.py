"""Opportunity Scoring REST endpoints (F-204)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.ideation import (
    HumanScoreOverride,
    OpportunityScoreRead,
)
from app.services.ideation.scoring import (
    ScoreComponents,
    opportunity_scoring_service,
)

router = APIRouter(prefix="/ideation/ideas", tags=["ideation"])


def _to_read(row) -> OpportunityScoreRead:
    return OpportunityScoreRead(
        id=row.id,
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        idea_id=row.idea_id,
        value_score=row.value_score,
        feasibility_score=row.feasibility_score,
        risk_score=row.risk_score,
        reach_score=row.reach_score,
        total_score=row.total_score,
        scoring_rationale=row.scoring_rationale,
        scored_by=row.scored_by,
        scored_at=row.scored_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.post("/{idea_id}/score", response_model=OpportunityScoreRead)
@audit(action="ideation.score.generate", target_type="opportunity_score")
async def score_idea(
    idea_id: UUID,
    principal: Principal,
    strategy: str = Query(default="ai"),
    _perm: Principal = require_permission("ideation:score"),
) -> OpportunityScoreRead:
    try:
        score = await opportunity_scoring_service.score_idea(
            idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            scoring_strategy=strategy,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_read(score)


@router.post("/score/batch", response_model=list[OpportunityScoreRead])
@audit(action="ideation.score.batch", target_type="opportunity_score")
async def score_batch(
    idea_ids: list[UUID],
    principal: Principal,
    strategy: str = Query(default="ai"),
    _perm: Principal = require_permission("ideation:score"),
) -> list[OpportunityScoreRead]:
    if not idea_ids:
        raise HTTPException(status_code=400, detail="idea_ids_required")
    if len(idea_ids) > 50:
        raise HTTPException(status_code=400, detail="too_many_ideas:max=50")
    scores = await opportunity_scoring_service.score_batch(
        idea_ids,
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        strategy=strategy,
        actor_id=principal.user_id,
    )
    return [_to_read(s) for s in scores]


@router.get("/{idea_id}/score", response_model=OpportunityScoreRead | None)
@audit(action="ideation.score.get", target_type="opportunity_score")
async def get_score(
    idea_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("ideation:read"),
) -> OpportunityScoreRead | None:
    score = await opportunity_scoring_service.get_score(
        idea_id, tenant_id=principal.tenant_id
    )
    if score is None:
        return None
    return _to_read(score)


@router.post("/{idea_id}/score/override", response_model=OpportunityScoreRead)
@audit(action="ideation.score.override", target_type="opportunity_score")
async def human_override(
    idea_id: UUID,
    body: HumanScoreOverride,
    principal: Principal,
    _perm: Principal = require_permission("ideation:score:override"),
) -> OpportunityScoreRead:
    components = ScoreComponents(
        value=body.value_score,
        feasibility=body.feasibility_score,
        risk=body.risk_score,
        reach=body.reach_score,
        rationale=body.reason,
    )
    try:
        score = await opportunity_scoring_service.human_override(
            idea_id,
            components,
            body.reason,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_read(score)


__all__ = ["router"]
