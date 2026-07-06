"""F-800 — Forge Co-pilot data model.

Two tenant-scoped, user-isolated tables that back the conversational
assistant. Per Rule 2 every row carries ``tenant_id`` and ``project_id``;
per F-800 design every row also carries ``user_id`` and a service-layer
filter enforces user privacy in addition to the DB-level RLS.

* ``CopilotConversation`` — one row per user-visible thread. Nullable
  ``project_id`` because some threads are tenant-wide (org standards,
  policy Q&A).
* ``CopilotMessage`` — one row per turn in a thread. ``role`` is one of
  ``user | assistant | system | tool``. ``content`` is markdown for
  user/assistant and a JSON envelope for ``tool`` rows.

This module defines the tables only; the service layer
(``app/services/copilot_service.py`` — Plan 1) wires reads/writes, audit,
and budget admission. RLS lives in the alembic migration; per-user
isolation is enforced by the service-layer ``WHERE user_id = principal``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    JSONB,
    Base,
    GUID,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


# ---------------------------------------------------------------------------
# Conversation
# ---------------------------------------------------------------------------


class CopilotConversation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One Co-pilot conversation thread per user.

    The user_id column is the *privacy* boundary — RLS protects the
    tenant boundary; user_id protects the user's personal history.
    project_id is nullable for tenant-wide threads (no project selected).
    """

    __tablename__ = "copilot_conversations"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    message_count: Mapped[int] = mapped_column(default=0, nullable=False)
    total_cost_usd: Mapped[float] = mapped_column(
        Numeric(18, 8), nullable=False, default=0
    )
    total_tokens_in: Mapped[int] = mapped_column(default=0, nullable=False)
    total_tokens_out: Mapped[int] = mapped_column(default=0, nullable=False)

    __table_args__ = (
        Index(
            "ix_copilot_conv_user_updated",
            "user_id",
            "updated_at",
        ),
        Index(
            "ix_copilot_conv_tenant_updated",
            "tenant_id",
            "updated_at",
        ),
    )


# ---------------------------------------------------------------------------
# Message
# ---------------------------------------------------------------------------


class CopilotMessage(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single message in a Co-pilot conversation.

    ``role`` mirrors OpenAI: ``user | assistant | system | tool``.
    ``content`` is markdown for user/assistant and a JSON envelope for
    tool rows. ``tool_calls``, ``citations``, ``suggested_actions`` are
    nullable JSON envelopes only populated for assistant messages.
    """

    __tablename__ = "copilot_messages"

    conversation_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("copilot_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    tool_calls: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    suggested_actions: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(10), nullable=True)
    feedback_rating: Mapped[str | None] = mapped_column(String(10), nullable=True)
    feedback_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cost_usd: Mapped[float] = mapped_column(
        Numeric(18, 8), nullable=False, default=0
    )
    tokens_in: Mapped[int] = mapped_column(default=0, nullable=False)
    tokens_out: Mapped[int] = mapped_column(default=0, nullable=False)
    latency_ms: Mapped[int] = mapped_column(default=0, nullable=False)
    context_tokens: Mapped[int] = mapped_column(default=0, nullable=False)
    # M10 — typing indicator flag. ``True`` while a streaming assistant
    # response is in-flight (placeholder row visible to the UI before the
    # model has finished). The Co-pilot service flips it to ``False`` on
    # the terminal ``done`` event. Non-streaming ``chat()`` always
    # persists with the default ``False``.
    typing_indicator: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    __table_args__ = (
        Index(
            "ix_copilot_msg_conv_created",
            "conversation_id",
            "created_at",
        ),
        Index(
            "ix_copilot_msg_feedback",
            "feedback_rating",
            postgresql_where=Text("feedback_rating IS NOT NULL"),
        ),
    )


__all__ = ["CopilotConversation", "CopilotMessage"]
