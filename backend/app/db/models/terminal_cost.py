"""TerminalSessionCost (F-412).

Per-session cost rollup persisted alongside the append-only
:mod:`app.db.models.cost.CostEntry` ledger. We keep the rollup here so
dashboard reads don't have to aggregate every CostEntry row for an
active session on every poll, while the ledger remains the source of
truth for the audit trail.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, UUIDPrimaryKeyMixin


class TerminalSessionCost(Base, UUIDPrimaryKeyMixin):
    """One row per (session, model) — append-only rollup.

    A given session may have multiple rows when the user switches
    between Claude Code, Codex, and Gemini mid-session. The dashboard
    groups by model; the per-session total sums all rows.
    """

    __tablename__ = "terminal_session_costs"

    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False, default=0)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    command_count: Mapped[int] = mapped_column(nullable=False, default=0)
    duration_seconds: Mapped[float] = mapped_column(nullable=False, default=0.0)

    __table_args__ = (
        Index("ix_tsc_session_model", "session_id", "model"),
        Index("ix_tsc_tenant_recorded", "tenant_id", "recorded_at"),
    )


__all__ = ["TerminalSessionCost"]
