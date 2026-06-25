"""F-800 Plan 1 — Copilot REST API integration tests.

These tests mount the Copilot router under a minimal FastAPI app and
exercise it through ``fastapi.testclient.TestClient``. The principal is
injected via dependency overrides so we can drive the per-permission
matrix without a full JWT pipeline.

Tests cover:
 1. ``test_post_chat_returns_copilot_chat_response_shape``
 2. ``test_post_chat_returns_404_when_copilot_disabled``
 3. ``test_post_chat_returns_403_without_copilot_use_permission``
 4. ``test_list_conversations_returns_only_callers``
 5. ``test_get_conversation_404_for_wrong_user``
 6. ``test_delete_conversation_204``
 7. ``test_submit_feedback_204``
 8. ``test_list_tools_returns_11_tools``
 9. ``test_get_conversation_cost_returns_shape``
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Stub the session module before importing the copilot service — this
# prevents the eager ``ComplianceFeed()`` import chain from blowing up
# on the test env (same trick used in test_litellm_tools.py).
import app.db.session as _session_mod


class _StubSession:
    def __init__(self) -> None:
        self.added: list[Any] = []

    async def __aenter__(self) -> "_StubSession":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def commit(self) -> None:
        return None

    async def flush(self) -> None:
        return None

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def execute(self, *args: Any, **kwargs: Any) -> Any:
        return None

    async def scalar(self, *args: Any, **kwargs: Any) -> Any:
        return None


class _StubSessionFactory:
    def __call__(self, *args: Any, **kwargs: Any) -> _StubSession:
        return _StubSession()


def _stub_db_session_factory() -> _StubSessionFactory:
    return _StubSessionFactory()


_session_mod.db_session_factory = _stub_db_session_factory  # type: ignore[assignment]


from app.api.deps import db_session  # noqa: E402
from app.api.v1 import copilot as copilot_module  # noqa: E402
from app.core.security import AuthenticatedPrincipal, get_current_principal  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _principal(*, permissions=None, tenant_id=None, user_id=None) -> Any:
    return AuthenticatedPrincipal(
        user_id=str(user_id or uuid.uuid4()),
        email="t@example.com",
        tenant_id=str(tenant_id or uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        roles=[],
        raw_claims={"forge.permissions": list(permissions or [])},
    )


@pytest.fixture
def fastapi_client(sqlite_db):
    """Build a minimal FastAPI test client for the copilot router."""
    from typing import AsyncIterator

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")
    principal = _principal(permissions=["copilot:use"])

    async def _override_principal() -> Any:
        return principal

    async def _override_session() -> AsyncIterator[Any]:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_principal  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_session
    return TestClient(app), principal


def _stub_agent_loop(response, calls, results):
    async def _no_op_aenter(self):
        return self

    async def _no_op_aexit(self, *args):
        return None

    return patch(
        "app.services.litellm_client.LiteLLMClient.__aenter__", _no_op_aenter
    ), patch(
        "app.services.litellm_client.LiteLLMClient.__aexit__", _no_op_aexit
    ), patch(
        "app.services.litellm_client.LiteLLMClient.agent_loop",
        AsyncMock(return_value=(response, calls, results)),
    )


def _tool_response_with_call(
    *,
    call_id: str = "call_1",
    content: str = "final answer",
    cost_usd: float = 0.001,
    prompt_tokens: int = 12,
    completion_tokens: int = 4,
) -> tuple[dict[str, Any], list[Any], list[Any]]:
    from app.services._litellm_tools import ToolCall, ToolResult

    response = {
        "id": "chatcmpl-test",
        "model": "gpt-4o-mini",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost_usd": cost_usd,
        },
    }
    calls = [
        ToolCall(id=call_id, name="search_knowledge", arguments_json='{"query": "x"}')
    ]
    results = [
        ToolResult(
            tool_call_id=call_id,
            name="search_knowledge",
            content='{"nodes": [], "total": 0}',
            is_error=False,
        )
    ]
    return response, calls, results


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_post_chat_returns_copilot_chat_response_shape(monkeypatch, fastapi_client):
    client, _principal_obj = fastapi_client

    # Enable copilot for this test.
    from app.core import config

    monkeypatch.setattr(config.settings, "copilot_enabled", True)

    response, calls, results = _tool_response_with_call()
    p1, p2, p3 = _stub_agent_loop(response, calls, results)
    with p1, p2, p3:
        body = {
            "conversation_id": None,
            "project_id": None,
            "message": "What runs are active?",
            "context": {
                "current_page": "/dashboard",
                "current_center": "dashboard",
                "recent_actions": [],
            },
        }
        resp = client.post("/api/v1/copilot/conversations", json=body)

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert "conversation_id" in payload
    assert "message_id" in payload
    assert payload["content"] == "final answer"
    assert payload["model"] == "gpt-4o-mini"
    assert isinstance(payload["tool_calls"], list)


def test_post_chat_returns_404_when_copilot_disabled(monkeypatch, fastapi_client):
    client, _ = fastapi_client
    from app.core import config

    monkeypatch.setattr(config.settings, "copilot_enabled", False)

    body = {
        "conversation_id": None,
        "project_id": None,
        "message": "x",
        "context": {"current_page": "/x", "recent_actions": []},
    }
    resp = client.post("/api/v1/copilot/conversations", json=body)
    assert resp.status_code == 404


def test_post_chat_returns_403_without_copilot_use_permission(monkeypatch, sqlite_db):
    from app.core import config

    # Enable copilot so the master toggle does not return 404 first;
    # we want the RBAC denial (403) to be the visible failure mode.
    monkeypatch.setattr(config.settings, "copilot_enabled", True)

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")

    async def _override_principal() -> Any:
        return _principal(permissions=[])  # NO copilot:use

    async def _override_session() -> Any:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_principal  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_session
    client = TestClient(app)

    body = {
        "conversation_id": None,
        "project_id": None,
        "message": "x",
        "context": {"current_page": "/x", "recent_actions": []},
    }
    resp = client.post("/api/v1/copilot/conversations", json=body)
    assert resp.status_code == 403


def test_list_conversations_returns_only_callers(monkeypatch, sqlite_db):
    """Caller A sees only their conversations; caller B sees only theirs."""
    import asyncio
    from app.db.models.copilot import CopilotConversation

    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async def _seed():
        async with sqlite_db() as db:
            db.add_all([
                CopilotConversation(
                    tenant_id=tenant_id, project_id=None, user_id=user_a
                ),
                CopilotConversation(
                    tenant_id=tenant_id, project_id=None, user_id=user_b
                ),
            ])
            await db.commit()

    asyncio.get_event_loop().run_until_complete(_seed())

    # Caller A.
    app_a = FastAPI()
    app_a.include_router(copilot_module.router, prefix="/api/v1")
    p_a = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_a)

    async def _override_a() -> Any:
        return p_a

    async def _override_sess() -> Any:
        async with sqlite_db() as session:
            yield session

    app_a.dependency_overrides[get_current_principal] = _override_a  # type: ignore[attr-defined]
    app_a.dependency_overrides[db_session] = _override_sess
    from app.core import config

    monkeypatch.setattr(config.settings, "copilot_enabled", True)
    resp_a = TestClient(app_a).get("/api/v1/copilot/conversations")
    assert resp_a.status_code == 200
    body_a = resp_a.json()
    assert len(body_a) == 1
    assert body_a[0]["user_id"] == str(user_a)


def test_get_conversation_404_for_wrong_user(sqlite_db):
    """User B cannot read User A's conversation."""
    import asyncio
    from app.db.models.copilot import CopilotConversation

    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async def _seed():
        async with sqlite_db() as db:
            conv = CopilotConversation(
                tenant_id=tenant_id, project_id=None, user_id=user_a
            )
            db.add(conv)
            await db.commit()
            return conv.id

    conv_id = asyncio.get_event_loop().run_until_complete(_seed())

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")
    p_b = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_b)

    async def _override_p() -> Any:
        return p_b

    async def _override_sess() -> Any:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_p  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_sess
    from app.core import config
    from app.core.config import settings

    settings.copilot_enabled = True
    resp = TestClient(app).get(f"/api/v1/copilot/conversations/{conv_id}")
    assert resp.status_code == 404


