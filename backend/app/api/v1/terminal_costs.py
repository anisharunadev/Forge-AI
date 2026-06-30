"""Cost tracking — thin proxy to LiteLLM /spend/logs.

Forge AI does NOT compute cost from token counts. LiteLLM tracks
cost as part of its spend logging (it has the latest model prices).
We just translate the response into Forge's shape.

Old behavior (REMOVED): aggregate from our own cost_tracker + runs table.
New behavior: stream from LiteLLM /spend/logs.

NOTE: The step-59 spec references ``principal.tenant.litellm_team_id`` as
the LiteLLM ``team_id`` filter. The current ``AuthenticatedPrincipal``
exposes ``tenant_id`` directly (no ``.tenant`` attribute). The recon
confirmed that each Forge tenant maps 1:1 to a LiteLLM team by ID, so we
use ``principal.tenant_id`` as the ``team_id`` for LiteLLM queries. If
this assumption is broken (e.g. one Forge tenant → many LiteLLM teams),
introduce a dedicated ``litellm_team_id`` claim on the principal.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.deps import Principal
from app.core.audit import audit
from app.services.litellm_admin import (
    get_global_spend,
    get_spend_by_team,
    list_spend_logs,
)

router = APIRouter(prefix="/costs", tags=["costs"])


# ---------------------------------------------------------------------------
# Response schemas (kept here so this router stays self-contained).
#
# We previously imported these from ``app.schemas.terminal_costs``. The
# schema module is preserved on disk for backward compatibility, but we
# re-declare the minimal shapes needed by these endpoints so the router
# has no runtime dependency on the old cost_tracker domain.
# ---------------------------------------------------------------------------


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


@router.get(
    "/sessions/{session_id}/cost",
    response_model=CostSummaryResponse,
)
@audit(action="costs.session", target_type="session")
async def get_session_cost(
    session_id: str,
    principal: Annotated[Principal, Depends()],
) -> CostSummaryResponse:
    """Cost summary for a single session.

    Source: LiteLLM ``/spend/logs`` filtered by ``team_id`` (mapped from
    ``principal.tenant_id``). We pick every log whose ``metadata.session_id``
    matches the requested session.
    """
    logs = await list_spend_logs(
        team_id=principal.tenant_id,
        limit=1000,
    )
    session_logs = [
        l
        for l in logs
        if l.get("metadata", {}).get("session_id") == session_id
    ]

    now = datetime.now(timezone.utc)
    total_cost = float(sum(l.get("spend", 0) for l in session_logs))
    breakdown: dict[str, float] = {}
    prompt_tokens = 0
    completion_tokens = 0
    for l in session_logs:
        model = l.get("model") or "unknown"
        breakdown[model] = breakdown.get(model, 0.0) + float(l.get("spend", 0))
        prompt_tokens += int(l.get("prompt_tokens", 0) or 0)
        completion_tokens += int(l.get("completion_tokens", 0) or 0)

    return CostSummaryResponse(
        session_id=session_id,
        total_cost_usd=total_cost,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        breakdown_by_model=breakdown,
        command_count=len(session_logs),
        burn_rate_usd_per_hour=0.0,
        started_at=now,
        last_activity_at=now,
        is_active=bool(session_logs),
    )


@router.get(
    "/sessions/{session_id}/cost/estimate",
    response_model=EstimateResponse,
)
@audit(action="costs.session", target_type="session")
async def estimate_session_cost(
    session_id: str,
    body: EstimateRequest,
    principal: Annotated[Principal, Depends()],
) -> EstimateResponse:
    """Backward-compatible what-if cost estimate for a session.

    NOTE: Not part of the step-59 spec. Kept so existing clients don't
    break. LiteLLM exposes ``/spend/calculate`` as a planning helper; if
    that endpoint is reachable we forward the request, otherwise we
    return ``501 Not Implemented`` with an explanation.
    """
    from app.services.litellm_admin import _request  # local import — private

    payload: dict[str, Any] = {
        "model": body.model or "gpt-4o-mini",
        "output_bytes": body.output_bytes,
        "metadata": {"session_id": session_id, "tenant_id": principal.tenant_id},
    }
    try:
        result = await _request("POST", "/spend/calculate", json=payload)
    except Exception as exc:  # pragma: no cover — depends on LiteLLM build
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "estimate_endpoint_unavailable: LiteLLM /spend/calculate "
                f"not reachable ({type(exc).__name__})"
            ),
        ) from exc

    if not isinstance(result, dict):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="estimate_endpoint_unavailable: LiteLLM returned non-dict payload",
        )

    return EstimateResponse(
        model=str(result.get("model", body.model or "gpt-4o-mini")),
        prompt_tokens=int(result.get("prompt_tokens", 0) or 0),
        completion_tokens=int(result.get("completion_tokens", 0) or 0),
        cost_usd=float(result.get("cost_usd", result.get("spend", 0)) or 0),
        output_bytes=body.output_bytes,
    )


@router.get(
    "/costs",
    response_model=list[CostSummaryResponse],
)
@audit(action="costs.list", target_type="tenant")
async def list_session_costs(
    principal: Annotated[Principal, Depends()],
    since: datetime | None = Query(default=None),
    limit: int = Query(default=500, le=1000),
) -> list[CostSummaryResponse]:
    """Cost entries for the caller's tenant, recent N days."""
    cutoff = since or (datetime.now(timezone.utc) - timedelta(days=30))
    logs = await list_spend_logs(
        team_id=principal.tenant_id,
        start_date=cutoff.isoformat(),
        limit=limit,
    )

    # Group by session_id (from metadata) so the response keeps the
    # existing ``list[CostSummaryResponse]`` shape that callers expect.
    by_session: dict[str, list[dict[str, Any]]] = {}
    for l in logs:
        sid = l.get("metadata", {}).get("session_id") or "_unscoped"
        by_session.setdefault(str(sid), []).append(l)

    out: list[CostSummaryResponse] = []
    for sid, session_logs in by_session.items():
        last_activity_raw = max(
            (l.get("startTime") for l in session_logs if l.get("startTime")),
            default=cutoff.isoformat(),
        )
        try:
            last_activity_at = datetime.fromisoformat(str(last_activity_raw).replace("Z", "+00:00"))
        except ValueError:
            last_activity_at = cutoff

        breakdown: dict[str, float] = {}
        prompt_tokens = 0
        completion_tokens = 0
        for l in session_logs:
            model = l.get("model") or "unknown"
            breakdown[model] = breakdown.get(model, 0.0) + float(l.get("spend", 0))
            prompt_tokens += int(l.get("prompt_tokens", 0) or 0)
            completion_tokens += int(l.get("completion_tokens", 0) or 0)

        out.append(
            CostSummaryResponse(
                session_id=sid,
                total_cost_usd=float(sum(l.get("spend", 0) for l in session_logs)),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                breakdown_by_model=breakdown,
                command_count=len(session_logs),
                burn_rate_usd_per_hour=0.0,
                started_at=last_activity_at,
                last_activity_at=last_activity_at,
                is_active=True,
            )
        )
    return out


@router.get(
    "/burn-rate",
    response_model=BurnRateResponse,
)
@audit(action="costs.burn_rate", target_type="tenant")
async def burn_rate(
    principal: Annotated[Principal, Depends()],
) -> BurnRateResponse:
    """Tenant-level USD/hour burn rate derived from LiteLLM /spend.

    Falls back to ``/global/spend`` if ``/spend/team/{team_id}`` is not
    supported by the configured LiteLLM build.
    """
    rate = 0.0
    try:
        team_spend = await get_spend_by_team(principal.tenant_id)
    except Exception:  # pragma: no cover — older LiteLLM builds
        team_spend = await get_global_spend()

    if isinstance(team_spend, dict):
        # LiteLLM exposes ``daily_spend``; multiply by 24 to get USD/hour.
        daily = float(team_spend.get("daily_spend", 0) or 0)
        rate = daily / 24.0 if daily else 0.0
    return BurnRateResponse(tenant_id=principal.tenant_id, burn_rate_usd_per_hour=rate)


__all__ = ["router"]
