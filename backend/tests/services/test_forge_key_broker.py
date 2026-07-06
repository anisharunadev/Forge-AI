"""step-75 P4 — Forge Key Broker tests (a–g).

* (a) ``issue`` calls ``/key/generate`` exactly once, persists one
  ``active`` row, ``encrypted_key`` is a Fernet token.
* (b) Plaintext key never appears in logs OR in the typed response
  (``ForgeKeyStatus`` has no ``key_value`` field).
* (c) Two agents get isolated rows: distinct active rows, distinct
  fingerprints.
* (d) ``rotate`` marks the prior row ``rotated`` and inserts a new
  ``active`` row; fingerprints differ.
* (e) ``revoke`` calls upstream ``/key/block`` and marks the row
  ``revoked``.
* (f) ``get_status`` returns a typed model with no plaintext.
* (g) ``encrypted_key`` round-trips through
  :func:`app.core.crypto.decrypt` to the original secret.

HTTP mocking style mirrors ``tests/services/test_forge_spend.py`` — an
``httpx.MockTransport`` swapped onto ``LiteLLMBaseClient``. ``respx``
isn't installed in this env; the two observe identical outbound
requests and per-call assertions work unchanged.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

# Bypass the production session-factory lazy init, same trick as
# test_forge_spend.py / test_forge_models.py.
import app.db.session as _session_mod


class _StubSessionFactory:
    def __call__(self) -> Any:  # pragma: no cover
        raise RuntimeError("sqlite_db fixture not active")


def _passthrough_factory() -> Any:
    return _session_mod._session_factory or _StubSessionFactory()


_session_mod.get_session_factory = _passthrough_factory  # type: ignore[assignment]

from app.core.crypto import decrypt  # noqa: E402
from app.services.forge_key_broker import (  # noqa: E402
    AgentVirtualKey,
    ForgeKeyBroker,
)

# ---------------------------------------------------------------------------
# HTTP transport helper (httpx.MockTransport — same as test_forge_spend)
# ---------------------------------------------------------------------------


def _make_transport(handlers: dict[str, Any], *, call_log: list[httpx.Request] | None = None):
    """Path → callable(request)→Response. Each handler also records the
    request to ``call_log`` if provided so we can assert call counts.

    Handlers may be sync or ``async def`` — both are awaited uniformly.
    """

    async def handler(request: httpx.Request) -> httpx.Response:
        if call_log is not None:
            call_log.append(request)
        for path, fn in handlers.items():
            if request.url.path.endswith(path):
                result = fn(request)
                if hasattr(result, "__await__"):
                    result = await result  # type: ignore[func-returns-value]
                return result  # type: ignore[return-value]
        return httpx.Response(500, json={"error": f"unhandled {request.url.path}"})

    return httpx.MockTransport(handler)


def _patch_litellm_base(
    monkeypatch, handlers: dict[str, Any], *, call_log: list[httpx.Request] | None = None
):
    """Swap ``LiteLLMBaseClient`` for a fake that uses an httpx.MockTransport."""
    from app.services import forge_key_broker as broker_mod

    transport = _make_transport(handlers, call_log=call_log)

    class _FakeBase:
        def __init__(self) -> None:
            self._client = httpx.AsyncClient(
                base_url="http://litellm.test", timeout=10.0, transport=transport
            )

        async def __aenter__(self) -> _FakeBase:
            return self

        async def __aexit__(self, *exc: Any) -> None:
            await self._client.aclose()

        @property
        def admin_client(self) -> httpx.AsyncClient:
            return self._client

    monkeypatch.setattr(broker_mod, "LiteLLMBaseClient", _FakeBase)
    return _FakeBase


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def broker(sqlite_db):
    return ForgeKeyBroker()


async def _insert_agent(session_factory, **overrides: Any):
    """Insert one Agent row in the same tenant/project as overrides."""
    from app.db.models.agent import Agent, AgentStatus, AgentType

    tenant_id = overrides.pop("tenant_id", uuid4())
    project_id = overrides.pop("project_id", uuid4())
    name = overrides.pop("name", f"agent-{uuid4().hex[:8]}")
    agent = Agent(
        id=uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
        name=name,
        type=AgentType.CLAUDE_CODE,
        capabilities={},
        status=AgentStatus.ENABLED,
        version="1.0.0",
    )
    async with session_factory() as session:
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
    return agent


async def _agent_via_db(session_factory):
    """Helper — build + persist one agent row, return the Agent object."""
    return await _insert_agent(session_factory)


def _keygen_handler(plaintext: str):
    """Handler factory: returns /key/generate → ``{"key": plaintext}``."""

    def _h(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"key": plaintext})

    return _h


# ---------------------------------------------------------------------------
# (a) issue() — exactly one /key/generate call, one active row, Fernet token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_issue_calls_key_generate_once(sqlite_db, monkeypatch):
    call_log: list[httpx.Request] = []
    plaintext = "sk-test-plaintext-aaaa"
    _patch_litellm_base(
        monkeypatch,
        {"/key/generate": _keygen_handler(plaintext)},
        call_log=call_log,
    )

    factory = _session_mod.get_session_factory()
    agent = await _agent_via_db(factory)
    broker = ForgeKeyBroker()

    status = await broker.issue(agent)

    # (i) /key/generate called exactly once.
    keygen_calls = [r for r in call_log if r.url.path.endswith("/key/generate")]
    assert len(keygen_calls) == 1, f"expected 1 /key/generate, got {len(keygen_calls)}"

    # (ii) exactly one active row for this agent.
    from sqlalchemy import select

    async with factory() as session:
        rows = (
            (
                await session.execute(
                    select(AgentVirtualKey).where(AgentVirtualKey.agent_id == agent.id)
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1
    assert rows[0].status == "active"
    assert rows[0].fingerprint == status.fingerprint

    # (iii) encrypted_key is a Fernet token: URLs-safe base64 starting with 'gAAAAA'.
    enc = rows[0].encrypted_key
    assert enc and isinstance(enc, str)
    assert enc.startswith("gAAAAA"), f"encrypted_key not Fernet-form: {enc!r}"


# ---------------------------------------------------------------------------
# (b) plaintext key never leaks — log capture + schema check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_plaintext_key_never_logged(sqlite_db, monkeypatch):
    plaintext = "sk-test-plaintext-bbbb"
    _patch_litellm_base(monkeypatch, {"/key/generate": _keygen_handler(plaintext)})

    factory = _session_mod.get_session_factory()
    agent = await _agent_via_db(factory)
    broker = ForgeKeyBroker()

    # Capture every log record across all loggers.
    captured: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            try:
                captured.append(record.getMessage())
            except Exception:
                pass

    handler = _Capture()
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        status = await broker.issue(agent)
    finally:
        root.removeHandler(handler)

    joined = "\n".join(captured)
    assert plaintext not in joined, f"plaintext leaked into logs:\n{joined}"

    # Typed response carries no plaintext. ``ForgeKeyStatus`` has no
    # ``key_value`` field — assert via model_dump + attr probe.
    dump = status.model_dump()
    assert "key_value" not in dump
    assert "encrypted_key" not in dump
    assert not hasattr(status, "key_value")


# ---------------------------------------------------------------------------
# (c) two agents — isolated scopes (one active row each, distinct fingerprints)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_agents_isolated_scopes(sqlite_db, monkeypatch):
    # Per-call counter → distinct upstream secret for each issue() call.
    counter = {"n": 0}

    async def per_agent_handler(req: httpx.Request) -> httpx.Response:
        counter["n"] += 1
        secret = f"sk-agent-isolated-{counter['n']}-{uuid4().hex[:6]}"
        return httpx.Response(200, json={"key": secret})

    _patch_litellm_base(monkeypatch, {"/key/generate": per_agent_handler})

    factory = _session_mod.get_session_factory()
    agent_a = await _agent_via_db(factory)
    agent_b = await _agent_via_db(factory)
    broker = ForgeKeyBroker()

    status_a = await broker.issue(agent_a)
    status_b = await broker.issue(agent_b)

    from sqlalchemy import select

    async with factory() as session:
        rows = (await session.execute(select(AgentVirtualKey))).scalars().all()

    rows_a = [r for r in rows if r.agent_id == agent_a.id]
    rows_b = [r for r in rows if r.agent_id == agent_b.id]
    assert len(rows_a) == 1 and rows_a[0].status == "active"
    assert len(rows_b) == 1 and rows_b[0].status == "active"
    assert rows_a[0].fingerprint != rows_b[0].fingerprint
    assert status_a.fingerprint != status_b.fingerprint


# ---------------------------------------------------------------------------
# (d) rotate — old row → 'rotated', new row → 'active', fingerprints differ
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rotate_marks_old_as_rotated(sqlite_db, monkeypatch):
    counter = {"n": 0}
    secrets = ["sk-original-secret", "sk-rotated-secret"]

    def rotate_handler(req: httpx.Request) -> httpx.Response:
        secret = secrets[counter["n"]]
        counter["n"] += 1
        return httpx.Response(200, json={"key": secret})

    call_log: list[httpx.Request] = []
    _patch_litellm_base(monkeypatch, {"/key/generate": rotate_handler}, call_log=call_log)

    factory = _session_mod.get_session_factory()
    agent = await _agent_via_db(factory)
    broker = ForgeKeyBroker()

    first = await broker.issue(agent)
    rot = await broker.rotate(agent.id, reason="test")

    from sqlalchemy import select

    async with factory() as session:
        rows = (
            (
                await session.execute(
                    select(AgentVirtualKey).where(AgentVirtualKey.agent_id == agent.id)
                )
            )
            .scalars()
            .all()
        )

    by_status: dict[str, list[AgentVirtualKey]] = {}
    for r in rows:
        by_status.setdefault(r.status, []).append(r)
    assert "rotated" in by_status and len(by_status["rotated"]) == 1
    assert "active" in by_status and len(by_status["active"]) == 1

    rotated_row = by_status["rotated"][0]
    active_row = by_status["active"][0]
    assert rotated_row.fingerprint == first.fingerprint
    assert active_row.fingerprint == rot.new_fingerprint
    assert active_row.fingerprint != rotated_row.fingerprint


# ---------------------------------------------------------------------------
# (e) revoke — /key/block called + row.status == 'revoked'
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_blocks_upstream(sqlite_db, monkeypatch):
    block_calls: list[httpx.Request] = []

    def block_handler(req: httpx.Request) -> httpx.Response:
        block_calls.append(req)
        return httpx.Response(200, json={"blocked": True})

    call_log: list[httpx.Request] = []
    _patch_litellm_base(
        monkeypatch,
        {
            "/key/generate": _keygen_handler("sk-revoke-secret"),
            "/key/block": block_handler,
        },
        call_log=call_log,
    )

    factory = _session_mod.get_session_factory()
    agent = await _agent_via_db(factory)
    broker = ForgeKeyBroker()

    status = await broker.issue(agent)
    # Reset call_log so we only inspect revoke-path traffic.
    assert status.litellm_key_alias
    resp = await broker.revoke(agent.id, reason="test")

    assert resp.fingerprint == status.fingerprint

    block_paths = [r for r in call_log if r.url.path.endswith("/key/block")]
    assert len(block_paths) == 1, (
        f"expected 1 /key/block call, got {[r.url.path for r in block_paths]}"
    )
    assert len(block_calls) == 1

    from sqlalchemy import select

    async with factory() as session:
        row = await session.scalar(
            select(AgentVirtualKey).where(AgentVirtualKey.agent_id == agent.id)
        )
    assert row is not None
    assert row.status == "revoked"
    assert row.revoked_at is not None


# ---------------------------------------------------------------------------
# (f) get_status — typed model with NO plaintext field
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_status_returns_no_plaintext(sqlite_db, monkeypatch):
    _patch_litellm_base(monkeypatch, {"/key/generate": _keygen_handler("sk-status-secret")})

    factory = _session_mod.get_session_factory()
    agent = await _agent_via_db(factory)
    broker = ForgeKeyBroker()

    await broker.issue(agent)
    status = await broker.get_status(agent.id)

    assert status is not None
    dump = status.model_dump()
    # The plaintext secret must NOT appear under any key.
    for k, v in dump.items():
        assert "sk-status-secret" not in str(v), f"plaintext leaked into {k}={v!r}"
    assert "key_value" not in dump
    assert "encrypted_key" not in dump
    assert "plaintext" not in dump


# ---------------------------------------------------------------------------
# (g) encrypted_key round-trips through app.core.crypto.decrypt
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_encrypted_key_round_trips(sqlite_db, monkeypatch):
    plaintext = "sk-round-trip-secret-12345"
    _patch_litellm_base(monkeypatch, {"/key/generate": _keygen_handler(plaintext)})

    factory = _session_mod.get_session_factory()
    agent = await _agent_via_db(factory)
    broker = ForgeKeyBroker()

    await broker.issue(agent)

    from sqlalchemy import select

    async with factory() as session:
        row = await session.scalar(
            select(AgentVirtualKey).where(AgentVirtualKey.agent_id == agent.id)
        )
    assert row is not None

    recovered = decrypt(row.encrypted_key)
    assert recovered == plaintext, f"decrypt mismatch: got {recovered!r}, want {plaintext!r}"