def test_delete_conversation_204(monkeypatch, sqlite_db):
    import asyncio
    from app.db.models.copilot import CopilotConversation

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async def _seed():
        async with sqlite_db() as db:
            conv = CopilotConversation(
                tenant_id=tenant_id, project_id=None, user_id=user_id
            )
            db.add(conv)
            await db.commit()
            return conv.id

    conv_id = asyncio.get_event_loop().run_until_complete(_seed())

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")
    p = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    async def _override_p() -> Any:
        return p

    async def _override_sess() -> Any:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_p  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_sess
    from app.core import config

    monkeypatch.setattr(config.settings, "copilot_enabled", True)
    resp = TestClient(app).delete(f"/api/v1/copilot/conversations/{conv_id}")
    assert resp.status_code == 204


def test_submit_feedback_204(monkeypatch, sqlite_db):
    import asyncio
    from app.db.models.copilot import CopilotConversation, CopilotMessage

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async def _seed():
        async with sqlite_db() as db:
            conv = CopilotConversation(
                tenant_id=tenant_id, project_id=None, user_id=user_id
            )
            db.add(conv)
            await db.flush()
            msg = CopilotMessage(
                conversation_id=conv.id,
                tenant_id=tenant_id,
                role="assistant",
                content="ok",
            )
            db.add(msg)
            await db.commit()
            return msg.id

    msg_id = asyncio.get_event_loop().run_until_complete(_seed())

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")
    p = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    async def _override_p() -> Any:
        return p

    async def _override_sess() -> Any:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_p  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_sess
    from app.core import config

    monkeypatch.setattr(config.settings, "copilot_enabled", True)
    resp = TestClient(app).post(
        f"/api/v1/copilot/messages/{msg_id}/feedback",
        json={"rating": "up", "comment": "nice"},
    )
    assert resp.status_code == 204


