"""Phase 8 SC-8.2 / SC-8.8 - shared fixtures for security tests.

This conftest mirrors the backend's ``tests/conftest.py`` fixtures
(``sqlite_db``, ``fresh_bus``) so the security pen-tests can run
against the real service code paths without duplicating the
engine-spinup logic.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Backend on sys.path.
_BACKEND = Path(__file__).resolve().parents[2] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# Module-level env setup so pydantic-settings can construct
# ``Settings`` at import time.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("LITELLM_PROXY_URL", "http://localhost:4000")
os.environ.setdefault("LITELLM_API_KEY", "test-key")
os.environ.setdefault("LITELLM_ADMIN_KEY", "test-admin-key")
os.environ.setdefault("KEYCLOAK_URL", "http://localhost:8080")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENVIRONMENT", "test")

# Pre-stub the lazy DB engine so importing ``app.main`` doesn't try to
# open a Postgres pool during unit tests that don't use sqlite_db.
import app.db.session as _sess

_sess._engine = object()  # type: ignore[assignment]
_sess._session_factory = object()  # type: ignore[assignment]

import pytest
import pytest_asyncio





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

    # Ensure all model modules are imported so metadata is populated.
    # Imports must happen BEFORE the projects stub check below, otherwise
    # the now-real ``app.db.models.project.Project`` table conflicts with
    # the legacy stub (Plan 0 — project schema anchor).
    from app.db.models import (  # noqa: F401
        agent,
        approval,
        architecture,
        architecture_services,
        artifact,
        audit,
        command_run,
        connector,
        conflict,
        copilot,
        cost,
        graph,
        hook,
        ideation,
        ideation_signal,
        lesson,
        litellm_budget_config,
        litellm_call_record,
        litellm_key_audit,
        litellm_model_assignment,
        litellm_team_mapping,
        marketplace,
        model_provider,
        observability,
        onboarding,
        persona_memory,
        policy,
        project,
        repo_ingestion,
        role,
        seed,
        security_report,
        standard,
        steering_rule,
        template,
        tenant,
        terminal_cost,
        tool_bundle,
        user,
        workflow,
        workflow_budget,
    )

    # Legacy fallback: only stub ``projects`` if no real model owns the
    # table. As of Plan 0 (project schema anchor), ``app.db.models.project.Project``
    # is the authoritative definition.
    if "projects" not in base_mod.metadata.tables:
        Table(
            "projects",
            base_mod.metadata,
            Column("id", base_mod.GUID(), primary_key=True),
            Column("tenant_id", base_mod.GUID(), nullable=False),
            Column("name", String(200), nullable=False),
        )

    # M5 T-A6 — also import the service-level KGNode / KGEdge models so
    # ``metadata.create_all`` registers ``kg_nodes`` for the new
    # artifact_registry.register path and the SecurityReport service
    # can mirror rows. KGNode lives in app.services.knowledge_graph
    # (not app.db.models) so a bare ``from app.db.models import …``
    # doesn't pick it up.
    from app.services import knowledge_graph as _kg_module  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

    # M5 T-A6 — sqlite_db must accept models that declare PG-only
    # ``ARRAY`` columns (e.g. ``phase4_sso_configs``) without those
    # tables blowing up the entire ``create_all`` pass on SQLite.
    # We try the full metadata first, and if any compile fails we
    # drop the offending tables and re-run.
    pg_only_tables: list = []
    try:
        async with engine.begin() as conn:
            await conn.run_sync(base_mod.metadata.create_all)
    except Exception as exc:  # noqa: BLE001 — any sqlite compile failure
        # Identify the offending tables by retrying each one in isolation.
        from sqlalchemy import create_engine as _ce
        sync_url = "sqlite:///:memory:"
        sync_engine = _ce(sync_url)
        for table in list(base_mod.metadata.tables.values()):
            try:
                table.create(sync_engine, checkfirst=False)
            except Exception:  # noqa: BLE001
                pg_only_tables.append(table.name)
        # Drop the PG-only tables from the metadata so the SQLite path
        # can create_all without tripping on them.
        for name in pg_only_tables:
            tbl = base_mod.metadata.tables.get(name)
            if tbl is not None:
                base_mod.metadata.remove(tbl)
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
    # Only drop when we created the stub ourselves (real Project model
    # must NOT be removed from shared metadata).
    if "projects" in base_mod.metadata.tables and base_mod.metadata.tables["projects"].schema is None:
        # Heuristic: stub was Table(..., base_mod.metadata, ...) with no schema;
        # real Project registers via DeclarativeBase which also has no schema,
        # so we additionally guard on the absence of the Tenant FK the real
        # model carries (``ForeignKey("tenants.id")``).
        proj = base_mod.metadata.tables["projects"]
        has_tenant_fk = any(
            c.foreign_keys and any(fk.column.table.name == "tenants" for fk in c.foreign_keys)
            for c in proj.columns
        )
        if not has_tenant_fk:
            base_mod.metadata.remove(proj)


# ---------------------------------------------------------------------------
# Phase 4 SC-4.3 / SC-4.4 — shared tenant fixtures.
#
# Avoid the per-file ``Tenant(slug=f"t-{uuid.uuid4().hex[:8]}", name=...)``
# ceremony. Use ``two_tenants`` to grab (tenant_a, tenant_b, project_for_a)
# in one call. PR-4.5 will fold any stragglers onto these fixtures.
# ---------------------------------------------------------------------------

