"""F-310 — Acceptance Criteria HTTP endpoints."""

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
    AcceptanceCriteriaGenerateRequest,
    AcceptanceCriteriaResponse,
    AcceptanceLinkTestRequest,
    ContextUsageResponse,
    CoverageReportResponse,
    ValidationResultResponse,
)
from app.services.architecture.acceptance_criteria import (
    AcceptanceCriteriaService,
)
from app.services.architecture.context_aware import ContextAwareGenerator
from app.services.artifact_registry import artifact_registry
from app.services.event_bus import bus
from app.services.litellm_client import LiteLLMClient

router = APIRouter(prefix="/architecture", tags=["architecture:acceptance"])


def _acceptance_service() -> AcceptanceCriteriaService:
    return AcceptanceCriteriaService(
        litellm_client=LiteLLMClient(),
        artifact_registry=artifact_registry,
        test_service=None,
        event_bus=bus,
    )


def _context_generator() -> ContextAwareGenerator:
    return ContextAwareGenerator(
        litellm_client=LiteLLMClient(),
        standard_service=None,
        template_service=None,
        project_intelligence=None,
        event_bus=bus,
    )


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post(
    "/acceptance/generate",
    response_model=AcceptanceCriteriaResponse,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="architecture.acceptance.generate", target_type="acceptance_criteria")
async def generate_criteria(
    body: AcceptanceCriteriaGenerateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:acceptance:create")),
) -> AcceptanceCriteriaResponse:
    """Produce Given/When/Then criteria from an ADR, contract, or breakdown."""
    try:
        envelope = await _acceptance_service().generate_from_artifact(
            artifact_type=body.artifact_type,
            artifact_id=body.artifact_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AcceptanceCriteriaResponse.model_validate(envelope)


@router.get("/acceptance/{criteria_id}", response_model=AcceptanceCriteriaResponse)
@audit(action="architecture.acceptance.get", target_type="acceptance_criteria")
async def get_criteria(
    criteria_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:acceptance:read")),
) -> AcceptanceCriteriaResponse:
    record = await _acceptance_service()._load_record(criteria_id)
    if record is None or record["tenant_id"] != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="acceptance_criteria_not_found")
    return AcceptanceCriteriaResponse.model_validate(record)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post(
    "/acceptance/{criteria_id}/link-test",
    response_model=AcceptanceCriteriaResponse,
)
@audit(action="architecture.acceptance.link_test", target_type="acceptance_criteria")
async def link_test(
    criteria_id: UUID,
    body: AcceptanceLinkTestRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:acceptance:update")),
) -> AcceptanceCriteriaResponse:
    try:
        record = await _acceptance_service().link_to_test(
            criteria_id=criteria_id,
            test_id=body.test_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return AcceptanceCriteriaResponse.model_validate(record)


@router.get("/coverage", response_model=CoverageReportResponse)
@audit(action="architecture.coverage.report", target_type="acceptance_criteria")
async def coverage(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID = Query(...),
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:acceptance:read")),
) -> CoverageReportResponse:
    report = await _acceptance_service().get_coverage(
        tenant_id=principal.tenant_id,
        project_id=project_id,
    )
    return CoverageReportResponse.model_validate(report)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post(
    "/acceptance/{criteria_id}/validate",
    response_model=ValidationResultResponse,
)
@audit(action="architecture.acceptance.validate", target_type="acceptance_criteria")
async def validate_against_code(
    criteria_id: UUID,
    code_artifact_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("architecture:acceptance:read")),
) -> ValidationResultResponse:
    try:
        result = await _acceptance_service().validate_against_code(
            criteria_id=criteria_id,
            code_artifact_id=code_artifact_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ValidationResultResponse.model_validate(result)


# Re-use the context generator for the related F-309 read path so
# callers have a single place to inspect context usage.
@router.get(
    "/context-usage/{artifact_id}",
    response_model=ContextUsageResponse,
)
@audit(action="architecture.context.usage", target_type="artifact")
async def get_context_usage(
    artifact_id: UUID,
    artifact_type: str = Query(...),
    principal: Annotated[
        AuthenticatedPrincipal, Depends(get_current_principal)
    ] = require_permission("architecture:context:read"),
) -> ContextUsageResponse:
    refs = await _context_generator().get_context_usage(artifact_id)
    return ContextUsageResponse(
        artifact_id=artifact_id,
        artifact_type=artifact_type,
        references=refs,
    )


__all__ = ["router"]
