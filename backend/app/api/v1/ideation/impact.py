"""Impact Graph REST endpoints (F-203)."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.ideation import ImpactComparison, ImpactGraph
from app.services.ideation.impact_graph import impact_graph_service
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/ideation/ideas", tags=["ideation"])


@router.get("/{idea_id}/impact-graph", response_model=ImpactGraph)
@audit(action="ideation.impact.build", target_type="idea")
async def build_impact_graph(
    idea_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> ImpactGraph:
    try:
        graph = await impact_graph_service.build_impact_graph(
            idea_id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ImpactGraph(
        idea_id=graph.idea_id,
        nodes=[n.to_dict() for n in graph.nodes],
        edges=[e.to_dict() for e in graph.edges],
        generated_at=graph.generated_at,
        summary=graph.summary,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/impact/compare", response_model=ImpactComparison)
@audit(action="ideation.impact.compare", target_type="idea")
async def compare_impact(
    idea_ids: list[UUID],
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> ImpactComparison:
    if not idea_ids:
        raise HTTPException(status_code=400, detail="idea_ids_required")
    if len(idea_ids) > 25:
        raise HTTPException(status_code=400, detail="too_many_ideas:max=25")
    comparison = await impact_graph_service.compare_impact(
        idea_ids, tenant_id=principal.tenant_id
    )
    return ImpactComparison(
        entries=[
            {
                "idea_id": e.idea_id,
                "affected_services": e.affected_services,
                "affected_dependencies": e.affected_dependencies,
                "recommended_tests": e.recommended_tests,
                "total_impact_score": e.total_impact_score,
            }
            for e in comparison.entries
        ],
        compared_at=comparison.compared_at,
    )


__all__ = ["router"]
