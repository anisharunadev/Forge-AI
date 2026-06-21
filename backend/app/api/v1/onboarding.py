"""F-021 — Project Onboarding Wizard REST endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.onboarding import (
    OnboardingAdvanceRequest,
    OnboardingSessionRead,
    OnboardingStartRequest,
)
from app.services.project_onboarding.wizard import (
    WizardError,
    onboarding_wizard,
)

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.post(
    "/sessions",
    response_model=OnboardingSessionRead,
    status_code=201,
)
@audit(action="onboarding.start", target_type="onboarding_session")
async def start_session(
    body: OnboardingStartRequest,
    principal: Principal,
    _perm: Principal = require_permission("onboarding:write"),
) -> OnboardingSessionRead:
    return await onboarding_wizard.start(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        user_id=principal.user_id,
    )


@router.get("/sessions/{session_id}", response_model=OnboardingSessionRead)
@audit(action="onboarding.get", target_type="onboarding_session")
async def get_session(
    session_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("onboarding:read"),
) -> OnboardingSessionRead:
    state = await onboarding_wizard.get_state(session_id)
    if str(state.tenant_id) != principal.tenant_id:
        raise HTTPException(status_code=404, detail="onboarding_session_not_found")
    return state


@router.post("/sessions/{session_id}/advance", response_model=OnboardingSessionRead)
@audit(action="onboarding.advance", target_type="onboarding_session")
async def advance_session(
    session_id: UUID,
    body: OnboardingAdvanceRequest,
    principal: Principal,
    _perm: Principal = require_permission("onboarding:write"),
) -> OnboardingSessionRead:
    state = await onboarding_wizard.get_state(session_id)
    if str(state.tenant_id) != principal.tenant_id:
        raise HTTPException(status_code=404, detail="onboarding_session_not_found")
    try:
        return await onboarding_wizard.advance(session_id, body)
    except WizardError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/cancel", response_model=OnboardingSessionRead)
@audit(action="onboarding.cancel", target_type="onboarding_session")
async def cancel_session(
    session_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("onboarding:write"),
) -> OnboardingSessionRead:
    state = await onboarding_wizard.get_state(session_id)
    if str(state.tenant_id) != principal.tenant_id:
        raise HTTPException(status_code=404, detail="onboarding_session_not_found")
    return await onboarding_wizard.cancel(session_id)


__all__ = ["router"]