def test_list_tools_returns_11_tools(monkeypatch, fastapi_client):
    client, _ = fastapi_client
    from app.core import config

    monkeypatch.setattr(config.settings, "copilot_enabled", True)
    resp = client.get("/api/v1/copilot/tools")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 11
    names = {t["name"] for t in body}
    for expected in (
        "search_knowledge",
        "get_service",
        "get_adr",
        "list_recent_adrs",
        "get_standards",
        "get_template",
        "navigate_to",
        "draft_artifact",
        "run_command",
        "check_budget",
        "audit_event",
    ):
        assert expected in names


def test_get_conversation_cost_returns_shape(monkeypatch, sqlite_db):
    import asyncio
    from decimal import Decimal
    from app.db.models.copilot import CopilotConversation

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async def _seed():
        async with sqlite_db() as db:
            conv = CopilotConversation(
                tenant_id=tenant_id,
                project_id=None,
                user_id=user_id,
                total_cost_usd=Decimal("0.42"),
                total_tokens_in=100,
                total_tokens_out=50,
            )
            db.add(conv)
            await db.commit()
            return conv.id

    conv_id = asyncio.get_event_loop().run_until_complete(_seed())

    app = FastAPI()
    app.include_router(copilot_module.router, prefix="/api/v1")
    p = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    async def _override_p() -> Any:
        return p

    async def _override_sess() -> Any:
        async with sqlite_db() as session:
            yield session

    app.dependency_overrides[get_current_principal] = _override_p  # type: ignore[attr-defined]
    app.dependency_overrides[db_session] = _override_sess
    from app.core import config

    monkeypatch.setattr(config.settings, "copilot_enabled", True)
    resp = TestClient(app).get(f"/api/v1/copilot/conversations/{conv_id}/cost")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["conversation_id"] == str(conv_id)
    assert float(body["total_cost_usd"]) == pytest.approx(0.42)
    assert body["total_tokens_in"] == 100
    assert body["total_tokens_out"] == 50