"""F-504 — Steering Rules API."""

from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import Principal, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.steering_rules import (
    InjectionResult,
    SteeringCatalog,
    SteeringRuleCreate,
    SteeringRuleRead,
)
from app.services.steering_rules import steering_engine
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/steering-rules", tags=["steering-rules"])


@router.get("", response_model=list[SteeringRuleRead])
@audit(action="steering_rules.list", target_type="steering_rule")
async def list_steering_rules(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> list[SteeringRuleRead]:
    """List steering rules for the current project (RLS-scoped)."""
    project_id = principal.project_id
    if not project_id:
        return []
    return await steering_engine.list_rules(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )


@router.get("/catalog", response_model=SteeringCatalog | None)
@audit(action="steering_rules.catalog", target_type="steering_rule")
async def get_catalog(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> SteeringCatalog | None:
    """Return the in-memory catalog for the current project (if built)."""
    project_id = principal.project_id
    if not project_id:
        return None
    return steering_engine.as_catalog_model(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("", response_model=SteeringRuleRead, status_code=status.HTTP_201_CREATED)
@audit(action="steering_rules.create", target_type="steering_rule")
async def create_steering_rule(
    body: SteeringRuleCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> SteeringRuleRead:
    """Add (or upsert) a steering rule file for the current project."""
    project_id = body.project_id or principal.project_id
    if not project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_id required (none in principal and none in body)",
        )
    return await steering_engine.add_rule(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        body=body,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.delete(
    "/{rule_id}",
    response_model=None,
    response_class=Response,
)
@audit(action="steering_rules.delete", target_type="steering_rule")
async def delete_steering_rule(
    rule_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> None:
    """Remove a steering rule by DB id or rule_id slug."""
    project_id = principal.project_id
    if not project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_id required",
        )
    removed = await steering_engine.delete_rule(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        rule_id=rule_id,
    )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"steering rule {rule_id!r} not found",
        )


@router.get("/inject/{stage}", response_model=InjectionResult)
@audit(action="steering_rules.inject", target_type="steering_rule")
async def inject_for_stage(
    stage: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> InjectionResult:
    """Return the rule markdown content to inject before ``stage``.

    ``stage`` is one of ``pre_plan | pre_code | pre_commit |
    pre_deploy | pre_review``.
    """
    project_id = principal.project_id
    if not project_id:
        return InjectionResult(rules_by_stage={})
    by_stage = steering_engine.inject_into_context(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        stage=stage,
    )
    return InjectionResult(
        rules_by_stage=by_stage,
    )


__all__ = ["router"]