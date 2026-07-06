"""BoardConfirmation — board-level ack of plan revisions (Step-72).

Replaces the orchestrator-stub board-confirmations fixture with a
durable store so the Governance Center can list and ack confirmations
through the real backend (the stub stays for dev).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class BoardConfirmationOutcome(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"


class BoardConfirmation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A board-level confirmation (per Rule 3 — Architecture boundary)."""

    __tablename__ = "board_confirmations"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False)
    plan_rev: Mapped[str] = mapped_column(String(64), nullable=False)
    outcome: Mapped[BoardConfirmationOutcome] = mapped_column(
        SAEnum(BoardConfirmationOutcome, name="board_confirmation_outcome"),
        nullable=False,
        default=BoardConfirmationOutcome.PENDING,
    )
    decider_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    __table_args__ = (
        Index(
            "ix_board_conf_tenant_project_decided",
            "tenant_id",
            "project_id",
            "decided_at",
        ),
        UniqueConstraint(
            "tenant_id",
            "idempotency_key",
            name="uq_board_conf_tenant_idempotency",
        ),
    )


__all__ = ["BoardConfirmation", "BoardConfirmationOutcome"]
