"""Pytest fixtures shared by the backend suite.

Phase 2 is a scaffold; the fixtures here ensure tests can run without
Postgres / Redis by switching the event bus to in-memory mode.
"""

from __future__ import annotations

import os

# Module-level env setup so pydantic-settings can construct ``Settings``
# at *import* time (e.g. ``from app.db.session import get_session_factory``
# triggers ``Settings()`` before any fixtures run).
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("LITELLM_PROXY_URL", "http://localhost:4000")
os.environ.setdefault("LITELLM_API_KEY", "test-key")
os.environ.setdefault("KEYCLOAK_URL", "http://localhost:8080")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENVIRONMENT", "test")

import pytest
import pytest_asyncio


@pytest.fixture(autouse=True)
def _set_test_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provide minimum env so pydantic-settings can construct Settings."""
    monkeypatch.setenv(
        "DATABASE_URL",
        os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///:memory:"),
    )
    monkeypatch.setenv("REDIS_URL", os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    monkeypatch.setenv(
        "LITELLM_PROXY_URL",
        os.environ.get("LITELLM_PROXY_URL", "http://localhost:4000"),
    )
    monkeypatch.setenv("LITELLM_API_KEY", os.environ.get("LITELLM_API_KEY", "test-key"))
    monkeypatch.setenv("KEYCLOAK_URL", os.environ.get("KEYCLOAK_URL", "http://localhost:8080"))
    monkeypatch.setenv("JWT_SECRET", os.environ.get("JWT_SECRET", "test-secret"))
    monkeypatch.setenv("ENVIRONMENT", "test")


@pytest.fixture
def event_bus():
    """In-memory event bus for tests (no Redis required)."""
    from app.services.event_bus import EventBus

    bus = EventBus(use_redis=False)
    yield bus


@pytest_asyncio.fixture
async def sqlite_db(monkeypatch: pytest.MonkeyPatch):
    """Spin up an in-memory SQLite engine and create all tables.

    Tests that hit the DB through `get_session_factory()` will share
    this engine. We override the lazy initializer so model metadata
    registers against our engine, not the production one.

    A minimal `projects` table is registered so existing FKs in the
    M1 models (which point at `projects.id`) don't error during
    metadata.create_all.
    """
    from sqlalchemy import Column, MetaData, String, Table
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.db import base as base_mod
    from app.db.session import get_session_factory as _prod_get_session_factory  # noqa: F401

    # Stub the missing projects table.
    if "projects" not in base_mod.metadata.tables:
        Table(
            "projects",
            base_mod.metadata,
            Column("id", base_mod.GUID(), primary_key=True),
            Column("tenant_id", base_mod.GUID(), nullable=False),
            Column("name", String(200), nullable=False),
        )

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    # Ensure all model modules are imported so metadata is populated.
    from app.db.models import (  # noqa: F401
        agent,
        approval,
        artifact,
        audit,
        connector,
        cost,
        hook,
        ideation,
        marketplace,
        model_provider,
        onboarding,
        policy,
        role,
        standard,
        steering_rule,
        template,
        tenant,
        user,
        workflow,
        workflow_budget,
    )

    async with engine.begin() as conn:
        await conn.run_sync(base_mod.metadata.create_all)

    import app.db.session as session_mod

    monkeypatch.setattr(session_mod, "_engine", engine)
    monkeypatch.setattr(session_mod, "_session_factory", factory)

    yield factory

    await engine.dispose()
    monkeypatch.setattr(session_mod, "_engine", None)
    monkeypatch.setattr(session_mod, "_session_factory", None)
    # Drop the stub to avoid contaminating other tests' metadata.
    base_mod.metadata.remove(base_mod.metadata.tables["projects"])

