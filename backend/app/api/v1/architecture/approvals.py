"""F-305 — Architecture Approval HTTP endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.architecture import (
    ArchitectureApprovalDecisionRequest,
    ArchitectureApprovalListResponse,
    ArchitectureApprovalRequest,
    ArchitectureApprovalResponse,
)
from app.services.architecture.approval_workflow import (
    ArchitectureApprovalWorkflow,
    _decode_reviewers,
)
from app.services.audit_service import audit_service
from app.services.event_bus import bus
from app.services.litellm_client import LiteLLMClient

router = APIRouter(
    prefix="/architecture/approvals",
    tags=["architecture:approvals"],
)


def _workflow() -> ArchitectureApprovalWorkflow:
    # ponytail: pass the module-level audit_service singleton so terminal
    # approve/deny rows land in audit_events (R6). Per the M15-1 contract
    # Gap 4 — was previously omitted, leaving grant/deny invisible to the
    # Audit Center. The singleton is process-local; no DI needed.
    return ArchitectureApprovalWorkflow(
        litellm_client=LiteLLMClient(),
        event_bus=bus,
        audit_service=audit_service,
    )


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("", response_model=ArchitectureApprovalResponse, status_code=status.HTTP_201_CREATED)
@audit(action="architecture.approval.request", target_type="approval")
async def request_approval(
    body: ArchitectureApprovalRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:approval:request")),
) -> ArchitectureApprovalResponse:
    """Open a new approval request for an artifact."""
    project_id = body.project_id or principal.project_id
    if project_id is None:
        raise HTTPException(status_code=400, detail="project_id_required")
    try:
        approval = await _workflow().request_approval(
            artifact_type=body.artifact_type,
            artifact_id=body.artifact_id,
            requester_id=principal.user_id,
            tenant_id=principal.tenant_id,
            project_id=project_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if str(approval.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="approval_not_found")
    return _serialize(approval)


@router.get("", response_model=ArchitectureApprovalListResponse)
@audit(action="architecture.approval.list", target_type="approval")
async def list_approvals(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:approval:read")),
    approval_status: str | None = Query(default=None, alias="status"),
    tenant_id: UUID | None = Query(default=None),
) -> ArchitectureApprovalListResponse:
    """List approvals scoped to the caller's tenant."""
    target_tenant = tenant_id or principal.tenant_id
    rows = await _workflow().get_pending(tenant_id=target_tenant)
    if approval_status is not None:
        rows = [r for r in rows if r.status == approval_status]
    return ArchitectureApprovalListResponse(
        items=[_serialize(r) for r in rows],
        total=len(rows),
    )


@router.get("/{approval_id}", response_model=ArchitectureApprovalResponse)
@audit(action="architecture.approval.get", target_type="approval")
async def get_approval(
    approval_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:approval:read")),
) -> ArchitectureApprovalResponse:
    approval = await _workflow().get_approval(approval_id)
    if approval is None or str(approval.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="approval_not_found")
    return _serialize(approval)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/{approval_id}/decide", response_model=ArchitectureApprovalResponse)
@audit(action="architecture.approval.decide", target_type="approval")
async def decide_approval(
    approval_id: UUID,
    body: ArchitectureApprovalDecisionRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:approval:decide")),
) -> ArchitectureApprovalResponse:
    try:
        approval = await _workflow().decide(
            approval_id=approval_id,
            decision=body.decision,
            reviewer_id=principal.user_id,
            reason=body.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if str(approval.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="approval_not_found")
    return _serialize(approval)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/{approval_id}/cancel", response_model=ArchitectureApprovalResponse)
@audit(action="architecture.approval.cancel", target_type="approval")
async def cancel_approval(
    approval_id: UUID,
    body: ArchitectureApprovalDecisionRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:approval:cancel")),
) -> ArchitectureApprovalResponse:
    try:
        approval = await _workflow().cancel(
            approval_id=approval_id,
            reason=body.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if str(approval.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="approval_not_found")
    return _serialize(approval)


def _serialize(approval) -> ArchitectureApprovalResponse:  # type: ignore[no-untyped-def]
    """Flatten the JSON-encoded reviewer blob into the response model."""
    reviewers = _decode_reviewers(approval.reason)
    base = ArchitectureApprovalResponse.model_validate(approval).model_dump()
    base.pop("reason", None)
    base["required_reviewers"] = sorted({r.get("role", "") for r in reviewers if r.get("role")})
    base["reviewers"] = reviewers
    return ArchitectureApprovalResponse.model_validate(base)


__all__ = ["router"]
