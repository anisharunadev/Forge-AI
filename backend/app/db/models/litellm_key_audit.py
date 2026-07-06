"""F-829b — Virtual Key audit ledger.

The key VALUE never lives in the database — only metadata. The actual
key is stored in AWS Secrets Manager (see
:mod:`app.integrations.litellm.secrets_manager_client`). This table is
the append-only audit trail of every key lifecycle event:

* minted — a new Virtual Key was provisioned
* rotated — a new key was issued; the old one revoked
* revoked — the key was deleted in LiteLLM (tenant archive, manual)
* leaked — operator flagged the key for emergency rotation
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, Base, UUIDPrimaryKeyMixin


class LiteLLMKeyAction(str, Enum):
    """Action performed on a Virtual Key."""

    MINTED = "minted"
    ROTATED = "rotated"
    REVOKED = "revoked"
    LEAKED = "leaked"


class LiteLLMKeyAudit(Base, UUIDPrimaryKeyMixin):
    """Append-only audit row for a Virtual Key lifecycle event.

    `litellm_key_alias` is the LiteLLM key_alias (NOT the value).
    `litellm_key_hash` is a SHA-256 fingerprint of the key value for
    correlation with LiteLLM's own spend logs (the value itself never
    leaves Secrets Manager).
    """

    __tablename__ = "litellm_key_audit"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    litellm_team_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    litellm_key_alias: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    litellm_key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )

    __table_args__ = (
        Index(
            "ix_litellm_key_audit_tenant_project_occurred",
            "tenant_id",
            "project_id",
            "occurred_at",
        ),
    )


__all__ = ["LiteLLMKeyAudit", "LiteLLMKeyAction"]
