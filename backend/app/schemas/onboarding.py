"""Schemas for F-021 — Project Onboarding Wizard."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.db.models.onboarding import OnboardingStatus, OnboardingStepStatus
from app.schemas.common import ForgeBaseModel, TenantScopedModel


class OnboardingStepRead(ForgeBaseModel):
    id: UUID
    step_name: str
    step_order: int
    status: OnboardingStepStatus
    input: dict[str, Any]
    output: dict[str, Any]
    error_message: str | None = None
    created_at: datetime


class OnboardingSessionRead(TenantScopedModel):
    id: UUID
    user_id: UUID
    status: OnboardingStatus
    current_step: str
    state: dict[str, Any]
    completed_at: datetime | None = None
    steps: list[OnboardingStepRead] = Field(default_factory=list)


class OnboardingStartRequest(ForgeBaseModel):
    project_id: UUID


class OnboardingAdvanceRequest(ForgeBaseModel):
    step_input: dict[str, Any] = Field(default_factory=dict)
    mark_complete: bool = True
