"""F15 — Audit / Health / Compliance / Alerts / Drift / Rate-Limits / GDPR schemas.

Pydantic v2 typed artifacts for the Phase 3 Feature 15 surface. Every
output schema the spec mandates (lines 581-698 of step-78) lives here
so ``app.api.v1.forge_observability`` can return typed responses and
the OpenAPI doc carries concrete shapes.

Spec mapping:
  - AuditEventRead / AuditQueryParams / AuditPage     (audit log)
  - ForgeHealthDetail / HealthServicesResponse         (health dashboard)
  - ComplianceReport / GdprExportResponse /
    GdprDeleteRequest / GdprDeleteResponse             (EU AI Act + GDPR)
  - AlertConfig / AlertConfigRead / ActiveAlert        (cost alerts)
  - MetricsResponse                                   (drift / rate-limits)
  - ErrorEnvelope extensions                          (typed errors)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.common import ForgeBaseModel, Page

# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


class AuditEventRead(ForgeBaseModel):
    """One audit row, projected to the spec's wire shape.

    `payload_summary` is a JSON-pointer-ish preview of `payload`; we
    keep the full `payload` in DB but only emit a digest over the wire
    unless the caller asks for it explicitly.
    """

    event_id: UUID
    ts: datetime
    tenant_id: UUID
    team_id: UUID | None = None
    user_id: UUID | None = None
    agent_id: UUID | None = None
    run_id: UUID | None = None
    event_type: str
    payload_summary: dict[str, Any] = Field(default_factory=dict)
    status: str
    duration_ms: int
    ip: str | None = None
    user_agent: str | None = None
    hash_chain_ref: str | None = None


class AuditQueryParams(ForgeBaseModel):
    """Query params for /api/forge/audit.

    Mirrors ``app.schemas.audit.AuditQueryParams`` (F-005) but adds
    the new fields the F15 spec requires (``event_type`` vs.
    ``action``, ``user_id``/``agent_id`` projection, page/page_size).
    """

    since: datetime | None = None
    until: datetime | None = None
    event_type: str | None = None
    user_id: UUID | None = None
    agent_id: UUID | None = None
    status: str | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=500)


AuditPage = Page[AuditEventRead]


# ---------------------------------------------------------------------------
# Health dashboard
# ---------------------------------------------------------------------------


class ForgeHealthDetail(ForgeBaseModel):
    """The ``forge`` sub-object on ``/api/forge/health`` (spec line 610)."""

    uptime: float = Field(description="Process uptime in seconds since boot")
    version: str = Field(description="Forge Backend version")
    cache_hit_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    error_rate_5m: float = Field(default=0.0, ge=0.0)
    error_rate_1h: float = Field(default=0.0, ge=0.0)
    error_rate_24h: float = Field(default=0.0, ge=0.0)
    p50_chat_latency_ms: float = Field(default=0.0, ge=0.0)
    p95_chat_latency_ms: float = Field(default=0.0, ge=0.0)
    p99_chat_latency_ms: float = Field(default=0.0, ge=0.0)


class HealthServicesResponse(ForgeBaseModel):
    """Per-service health check result."""

    db: str = Field(description="`ok` | `degraded` | `down`")
    cache: str = Field(description="`ok` | `degraded` | `down`")
    providers: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Phase 6 SC-6.1 — Tenant budget snapshot
# ---------------------------------------------------------------------------


class TenantBudgetRead(ForgeBaseModel):
    """Output of GET /forge/observability/budget/{tenant_id}."""

    tenant_id: UUID
    spent_30d_usd: float = 0.0
    ceiling_usd: float = 0.0
    pct: float = 0.0
    today_usd: float = 0.0
    has_activity: bool = False


class CostRealtimeBucket(ForgeBaseModel):
    """One minute-bucket in the 60-bucket last-hour sparkline."""

    bucket_ts: datetime
    cost_usd: float = 0.0


class CostRealtimeResponse(ForgeBaseModel):
    """Output of GET /forge/observability/cost/realtime (Phase 6 SC-6.6)."""

    tenant_id: UUID
    today_usd: float = 0.0
    last_minute_usd: float = 0.0
    budget_remaining_usd: float = 0.0
    top_models: list[dict[str, Any]] = Field(default_factory=list)
    last_hour_sparkline: list[CostRealtimeBucket] = Field(default_factory=list)
    has_activity: bool = False

    @model_validator(mode="after")
    def _set_has_activity(self) -> CostRealtimeResponse:
        object.__setattr__(self, "has_activity", self.today_usd > 0)
        return self


# ---------------------------------------------------------------------------
# Compliance — EU AI Act + GDPR
# ---------------------------------------------------------------------------


class ComplianceReport(ForgeBaseModel):
    """Output of /api/forge/compliance/eu-ai-act (spec line 618)."""

    report_id: UUID
    generated_at: datetime
    tenant_id: UUID
    sections: dict[str, Any]
    pdf_url: str | None = None
    json_url: str | None = None


class GdprExportResponse(ForgeBaseModel):
    """GDPR Article 20 export envelope (spec line 623)."""

    profile: dict[str, Any] = Field(default_factory=dict)
    audit_events: list[dict[str, Any]] = Field(default_factory=list)
    spend_records: list[dict[str, Any]] = Field(default_factory=list)
    agent_configs: list[dict[str, Any]] = Field(default_factory=list)
    rag_queries: list[dict[str, Any]] = Field(default_factory=list)


class GdprDeleteRequest(ForgeBaseModel):
    """GDPR Article 17 deletion request (spec line 624)."""

    user_id: UUID
    justification: str | None = None


class GdprDeleteResponse(ForgeBaseModel):
    """GDPR delete kickoff response.

    Audit logs are NOT touched (legal retention) — that's a property
    the service must enforce, not the schema.
    """

    user_id: UUID
    eta: datetime = Field(description="Expected completion timestamp (UTC)")
    job_id: UUID
    affected_tables: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------


class AlertConfig(ForgeBaseModel):
    """Per-tenant alert thresholds (spec line 632)."""

    tenant_id: UUID
    warn_pct: int = Field(default=80, ge=0, le=100)
    exceed_pct: int = Field(default=95, ge=0, le=100)
    channels: list[Literal["email", "slack"]] = Field(default_factory=lambda: ["email"])


class AlertConfigRead(AlertConfig):
    """Persisted alert config with timestamps."""

    id: UUID
    created_at: datetime
    updated_at: datetime


class ActiveAlert(ForgeBaseModel):
    """An alert currently firing for a tenant."""

    id: UUID
    kind: Literal[
        "budget_warning",
        "budget_exceeded",
        "spend_drift",
        "model_unavailable",
        "rate_limit_warning",
        "rate_limit_exceeded",
    ]
    tenant_id: UUID
    message: str
    fired_at: datetime
    resolved_at: datetime | None = None


# ---------------------------------------------------------------------------
# Metrics (drift / rate-limits / latency)
# ---------------------------------------------------------------------------


class MetricsResponse(ForgeBaseModel):
    """Aggregate metrics for /api/forge/metrics/* (spec lines 678-680)."""

    spend_drift: float = Field(default=0.0, description="Forge DB cost vs LiteLLM spend diff %")
    rate_limits: dict[str, Any] = Field(
        default_factory=dict,
        description="Per-tenant current call rate + limit (count, window_seconds, limit)",
    )
    latency: dict[str, float] = Field(
        default_factory=dict,
        description="Per-window p50/p95/p99 chat latency (ms)",
    )


# ---------------------------------------------------------------------------
# Error envelope extensions
# ---------------------------------------------------------------------------


class ComplianceReportInProgress(ForgeBaseModel):
    """202 envelope while a compliance report is being generated."""

    report_id: UUID
    status: Literal["queued", "generating"] = "generating"
    eta_seconds: int = 30


class GDPRDeleteInProgress(ForgeBaseModel):
    """202 envelope while a GDPR delete is running."""

    job_id: UUID
    user_id: UUID
    eta: datetime


class PermissionDenied(ForgeBaseModel):
    """403 envelope for F15 permission gates.

    Currently used for "you may not export another user's GDPR data
    without org-admin role".
    """

    reason: str
    required_role: str | None = None


__all__ = [
    "ActiveAlert",
    "AlertConfig",
    "AlertConfigRead",
    "AuditEventRead",
    "AuditPage",
    "AuditQueryParams",
    "ComplianceReport",
    "ComplianceReportInProgress",
    "ForgeHealthDetail",
    "GDPRDeleteInProgress",
    "GdprDeleteRequest",
    "GdprDeleteResponse",
    "GdprExportResponse",
    "HealthServicesResponse",
    "MetricsResponse",
    "PermissionDenied",
]
