"""F-829d — Per-tenant guardrail assignment mirror.

A single mirror row per tenant that holds the set of LiteLLM
guardrail ids currently enforced for the tenant's team. This is
NOT the authoritative state (LiteLLM's Team config is) — it is a
best-effort read cache for the Steward UI so the page can render
"which guardrails are active for this tenant" without re-querying
LiteLLM on every page load.

The catalog of *available* guardrails is pulled live from LiteLLM
on every read (see :class:`GuardrailSync.list_catalog`); only the
per-tenant *assignment* is mirrored here.

Rules respected:
* Rule 1 — no direct LLM SDKs (we mirror what LiteLLM reports).
* Rule 2 — composite index ``(tenant_id, project_id)`` enforces
  tenant isolation (DL-026 also enables RLS at the migration level).
* Rule 3 — every write is auditable; this row carries
  ``assigned_at`` + ``assigned_by`` so the audit trail is self-contained.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ARRAY, GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class LiteLLMGuardrailAssignment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Mirror row: which guardrails are active for a tenant's LiteLLM Team.

    ``guardrail_ids`` is the array of guardrail names assigned to the
    tenant's team in LiteLLM (e.g. ``["aporia_pii", "lakera_prompt_injection"]``).
    One row per tenant; the previous row is deleted on reassignment
    (see :meth:`GuardrailSync.assign_to_tenant`) so the mirror
    reflects a single authoritative state.
    """

    __tablename__ = "litellm_guardrail_assignments"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    litellm_team_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    guardrail_ids: Mapped[list[str]] = mapped_column(
        ARRAY(String),
        nullable=False,
        default=list,
        server_default="{}",
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    assigned_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Free-form metadata for future per-assignment notes (e.g. source UI,
    # change reason, link to a Steward ticket). Kept narrow on purpose —
    # the row is a mirror, not a domain object.
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict, server_default="{}"
    )

    __table_args__ = (
        Index(
            "ix_litellm_guardrail_assignments_tenant_project",
            "tenant_id",
            "project_id",
        ),
    )


__all__ = ["LiteLLMGuardrailAssignment"]
