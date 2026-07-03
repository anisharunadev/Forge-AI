"""Tests for `/api/v1/forge/chat*` router (step-75 §F5).

Cases:
(a) POST /forge/chat/stream    -> 200 + text/event-stream; 2 chunks
(b) POST /forge/chat/cancel    -> 200 + ChatCancelResponse
(c) GET  /forge/chat/runs/{id} -> 200 if exists, 404 if not
(d) POST /forge/chat/stream    -> SSE error frame when service raises
    AuthenticationError, before the stream closes

The router is a thin layer over :mod:`app.services.forge_chat`. We
monkeypatch `stream_chat`, `cancel_run`, and `get_run_status` at the
router module so no LiteLLM / DB / audit calls fire. Auth deps
(`require_tenant` and the leaf `get_current_principal`) are
dependency-overridden so the test controls the caller.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

# Pre-stub the lazy engine + session factory (mirrors test_forge_keys_router.py).
import app.db.session as _sess

_sess._engine = object()  # type: ignore[assignment]
_sess._session_factory = object()  # type: ignore[assignment]

import app.api.v1.forge_chat as forge_chat_router
from app.main import app
from app.schemas.forge_chat import (
    ChatCancelResponse,
    ChatStreamChunk,
    ForgeRunStatus,
)
from app.services.forge_chat_errors import AuthenticationError

AGENT_ID = UUID("11111111-1111-1111-1111-111111111111")
RUN_ID = UUID("22222222-2222-2222-2222-222222222222")
TENANT_ID = "00000000-0000-0000-0000-000000000aaa"
MISSING_RUN_ID = UUID("33333333-3333-3333-3333-333333333333")


# ---------------------------------------------------------------------------
# Principals
# ---------------------------------------------------------------------------


class _Principal:
    tenant_id = TENANT_ID
    project_id = "00000000-0000-0000-0000-000000000bbb"
    user_id = "00000000-0000-0000-0000-000000000ccc"
    team_id = "00000000-0000-0000-0000-000000000ddd"
    roles: list[str] = ["user"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _chunk(event: str, data: dict) -> ChatStreamChunk:
    return ChatStreamChunk(
        event=event,
        data=data,
        run_id=RUN_ID,
        agent_id=AGENT_ID,
        model="claude-sonnet-4-6",
        ts=_now(),
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def stub_service(monkeypatch):
    """Replace the three router-callable service functions with stubs.

    Tests mutate the returned ``service`` dict to set scenario-specific
    behaviors so each test reads what it expects from the service.
    """

    async def _make_generator(_principal, _agent_id, _body):
        for c in service["chunks"]:
            yield c

    service = {
        "chunks": [],
        "cancel_response": None,
        "run_status": None,
    }

    monkeypatch.setattr(
        forge_chat_router, "stream_chat", _make_generator
    )

    async def _cancel(run_id):
        return service["cancel_response"]

    monkeypatch.setattr(forge_chat_router, "cancel_run", _cancel)

    async def _status(run_id):
        return service["run_status"]

    monkeypatch.setattr(forge_chat_router, "get_run_status", _status)
    return service


@pytest.fixture
def wired_client(stub_service):
    """Override auth deps so the router never resolves a real principal."""
    auth = __import__("app.core.auth", fromlist=["get_current_principal"])

    async def _principal():
        return _Principal()

    async def _tenant():
        return _Principal()

    app.dependency_overrides[auth.get_current_principal] = _principal
    app.dependency_overrides[forge_chat_router.require_tenant] = _tenant
    yield
    app.dependency_overrides.clear()


def _stream_body() -> dict:
    return {
        "agent_id": str(AGENT_ID),
        "model": "claude-sonnet-4-6",
        "messages": [{"role": "user", "content": "hi"}],
    }


# ---------------------------------------------------------------------------
# (a) POST /forge/chat/stream -> 200 + text/event-stream, 2 chunks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stream_returns_sse_content_type(stub_service, wired_client):
    stub_service["chunks"] = [
        _chunk("token", {"delta": "hello"}),
        _chunk("finish", {"reason": "stop"}),
    ]

    with TestClient(app) as client:
        with client.stream(
            "POST", "/api/v1/forge/chat/stream", json=_stream_body()
        ) as r:
            assert r.status_code == 200, r.text
            ct = r.headers["content-type"]
            assert ct.startswith("text/event-stream"), ct
            body = b"".join(r.iter_bytes()).decode("utf-8")

    # Two `event:` lines = two chunk frames.
    event_lines = [ln for ln in body.split("\n") if ln.startswith("event: ")]
    assert len(event_lines) == 2, body
    assert event_lines[0] == "event: token"
    assert event_lines[1] == "event: finish"


# ---------------------------------------------------------------------------
# (b) POST /forge/chat/cancel -> 200 + ChatCancelResponse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cancel_returns_200(stub_service, wired_client):
    cancel_at = _now()
    stub_service["cancel_response"] = ChatCancelResponse(
        run_id=RUN_ID, cancelled=True, cancelled_at=cancel_at
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post(
            "/api/v1/forge/chat/cancel", json={"run_id": str(RUN_ID)}
        )

    assert r.status_code == 200, r.text
    payload = r.json()
    obj = ChatCancelResponse.model_validate(payload)
    assert obj.run_id == RUN_ID
    assert obj.cancelled is True


# ---------------------------------------------------------------------------
# (c) GET /forge/chat/runs/{id} -> 200 if exists, 404 if not
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_status_returns_200_when_present(
    stub_service, wired_client
):
    started = _now()
    stub_service["run_status"] = ForgeRunStatus(
        run_id=RUN_ID,
        agent_id=AGENT_ID,
        status="streaming",
        started_at=started,
        completed_at=None,
        prompt_tokens=None,
        completion_tokens=None,
        cost_usd=None,
        model="claude-sonnet-4-6",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(f"/api/v1/forge/chat/runs/{RUN_ID}")

    assert r.status_code == 200, r.text
    obj = ForgeRunStatus.model_validate(r.json())
    assert obj.run_id == RUN_ID
    assert obj.status == "streaming"


@pytest.mark.asyncio
async def test_run_status_returns_404_when_absent(
    stub_service, wired_client
):
    stub_service["run_status"] = None  # service signals "not found"

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.get(f"/api/v1/forge/chat/runs/{MISSING_RUN_ID}")

    assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# (d) Typed error during stream -> SSE error event before close
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_typed_error_yields_error_event(monkeypatch, wired_client):
    """The router wraps ``stream_chat`` errors into an ``event: error`` SSE
    frame. Mock the service to raise ``AuthenticationError`` and assert the
    produced frame carries ``code=authentication_error`` before the stream
    is closed."""

    async def _raising_generator(_principal, _agent_id, _body):
        raise AuthenticationError("bad key")
        yield  # pragma: no cover  -- marker: this is an async generator

    monkeypatch.setattr(
        forge_chat_router, "stream_chat", _raising_generator
    )

    body_lines: list[str] = []

    with TestClient(app) as client:
        with client.stream(
            "POST", "/api/v1/forge/chat/stream", json=_stream_body()
        ) as r:
            assert r.status_code == 200, r.text
            for chunk in r.iter_text():
                if chunk:
                    body_lines.append(chunk)

    raw = "".join(body_lines)
    assert "event: error" in raw, raw

    # Pull the first error frame's JSON payload and verify the typed code.
    error_frame = raw.split("event: error", 1)[1].split("\n\n", 1)[0]
    data_line = next(
        ln for ln in error_frame.splitlines() if ln.startswith("data: ")
    )
    payload = json.loads(data_line[len("data: "):])
    assert payload["code"] == "authentication_error"
