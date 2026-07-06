"""F-502 — Validation Report REST endpoints.

Endpoints
---------
POST /api/v1/validation-reports
    Submit a ValidationReport. Persists via the artifact registry
    (append-only, SHA-256 content_hash) and writes an AuditEvent so
    the F-005 audit trail captures the validator run.

GET /api/v1/validation-reports/{report_id}
    Retrieve a single ValidationReport by id.

GET /api/v1/validation-reports?commit_sha=X
    List all reports for the caller's tenant whose payload references
    the given commit_sha. RLS scopes by tenant.

The dual write (ArtifactRegistry + AuditEvent) mirrors F-308
StandardsAttestationService: the audit trail is the system of record
while the registry supplies queryability.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import DbSession, get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.artifact import Artifact, ArtifactStatus
from app.schemas.artifact_types import is_known_artifact_type
from app.schemas.common import Page
from app.schemas.validation_report import (
    ValidationReport,
    aggregate_summary,
)
from app.services.artifact_registry import artifact_registry
from app.services.audit_service import audit_service
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

router = APIRouter(prefix="/validation-reports", tags=["validation-reports"])


VALIDATION_REPORT_TYPE = "validation_report"


def _report_to_dict(report: ValidationReport, *, commit_sha: str | None = None) -> dict:
    """Convert a ValidationReport to the dict payload persisted as Artifact.payload.

    `commit_sha` is supplied at submit time and stored alongside the
    canonical schema so list-by-commit queries can index on it.
    """
    data = report.model_dump(mode="json")
    data["commit_sha"] = commit_sha
    return data


def _dict_to_report(payload: dict) -> ValidationReport:
    """Reconstruct a ValidationReport from a stored artifact payload.

    Strips the storage-only `commit_sha` field before validation.
    """
    raw = {k: v for k, v in payload.items() if k != "commit_sha"}
    return ValidationReport.model_validate(raw)


@require_approval_phase(SDLCPhase.SECURITY)
@router.post(
    "",
    response_model=ValidationReport,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="validation_reports.create", target_type="validation_report")
async def submit_validation_report(
    body: ValidationReport,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("validation_reports:create")),
    commit_sha: Annotated[str | None, Query(min_length=7, max_length=64)] = None,
) -> ValidationReport:
    """Submit a ValidationReport.

    Persists via ArtifactRegistry (append-only, content-hashed) and
    emits an AuditEvent with the validator run metadata.
    """
    if not is_known_artifact_type(VALIDATION_REPORT_TYPE):
        # Defensive: surface registry drift immediately rather than
        # silently writing to an unknown artifact type.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="artifact_type_not_registered:validation_report",
        )

    artifact = await artifact_registry.create(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        type=VALIDATION_REPORT_TYPE,
        payload=_report_to_dict(body, commit_sha=commit_sha),
        created_by=principal.user_id,
        status=ArtifactStatus.ACTIVE,
        actor_id=principal.user_id,
    )

    await audit_service.record(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
        action="validation_reports.create",
        target_type=VALIDATION_REPORT_TYPE,
        target_id=str(artifact.id),
        payload={
            "report_id": str(body.report_id),
            "run_id": str(body.run_id),
            "validator_version": body.validator_version,
            "decision": body.decision,
            "total_findings": body.summary.total_findings,
            "commit_sha": commit_sha,
            "schema_version": body.schema_version,
            "content_hash": artifact.content_hash,
        },
        occurred_at=body.timestamp,
    )

    await default_bus.publish(
        EventType.ARTIFACT_CREATED,
        {
            "artifact_id": str(artifact.id),
            "type": VALIDATION_REPORT_TYPE,
            "report_id": str(body.report_id),
            "decision": body.decision,
        },
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
    )

    return body


@router.get(
    "/{report_id}",
    response_model=ValidationReport,
)
@audit(action="validation_reports.get", target_type="validation_report")
async def get_validation_report(
    report_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
    _perm: AuthenticatedPrincipal = Depends(require_permission("validation_reports:read")),
) -> ValidationReport:
    """Retrieve a single ValidationReport by its internal artifact id."""
    stmt = select(Artifact).where(
        Artifact.id == str(report_id),
        Artifact.tenant_id == principal.tenant_id,
        Artifact.type == VALIDATION_REPORT_TYPE,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="validation_report_not_found",
        )
    return _dict_to_report(row.payload)


@router.get(
    "",
    response_model=Page[ValidationReport],
)
@audit(action="validation_reports.list", target_type="validation_report")
async def list_validation_reports(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession = None,  # type: ignore[assignment]
    _perm: AuthenticatedPrincipal = Depends(require_permission("validation_reports:read")),
    commit_sha: Annotated[str | None, Query(min_length=7, max_length=64)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[ValidationReport]:
    """List ValidationReports, optionally filtered by commit_sha.

    `commit_sha` matches against the storage-only field on each
    artifact's payload. Tenant scoping is enforced by RLS via the
    `tenant_id` filter on the WHERE clause.
    """
    stmt = select(Artifact).where(
        Artifact.tenant_id == principal.tenant_id,
        Artifact.type == VALIDATION_REPORT_TYPE,
    )
    if commit_sha is not None:
        # JSONB containment lookup; payload is a JSON column on Artifact.
        # We rely on SQLAlchemy's JSONB column comparison which is
        # implemented as `payload @> :payload` on Postgres.
        stmt = stmt.where(Artifact.payload["commit_sha"].as_string() == commit_sha)

    total_stmt = select(Artifact.id).where(
        Artifact.tenant_id == principal.tenant_id,
        Artifact.type == VALIDATION_REPORT_TYPE,
    )
    if commit_sha is not None:
        total_stmt = total_stmt.where(Artifact.payload["commit_sha"].as_string() == commit_sha)

    total = len(list((await db.execute(total_stmt)).scalars().all()))

    stmt = stmt.order_by(Artifact.created_at.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    rows = list((await db.execute(stmt)).scalars().all())

    items = [_dict_to_report(r.payload) for r in rows]
    return Page[ValidationReport](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# Internal helper exposed for service-layer callers (e.g. F-503 gate) and
# for tests that want to seed a report without going through HTTP.
# ---------------------------------------------------------------------------


async def record_validation_report(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str | None,
    actor_id: UUID | str | None,
    report: ValidationReport,
    commit_sha: str | None = None,
    occurred_at: datetime | None = None,
) -> tuple[UUID, str]:
    """Persist a ValidationReport and emit its audit + bus events.

    Returns (artifact_id, content_hash) so callers (e.g. F-503) can
    refer to the exact stored version.
    """
    occurred_at = occurred_at or datetime.now(UTC)
    artifact = await artifact_registry.create(
        tenant_id=tenant_id,
        project_id=project_id,
        type=VALIDATION_REPORT_TYPE,
        payload=_report_to_dict(report, commit_sha=commit_sha),
        created_by=actor_id,
        status=ArtifactStatus.ACTIVE,
        actor_id=actor_id,
    )
    await audit_service.record(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        action="validation_reports.create",
        target_type=VALIDATION_REPORT_TYPE,
        target_id=str(artifact.id),
        payload={
            "report_id": str(report.report_id),
            "run_id": str(report.run_id),
            "validator_version": report.validator_version,
            "decision": report.decision,
            "total_findings": report.summary.total_findings,
            "commit_sha": commit_sha,
            "schema_version": report.schema_version,
            "content_hash": artifact.content_hash,
        },
        occurred_at=occurred_at,
    )
    await default_bus.publish(
        EventType.ARTIFACT_CREATED,
        {
            "artifact_id": str(artifact.id),
            "type": VALIDATION_REPORT_TYPE,
            "report_id": str(report.report_id),
            "decision": report.decision,
        },
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    return UUID(str(artifact.id)), artifact.content_hash


def new_report(
    *,
    run_id: UUID,
    validator_version: str,
    decision: str,
    findings: list | None = None,
    scan_duration_ms: int = 0,
    scanners_executed: list[str] | None = None,
    evidence_pack_url: str = "",
    schema_version: str | None = None,
    report_id: UUID | None = None,
    timestamp: datetime | None = None,
) -> ValidationReport:
    """Construct a ValidationReport with an auto-computed summary."""
    from app.schemas.validation_report import SCHEMA_VERSION as _SCHEMA_VERSION

    summary = aggregate_summary(
        findings or [],
        scan_duration_ms=scan_duration_ms,
        scanners_executed=scanners_executed,
    )
    return ValidationReport(
        report_id=report_id or uuid4(),
        run_id=run_id,
        timestamp=timestamp or datetime.now(UTC),
        validator_version=validator_version,
        decision=decision,  # type: ignore[arg-type]
        findings=findings or [],
        summary=summary,
        evidence_pack_url=evidence_pack_url,
        schema_version=schema_version or _SCHEMA_VERSION,
    )


__all__ = [
    "router",
    "record_validation_report",
    "new_report",
    "VALIDATION_REPORT_TYPE",
]
