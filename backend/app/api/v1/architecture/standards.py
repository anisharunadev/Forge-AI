"""F-308 — Standards Attestation HTTP endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.architecture import (
    AttestationListResponse,
    AttestationRequest,
    AttestationResponse,
    AttestationRevokeRequest,
    StandardCheckResponse,
)
from app.services.architecture.standards_attestation import (
    StandardsAttestationService,
)
from app.services.artifact_registry import artifact_registry
from app.services.audit_service import audit_service
from app.services.event_bus import bus

router = APIRouter(prefix="/architecture/standards", tags=["architecture:standards"])


def _service() -> StandardsAttestationService:
    return StandardsAttestationService(
        artifact_registry=artifact_registry,
        standard_service=None,
        audit_service=audit_service,
        event_bus=bus,
    )


@router.post(
    "/attest",
    response_model=AttestationResponse,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="architecture.standards.attest", target_type="standards_attestation")
async def attest(
    body: AttestationRequest,
    principal: Principal,
    project_id: UUID = Query(...),
    _perm: Principal = require_permission("architecture:standards:attest"),
) -> AttestationResponse:
    """Run the standard checks for an artifact and record the outcome."""
    payload = await _service().attest(
        artifact_type=body.artifact_type,
        artifact_id=body.artifact_id,
        attestor_id=principal.user_id,
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
    return AttestationResponse.model_validate(payload)


@router.get("/attestations", response_model=AttestationListResponse)
@audit(action="architecture.standards.list", target_type="standards_attestation")
async def list_attestations(
    principal: Principal,
    project_id: UUID = Query(...),
    _perm: Principal = require_permission("architecture:standards:read"),
) -> AttestationListResponse:
    rows = await _service().list_attestations(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
    return AttestationListResponse(
        items=[AttestationResponse.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.get(
    "/check/{artifact_type}/{artifact_id}",
    response_model=list[StandardCheckResponse],
)
@audit(action="architecture.standards.check", target_type="standards_attestation")
async def check_artifact(
    artifact_type: str,
    artifact_id: UUID,
    principal: Principal,
    project_id: UUID | None = Query(default=None),
    _perm: Principal = require_permission("architecture:standards:read"),
) -> list[StandardCheckResponse]:
    """List applicable standards and whether they're met (no audit row)."""
    rows = await _service().get_standards_for_artifact(
        artifact_type=artifact_type,
        artifact_id=artifact_id,
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
    return [StandardCheckResponse.model_validate(r) for r in rows]


@router.post(
    "/attestations/{attestation_id}/revoke",
    response_model=AttestationResponse,
)
@audit(action="architecture.standards.revoke", target_type="standards_attestation")
async def revoke_attestation(
    attestation_id: UUID,
    body: AttestationRevokeRequest,
    principal: Principal,
    _perm: Principal = require_permission("architecture:standards:revoke"),
) -> AttestationResponse:
    """Revoke a previously issued attestation (forge-admin only)."""
    try:
        payload = await _service().revoke_attestation(
            attestation_id=attestation_id,
            reason=body.reason,
            revoker_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AttestationResponse.model_validate(payload)


__all__ = ["router"]