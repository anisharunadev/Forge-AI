"""F-829k — Forge-side LLM call record with trace correlation.

Every call made through :class:`app.integrations.litellm.llm_client.ForgeLLMClient`
emits one row here. The `forge_trace_id` is the OpenTelemetry trace id
that the caller was already carrying; the LiteLLM call id from the
response is captured as `litellm_call_id` so we can correlate the two
sides of the gateway.

The `cost_ledger` table still owns the canonical spend record; this
table is the operation-level audit log (request id, model, status,
latency, prompt/completion tokens).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, UUIDPrimaryKeyMixin


class LiteLLMCallStatus(StrEnum):
    """Outcome of a single LLM call."""

    SUCCESS = "success"
    FAILED = "failed"
    BUDGET_BLOCKED = "budget_blocked"
    BUDGET_EXCEEDED = "budget_exceeded"
    RATE_LIMITED = "rate_limited"
    UPSTREAM_ERROR = "upstream_error"
    LITELLM_DOWN = "litellm_down"


class LiteLLMCallRecord(Base, UUIDPrimaryKeyMixin):
    """One row per LLM call made through the integration layer.

    `forge_trace_id` correlates with the caller's OpenTelemetry span.
    `litellm_call_id` correlates with LiteLLM's own spend logs.
    `latency_ms` and `status` are surfaced in the health and usage
    dashboards.
    """

    __tablename__ = "litellm_call_records"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    workflow_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    forge_trace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    litellm_call_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    __table_args__ = (
        Index(
            "ix_litellm_call_records_tenant_occurred",
            "tenant_id",
            "occurred_at",
        ),
        Index(
            "ix_litellm_call_records_forge_trace",
            "forge_trace_id",
        ),
    )


__all__ = ["LiteLLMCallRecord", "LiteLLMCallStatus"]
