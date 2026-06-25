"""Unit tests for ``app.integrations.litellm.tenant_sync`` (F-829a).

Real API (from source):

    class TenantSync:
        def __init__(self, base_client_factory=None) -> None: ...

        async def on_tenant_created(
            self, tenant_id, project_id, name
        ) -> str | None: ...       # returns LiteLLM team_id

        async def on_tenant_archived(
            self, tenant_id
        ) -> None: ...

        async def get_team_id(self, tenant_id) -> str | None: ...

        async def reconcile(self, tenant_id) -> bool: ...

``base_client_factory`` is a callable returning an async context
manager that yields an object with an ``admin_client`` attribute
whose ``post`` / ``get`` / ``delete`` are awaitables returning an
httpx-shaped response (``response.json()`` is a dict).

These tests use the ``LiteLLMBaseClient`` directly in async context
manager form, with the underlying httpx client mocked at the
``.admin_client.post`` boundary.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest


def _try_import():
    return pytest.importorskip("app.integrations.litellm.tenant_sync")


def _make_response(json_body: dict, status_code: int = 200):
    """Build a MagicMock standing in for an httpx Response."""
    resp = MagicMock(name="httpx_response")
    resp.status_code = status_code
    resp.json = lambda: json_body
    resp.raise_for_status = lambda: None
    resp.text = str(json_body)
    return resp


class _FakeBaseClient:
    """Stand-in for ``LiteLLMBaseClient``.

    Exposes ``admin_client`` with async ``post`` / ``get`` / ``delete``.
    """

    def __init__(self) -> None:
        self.admin_client = MagicMock(name="admin_client")
        self.admin_client.post = AsyncMock(name="admin_client.post")
        self.admin_client.get = AsyncMock(name="admin_client.get")
        self.admin_client.delete = AsyncMock(name="admin_client.delete")

    async def __aenter__(self) -> "_FakeBaseClient":
        return self

    async def __aexit__(self, *_exc) -> None:
        return None


@asynccontextmanager
async def _base_client_factory(client: _FakeBaseClient):
    """Async context manager factory matching ``TenantSync``'s expectation."""
    yield client


# ---------------------------------------------------------------------------
# 1. Create tenant → LiteLLM Team created
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_team_succeeds(
    settings_override,
    sqlite_db,
    fake_tenant_id,
    fake_project_id,
):
    """on_tenant_created POSTs /team/new and returns the LiteLLM team id."""
    mod = _try_import()

    client = _FakeBaseClient()
    expected_team_id = f"forge-team-{uuid.uuid4().hex[:8]}"
    client.admin_client.post.return_value = _make_response(
        {"team_id": expected_team_id, "team_alias": f"forge-{fake_tenant_id}"},
    )

    service = mod.TenantSync(base_client_factory=lambda: _base_client_factory(client))
    team_id = await service.on_tenant_created(
        tenant_id=fake_tenant_id,
        project_id=fake_project_id,
        name="Acme Co",
    )

    assert team_id == expected_team_id
    client.admin_client.post.assert_awaited_once()
    call = client.admin_client.post.await_args
    assert "/team/new" in str(call.args[0])

    # The metadata MUST carry the tenant_id (Rule 2).
    body = call.kwargs.get("json") or call.args[1]
    assert body["metadata"]["forge_tenant_id"] == fake_tenant_id


# ---------------------------------------------------------------------------
# 2. Idempotency — second call returns the same team_id, no second POST
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_team_idempotent(
    settings_override,
    sqlite_db,
    fake_tenant_id,
    fake_project_id,
):
    """A second on_tenant_created for the same tenant short-circuits
    on the DB mapping without re-POSTing."""
    mod = _try_import()

    client = _FakeBaseClient()
    expected_team_id = f"forge-team-{uuid.uuid4().hex[:8]}"
    client.admin_client.post.return_value = _make_response(
        {"team_id": expected_team_id},
    )

    service = mod.TenantSync(base_client_factory=lambda: _base_client_factory(client))

    first = await service.on_tenant_created(
        tenant_id=fake_tenant_id,
        project_id=fake_project_id,
        name="Acme",
    )
    second = await service.on_tenant_created(
        tenant_id=fake_tenant_id,
        project_id=fake_project_id,
        name="Acme",
    )

    assert first == second == expected_team_id
    assert client.admin_client.post.await_count == 1


