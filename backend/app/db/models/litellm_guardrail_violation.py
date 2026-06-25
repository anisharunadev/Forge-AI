"""F-829i — Guardrail violation ledger (LiteLLM Proxy ingest target).

Every guardrail violation emitted by the LiteLLM Proxy's
``/guardrail/violations`` endpoint is mirrored here so the Steward can
review them in ``/governance/compliance``. The actual blocking happens
inside LiteLLM; this row is the read-side audit record and the source
for the ``compliance.violation`` domain event.

Tenant scoping: every row carries ``tenant_id`` and ``project_id`` (Rule
2). The schema mirror is ``TenantScopedMixin``; the query side uses
:mod:`app.db.rls` to enforce per-tenant reads.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import (
    Base,
    GUID,
    TenantScopedMixin,
    UUIDPrimaryKeyMixin,
)


class GuardrailSeverity(str, Enum):
    """Severity tier reported by the LiteLLM Proxy."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class GuardrailAction(str, Enum):
    """Action the proxy took when the violation was detected."""

    BLOCKED = "blocked"
    WARNED = "warned"
    PASSED = "passed"


class LiteLLMGuardrailViolation(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    """One row per LiteLLM guardrail violation.

    ``sanitized_content`` carries the redacted text LiteLLM returned
    (never the raw PII / prompt-injection payload — Rule 6). ``resolved``
    flips to ``True`` when the Steward acknowledges the violation in
    ``/governance/compliance``.
    """

    __tablename__ = "litellm_guardrail_violations"

    litellm_team_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    guardrail_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    action_taken: Mapped[str] = mapped_column(String(16), nullable=False)
    sanitized_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        # JSONB is the right type in Postgres but the SQLite fallback
        # also accepts JSON. We use the dialect-aware decorator from
        # ``app.db.base`` so tests run on either engine.
        Text,
        nullable=False,
        default="{}",
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    __table_args__ = (
        Index(
            "ix_litellm_guardrail_violations_tenant_occurred",
            "tenant_id",
            "occurred_at",
        ),
        Index(
            "ix_litellm_guardrail_violations_tenant_severity",
            "tenant_id",
            "severity",
        ),
    )


__all__ = [
    "LiteLLMGuardrailViolation",
    "GuardrailSeverity",
    "GuardrailAction",
]
