"""step-78 F15 — `/api/forge/audit`, `/api/forge/observability/*`, `/api/forge/compliance/*`.

Thin HTTP layer over ``observability_service``. Auth: every endpoint
depends on ``Principal`` + a ``require_permission`` string. Audit events
follow the ``forge.compliance.*`` / ``forge.alerts.*`` taxonomy from
step-78 §"Cross-Cutting Concerns".

Routes per spec lines 673-686:
  GET    /forge/audit                          paginated audit query
  GET    /forge/audit/{event_id}               single audit event
  GET    /forge/health/services                per-service health
  GET    /forge/metrics/spend-drift            current drift
  GET    /forge/metrics/rate-limits            current rates
  GET    /forge/metrics/latency?window=1h      p50/p95/p99
  GET    /forge/compliance/eu-ai-act           EU AI Act report
  GET    /forge/compliance/gdpr/export         self or admin
  POST   /forge/compliance/gdpr/delete         admin only
  GET    /forge/orgs/{org_id}/alerts           current alert config
  POST   /forge/orgs/{org_id}/alerts           configure
  GET    /forge/alerts/active                  currently firing
  POST   /forge/webhooks/callback              receive LiteLLM webhooks
  POST   /forge/event-logging                  telemetry push
  GET    /forge/in-product-nudges              UI feature tips
  GET    /forge/health/extended                history + latest + backlog + license
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.schemas.observability_v2 import (
    ActiveAlert,
    AlertConfigRead,
    AuditEventRead,
    AuditPage,
    AlertConfig as AlertConfigSchema,
    ComplianceReport,
    CostRealtimeBucket,
    CostRealtimeResponse,
    GdprDeleteRequest,
    GdprDeleteResponse,
    GdprExportResponse,
    HealthServicesResponse,
    MetricsResponse,
    TenantBudgetRead,
)
from app.services.observability_service import (
    ObservabilityError,
    observability_service,
)

router = APIRouter(prefix="/forge", tags=["forge.observability"])
logger = get_logger(__name__)


def _tenant_id(principal: object) -> UUID:
    tid = getattr(principal, "tenant_id", None)
    if not tid:
        raise HTTPException(status_code=403, detail="token_missing_tenant_claim")
    return UUID(tid)


def _obs_error_to_http(exc: ObservabilityError) -> HTTPException:
    code_to_status = {
        "compliance_report_in_progress": status.HTTP_202_ACCEPTED,
    }
    return HTTPException(
        status_code=code_to_status.get(exc.code, status.HTTP_400_BAD_REQUEST),
        detail=exc.detail,
    )


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


@router.get("/audit", response_model=AuditPage)
@audit(action="forge.audit.queried", target_type="audit")
async def list_audit(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("audit:read"))],
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    event_type: str | None = Query(None),
    user_id: UUID | None = Query(None),
    agent_id: UUID | None = Query(None),
    status_: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> AuditPage:
    items, total = await observability_service.query_audit(
        db,
        tenant_id=_tenant_id(principal),
        project_id=getattr(principal, "project_id", None),
        since=since,
        until=until,
        event_type=event_type,
        user_id=user_id,
        agent_id=agent_id,
        status=status_,
        page=page,
        page_size=page_size,
    )
    return AuditPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/audit/{event_id}", response_model=AuditEventRead)
@audit(action="forge.audit.read", target_type="audit")
async def get_audit_event(
    event_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("audit:read"))],
) -> AuditEventRead:
    item = await observability_service.get_audit_event(
        db, tenant_id=_tenant_id(principal), event_id=event_id
    )
    if item is None:
        raise HTTPException(status_code=404, detail="audit_event_not_found")
    return item


# ---------------------------------------------------------------------------
# Health (per-service + extended)
# ---------------------------------------------------------------------------


@router.get("/health/services", response_model=HealthServicesResponse)
@audit(action="forge.health.served", target_type="health")
async def health_services(
    principal: Annotated[object, Depends(require_permission("health:read"))],
) -> HealthServicesResponse:
    return await observability_service.health_services()


@router.get("/health/extended", response_model=dict)
@audit(action="forge.health.extended_served", target_type="health")
async def health_extended(
    principal: Annotated[object, Depends(require_permission("health:read"))],
) -> dict:
    """Aggregate /health/{history,latest,backlog,license} from LiteLLM."""
    client = LiteLLMBaseClient()
    out: dict = {}
    for kind, method in (
        ("history", client.observability.health_history),
        ("latest", client.observability.health_latest),
        ("backlog", client.observability.health_backlog),
        ("license", client.observability.health_license),
    ):
        try:
            out[kind] = await method()
        except Exception as exc:  # noqa: BLE001
            logger.warning("observability.health_extended.partial", kind=kind, error=str(exc))
            out[kind] = {"error": str(exc)}
    return out


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


@router.get("/metrics/spend-drift", response_model=dict)
@audit(action="forge.metrics.spend_drift_served", target_type="metrics")
async def metrics_spend_drift(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("metrics:read"))],
) -> dict:
    return await observability_service.drift_status(
        db, tenant_id=_tenant_id(principal)
    )


@router.get("/metrics/rate-limits", response_model=MetricsResponse)
@audit(action="forge.metrics.rate_limits_served", target_type="metrics")
async def metrics_rate_limits(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("metrics:read"))],
    window_seconds: int = Query(60, ge=1, le=86400),
) -> MetricsResponse:
    return await observability_service.metrics(
        db, tenant_id=_tenant_id(principal), window_seconds=window_seconds
    )


@router.get("/metrics/latency", response_model=MetricsResponse)
@audit(action="forge.metrics.latency_served", target_type="metrics")
async def metrics_latency(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("metrics:read"))],
    window_seconds: int = Query(3600, ge=1, le=86400),
) -> MetricsResponse:
    metrics = await observability_service.metrics(
        db, tenant_id=_tenant_id(principal), window_seconds=window_seconds
    )
    return metrics


# ---------------------------------------------------------------------------
# Phase 6 SC-6.1 — Tenant budget snapshot
# ---------------------------------------------------------------------------


@router.get(
    "/budget/{tenant_id}",
    response_model=TenantBudgetRead,
    summary="Tenant budget snapshot (today + 30-day rolling)",
)
@audit(action="forge.budget.snapshot_served", target_type="budget")
async def get_tenant_budget(
    tenant_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("budget:read"))],
) -> TenantBudgetRead:
    """Return the tenant's current budget status (Phase 6 SC-6.1)."""
    from datetime import UTC, datetime
    from app.services.cost_ledger import cost_ledger
    from app.services.forge_budget_guard import tenant_budget_guard

    snapshot = await tenant_budget_guard.check_pre_call(
        tenant_id=tenant_id, est_cost_usd=0.0
    )
    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    today_usd = await cost_ledger.get_total_for_tenant(
        tenant_id=tenant_id,
        since=today_start,
    )
    return TenantBudgetRead(
        tenant_id=tenant_id,
        spent_30d_usd=snapshot["spent_usd"],
        ceiling_usd=snapshot["ceiling_usd"],
        pct=snapshot["pct"],
        today_usd=today_usd,
        has_activity=today_usd > 0,
    )


