"""F-504 — Steering Rules API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import Principal
from app.core.audit import audit
from app.schemas.steering_rules import (
    InjectionResult,
    SteeringCatalog,
    SteeringRuleCreate,
    SteeringRuleRead,
)
from app.services.steering_rules import steering_engine

router = APIRouter(prefix="/steering-rules", tags=["steering-rules"])


@router.get("", response_model=list[SteeringRuleRead])
@audit(action="steering_rules.list", target_type="steering_rule")
async def list_steering_rules(
    principal: Principal,
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
    principal: Principal,
) -> SteeringCatalog | None:
    """Return the in-memory catalog for the current project (if built)."""
    project_id = principal.project_id
    if not project_id:
        return None
    return steering_engine.as_catalog_model(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )


@router.post("", response_model=SteeringRuleRead, status_code=status.HTTP_201_CREATED)
@audit(action="steering_rules.create", target_type="steering_rule")
async def create_steering_rule(
    body: SteeringRuleCreate,
    principal: Principal,
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


@router.delete(
    "/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    response_class=Response,
)
    response_class=Response,
@audit(action="steering_rules.delete", target_type="steering_rule")
async def delete_steering_rule(
    rule_id: str,
    principal: Principal,
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
    principal: Principal,
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