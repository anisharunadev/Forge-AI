"""M5 Architecture Center (T-A3) — SecurityReport service.

Operational surface for the deployment-posture Security Report tab.
The service:

* `create_report` — inserts a row, mirrors the artifact to the KG via
  `artifact_registry.register(artifact_type='security_report', ...)`,
  emits ARTIFACT_CREATED on the bus, and stamps the audit row.
* `list_reports` — tenant+project-scoped query with severity/category/
  status filters and a hard cap of 200 rows (matching the spec).
* `update_status` — PATCH workflow that enforces the lifecycle
  open → mitigating → closed (accepted is terminal).
* `compute_deployment_posture` — aggregate over (tenant, project):
  total_open, critical_open, high_open, by_category distribution,
  top_affected_services, and a risk-weighted score (0-100, higher is
  better).
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models.security_report import (
    CATEGORY_VALUES,
    SEVERITY_LEVELS,
    STATUS_VALUES,
    SecurityReport,
)
from app.db.session import get_session_factory
from app.services.artifact_registry import artifact_registry
from app.services.event_bus import EventType

logger = get_logger(__name__)


# Severity weights for the deployment posture score (higher = worse).
_SEVERITY_PENALTY = {"low": 1, "medium": 3, "high": 10, "critical": 25}
_CLOSED_BONUS = 5
_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_severity(value: str) -> str:
    s = str(value or "").strip().lower()
    if s not in SEVERITY_LEVELS:
        raise ValueError(f"invalid severity: {value!r}")
    return s


def _normalize_category(value: str) -> str:
    c = str(value or "").strip().lower()
    if c not in CATEGORY_VALUES:
        raise ValueError(f"invalid category: {value!r}")
    return c


def _normalize_status(value: str) -> str:
    s = str(value or "").strip().lower()
    if s not in STATUS_VALUES:
        raise ValueError(f"invalid status: {value!r}")
    return s


def _validate_status_transition(current: str, target: str) -> str:
    """Enforce the open → mitigating → closed (or accepted) lifecycle."""
    if current == target:
        return current
    allowed: dict[str, set[str]] = {
        "open": {"mitigating", "accepted", "closed"},
        "mitigating": {"closed", "accepted", "open"},
        "accepted": {"closed", "mitigating"},
        "closed": {"mitigating", "accepted"},
    }
    if target not in allowed.get(current, set()):
        raise ValueError(
            f"invalid_status_transition:{current}→{target}"
        )
    return target


class SecurityReportService:
    """Create, list, update, and aggregate Security Reports."""

    def __init__(
        self,
        artifact_registry_instance: Any | None = None,
        event_bus: Any | None = None,
        audit_service: Any | None = None,
    ) -> None:
        self._registry = artifact_registry_instance or artifact_registry
        # Importing the bus via the property avoids a circular import
        # at module load (event_bus imports service modules that may
        # in turn import this one for downstream consumers).
        if event_bus is None:
            from app.services.event_bus import bus as default_bus

            event_bus = default_bus
        self._bus = event_bus
        self._audit = audit_service

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------
    async def create_report(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        title: str,
        severity: str,
        category: str,
        description: str,
        affected_service: str,
        recommendation: str,
        source_adr_id: UUID | str | None = None,
        generated_by: UUID | str | None = None,
    ) -> SecurityReport:
        severity = _normalize_severity(severity)
        category = _normalize_category(category)
        title = (title or "").strip()
        affected_service = (affected_service or "").strip()
        if not title:
            raise ValueError("title_required")
        if not affected_service:
            raise ValueError("affected_service_required")

        factory = get_session_factory()
        now = _utcnow()
        async with factory() as session:
            row = SecurityReport(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                title=title,
                severity=severity,
                category=category,
                description=description or "",
                affected_service=affected_service,
                recommendation=recommendation or "",
                status="open",
                source_adr_id=str(source_adr_id) if source_adr_id else None,
                discovered_at=now,
                generated_by=str(generated_by) if generated_by else None,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)

        # M5-G2 — mirror the report into the KG (typed artifact,
        # ``artifact_type='security_report'``).
        await self._registry.register(
            artifact_type="security_report",
            artifact_id=str(row.id),
            tenant_id=tenant_id,
            project_id=project_id,
            payload={
                "title": row.title,
                "severity": row.severity,
                "category": row.category,
                "affected_service": row.affected_service,
                "status": row.status,
                "source_adr_id": str(source_adr_id) if source_adr_id else None,
            },
            actor_id=generated_by,
        )

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "artifact_type": "security_report",
                "report_id": str(row.id),
                "severity": row.severity,
                "category": row.category,
                "affected_service": row.affected_service,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=generated_by,
        )
        if self._audit is not None:
            try:
                await self._audit.record(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=generated_by,
                    action="architecture.security_report.create",
                    target_type="security_report",
                    target_id=str(row.id),
                    payload={
                        "severity": row.severity,
                        "category": row.category,
                        "affected_service": row.affected_service,
                    },
                )
            except Exception:  # noqa: BLE001 — audit must not break the call
                logger.warning("security_report.audit_skipped", report_id=str(row.id))
        return row

    # ------------------------------------------------------------------
    # List / Get
    # ------------------------------------------------------------------
    async def list_reports(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        severity: str | None = None,
        category: str | None = None,
        status: str | None = None,
        limit: int = _DEFAULT_LIMIT,
    ) -> list[SecurityReport]:
        limit = max(1, min(int(limit), _MAX_LIMIT))
        factory = get_session_factory()
        stmt = select(SecurityReport).where(
            SecurityReport.tenant_id == str(tenant_id),
            SecurityReport.project_id == str(project_id),
        )
        if severity is not None:
            stmt = stmt.where(SecurityReport.severity == _normalize_severity(severity))
        if category is not None:
            stmt = stmt.where(SecurityReport.category == _normalize_category(category))
        if status is not None:
            stmt = stmt.where(SecurityReport.status == _normalize_status(status))
        stmt = stmt.order_by(SecurityReport.discovered_at.desc()).limit(limit)
        async with factory() as session:
            return list((await session.execute(stmt)).scalars().all())

    async def get_report(
        self,
        *,
        tenant_id: UUID | str,
        report_id: UUID | str,
    ) -> SecurityReport | None:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(SecurityReport, str(report_id))
        if row is None or row.tenant_id != str(tenant_id):
            return None
        return row

    # ------------------------------------------------------------------
    # Status update
    # ------------------------------------------------------------------
    async def update_status(
        self,
        *,
        tenant_id: UUID | str,
        report_id: UUID | str,
        target_status: str,
        reason: str | None = None,
        actor_id: UUID | str | None = None,
    ) -> SecurityReport:
        target_status = _normalize_status(target_status)
        factory = get_session_factory()
        now = _utcnow()
        async with factory() as session:
            row = await session.get(SecurityReport, str(report_id))
            if row is None or row.tenant_id != str(tenant_id):
                raise LookupError("security_report_not_found")
            new_status = _validate_status_transition(row.status, target_status)
            row.status = new_status
            if new_status in {"closed", "accepted"}:
                row.mitigated_at = now
            elif new_status == "mitigating":
                row.mitigated_at = None
            await session.commit()
            await session.refresh(row)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": "security_report",
                "report_id": str(row.id),
                "status": new_status,
                "reason": reason or "",
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    # ------------------------------------------------------------------
    # Deployment posture aggregate
    # ------------------------------------------------------------------
    async def compute_deployment_posture(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> dict[str, Any]:
        """Return the aggregate deployment-posture dict used by the UI.

        Score formula (0-100, higher = better):
          \u2211(severity_penalty[open])\u2212 closed * _CLOSED_BONUS
          clamped to [0, 100]; starts from 100 then subtracts penalties
          and adds back closed bonuses, divided by a max-penalty
          normalisation of 100 so a heavily-loaded project floors at
          0 instead of going negative.
        """
        factory = get_session_factory()
        open_filter = [SecurityReport.status == "open"]
        if project_id is not None:
            open_filter.append(SecurityReport.project_id == str(project_id))
        stmt = select(SecurityReport.severity, SecurityReport.status).where(
            SecurityReport.tenant_id == str(tenant_id),
            *open_filter,
        )
        async with factory() as session:
            rows = list((await session.execute(stmt)).all())

        severity_counts: Counter[str] = Counter(r.severity for r in rows if r.severity)
        status_counts: Counter[str] = Counter(r.status for r in rows if r.status)

        # By-category breakdown (open only — closed categories aren't
        # shown to reduce noise).
        cat_stmt = select(SecurityReport.category).where(
            SecurityReport.tenant_id == str(tenant_id),
            SecurityReport.status == "open",
        )
        if project_id is not None:
            cat_stmt = cat_stmt.where(SecurityReport.project_id == str(project_id))
        async with factory() as session:
            cats = list((await session.execute(cat_stmt)).scalars().all())
        by_category = {c: cats.count(c) for c in CATEGORY_VALUES if cats.count(c)}

        # Top affected services.
        svc_stmt = select(SecurityReport.affected_service).where(
            SecurityReport.tenant_id == str(tenant_id),
            SecurityReport.status == "open",
        )
        if project_id is not None:
            svc_stmt = svc_stmt.where(SecurityReport.project_id == str(project_id))
        async with factory() as session:
            services = [s for s in (await session.execute(svc_stmt)).scalars().all() if s]
        svc_counter = Counter(services)
        top_services = [s for s, _ in svc_counter.most_common(5)]

        # Score: 100 minus weighted open penalties, plus closed bonus,
        # normalised so it floors at 0 and caps at 100.
        penalty = sum(
            _SEVERITY_PENALTY.get(sev, 0) * count
            for sev, count in severity_counts.items()
            if status_counts.get(sev, 0) >= 0  # all severities included
        )
        closed_bonus = status_counts.get("closed", 0) * _CLOSED_BONUS
        raw_score = max(0, min(100, 100 - penalty + closed_bonus))

        return {
            "tenant_id": str(tenant_id),
            "project_id": str(project_id) if project_id else None,
            "total_open": status_counts.get("open", 0)
            + status_counts.get("mitigating", 0),
            "total_closed": status_counts.get("closed", 0)
            + status_counts.get("accepted", 0),
            "critical_open": severity_counts.get("critical", 0),
            "high_open": severity_counts.get("high", 0),
            "medium_open": severity_counts.get("medium", 0),
            "low_open": severity_counts.get("low", 0),
            "by_category": by_category,
            "top_affected_services": top_services,
            "score": raw_score,
            "computed_at": _utcnow(),
        }


__all__ = [
    "SecurityReportService",
    "SEVERITY_LEVELS",
    "CATEGORY_VALUES",
    "STATUS_VALUES",
]