# ---------------------------------------------------------------------------
# Compliance — EU AI Act + GDPR
# ---------------------------------------------------------------------------


@router.get("/compliance/eu-ai-act", response_model=ComplianceReport)
@audit(action="forge.compliance.eu_ai_act_generated", target_type="compliance")
async def compliance_eu_ai_act(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("compliance:read"))],
) -> ComplianceReport:
    try:
        return await observability_service.generate_eu_ai_act_report(
            db, tenant_id=_tenant_id(principal)
        )
    except ObservabilityError as exc:
        raise _obs_error_to_http(exc) from exc


@router.get("/compliance/gdpr/export", response_model=GdprExportResponse)
@audit(action="forge.compliance.gdpr_export", target_type="compliance")
async def compliance_gdpr_export(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("compliance:read"))],
    user_id: UUID = Query(..., description="self or org-admin-target user_id"),
) -> GdprExportResponse:
    # Permission gate: self-export or org-admin. Other-user export
    # requires explicit justification which is logged at audit-time.
    requester = UUID(getattr(principal, "user_id", "")) if getattr(principal, "user_id", None) else None
    caller_role = getattr(principal, "role", None)
    if requester != user_id and caller_role not in {"org_admin", "super_admin"}:
        raise HTTPException(
            status_code=403,
            detail={"reason": "permission_denied", "required_role": "org_admin"},
        )
    return await observability_service.gdpr_export(
        db, tenant_id=_tenant_id(principal), user_id=user_id
    )


