"""NFR-044 — Workflow Budget endpoints.

* ``POST /api/v1/workflows/{workflow_id}/budget`` — declare a ceiling.
* ``GET  /api/v1/workflows/{workflow_id}/budget`` — current state.
* ``GET  /api/v1/workflows/{workflow_id}/budget/history`` — admission audit trail.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.api.deps import DbSession, Principal
from app.core.audit import audit
from app.schemas.workflow_budget import BudgetDeclareRequest, BudgetRead
from app.services.workflow_budget import workflow_budget_service

router = APIRouter(prefix="/workflows", tags=["workflows"])


def _snapshot_to_read(snapshot) -> BudgetRead:
    ceiling = float(snapshot.ceiling_usd)
    spent = float(snapshot.spent_usd)
    headroom_pct = round((snapshot.remaining_usd / ceiling) * 100, 2) if ceiling > 0 else 0.0
    return BudgetRead(
        workflow_id=snapshot.workflow_id,
        ceiling_usd=ceiling,
        spent_usd=spent,
        remaining_usd=snapshot.remaining_usd,
        status=snapshot.status,
        headroom_pct=headroom_pct,
    )


@router.post(
    "/{workflow_id}/budget",
    response_model=BudgetRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="workflow.budget.declare", target_type="workflow_budget")
async def declare_budget(
    workflow_id: UUID,
    body: BudgetDeclareRequest,
    principal: Principal,
    db: DbSession = None,  # type: ignore[assignment]
) -> BudgetRead:
    if body.workflow_id != workflow_id:
        raise HTTPException(
            status_code=400, detail="workflow_id_mismatch_with_path"
        )
    snapshot = await workflow_budget_service.declare_budget(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or workflow_id,
        workflow_id=workflow_id,
        ceiling_usd=body.ceiling_usd,
        actor_id=principal.user_id,
        metadata=body.metadata,
    )
    return _snapshot_to_read(snapshot)


@router.get("/{workflow_id}/budget", response_model=BudgetRead)
@audit(action="workflow.budget.read", target_type="workflow_budget")
async def get_budget(
    workflow_id: UUID,
    principal: Principal,
    db: DbSession = None,  # type: ignore[assignment]
) -> BudgetRead:
    snapshot = await workflow_budget_service.get_budget(workflow_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="workflow_budget_not_found")
    return _snapshot_to_read(snapshot)


@router.get("/{workflow_id}/budget/history", response_model=list[dict])
@audit(action="workflow.budget.history", target_type="workflow_budget")
async def budget_history(
    workflow_id: UUID,
    principal: Principal,
    db: DbSession = None,  # type: ignore[assignment]
) -> list[dict]:
    return await workflow_budget_service.history(workflow_id)


__all__ = ["router"]