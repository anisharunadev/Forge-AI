"""SQLAlchemy 2.0 declarative base + naming conventions.

Centralizes conventions so alembic autogenerate produces stable names
across all migrations.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, MetaData, String, Text
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class GUID(TypeDecorator):  # noqa: D401 — type decorator
    """Cross-dialect UUID column.

    Uses native UUID on Postgres, CHAR(32) elsewhere. We always run on
    Postgres, but keeping cross-dialect support avoids surprise breakage
    in tests against SQLite.
    """

    impl = String
    cache_ok = True

    def load_dialect_impl(self, dialect: Any):  # type: ignore[override]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PGUUID(as_uuid=True))
        return dialect.type_descriptor(String(32))

    def process_bind_param(self, value: Any, dialect: Any):  # type: ignore[override]
        if value is None:
            return None
        if dialect.name == "postgresql":
            return value if isinstance(value, UUID) else UUID(str(value))
        return str(value)

    def process_result_value(self, value: Any, dialect: Any):  # type: ignore[override]
        if value is None:
            return None
        return value if isinstance(value, UUID) else UUID(str(value))


class JSONB(TypeDecorator):
    """Postgres JSONB on Postgres, plain JSON elsewhere.

    Production runs on Postgres where JSONB is the right choice. The
    SQLite fallback keeps tests runnable without a Postgres instance.
    """

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect: Any):  # type: ignore[override]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_JSONB())
        return dialect.type_descriptor(JSON())


class ARRAY(TypeDecorator):
    """Postgres ARRAY on Postgres; JSON-encoded Text on SQLite.

    The SQLite fallback serializes as JSON in a Text column so list
    semantics survive tests without a Postgres instance.
    """

    impl = Text
    cache_ok = True

    def __init__(self, item_type: Any = String) -> None:
        super().__init__()
        self._item_type = item_type

    def load_dialect_impl(self, dialect: Any):  # type: ignore[override]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_ARRAY(self._item_type))
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value: Any, dialect: Any):  # type: ignore[override]
        if value is None:
            return None
        if dialect.name == "postgresql":
            return list(value)
        import json as _json

        return _json.dumps(list(value))

    def process_result_value(self, value: Any, dialect: Any):  # type: ignore[override]
        if value is None:
            return None
        if dialect.name == "postgresql":
            return list(value)
        import json as _json

        return _json.loads(value)


def _utcnow() -> datetime:
    return datetime.now(UTC)


NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    """Declarative base. All ORM models inherit from this."""

    metadata = metadata
    type_annotation_map = {UUID: GUID()}


class TimestampMixin:
    """created_at + updated_at columns."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        onupdate=_utcnow,
        nullable=False,
    )


class UUIDPrimaryKeyMixin:
    """UUID primary key with server-side default."""

    id: Mapped[UUID] = mapped_column(
        GUID(),
        primary_key=True,
        default=uuid4,
        nullable=False,
    )


class TenantScopedMixin:
    """tenant_id + project_id columns (Rule 2 — never optional)."""

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