@router.post(
    "/compliance/gdpr/delete",
    response_model=GdprDeleteResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
@audit(action="forge.compliance.gdpr_delete", target_type="compliance")
async def compliance_gdpr_delete(
    payload: GdprDeleteRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("compliance:write"))],
) -> GdprDeleteResponse:
    caller_role = getattr(principal, "role", None)
    if caller_role not in {"org_admin", "super_admin"}:
        raise HTTPException(
            status_code=403,
            detail={"reason": "permission_denied", "required_role": "org_admin"},
        )
    return observability_service.gdpr_delete_kickoff(
        tenant_id=_tenant_id(principal), user_id=payload.user_id
    )


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


@router.get("/orgs/{org_id}/alerts", response_model=AlertConfigRead | None)
@audit(action="forge.alerts.config_read", target_type="alert_config")
async def get_alert_config(
    org_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("alerts:read"))],
) -> AlertConfigRead | None:
    return await observability_service.get_alert_config(
        db, tenant_id=_tenant_id(principal)
    )


@router.post("/orgs/{org_id}/alerts", response_model=AlertConfigRead)
@audit(action="forge.alerts.config_updated", target_type="alert_config")
async def upsert_alert_config(
    org_id: UUID,
    payload: AlertConfigSchema,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("alerts:write"))],
) -> AlertConfigRead:
    return await observability_service.upsert_alert_config(
        db,
        tenant_id=_tenant_id(principal),
        warn_pct=payload.warn_pct,
        exceed_pct=payload.exceed_pct,
        channels=payload.channels,
    )


@router.get("/alerts/active", response_model=list[ActiveAlert])
@audit(action="forge.alerts.active_served", target_type="alert")
async def active_alerts(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("alerts:read"))],
) -> list[ActiveAlert]:
    return await observability_service.active_alerts(
        db, tenant_id=_tenant_id(principal)
    )


# ---------------------------------------------------------------------------
# Webhook + event-logging + nudges
# ---------------------------------------------------------------------------


@router.post("/webhooks/callback", status_code=status.HTTP_204_NO_CONTENT)
@audit(action="forge.webhooks.callback_received", target_type="webhook")
async def webhook_callback(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("webhooks:write"))],
    payload: dict,
) -> None:
    """Receive LiteLLM webhooks (budget exhausted, key blocked, health changed)."""
    try:
        client = LiteLLMBaseClient()
        await client.observability.callback(payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("observability.webhook_callback.upstream_error", error=str(exc))
    return None


@router.post("/event-logging", status_code=status.HTTP_204_NO_CONTENT)
@audit(action="forge.event_logging.pushed", target_type="event")
async def event_logging(
    principal: Annotated[object, Depends(require_permission("events:write"))],
    payload: dict,
) -> None:
    try:
        client = LiteLLMBaseClient()
        await client.observability.event_logging(payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("observability.event_logging.upstream_error", error=str(exc))
    return None


@router.get("/in-product-nudges", response_model=dict)
@audit(action="forge.nudges.served", target_type="nudges")
async def in_product_nudges(
    principal: Annotated[object, Depends(require_permission("nudges:read"))],
) -> dict:
    try:
        client = LiteLLMBaseClient()
        return await client.observability.in_product_nudges()
    except Exception as exc:  # noqa: BLE001
        logger.warning("observability.nudges.upstream_error", error=str(exc))
        return {"nudges": [], "error": str(exc)}


__all__ = ["router"]