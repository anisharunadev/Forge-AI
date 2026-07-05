"""M5 Architecture Center (T-A3) — SecurityReport HTTP endpoints.

Mounted at /architecture/security-reports. All mutators carry the
@require_approval_phase(SDLCPhase.ARCHITECTURE) decoration so a run
without a granted architecture-approval gets a 403 instead of leaking
a row.

Endpoints:

* POST   /security-reports                 — create_report
* GET    /security-reports                 — list_reports
* GET    /security-reports/posture         — compute_deployment_posture
* GET    /security-reports/{report_id}     — get_report
* PATCH  /security-reports/{report_id}/status — update_status
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.security_report import (
    SecurityReportCreateRequest,
    SecurityReportDeploymentPosture,
    SecurityReportListResponse,
    SecurityReportRead,
    SecurityReportStatusUpdateRequest,
)
from app.services.architecture.security_report import SecurityReportService

router = APIRouter(
    prefix="/architecture/security-reports",
    tags=["architecture:security_reports"],
)


def _service() -> SecurityReportService:
    """Per-request service stub.

    A future patch can inject a real audit service here; for now the
    service falls back to no-op when audit is None.
    """
    return SecurityReportService(
        artifact_registry_instance=None,
        event_bus=None,
        audit_service=None,
    )


@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.post(
    "", response_model=SecurityReportRead, status_code=status.HTTP_201_CREATED
)
@audit(action="architecture.security_report.create", target_type="security_report")
async def create_security_report(
    body: SecurityReportCreateRequest,
    principal: Annotated[
        AuthenticatedPrincipal, Depends(get_current_principal)
    ],
    _perm: AuthenticatedPrincipal = Depends(
        require_permission("architecture:security_report:write")
    ),
) -> SecurityReportRead:
    """Create a deployment-relevant security finding."""
    svc = _service()
    row = await svc.create_report(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        title=body.title,
        severity=body.severity,
        category=body.category,
        description=body.description,
        affected_service=body.affected_service,
        recommendation=body.recommendation,
        source_adr_id=body.source_adr_id,
        generated_by=principal.user_id,
    )
    return SecurityReportRead.model_validate(row)


@router.get(
    "", response_model=SecurityReportListResponse
)
@audit(action="architecture.security_report.list", target_type="security_report")
async def list_security_reports(
    principal: Annotated[
        AuthenticatedPrincipal, Depends(get_current_principal)
    ],
    _perm: AuthenticatedPrincipal = Depends(
        require_permission("architecture:security_report:read")
    ),
    project_id: UUID = Query(...),
    severity: str | None = Query(default=None),
    category: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, le=200, ge=1),
) -> SecurityReportListResponse:
    """List rows, filtered by severity/category/status when supplied."""
    svc = _service()
    rows = await svc.list_reports(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        severity=severity,
        category=category,
        status=status_,
        limit=limit,
    )
    return SecurityReportListResponse(
        items=[SecurityReportRead.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.get(
    "/posture", response_model=SecurityReportDeploymentPosture
)
@audit(action="architecture.security_report.posture", target_type="security_report")
async def deployment_posture(
    principal: Annotated[
        AuthenticatedPrincipal, Depends(get_current_principal)
    ],
    _perm: AuthenticatedPrincipal = Depends(
        require_permission("architecture:security_report:read")
    ),
    project_id: UUID | None = Query(default=None),
) -> SecurityReportDeploymentPosture:
    """Aggregate roll-up used by the SecurityPostureCard."""
    svc = _service()
    posture = await svc.compute_deployment_posture(
        tenant_id=principal.tenant_id, project_id=project_id
    )
    return SecurityReportDeploymentPosture.model_validate(posture)


@router.get(
    "/{report_id}", response_model=SecurityReportRead
)
@audit(action="architecture.security_report.get", target_type="security_report")
async def get_security_report(
    report_id: UUID,
    principal: Annotated[
        AuthenticatedPrincipal, Depends(get_current_principal)
    ],
    _perm: AuthenticatedPrincipal = Depends(
        require_permission("architecture:security_report:read")
    ),
) -> SecurityReportRead:
    svc = _service()
    row = await svc.get_report(
        tenant_id=principal.tenant_id, report_id=report_id
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="security_report_not_found"
        )
    return SecurityReportRead.model_validate(row)


@require_approval_phase(SDLCPhase.ARCHITECTURE)


@router.patch(
    "/{report_id}/status", response_model=SecurityReportRead
)
@audit(action="architecture.security_report.status", target_type="security_report")
async def update_security_report_status(
    report_id: UUID,
    body: SecurityReportStatusUpdateRequest,
    principal: Annotated[
        AuthenticatedPrincipal, Depends(get_current_principal)
    ],
    _perm: AuthenticatedPrincipal = Depends(
        require_permission("architecture:security_report:write")
    ),
) -> SecurityReportRead:
    """Move the row through its lifecycle: open → mitigating → closed."""
    svc = _service()
    try:
        row = await svc.update_status(
            tenant_id=principal.tenant_id,
            report_id=report_id,
            target_status=body.status,
            reason=body.reason,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return SecurityReportRead.model_validate(row)


__all__ = ["router"]
