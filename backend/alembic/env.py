"""Alembic migration environment.

Reads ``DATABASE_URL`` from :mod:`app.core.config` so the migration
runner and the application share one source of truth. Supports async
SQLAlchemy via asyncpg (matches the runtime engine).

Why this file exists:
- ``backend/alembic.ini`` declares ``script_location = alembic`` but the
  directory was missing; this env.py is the canonical alembic bootstrap.
- Existing partial migrations under ``backend/app/db/migrations/versions/``
  are NOT picked up here — they were hand-written and assume a
  pre-existing schema. They should be folded in during Plan 6 schema
  reconciliation. For Plan 0 we autogenerate from the live ORM models
  so ``alembic upgrade head`` produces a coherent baseline.

References: ADR-002 (PostgreSQL 17 + AGE + pgvector).
"""

from __future__ import annotations

import asyncio

# Make ``app.*`` importable when running ``alembic`` from anywhere.
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import app.db.models  # noqa: F401,E402 — register all ORM models on Base.metadata
from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402

# Alembic Config object — provides access to alembic.ini values.
config = context.config

# Override sqlalchemy.url from settings (12-factor: never hardcode credentials).
# Async engine requires the +asyncpg driver suffix; normalize if missing.
_db_url = settings.database_url
if _db_url.startswith("postgresql://") and "+asyncpg" not in _db_url and "+psycopg" not in _db_url:
    _db_url = "postgresql+asyncpg://" + _db_url[len("postgresql://") :]
elif _db_url.startswith("postgres://") and "+asyncpg" not in _db_url and "+psycopg" not in _db_url:
    _db_url = "postgresql+asyncpg://" + _db_url[len("postgres://") :]
config.set_main_option("sqlalchemy.url", _db_url)

# Configure Python logging from alembic.ini (if present).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata for autogenerate.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Emits SQL to stdout without connecting to a database. Useful for
    producing migration scripts for environments that apply them
    via a separate tool.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode using an async engine.

    Wraps ``async_engine_from_config`` so we honour ``poolclass=NullPool``
    during migrations (per alembic async best-practice). Each migration
    opens its own short-lived connection.
    """
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
