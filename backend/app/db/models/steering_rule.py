"""SteeringRule — auto-discovered agent steering rules (F-504).

A steering rule is a Markdown document under the workspace (e.g.
``**/steering/*.md``, ``**/.forge/steering.md``, ``**/AGENTS.md``,
``**/CLAUDE.md``) that carries YAML front-matter declaring which agent
stages it applies to. At session start the engine indexes all matching
files into this table; a watchdog re-indexes on file change.

Rule 2 compliance: every row carries ``tenant_id`` + ``project_id``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import ARRAY, Base, GUID, JSONB, TimestampMixin, UUIDPrimaryKeyMixin


class SteeringRule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A steering rule file, indexed for the current project.

    ``file_path`` is the relative path inside the project workspace.
    ``content_hash`` is a SHA-256 hex digest of ``content``; it lets the
    file watcher detect real content changes vs. spurious mtime updates.
    ``applies_to_stages`` is the parsed list from front-matter
    (e.g. ``["pre_plan", "pre_code", "pre_commit"]``).
    ``scope`` mirrors the front-matter ``scope`` field — typically
    ``"org"`` (shared across tenant) or ``"project"``.
    """

    __tablename__ = "steering_rules"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(
        GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    rule_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    indexed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    scope: Mapped[str] = mapped_column(String(64), nullable=False, default="project")
    applies_to_stages: Mapped[list[str]] = mapped_column(
        ARRAY(String(64)),
        nullable=False,
        default=list,
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        default=dict,
    )

    __table_args__ = (
        Index(
            "ix_steering_rules_tenant_project_path",
            "tenant_id",
            "project_id",
            "file_path",
        ),
        Index(
            "uq_steering_rules_tenant_project_rule",
            "tenant_id",
            "project_id",
            "rule_id",
            unique=True,
        ),
    )

    def to_dict(self) -> dict[str, Any]:
        """Serialize for API responses."""
        import json as _json

        meta = {}
        if isinstance(self.metadata_, str) and self.metadata_:
            try:
                meta = _json.loads(self.metadata_)
            except _json.JSONDecodeError:
                meta = {}
        return {
            "id": str(self.id),
            "tenant_id": str(self.tenant_id),
            "project_id": str(self.project_id),
            "rule_id": self.rule_id,
            "file_path": self.file_path,
            "content_hash": self.content_hash,
            "indexed_at": self.indexed_at.isoformat(),
            "content": self.content,
            "scope": self.scope,
            "applies_to_stages": list(self.applies_to_stages or []),
            "metadata": meta,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


__all__ = ["SteeringRule"]