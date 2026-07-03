"""Step-71 — Terminal WS roundtrip integration tests.

Verifies the wiring contract for `POST /api/v1/terminal/sessions` →
`/ws/terminal/{session_id}?token=<jwt>` end-to-end through the
FastAPI ASGI app, with the PTY layer, RBAC, and audit stubbed out.

What we prove here:
  1. `POST /terminal/sessions` returns 201 with a server-issued id
     and a `websocket_path` of the expected shape.
  2. `POST /terminal/sessions` without a `forge.project` claim
     returns 400 (`project_required`).
  3. `GET /ws/terminal/{id}?token=<good>` accepts the upgrade and
     streams `{"type":"ready",...}` as the first frame, and writes
     a `started` audit row.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from app.api.deps import AuthenticatedPrincipal
from app.api.v1 import terminal_sessions as mod_sessions
from app.api.ws import terminal as ws_mod
from app.core.config import settings
from app.terminal.session_manager import AgentType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_jwt(*, tenant_id: str, project_id: str, user_id: str) -> str:
    """Mint an HS256 token with the claims the security layer expects."""
    now = int(datetime.now(UTC).timestamp())
    claims = {
        "sub": user_id,
        "email": f"{user_id}@example.com",
        "forge.tenant": tenant_id,
        "forge.project": project_id,
        "iat": now,
        "exp": now + 600,
        "iss": settings.jwt_issuer or "forge-test",
        "realm_access": {"roles": ["forge-admin"]},
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _fake_session(*, tenant_id: str, project_id: str, user_id: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        project_id=project_id,
        user_id=user_id,
        agent_type=AgentType.CLAUDE_CODE,
        workspace_path="default",
        created_at=datetime.now(UTC),
        last_activity_at=datetime.now(UTC),
        status="active",
        metadata={},
    )


def _fake_pty() -> SimpleNamespace:
    # ponytail: handler reads these private attrs from the launcher output;
    # defaults below match backend/app/terminal/session_manager.py expectations.
    pty = SimpleNamespace(
        closed=False,
        _pending_command="cat",
        _pending_cwd="/tmp",
        _pending_env={},
    )
    pty.start = AsyncMock()
    pty.read = AsyncMock(return_value=b"")
    pty.write = AsyncMock()
    pty.resize = AsyncMock()
    pty.kill = AsyncMock()
    return pty


# ---------------------------------------------------------------------------
# HTTP entry point — POST /terminal/sessions
# ---------------------------------------------------------------------------


@pytest.fixture
def http_app():
    app = FastAPI()
    app.include_router(mod_sessions.router)
    yield app


@pytest.fixture
def http_principal():
    return SimpleNamespace(
        tenant_id="t-ws",
        project_id="p-ws",
        user_id="u-ws",
        roles=["forge-admin"],
    )


def test_create_session_endpoint_returns_201_and_uuid(http_app, http_principal) -> None:
    app = http_app
    fake = _fake_session(
        tenant_id=http_principal.tenant_id,
        project_id=http_principal.project_id,
        user_id=http_principal.user_id,
    )

    async def _principal_override() -> AuthenticatedPrincipal:
        return AuthenticatedPrincipal(
            user_id=http_principal.user_id,
            email="u-ws@example.com",
            tenant_id=http_principal.tenant_id,
            project_id=http_principal.project_id,
            roles=http_principal.roles,
            raw_claims={},
        )

    app.dependency_overrides[mod_sessions.get_current_principal] = _principal_override

    with patch.object(
        mod_sessions.session_manager, "create_session", AsyncMock(return_value=fake)
    ), patch(
        "app.api.deps.rbac.check",
        AsyncMock(return_value=SimpleNamespace(allowed=True, reason="")),
    ), TestClient(app) as client:
        resp = client.post(
            "/terminal/sessions",
            json={"agent_type": "claude_code", "workspace_path": "default"},
        )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["id"] == fake.id
    assert body["agent_type"] == "claude_code"
    assert body["websocket_path"] == f"/ws/terminal/{fake.id}"


def test_create_session_endpoint_requires_project(http_app) -> None:
    app = http_app

    async def _principal_override() -> AuthenticatedPrincipal:
        return AuthenticatedPrincipal(
            user_id="u-noproj",
            email="u-noproj@example.com",
            tenant_id="t-ws",
            project_id=None,
            roles=["forge-admin"],
            raw_claims={},
        )

    app.dependency_overrides[mod_sessions.get_current_principal] = _principal_override

    with patch(
        "app.api.deps.rbac.check",
        AsyncMock(return_value=SimpleNamespace(allowed=True, reason="")),
    ), TestClient(app) as client:
        resp = client.post(
            "/terminal/sessions",
            json={"agent_type": "claude_code", "workspace_path": "default"},
        )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "project_required"


# ---------------------------------------------------------------------------
# WebSocket — /ws/terminal/{session_id}
# ---------------------------------------------------------------------------


def _build_ws_app() -> FastAPI:
    app = FastAPI()
    app.include_router(ws_mod.router)
    return app


def test_ws_accepts_valid_token_and_emits_ready() -> None:
    """Happy path: principal matches session tenant → server sends `ready`."""
    app = _build_ws_app()
    fake = _fake_session(tenant_id="t1", project_id="p1", user_id="u1")
    token = _make_jwt(tenant_id="t1", project_id="p1", user_id="u1")

    pty = _fake_pty()
    audit_mock = AsyncMock()

    with patch.object(
        ws_mod.session_manager, "get_session", AsyncMock(return_value=fake)
    ), patch.object(ws_mod.agent_launcher, "launch", return_value=pty), patch.object(
        ws_mod.rbac,
        "check",
        AsyncMock(return_value=SimpleNamespace(allowed=True, reason="")),
    ), patch.object(
        ws_mod.terminal_audit, "record_session_lifecycle", audit_mock
    ), TestClient(app) as client, client.websocket_connect(
        f"/ws/terminal/{fake.id}?token={token}"
    ) as ws:
        frame = ws.receive_text()
        msg = json.loads(frame)
        assert msg["type"] == "ready", f"unexpected first frame: {msg!r}"
        assert msg["agent_type"] == "claude_code"

    started_calls = [
        c for c in audit_mock.call_args_list if c.kwargs.get("event") == "started"
    ]
    assert started_calls, "expected a 'started' audit row from record_session_lifecycle"