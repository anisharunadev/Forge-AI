"""UserApiToken + UserSession (Step 73 — Settings).

Step 73 wires the remaining 13 Settings tabs to real backend. Two new
tables power the API Tokens and Sessions tabs:

* ``user_api_tokens`` — opaque bearer tokens issued to a user; only a
  sha256 fingerprint is stored, never the secret. Full secret is
  returned exactly once at creation (LiteLLM Virtual Key pattern,
  Step 65).
* ``user_sessions`` — refresh-token chain state per (user, device).
  ``last_seen_at`` is updated each /auth/refresh. Revoked rows are
  retained for audit but excluded from list endpoints.

Per Rule 2 every row carries ``tenant_id`` plus either ``user_id`` or
``project_id``; composite indexes are added on the read paths.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, GUID, TimestampMixin, UUIDPrimaryKeyMixin


class UserApiToken(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """API token issued to a user (Settings → API Tokens tab).

    The plaintext secret is shown to the user exactly once at creation
    time and then discarded — only ``fingerprint_sha256[12]`` and the
    full ``secret_hash`` (sha256 of the plaintext) are persisted. The
    fingerprint is what gets rendered in the list view.
    """

    __tablename__ = "user_api_tokens"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    scope: Mapped[str] = mapped_column(String(64), nullable=False, default="read")
    fingerprint_sha256: Mapped[str] = mapped_column(String(12), nullable=False)
    # ponytail: full sha256 of the plaintext; sufficient for verify given
    # the small keyspace. Swap for argon2 if rotating to user-supplied
    # passwords later.
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_user_api_tokens_user_active", "user_id", "revoked_at"),
        Index("ix_user_api_tokens_tenant_active", "tenant_id", "revoked_at"),
    )


class UserSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A logged-in browser/device session (Settings → Sessions tab).

    One row per refresh-token issue; principal.session_id resolves to
    the ``id`` here. ``revoked_at`` non-NULL means the session was
    killed either explicitly (Settings tab) or implicitly (password
    reset — out of scope here).
    """

    __tablename__ = "user_sessions"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    user_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_agent: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    ip: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # ponytail: client-reported label ("Chrome on macOS"), best-effort.
    label: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_user_sessions_user_active", "user_id", "revoked_at"),
    )


__all__ = ["UserApiToken", "UserSession"]
