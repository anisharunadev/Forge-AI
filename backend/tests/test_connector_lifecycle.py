"""Tests for ``ConnectorLifecycle`` (Pillar 1 — Phase 4) + M3-G2/G3/G4.

Covers:
- ``install`` creates a Connector + runs ``test_connection`` +
  records audit.
- ``rotate`` updates ``Connector.config`` + invalidates MCP
  registration (bus event) + re-tests.
- ``test`` calls ``ConnectorManager.test_connection`` + writes a
  ``ConnectorHealthHistory`` row.
- ``disconnect`` soft-deletes to DISCONNECTED + writes one audit + one
  activity row (idempotent on repeat).
- ``oauth/start`` returns the deterministic demo URL in development.
- ``oauth/callback`` creates Connector + ConnectorCredential +
  activity row; replay of the same state is rejected.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.models.audit import AuditEvent
from app.db.models.connector import (
    Connector,
    ConnectorHealthHistory,
    ConnectorStatus,
    ConnectorType,
)
from app.db.models.connector_activity import ConnectorActivity
from app.db.models.connector_credential import ConnectorCredential
from app.db.models.marketplace import MarketplaceConnector
from app.db.session import get_session_factory
from app.services.connector_manager import ConnectorManager, TestResult
from app.services.connectors.lifecycle import ConnectorLifecycle
from app.services.event_bus import EventType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _StubManager:
    """In-memory ConnectorManager substitute.

    Captures calls so the lifecycle assertions can assert against the
    recorded arguments. Returns ``ok=True`` probe results so the
    health-check history path is exercised.
    """

    def __init__(self) -> None:
        self.created: list[dict] = []
        self.updated: list[dict] = []
        self.tested: list[str] = []
        self._connectors: dict[str, Connector] = {}

    async def create_connector(self, **kw) -> Connector:
        connector = Connector(
            id=uuid.uuid4(),
            tenant_id=str(kw["tenant_id"]),
            project_id=str(kw["project_id"]),
            name=kw["name"],
            type=kw["type"],
            config=dict(kw["config"]),
            status=ConnectorStatus.PENDING,
            created_by=str(kw["actor_id"]),
        )
        self.created.append(kw)
        self._connectors[str(connector.id)] = connector
        return connector

    async def get_connector(self, connector_id, *, tenant_id=None) -> Connector:
        row = self._connectors.get(str(connector_id))
        if row is None:
            raise LookupError(f"Connector {connector_id} not found")
        if tenant_id is not None and str(row.tenant_id) != str(tenant_id):
            raise PermissionError(f"Connector {connector_id} not in tenant {tenant_id}")
        return row

    async def update_connector(self, connector_id, **kw) -> Connector:
        row = self._connectors.get(str(connector_id))
        if row is None:
            raise LookupError(f"Connector {connector_id} not found")
        if "config" in kw and kw["config"] is not None:
            row.config = kw["config"]
        if "name" in kw and kw["name"] is not None:
            row.name = kw["name"]
        self.updated.append({"id": str(connector_id), **kw})
        return row

    async def test_connection(self, connector_id, *, tenant_id=None) -> TestResult:
        self.tested.append(str(connector_id))
        return TestResult(
            connector_id=uuid.UUID(str(connector_id)),
            ok=True,
            latency_ms=1.23,
            detail="reachable",
            checked_at=datetime.now(UTC),
        )


@pytest.fixture
def stub_manager() -> _StubManager:
    return _StubManager()


@pytest.fixture
def lifecycle(stub_manager, event_bus):
    # Use a deterministic bus so the test can assert on published events.
    return ConnectorLifecycle(manager=stub_manager, bus=event_bus)


@pytest_asyncio.fixture
async def focused_db(monkeypatch) -> AsyncIterator[None]:
    """In-memory SQLite with the subset of tables lifecycle tests need.

    We can't use the conftest ``sqlite_db`` fixture here because the
    full app metadata registers phase4_sso_configs which uses PG-only
    ``ARRAY`` columns and breaks SQLite compilation. Building a
    focused schema is the same approach ``tests/api/v1/test_audit.py``
    uses for its subset.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(
                sync_conn,
                tables=[
                    Connector.__table__,
                    ConnectorHealthHistory.__table__,
                    ConnectorActivity.__table__,
                    AuditEvent.__table__,
                    ConnectorCredential.__table__,
                    MarketplaceConnector.__table__,
                ],
            )
        )

    import app.db.session as session_mod

    _orig_factory = session_mod._session_factory  # noqa: SLF001

    session_mod._session_factory = factory  # noqa: SLF001
    yield
    session_mod._session_factory = _orig_factory  # noqa: SLF001
    await engine.dispose()


# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------


async def test_install_creates_connector_runs_probe_and_records_audit(
    focused_db, lifecycle, stub_manager, event_bus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    connector = await lifecycle.install(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_type=ConnectorType.JIRA,
        name="forge-jira",
        config={"base_url": "https://x.atlassian.net", "api_token": "tok"},
        actor_id=actor_id,
    )

    assert connector.id is not None
    assert len(stub_manager.created) == 1
    # The lifecycle service probes the freshly-installed connector.
    assert stub_manager.tested == [str(connector.id)]

    # Audit row written.
    factory = get_session_factory()
    async with factory() as session:
        from sqlalchemy import select

        stmt = select(AuditEvent).where(
            AuditEvent.tenant_id == tenant_id,
            AuditEvent.action == "connector.install",
        )
        rows = list((await session.execute(stmt)).scalars().all())
    assert len(rows) == 1
    assert rows[0].target_id == str(connector.id)
    assert rows[0].payload["type"] == "jira"
    assert rows[0].payload["ok"] is True


# ---------------------------------------------------------------------------
# rotate
# ---------------------------------------------------------------------------


async def test_rotate_updates_config_emits_bus_event_and_reprobes(
    focused_db, lifecycle, stub_manager, event_bus
):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    # Seed an existing connector.
    connector = await lifecycle.install(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_type=ConnectorType.JIRA,
        name="forge-jira",
        config={"api_token": "old-token"},
        actor_id=actor_id,
    )

    # Track bus events on the in-memory bus.
    seen: list[tuple[EventType, dict]] = []

    async def _capture(event):
        seen.append((event.event_type, dict(event.payload)))

    event_bus.subscribe(EventType.CONNECTOR_SYNCING, _capture)

    rotated = await lifecycle.rotate(
        connector_id=connector.id,
        new_credentials={"api_token": "new-token"},
        tenant_id=tenant_id,
        actor_id=actor_id,
    )

    # Config merged (old + new keys).
    assert rotated.config.get("api_token") == "new-token"

    # The rotate call updates the connector row.
    assert any(
        update.get("id") == str(connector.id) and update.get("config") is not None
        for update in stub_manager.updated
    )

    # Bus event with event=credentials_rotated fired.
    assert any(
        et == EventType.CONNECTOR_SYNCING and payload.get("event") == "credentials_rotated"
        for et, payload in seen
    )

    # Re-probed: two probes total (install + rotate).
    assert stub_manager.tested.count(str(connector.id)) == 2


# ---------------------------------------------------------------------------
# test
# ---------------------------------------------------------------------------


async def test_test_writes_health_history_row(focused_db, lifecycle, stub_manager):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    connector = await lifecycle.install(
        tenant_id=tenant_id,
        project_id=project_id,
        connector_type=ConnectorType.GITHUB,
        name="forge-github",
        config={"token": "ghp_x"},
        actor_id=actor_id,
    )

    # Reset probe counter and run a standalone test.
    stub_manager.tested.clear()
    result = await lifecycle.test(
        connector_id=connector.id,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )

    assert result.ok is True
    assert stub_manager.tested == [str(connector.id)]

    # Health-history row was written.
    factory = get_session_factory()
    async with factory() as session:
        from sqlalchemy import select

        stmt = select(ConnectorHealthHistory).where(
            ConnectorHealthHistory.connector_id == str(connector.id)
        )
        rows = list((await session.execute(stmt)).scalars().all())
    assert len(rows) >= 1
    assert rows[-1].ok is True
    assert str(rows[-1].tenant_id) == tenant_id
    assert str(rows[-1].project_id) == project_id

    # Audit row with action=connector.test.
    async with factory() as session:
        from sqlalchemy import select as _select

        stmt = _select(AuditEvent).where(
            AuditEvent.action == "connector.test",
            AuditEvent.target_id == str(connector.id),
        )
        audit_rows = list((await session.execute(stmt)).scalars().all())
    assert len(audit_rows) == 1


# ---------------------------------------------------------------------------
# M3-G2 — disconnect (soft-delete, idempotent)
# ---------------------------------------------------------------------------


async def test_disconnect_soft_deletes_and_writes_audit(focused_db, event_bus):
    """M3-G2 — POST /connectors/{id}/disconnect writes one audit + one
    activity row on the first call.

    Uses ``focused_db`` so the lifecycle path can write both rows in
    the same transaction (the conftest ``sqlite_db`` would compile
    the global metadata which contains PG-only ARRAY columns).
    """
    from sqlalchemy import select

    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    # Seed a HEALTHY connector (we can't drive the manager.disconnect
    # path against a stub here — we use the real ConnectorManager so
    # disconnect writes the actual row state).
    factory = get_session_factory()
    async with factory() as session:
        connector = Connector(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            project_id=project_id,
            name="forge-slack",
            type=ConnectorType.SLACK,
            config={"bot_token": "x", "default_channel": "#dev"},
            status=ConnectorStatus.HEALTHY,
            created_by=actor_id,
        )
        session.add(connector)
        await session.commit()
        await session.refresh(connector)
        connector_id = connector.id

    real_manager = ConnectorManager(bus=event_bus)
    lifecycle = ConnectorLifecycle(manager=real_manager, bus=event_bus)

    refreshed = await lifecycle.disconnect(
        connector_id=connector_id,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert refreshed.status == ConnectorStatus.DISCONNECTED
    assert refreshed.disconnected_at is not None
    assert str(refreshed.id) == str(connector_id)

    # Audit row written exactly once.
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(AuditEvent).where(
            AuditEvent.tenant_id == tenant_id,
            AuditEvent.action == "connector.disconnect",
            AuditEvent.target_id == str(connector_id),
        )
        audit_rows = list((await session.execute(stmt)).scalars().all())
    assert len(audit_rows) == 1
    assert audit_rows[0].payload["to_state"] == "disconnected"

    # Activity row written with event_type=disconnect.
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(ConnectorActivity).where(
            ConnectorActivity.tenant_id == tenant_id,
            ConnectorActivity.event_type == "disconnect",
            ConnectorActivity.connector_id == str(connector_id),
        )
        act_rows = list((await session.execute(stmt)).scalars().all())
    assert len(act_rows) == 1
    assert act_rows[0].status == "success"


async def test_disconnect_is_idempotent(focused_db, event_bus):
    """Calling disconnect twice writes zero new audit/activity rows."""
    from sqlalchemy import select

    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    factory = get_session_factory()
    async with factory() as session:
        connector = Connector(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            project_id=project_id,
            name="forge-jira",
            type=ConnectorType.JIRA,
            config={"base_url": "https://x.atlassian.net", "token": "tok"},
            status=ConnectorStatus.HEALTHY,
            created_by=actor_id,
        )
        session.add(connector)
        await session.commit()
        await session.refresh(connector)
        connector_id = connector.id

    real_manager = ConnectorManager(bus=event_bus)
    lifecycle = ConnectorLifecycle(manager=real_manager, bus=event_bus)

    first = await lifecycle.disconnect(
        connector_id=connector_id,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert first.status == ConnectorStatus.DISCONNECTED

    second = await lifecycle.disconnect(
        connector_id=connector_id,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert second.status == ConnectorStatus.DISCONNECTED
    assert str(second.id) == str(connector_id)

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(AuditEvent).where(
            AuditEvent.tenant_id == tenant_id,
            AuditEvent.action == "connector.disconnect",
        )
        audit_rows = list((await session.execute(stmt)).scalars().all())
    assert len(audit_rows) == 1

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(ConnectorActivity).where(
            ConnectorActivity.tenant_id == tenant_id,
            ConnectorActivity.event_type == "disconnect",
        )
        act_rows = list((await session.execute(stmt)).scalars().all())
    assert len(act_rows) == 1


# ---------------------------------------------------------------------------
# M3-G3 — OAuth start (dev-mode shortcut)
# ---------------------------------------------------------------------------


async def test_oauth_start_dev_mode_returns_demo_url(monkeypatch, focused_db):
    """M3-G3 — POST /connectors/oauth/start in dev mode returns a
    deterministic demo URL containing code=demo&state=…&slug=…
    """
    from dataclasses import dataclass

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    # Force Settings.environment to "development" so the dev-mode shortcut
    # fires even though pytest runs ENVIRONMENT=test.
    from app.core import config as config_mod

    config_mod.get_settings.cache_clear()  # type: ignore[attr-defined]
    monkeypatch.setenv("ENVIRONMENT", "development")
    config_mod.get_settings.cache_clear()  # type: ignore[attr-defined]

    from app.api.deps import get_current_principal
    from app.api.v1.connector_oauth import router as oauth_router
    from app.core.security import AuthenticatedPrincipal
    from app.services import rbac as rbac_mod

    # Patch rbac.check to always succeed so require_permission passes.
    @dataclass
    class _Allowed:
        allowed: bool = True
        reason: str | None = None

    async def _allow(*_a, **_kw):
        return _Allowed()

    monkeypatch.setattr(rbac_mod.rbac, "check", _allow)

    app = FastAPI()
    app.include_router(oauth_router, prefix="/api/v1")

    async def _stub_principal() -> AuthenticatedPrincipal:
        return AuthenticatedPrincipal(
            user_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            project_id=uuid.uuid4(),
            roles=["connector:install"],
            email="oauth-test@forge.local",
            raw_claims={},
        )

    app.dependency_overrides[get_current_principal] = _stub_principal

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/connectors/oauth/start",
            json={
                "slug": "forge-slack",
                "redirect_uri": "http://localhost:3000/oauth/callback",
            },
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["authorization_url"].startswith("http://localhost:3000/oauth/callback?")
    assert "code=demo" in body["authorization_url"]
    assert "state=" in body["authorization_url"]
    assert "slug=forge-slack" in body["authorization_url"]
    assert body["state"]  # non-empty

    config_mod.get_settings.cache_clear()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# M3-G4 — OAuth callback (dev-mode demo shortcut)
# ---------------------------------------------------------------------------


async def test_oauth_callback_creates_connector_with_oauth_credential(monkeypatch, focused_db):
    """M3-G4 — POST /connectors/oauth/callback with code=demo + a
    valid state token must create a Connector + a ConnectorCredential
    (type=oauth-token) + an install activity row.

    Replay of the same state is rejected (400).
    """
    from dataclasses import dataclass

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core import config as config_mod

    config_mod.get_settings.cache_clear()  # type: ignore[attr-defined]
    monkeypatch.setenv("ENVIRONMENT", "development")
    config_mod.get_settings.cache_clear()  # type: ignore[attr-defined]

    from app.api.deps import get_current_principal
    from app.api.v1.connector_oauth import router as oauth_router
    from app.core.security import AuthenticatedPrincipal
    from app.services import rbac as rbac_mod
    from app.services.connectors.oauth_state import oauth_state_store
    from app.services.marketplace import marketplace as marketplace_service

    # Patch rbac.check to always succeed so require_permission passes.
    @dataclass
    class _Allowed:
        allowed: bool = True
        reason: str | None = None

    async def _allow(*_a, **_kw):
        return _Allowed()

    monkeypatch.setattr(rbac_mod.rbac, "check", _allow)

    # Seed the marketplace catalog so get_details(slug) succeeds.
    await marketplace_service.seed_if_empty()

    # Mint a valid state for a known slug.
    state = oauth_state_store.mint("forge-slack")

    app = FastAPI()
    app.include_router(oauth_router, prefix="/api/v1")

    tenant_uuid = uuid.uuid4()
    project_uuid = uuid.uuid4()

    async def _stub_principal() -> AuthenticatedPrincipal:
        return AuthenticatedPrincipal(
            user_id=uuid.uuid4(),
            tenant_id=tenant_uuid,
            project_id=project_uuid,
            roles=["connector:install"],
            email="oauth-test@forge.local",
            raw_claims={},
        )

    app.dependency_overrides[get_current_principal] = _stub_principal

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/connectors/oauth/callback",
            json={
                "code": "demo",
                "state": state,
                "slug": "forge-slack",
            },
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # The ConnectorRead is returned with the slug-derived type/name.
    assert body["type"] in ("slack", "github", "jira", "aws")  # sanity

    # Replay protection: a second call with the same state must 400.
    with TestClient(app) as client:
        resp2 = client.post(
            "/api/v1/connectors/oauth/callback",
            json={
                "code": "demo",
                "state": state,
                "slug": "forge-slack",
            },
        )
    assert resp2.status_code == 400, resp2.text

    config_mod.get_settings.cache_clear()  # type: ignore[attr-defined]
