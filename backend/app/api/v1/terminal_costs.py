"""F-412 — Terminal Session Cost endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.services.terminal.cost_tracker import (
    CostSummary,
    CostTrackerHandle,
    cost_tracker,
)
from app.terminal.session_manager import session_manager

router = APIRouter(prefix="/terminal", tags=["terminal-costs"])


class CostSummaryResponse(BaseModel):
    session_id: str
    total_cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    breakdown_by_model: dict[str, float]
    command_count: int
    burn_rate_usd_per_hour: float
    started_at: datetime
    last_activity_at: datetime
    is_active: bool


class BurnRateResponse(BaseModel):
    tenant_id: str
    burn_rate_usd_per_hour: float


class EstimateRequest(BaseModel):
    output_bytes: int = Field(..., ge=0)
    model: str | None = None


class EstimateResponse(BaseModel):
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    output_bytes: int


def _to_response(summary: CostSummary) -> CostSummaryResponse:
    return CostSummaryResponse(
        session_id=summary.session_id,
        total_cost_usd=summary.total_cost_usd,
        prompt_tokens=summary.prompt_tokens,
        completion_tokens=summary.completion_tokens,
        breakdown_by_model=dict(summary.breakdown_by_model),
        command_count=summary.command_count,
        burn_rate_usd_per_hour=summary.burn_rate_usd_per_hour,
        started_at=summary.started_at,
        last_activity_at=summary.last_activity_at,
        is_active=summary.is_active,
    )


@router.get(
    "/sessions/{session_id}/cost",
    response_model=CostSummaryResponse,
)
@audit(action="terminal.cost.session", target_type="terminal_session")
async def get_session_cost(
    session_id: str,
    principal: Principal,
    _perm: Principal = require_permission("terminal:read"),
) -> CostSummaryResponse:
    """Cost summary for a single session."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        return CostSummaryResponse(
            session_id=session_id,
            total_cost_usd=0.0,
            prompt_tokens=0,
            completion_tokens=0,
            breakdown_by_model={},
            command_count=0,
            burn_rate_usd_per_hour=0.0,
            started_at=datetime.now(timezone.utc),
            last_activity_at=datetime.now(timezone.utc),
            is_active=False,
        )
    return _to_response(await cost_tracker.get_session_cost(session_id))


@router.get(
    "/costs",
    response_model=list[CostSummaryResponse],
)
@audit(action="terminal.cost.list", target_type="terminal_session")
async def list_session_costs(
    principal: Principal,
    _perm: Principal = require_permission("terminal:read"),
    since: datetime | None = None,
) -> list[CostSummaryResponse]:
    """Cost summaries for every session in the caller's tenant."""
    summaries = await cost_tracker.get_active_session_costs(principal.tenant_id)
    if since is None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    else:
        cutoff = since
    out: list[CostSummaryResponse] = []
    for s in summaries:
        if s.last_activity_at >= cutoff:
            out.append(_to_response(s))
    return out


@router.get(
    "/costs/burn-rate",
    response_model=BurnRateResponse,
)
@audit(action="terminal.cost.burn_rate", target_type="terminal_session")
async def get_burn_rate(
    principal: Principal,
    _perm: Principal = require_permission("terminal:read"),
    tenant_id: str | None = None,
) -> BurnRateResponse:
    """Current USD/hour for the tenant's terminal traffic."""
    target = tenant_id or principal.tenant_id
    if target != principal.tenant_id:
        target = principal.tenant_id
    rate = await cost_tracker.get_burn_rate(target)
    return BurnRateResponse(tenant_id=target, burn_rate_usd_per_hour=rate)


@router.post(
    "/sessions/{session_id}/cost/estimate",
    response_model=EstimateResponse,
)
@audit(action="terminal.cost.estimate", target_type="terminal_session")
async def estimate_command_cost(
    session_id: str,
    body: EstimateRequest,
    principal: Principal,
    _perm: Principal = require_permission("terminal:read"),
) -> EstimateResponse:
    """What-if cost estimate for a hypothetical command's output bytes."""
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise _not_found()
    handle = await cost_tracker.start_session_tracking(
        session_id,
        model=body.model or "gpt-4o-mini",
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or session.project_id,
    )
    est = await cost_tracker.estimate_command(
        handle,
        body.output_bytes,
        model=body.model,
    )
    return EstimateResponse(**est)


def _not_found() -> Exception:
    from fastapi import HTTPException, status as _status

    return HTTPException(status_code=_status.HTTP_404_NOT_FOUND, detail="session_not_found")


__all__ = ["router"]
