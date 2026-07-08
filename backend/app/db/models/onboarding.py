"""Project Onboarding Wizard — state machine for first-run setup (F-021)."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class OnboardingStatus(enum.StrEnum):
    """Lifecycle of a wizard session."""

    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class OnboardingStepStatus(enum.StrEnum):
    """Outcome of a single wizard step."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    FAILED = "failed"


class OnboardingSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A tenant user's run through the onboarding wizard.

    `current_step` holds the step name the user is on (e.g.
    "configure_agents"); `state` holds arbitrary wizard-internal
    state (collected connectors, detected stack, etc.).
    """

    __tablename__ = "onboarding_sessions"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    status: Mapped[OnboardingStatus] = mapped_column(
        SAEnum(OnboardingStatus, name="onboarding_status"),
        nullable=False,
        default=OnboardingStatus.ACTIVE,
    )
    current_step: Mapped[str] = mapped_column(String(64), nullable=False, default="tenant_setup")
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_onboarding_sessions_tenant_project", "tenant_id", "project_id"),)


class OnboardingStep(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Audit row per step a wizard session visited."""

    __tablename__ = "onboarding_steps"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    session_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("onboarding_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    step_name: Mapped[str] = mapped_column(String(64), nullable=False)
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[OnboardingStepStatus] = mapped_column(
        SAEnum(OnboardingStepStatus, name="onboarding_step_status"),
        nullable=False,
        default=OnboardingStepStatus.PENDING,
    )
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    output: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_onboarding_steps_session_order", "session_id", "step_order"),)


__all__ = [
    "OnboardingSession",
    "OnboardingStatus",
    "OnboardingStep",
    "OnboardingStepStatus",
]