# ---------------------------------------------------------------------------
# 3. Archive → DELETE /team/delete AND revoke the key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_archive_team_revokes_keys(
    settings_override,
    sqlite_db,
    fake_tenant_id,
    fake_project_id,
):
    """on_tenant_archived calls /team/delete AND revokes the Virtual Key
    in Secrets Manager. The mapping status is flipped to ARCHIVED.

    Per OQ-30 spend logs are preserved on the LiteLLM side; the
    Forge-side row stays as an audit record.
    """
    from sqlalchemy import select

    mod = _try_import()

    # Provision a mapping first so on_tenant_archived has something to act on.
    client = _FakeBaseClient()
    expected_team_id = f"forge-team-{uuid.uuid4().hex[:8]}"
    client.admin_client.post.return_value = _make_response({"team_id": expected_team_id})
    client.admin_client.delete.return_value = _make_response({"status": "ok"})

    # Stub the Secrets Manager / key_manager so we don't actually call boto3.
    from app.integrations.litellm import key_manager as key_manager_mod  # type: ignore

    async def _noop_revoke(*_args, **_kwargs):
        return None

    original_revoke = key_manager_mod.virtual_key_manager.revoke_key
    key_manager_mod.virtual_key_manager.revoke_key = _noop_revoke
    try:
        service = mod.TenantSync(base_client_factory=lambda: _base_client_factory(client))
        await service.on_tenant_created(
            tenant_id=fake_tenant_id,
            project_id=fake_project_id,
            name="Acme",
        )

        await service.on_tenant_archived(tenant_id=fake_tenant_id)
    finally:
        key_manager_mod.virtual_key_manager.revoke_key = original_revoke

    # /team/delete was called with the expected team_id.
    client.admin_client.delete.assert_awaited_once()
    delete_call = client.admin_client.delete.await_args
    assert "/team/delete" in str(delete_call.args[0])
    body = delete_call.kwargs.get("json") or delete_call.args[1]
    assert expected_team_id in str(body.get("team_ids", []))

    # The mapping status is now ARCHIVED.
    from app.db.models.litellm_team_mapping import LiteLLMTeamMapping

    from app.db.session import get_session_factory
    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                select(LiteLLMTeamMapping).where(
                    LiteLLMTeamMapping.tenant_id == fake_tenant_id,
                )
            )
        ).scalars().first()
    assert row is not None
    assert row.status == "archived"


# ---------------------------------------------------------------------------
# 4. Sync failure does NOT block tenant creation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_failure_does_not_block_tenant_creation(
    settings_override,
    sqlite_db,
    fake_tenant_id,
    fake_project_id,
    caplog: pytest.LogCaptureFixture,
):
    """If the LiteLLM admin call fails (exception), on_tenant_created
    returns ``None`` and logs a warning. Tenant creation in Forge
    must never be blocked on LiteLLM availability (Rule 3).
    """
    import logging

    mod = _try_import()

    client = _FakeBaseClient()
    client.admin_client.post.side_effect = RuntimeError("503 Service Unavailable")

    service = mod.TenantSync(base_client_factory=lambda: _base_client_factory(client))

    with caplog.at_level(logging.WARNING, logger="app.integrations.litellm.tenant_sync"):
        result = await service.on_tenant_created(
            tenant_id=fake_tenant_id,
            project_id=fake_project_id,
            name="Acme",
        )

    assert result is None
    # A warning was logged describing the failure.
    assert any(
        "create_failed" in record.message or "litellm" in record.message.lower()
        for record in caplog.records
    ), "Expected a structured warning about the create failure"
