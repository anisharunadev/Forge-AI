"""Day 2 mock-removal Track I — architecture metrics.

Replaces the previous frontend ``MOCK_DECISION_VELOCITY`` array with a
real SQL aggregation. Read-only — no audit decorator, no idempotency
key, no mutating side effects.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import get_current_principal
from app.core.security import AuthenticatedPrincipal
from app.schemas.architecture import DecisionVelocityResponse
from app.services.architecture.metrics import MetricsService

router = APIRouter(prefix="/api/v1/architecture/metrics", tags=["architecture-metrics"])


def get_metrics_service() -> MetricsService:
    return MetricsService()


@router.get(
    "/decision-velocity",
    response_model=DecisionVelocityResponse,
)
async def decision_velocity(
    response: Response,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID = Query(...),
    weeks: int = Query(
        MetricsService.DEFAULT_WEEKS,
        ge=MetricsService.WEEK_MIN,
        le=MetricsService.WEEK_MAX,
        description="Number of weekly buckets to return (1..52).",
    ),
    service: MetricsService = Depends(get_metrics_service),
) -> DecisionVelocityResponse:
    """Weekly counts of ADRs accepted in the last ``weeks`` weeks.

    Missing weeks are filled with 0 so the response always returns
    exactly ``weeks`` integers, oldest first.
    """
    # ponytail: HTTP-cache header only. Skip Redis-backed caching for
    # now; add it when this endpoint shows up in hot-path profiling.
    response.headers["Cache-Control"] = "private, max-age=300"
    buckets = await service.decision_velocity(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        weeks=weeks,
    )
    return DecisionVelocityResponse(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        weeks=weeks,
        buckets=buckets,
    )
