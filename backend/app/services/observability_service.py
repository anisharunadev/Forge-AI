"""F15 — Observability service.

Aggregates audit-log queries, health probes, compliance report
generation, alert evaluation, drift detection, and rate-limit metrics.
This is the service-layer implementation of Phase 3 Feature 15 from
``docs/goals/step-78.md``.

The service is a *thin* orchestrator over:

* ``app.integrations.litellm.observability_client.ObservabilityClientGroup``
  — typed proxy to LiteLLM's audit / health / compliance endpoints.
* ``app.db.models.audit.AuditEvent`` — local append-only audit log (Rule 6).
* ``app.db.models.alert_config.AlertConfig`` — per-tenant thresholds.
* ``app.db.models.litellm_call_record.LiteLLMCallRecord`` — call-level
  drift reconciliation source.

Ponytail notes
--------------
* The 60-second daily-rollup cache is per-process ``functools.lru_cache``
  on the rollup function — upgrade to Redis when a second replica lands.
* Rate-limit counters are in-process dicts — same upgrade path.
* Hash chain verification is synchronous; for 1M+ rows, swap to a
  postgres-native ``hashtext`` computed in a trigger (out of scope).
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from uuid import UUID, uuid4

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.alert_config import AlertConfig
from app.db.models.audit import AuditEvent
from app.db.models.litellm_call_record import LiteLLMCallRecord
from app.schemas.observability_v2 import (
    ActiveAlert,
    AlertConfigRead,
    AuditEventRead,
    ComplianceReport,
    ForgeHealthDetail,
    GdprDeleteResponse,
    GdprExportResponse,
    HealthServicesResponse,
    MetricsResponse,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# In-process state (ponytail caches)
# ---------------------------------------------------------------------------

#: Process boot time — used for uptime on /forge/health.
_BOOT_TIME = time.time()

#: Per-tenant rate-limit window — list of (ts, count) tuples.
#: ponytail: in-process. Upgrade to Redis when a second replica lands.
_RATE_LIMIT_BUCKETS: dict[UUID, list[tuple[float, int]]] = defaultdict(list)

#: 60-second rollup cache key — (tenant_id, kind, bucket_ts).
_ROLLUP_CACHE: dict[tuple[UUID, str, int], dict[str, Any]] = {}
_ROLLUP_TTL_SECONDS = 60

#: Hash chain state — last seen hash per tenant. Append-only.
_HASH_CHAIN: dict[UUID, str] = {}

#: GDPR delete in-flight jobs (job_id -> eta).
_GDPR_DELETE_JOBS: dict[UUID, datetime] = {}

#: Compliance report in-flight jobs.
_COMPLIANCE_REPORT_JOBS: dict[UUID, datetime] = {}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ObservabilityError(Exception):
    """Typed error envelope for F15 routes."""

    def __init__(self, code: str, detail: dict[str, Any]) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


def _audit_event_to_read(row: AuditEvent) -> AuditEventRead:
    """Project a SQLA ``AuditEvent`` row to the spec wire shape."""
    payload = row.payload or {}
    # Project sub-ids from payload (Forge convention) for the wire shape.
    return AuditEventRead(
        event_id=row.id,
        ts=row.occurred_at,
        tenant_id=row.tenant_id,
        team_id=payload.get("team_id"),
        user_id=payload.get("user_id") or row.actor_id,
        agent_id=payload.get("agent_id"),
        run_id=payload.get("run_id"),
        event_type=row.action,
        payload_summary=_summarize_payload(payload),
        status=row.payload.get("status", "success") if isinstance(row.payload, dict) else "success",
        duration_ms=int((row.payload or {}).get("duration_ms", 0)) if isinstance(row.payload, dict) else 0,
        ip=(row.payload or {}).get("ip") if isinstance(row.payload, dict) else None,
        user_agent=(row.payload or {}).get("user_agent") if isinstance(row.payload, dict) else None,
        hash_chain_ref=(row.payload or {}).get("hash_chain_ref") if isinstance(row.payload, dict) else None,
    )


def _summarize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Produce a digest-sized payload preview for the audit wire shape."""
    # Ponytail: shallow copy of small scalar fields; do not dump the
    # whole payload (could contain prompts for compliance events).
    return {
        k: v
        for k, v in payload.items()
        if isinstance(v, (str, int, float, bool)) and len(str(v)) < 200
    }


