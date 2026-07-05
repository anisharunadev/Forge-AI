"""Pytest fixtures shared by the backend suite.

Phase 2 is a scaffold; the fixtures here ensure tests can run without
Postgres / Redis by switching the event bus to in-memory mode.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta

# Module-level env setup so pydantic-settings can construct ``Settings``
# at *import* time (e.g. ``from app.db.session import get_session_factory``
# triggers ``Settings()`` before any fixtures run).
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("LITELLM_PROXY_URL", "http://localhost:4000")
os.environ.setdefault("LITELLM_API_KEY", "test-key")
os.environ.setdefault("LITELLM_ADMIN_KEY", "test-admin-key")
os.environ.setdefault("KEYCLOAK_URL", "http://localhost:8080")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENVIRONMENT", "test")

import pytest
import pytest_asyncio


# ---------------------------------------------------------------------------
# M5 Architecture Center (T-A1) — Grant architecture-approval fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def grant_architecture_approval():
    """Helper factory that returns a frozen SDLCState with a recorded
    architecture-phase approval.

    Usage::

        def test_foo(grant_architecture_approval):
            state, env = grant_architecture_approval()
            # `state` is an SDLCState with pending_approval set and
            # metadata["approval:architecture:decision"] recorded as
            # granted=True — call a `@require_approval_phase(
            # SDLCPhase.ARCHITECTURE)` decorated handler with `state`
            # as the first positional argument and the gate passes.
            # `env` is the frozen ``ApprovalEnvelope`` for assertions.

    The fixture is opt-in — only tests that exercise the gate must
    pull it in. Existing 37 architecture tests don't touch the gate
    (they call services directly) so they keep passing unchanged.
    """

    def _factory(*, granted: bool = True) -> tuple:
        from app.agents.approval_gate import ApprovalEnvelope, frozen_state_envelope
        from app.agents.sdlc_state import (
            ApprovalRequest,
            ApprovalResponse,
            SDLCPhase,
            SDLCState,
        )

        tenant_id = uuid.uuid4()
        project_id = uuid.uuid4()
        actor_id = uuid.uuid4()

        pending = ApprovalRequest(
            approval_id=uuid.uuid4(),
            type="architecture",
            required_role="forge-architect",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        # Build a baseline state with the pending approval pinned.
        state = SDLCState(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            context={"repo_path": "/tmp", "workspace_path": "/tmp/ws"},
        ).set_pending_approval(pending).with_phase(SDLCPhase.BLOCKED_APPROVAL)

        decision_key = f"approval:{SDLCPhase.ARCHITECTURE.value}:decision"
        base_metadata = {
            **state.metadata,
            decision_key: {
                "granted": granted,
                "decided_by": str(uuid.uuid4()),
                "reason": "test-grant-architecture-approval",
                "decided_at": datetime.now(UTC).isoformat(),
            },
        }
        state = state.model_copy(
            update={"metadata": base_metadata}, deep=True
        )

        # If the caller wants the canonical envelope (e.g. for the
        # audit/audit-row end of T-A4), build + stamp it.
        envelope_response = ApprovalResponse(
            approval_id=pending.approval_id,
            granted=granted,
            decided_by=uuid.uuid4(),
            reason="test-grant-architecture-approval",
            decided_at=datetime.now(UTC),
        )
        envelope = ApprovalEnvelope.from_response(
            phase=SDLCPhase.ARCHITECTURE,
            tenant_id=tenant_id,
            project_id=project_id,
            response=envelope_response,
        )
        state = frozen_state_envelope(state, envelope)
        return state, envelope

    return _factory


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
    monkeypatch.setenv("LITELLM_ADMIN_KEY", os.environ.get("LITELLM_ADMIN_KEY", "test-admin-key"))
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

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

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