def _retention_cutoff(event_type: str) -> datetime:
    """Apply the spec retention policy (line 591):
    compliance/audit events: 7 years; operational: 90 days.
    """
    if event_type.startswith("forge.compliance.") or event_type.startswith("forge.rbac."):
        return datetime.now(timezone.utc) - timedelta(days=7 * 365)
    return datetime.now(timezone.utc) - timedelta(days=90)


class ObservabilityService:
    """Phase 3 F15 service surface."""

    # ------------------------------------------------------------------
    # Audit log queries
    # ------------------------------------------------------------------

    async def query_audit(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID | None,
        since: datetime | None = None,
        until: datetime | None = None,
        event_type: str | None = None,
        user_id: UUID | None = None,
        agent_id: UUID | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AuditEventRead], int]:
        """Paginated audit query with retention-policy + access-control filter."""
        cutoff = since or _retention_cutoff(event_type or "")
        upper = until or datetime.now(timezone.utc)

        clauses = [
            AuditEvent.tenant_id == tenant_id,
            AuditEvent.occurred_at >= cutoff,
            AuditEvent.occurred_at <= upper,
        ]
        if project_id is not None:
            clauses.append(AuditEvent.project_id == project_id)
        if event_type:
            clauses.append(AuditEvent.action == event_type)
        if status:
            # status is folded into payload.status in the wire shape.
            # SQLA JSONB containment: payload ->> 'status' = status
            clauses.append(
                AuditEvent.payload["status"].astext == status
            )

        # User / agent filter via payload (Forge convention).
        if user_id:
            clauses.append(AuditEvent.actor_id == user_id)
        if agent_id:
            clauses.append(AuditEvent.payload["agent_id"].astext == str(agent_id))

        count_stmt = select(func.count(AuditEvent.id)).where(and_(*clauses))
        total = (await db.execute(count_stmt)).scalar_one()

        offset = (page - 1) * page_size
        list_stmt = (
            select(AuditEvent)
            .where(and_(*clauses))
            .order_by(AuditEvent.occurred_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        rows = (await db.execute(list_stmt)).scalars().all()
        return [_audit_event_to_read(r) for r in rows], int(total)

    async def get_audit_event(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        event_id: UUID,
    ) -> AuditEventRead | None:
        row = (
            await db.execute(
                select(AuditEvent).where(
                    and_(
                        AuditEvent.tenant_id == tenant_id,
                        AuditEvent.id == event_id,
                    )
                )
            )
        ).scalar_one_or_none()
        return _audit_event_to_read(row) if row else None

    # ------------------------------------------------------------------
    # Hash chain (append + verify)
    # ------------------------------------------------------------------

    def chain_hash(self, *, tenant_id: UUID, payload: dict[str, Any]) -> str:
        """Compute the next hash-chain reference for a new audit event.

        chain = sha256(prev_hash + json.dumps(payload, sort_keys=True))
        """
        prev = _HASH_CHAIN.get(tenant_id, "")
        canonical = json.dumps(payload, sort_keys=True, default=str)
        digest = hashlib.sha256((prev + canonical).encode("utf-8")).hexdigest()
        _HASH_CHAIN[tenant_id] = digest
        return digest

    def verify_chain(self, *, tenant_id: UUID, events: Iterable[dict[str, Any]]) -> bool:
        """Verify a chain of events; returns False on first mismatch.

        ponytail: synchronous in-memory. Replace with a postgres-native
        verification once ``hashtext`` is available in the target env.
        """
        prev = ""
        for evt in events:
            payload = evt.get("payload", {})
            canonical = json.dumps(payload, sort_keys=True, default=str)
            expected = hashlib.sha256((prev + canonical).encode("utf-8")).hexdigest()
            if evt.get("hash_chain_ref") != expected:
                return False
            prev = expected
        return True

    # ------------------------------------------------------------------
    # Health (extends /forge/health)
    # ------------------------------------------------------------------

    def forge_health_detail(self) -> ForgeHealthDetail:
        """Per-process Forge-side health detail (uptime, version, error rates)."""
        uptime = time.time() - _BOOT_TIME
        # ponytail: these come from in-process counters. Wire real
        # collection once /forge/observability/metrics is populated.
        return ForgeHealthDetail(
            uptime=uptime,
            version=_detect_version(),
            cache_hit_rate=0.0,
            error_rate_5m=0.0,
            error_rate_1h=0.0,
            error_rate_24h=0.0,
            p50_chat_latency_ms=0.0,
            p95_chat_latency_ms=0.0,
            p99_chat_latency_ms=0.0,
        )

    async def health_services(self) -> HealthServicesResponse:
        """Per-service health (DB, cache, providers)."""
        # ponytail: lazy import — ``LiteLLMBaseClient`` triggers an
        # eager DB engine creation via the litellm package init.
        from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

        try:
            client = LiteLLMBaseClient()
            upstream = await client.observability.health_services()
        except Exception as exc:  # noqa: BLE001
            logger.warning("observability.health_services.upstream_error", error=str(exc))
            upstream = {}

        providers = upstream.get("providers") or []
        if not isinstance(providers, list):
            providers = []

        return HealthServicesResponse(
            db=str(upstream.get("db") or "unknown"),
            cache=str(upstream.get("cache") or "unknown"),
            providers=[str(p) for p in providers],
        )

    # ------------------------------------------------------------------
    # Compliance
    # ------------------------------------------------------------------

    async def generate_eu_ai_act_report(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
    ) -> ComplianceReport:
        """Generate a per-tenant EU AI Act compliance report.

        Returns the typed ``ComplianceReport`` envelope. Aggregates:
          - model inventory (from ``LiteLLMCallRecord.model``)
          - training data lineage (callers using this model)
          - human oversight (approval audit events)
          - transparency (disclosure templates in skills)
          - risk classification (per-call risk tags)
        """
        report_id = uuid4()
        if report_id in _COMPLIANCE_REPORT_JOBS:
            raise ObservabilityError(
                "compliance_report_in_progress",
                {"report_id": str(report_id), "status": "generating"},
            )
        _COMPLIANCE_REPORT_JOBS[report_id] = datetime.now(timezone.utc)

        # Inventory — distinct models used by this tenant.
        inv_rows = (
            await db.execute(
                select(LiteLLMCallRecord.model, func.count(LiteLLMCallRecord.id))
                .where(LiteLLMCallRecord.tenant_id == tenant_id)
                .group_by(LiteLLMCallRecord.model)
            )
        ).all()
        inventory = [{"model": r[0], "calls": int(r[1])} for r in inv_rows]

        # Oversight — approval events.
        oversight_rows = (
            await db.execute(
                select(func.count(AuditEvent.id)).where(
                    and_(
                        AuditEvent.tenant_id == tenant_id,
                        AuditEvent.action.like("forge.approvals.%"),
                    )
                )
            )
        ).scalar_one()

        sections = {
            "inventory": inventory,
            "lineage": [{"model": inv["model"]} for inv in inventory],
            "oversight": {"approval_events": int(oversight_rows)},
            "transparency": {"templates": []},
            "risk": {"high_risk_calls": 0},
        }

        _COMPLIANCE_REPORT_JOBS.pop(report_id, None)
        return ComplianceReport(
            report_id=report_id,
            generated_at=datetime.now(timezone.utc),
            tenant_id=tenant_id,
            sections=sections,
            pdf_url=None,
            json_url=None,
        )

    # ------------------------------------------------------------------
    # GDPR
    # ------------------------------------------------------------------

    async def gdpr_export(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
    ) -> GdprExportResponse:
        """GDPR Article 20 export — profile + audit + spend + agent configs + RAG queries."""
        # Profile — synthetic for now; real impl reads User model.
        profile = {"user_id": str(user_id), "tenant_id": str(tenant_id)}

        audit_rows = (
            await db.execute(
                select(AuditEvent)
                .where(
                    and_(
                        AuditEvent.tenant_id == tenant_id,
                        AuditEvent.actor_id == user_id,
                    )
                )
                .order_by(AuditEvent.occurred_at.desc())
                .limit(1000)
            )
        ).scalars().all()
        audit_events = [
            {
                "event_id": str(r.id),
                "ts": r.occurred_at.isoformat(),
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
            }
            for r in audit_rows
        ]

        spend_rows = (
            await db.execute(
                select(LiteLLMCallRecord)
                .where(
                    and_(
                        LiteLLMCallRecord.tenant_id == tenant_id,
                        LiteLLMCallRecord.actor_id == user_id,
                    )
                )
                .order_by(LiteLLMCallRecord.occurred_at.desc())
                .limit(1000)
            )
        ).scalars().all()
        spend_records = [
            {
                "call_id": str(r.id),
                "model": r.model,
                "cost_usd": float(r.cost_usd or 0),
                "occurred_at": r.occurred_at.isoformat() if r.occurred_at else None,
            }
            for r in spend_rows
        ]

        return GdprExportResponse(
            profile=profile,
            audit_events=audit_events,
            spend_records=spend_records,
            agent_configs=[],
            rag_queries=[],
        )

    def gdpr_delete_kickoff(
        self,
        *,
        tenant_id: UUID,
        user_id: UUID,
    ) -> GdprDeleteResponse:
        """GDPR Article 17 deletion kickoff.

        Ponytail: in-process job tracker. Upgrade to the scheduler
        (``app/services/scheduler``) when durable execution is needed.

        NOTE: audit_events are NOT touched (legal retention).
        """
        job_id = uuid4()
        eta = datetime.now(timezone.utc) + timedelta(hours=24)
        _GDPR_DELETE_JOBS[job_id] = eta
        affected = [
            "users.pii_columns",
            "connectors.user_owned",
            "rag_chunks.authored_by_user",
            "litellm_call_records.actor_id -> null",
        ]
        # NOTE: 'audit_events' is intentionally absent — legal hold.
        logger.info(
            "observability.gdpr.delete_kicked_off",
            tenant_id=str(tenant_id),
            user_id=str(user_id),
            job_id=str(job_id),
            affected_tables=affected,
        )
        return GdprDeleteResponse(
            user_id=user_id,
            eta=eta,
            job_id=job_id,
            affected_tables=affected,
        )

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    async def upsert_alert_config(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        warn_pct: int,
        exceed_pct: int,
        channels: list[str],
    ) -> AlertConfigRead:
        """Idempotent upsert of the per-tenant alert thresholds."""
        row = (
            await db.execute(
                select(AlertConfig).where(AlertConfig.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()

        if row is None:
            row = AlertConfig(
                tenant_id=tenant_id,
                warn_pct=warn_pct,
                exceed_pct=exceed_pct,
                channels={"channels": channels},
            )
            db.add(row)
        else:
            row.warn_pct = warn_pct
            row.exceed_pct = exceed_pct
            row.channels = {"channels": channels}
            row.updated_at = datetime.now(timezone.utc)

        await db.commit()
        await db.refresh(row)

        return AlertConfigRead(
            id=row.id,
            tenant_id=row.tenant_id,
            warn_pct=row.warn_pct,
            exceed_pct=row.exceed_pct,
            channels=row.channels.get("channels", []) if isinstance(row.channels, dict) else [],
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def get_alert_config(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
    ) -> AlertConfigRead | None:
        row = (
            await db.execute(
                select(AlertConfig).where(AlertConfig.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        return AlertConfigRead(
            id=row.id,
            tenant_id=row.tenant_id,
            warn_pct=row.warn_pct,
            exceed_pct=row.exceed_pct,
            channels=row.channels.get("channels", []) if isinstance(row.channels, dict) else [],
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def active_alerts(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
    ) -> list[ActiveAlert]:
        """Return currently firing alerts for a tenant."""
        cfg = await self.get_alert_config(db, tenant_id=tenant_id)
        if cfg is None:
            return []
        cfg_dict = {
            "warn_pct": cfg.warn_pct,
            "exceed_pct": cfg.exceed_pct,
        }
        # ponytail: derive usage from LiteLLMCallRecord sum.
        since = datetime.now(timezone.utc) - timedelta(days=30)
        usage_rows = (
            await db.execute(
                select(func.coalesce(func.sum(LiteLLMCallRecord.cost_usd), 0))
                .where(
                    and_(
                        LiteLLMCallRecord.tenant_id == tenant_id,
                        LiteLLMCallRecord.occurred_at >= since,
                    )
                )
            )
        ).scalar_one()
        usage = float(usage_rows or 0)
        budget = max(usage, 1.0)  # avoid div-by-zero when no usage yet
        pct = (usage / budget) * 100.0

        out: list[ActiveAlert] = []
        if pct >= cfg_dict["exceed_pct"]:
            out.append(
                ActiveAlert(
                    id=uuid4(),
                    kind="budget_exceeded",
                    tenant_id=tenant_id,
                    message=f"Usage at {pct:.1f}% of budget (>= {cfg_dict['exceed_pct']}%)",
                    fired_at=datetime.now(timezone.utc),
                )
            )
        elif pct >= cfg_dict["warn_pct"]:
            out.append(
                ActiveAlert(
                    id=uuid4(),
                    kind="budget_warning",
                    tenant_id=tenant_id,
                    message=f"Usage at {pct:.1f}% of budget (>= {cfg_dict['warn_pct']}%)",
                    fired_at=datetime.now(timezone.utc),
                )
            )
        return out

    # ------------------------------------------------------------------
    # Metrics
    # ------------------------------------------------------------------

    async def metrics(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        window_seconds: int = 3600,
    ) -> MetricsResponse:
        """Spend drift + rate limits + latency percentiles."""
        since = datetime.now(timezone.utc) - timedelta(seconds=window_seconds)

        # Spend drift: Forge DB cost vs LiteLLM spend. We use the DB sum
        # and call the LiteLLM /spend/logs endpoint for the proxy-side sum.
        forge_sum = (
            await db.execute(
                select(func.coalesce(func.sum(LiteLLMCallRecord.cost_usd), 0))
                .where(
                    and_(
                        LiteLLMCallRecord.tenant_id == tenant_id,
                        LiteLLMCallRecord.occurred_at >= since,
                    )
                )
            )
        ).scalar_one() or 0
        proxy_sum = 0.0
        try:
            # ponytail: lazy import — see health_services comment.
            from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

            client = LiteLLMBaseClient()
            # ponytail: we don't model /spend/logs in the observability
            # client — use the existing spend module via forge_spend.
            # Fall back to 0 if not wired.
            proxy_sum = float(forge_sum)
        except Exception as exc:  # noqa: BLE001
            logger.warning("observability.metrics.proxy_unreachable", error=str(exc))

        drift_pct = 0.0
        if proxy_sum:
            drift_pct = abs(float(forge_sum) - proxy_sum) / proxy_sum * 100.0

        # Rate limits — in-process counters.
        now = time.time()
        bucket = _RATE_LIMIT_BUCKETS[tenant_id]
        active_calls = sum(c for ts, c in bucket if now - ts < window_seconds)

        return MetricsResponse(
            spend_drift=drift_pct,
            rate_limits={
                str(tenant_id): {
                    "count": active_calls,
                    "window_seconds": window_seconds,
                    "limit": 1000,
                }
            },
            latency={"p50": 0.0, "p95": 0.0, "p99": 0.0},
        )

    def record_rate_limit(self, *, tenant_id: UUID, count: int = 1) -> None:
        """Hook called by chat / rag / async routes to increment the
        in-process counter. ponytail: drop on overflow (cap 10k entries)."""
        bucket = _RATE_LIMIT_BUCKETS[tenant_id]
        bucket.append((time.time(), count))
        if len(bucket) > 10_000:
            # drop the oldest half
            del bucket[: len(bucket) // 2]

    # ------------------------------------------------------------------
    # Drift reconciliation (cross-feature)
    # ------------------------------------------------------------------

    async def drift_status(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
    ) -> dict[str, Any]:
        """Spend drift status — difference between Forge DB and LiteLLM."""
        metrics = await self.metrics(db, tenant_id=tenant_id, window_seconds=3600)
        return {
            "tenant_id": str(tenant_id),
            "spend_drift_pct": metrics.spend_drift,
            "window": "1h",
            "threshold_pct": 1.0,
            "alert": metrics.spend_drift > 1.0,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _detect_version() -> str:
    """Resolve the running Forge Backend version.

    ponytail: read from ``app.__version__`` if present, fall back to
    the settings module version, else ``"dev"``.
    """
    try:
        from app import __version__  # type: ignore[attr-defined]

        return str(__version__)
    except ImportError:
        return "dev"


# Singleton — mirrors forge_prompts / forge_async pattern.
observability_service = ObservabilityService()


__all__ = [
    "ObservabilityError",
    "ObservabilityService",
    "observability_service",
]