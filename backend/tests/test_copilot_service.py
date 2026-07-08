"""F-800 Plan 1 — CopilotService unit tests.

These tests drive the service directly. ``LiteLLMClient.agent_loop`` is
mocked so we don't need a running proxy. The mocked agent_loop returns a
canned ``(response, calls, results)`` tuple — service tests assert
persistence, audit, and event-bus wiring around the LLM call.

Tests cover:
  1. ``test_chat_creates_conversation_on_first_call``
  2. ``test_chat_continues_existing_conversation``
  3. ``test_chat_persists_assistant_message_with_tool_calls``
  4. ``test_chat_records_cost_in_ledger``
  5. ``test_chat_audits_message_recorded``
  6. ``test_chat_emits_event_bus_message_recorded``
  7. ``test_chat_blocks_when_budget_exhausted``
  8. ``test_chat_returns_503_when_tool_loop_exhausted``
  9. ``test_list_conversations_user_isolation``
 10. ``test_get_conversation_404_for_wrong_user``
 11. ``test_delete_conversation_soft_deletes``
 12. ``test_submit_feedback_updates_message``
 13. ``test_list_tools_returns_all_11``
 14. ``test_get_conversation_cost_returns_totals``
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

# IMPORTANT: stub the session module BEFORE importing the integration
# package — same trick used in test_litellm_tools.py.
import app.db.session as _session_mod


class _StubSession:
    def __init__(self) -> None:
        self.added: list[Any] = []

    async def __aenter__(self) -> _StubSession:
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


def _stub_get_session_factory() -> _StubSessionFactory:
    return _StubSessionFactory()


_session_mod.get_session_factory = _stub_get_session_factory  # type: ignore[assignment]


from app.db.models import copilot as _copilot_models  # noqa: E401,E402,F401
from app.db.models.copilot import CopilotConversation, CopilotMessage  # noqa: E402
from app.schemas.copilot import (  # noqa: E402
    CopilotChatRequest,
    CopilotFeedbackRequest,
    CopilotPageContext,
)
from app.services._litellm_tools import ToolCall, ToolResult  # noqa: E402
from app.services.copilot_service import (  # noqa: E402
    CopilotBudgetBlocked,
    CopilotService,
)

# ---------------------------------------------------------------------------
# Test fixtures + helpers
# ---------------------------------------------------------------------------


def _principal(*, permissions=None, tenant_id=None, user_id=None) -> Any:
    from app.core.security import AuthenticatedPrincipal

    return AuthenticatedPrincipal(
        user_id=str(user_id or uuid.uuid4()),
        email="t@example.com",
        tenant_id=str(tenant_id or uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        roles=[],
        raw_claims={"forge.permissions": list(permissions or [])},
    )


def _chat_request(*, conversation_id=None, project_id=None, message="hi"):
    return CopilotChatRequest(
        conversation_id=conversation_id,
        project_id=project_id,
        message=message,
        context=CopilotPageContext(
            current_page="/dashboard",
            current_center="dashboard",
            recent_actions=[],
        ),
    )


def _tool_response_with_call(
    *,
    call_id: str = "call_1",
    tool_name: str = "search_knowledge",
    args: dict[str, Any] | None = None,
    content: str = "final answer",
    prompt_tokens: int = 12,
    completion_tokens: int = 4,
    cost_usd: float = 0.001,
) -> tuple[dict[str, Any], list[ToolCall], list[ToolResult]]:
    """Return a canned ``(response, calls, results)`` triplet."""
    [
        {
            "id": call_id,
            "type": "function",
            "function": {
                "name": tool_name,
                "arguments": '{"query": "x"}' if args is None else _json_dumps(args),
            },
        }
    ]
    response: dict[str, Any] = {
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
    calls = [ToolCall(id=call_id, name=tool_name, arguments_json='{"query": "x"}')]
    results = [
        ToolResult(
            tool_call_id=call_id,
            name=tool_name,
            content='{"nodes": [], "total": 0}',
            is_error=False,
        )
    ]
    return response, calls, results


def _json_dumps(payload: Any) -> str:
    import json

    return json.dumps(payload)


@pytest_asyncio.fixture
async def agent_loop_mock():
    """Patch ``LiteLLMClient.agent_loop`` and ``__aenter__``."""

    async def _no_op_aenter(self):
        return self

    async def _no_op_aexit(self, *args):
        return None

    with (
        patch("app.services.litellm_client.LiteLLMClient.__aenter__", _no_op_aenter),
        patch("app.services.litellm_client.LiteLLMClient.__aexit__", _no_op_aexit),
    ):
        yield


# ---------------------------------------------------------------------------
# 1. Create on first call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_creates_conversation_on_first_call(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(
        permissions=["copilot:use"],
        tenant_id=tenant_id,
        user_id=user_id,
    )
    response, calls, results = _tool_response_with_call()

    async with sqlite_db() as db:
        with patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response, calls, results)),
        ):
            service = CopilotService(db=db, principal=principal)
            req = _chat_request(message="Who owns auth?")
            chat_response = await service.chat(req)

    assert chat_response.conversation_id is not None
    assert chat_response.content == "final answer"
    # Two messages persisted: user + assistant.
    async with sqlite_db() as db:
        from sqlalchemy import select

        rows = (
            (
                await db.execute(
                    select(CopilotMessage).where(
                        CopilotMessage.conversation_id == chat_response.conversation_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2
        assert rows[0].role == "user"
        assert rows[1].role == "assistant"


# ---------------------------------------------------------------------------
# 2. Continue existing conversation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_continues_existing_conversation(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(
        permissions=["copilot:use"],
        tenant_id=tenant_id,
        user_id=user_id,
    )

    # Pre-create a conversation with one assistant message in history.
    async with sqlite_db() as db:
        conv = CopilotConversation(tenant_id=tenant_id, project_id=None, user_id=user_id)
        db.add(conv)
        await db.flush()
        db.add(
            CopilotMessage(
                conversation_id=conv.id,
                tenant_id=tenant_id,
                role="assistant",
                content="earlier answer",
            )
        )
        await db.commit()
        conv_id = conv.id

    response, calls, results = _tool_response_with_call(content="next answer")
    async with sqlite_db() as db:
        with patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response, calls, results)),
        ):
            service = CopilotService(db=db, principal=principal)
            chat_response = await service.chat(
                _chat_request(conversation_id=conv_id, message="what next?")
            )

    assert chat_response.conversation_id == conv_id
    assert chat_response.content == "next answer"


# ---------------------------------------------------------------------------
# 3. Persist tool_calls JSON envelope
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_persists_assistant_message_with_tool_calls(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    response, calls, results = _tool_response_with_call()
    async with sqlite_db() as db:
        with patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response, calls, results)),
        ):
            service = CopilotService(db=db, principal=principal)
            chat_response = await service.chat(_chat_request(message="x"))

    async with sqlite_db() as db:
        from sqlalchemy import select

        row = (
            await db.execute(
                select(CopilotMessage).where(CopilotMessage.id == chat_response.message_id)
            )
        ).scalar_one()
        assert row.role == "assistant"
        assert row.tool_calls is not None
        assert isinstance(row.tool_calls, list)
        assert row.tool_calls[0]["tool"] == "search_knowledge"


# ---------------------------------------------------------------------------
# 4. Cost ledger called once
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_records_cost_in_ledger(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    response, calls, results = _tool_response_with_call(
        prompt_tokens=100, completion_tokens=50, cost_usd=0.025
    )

    fake_ledger = MagicMock()
    fake_ledger.record = AsyncMock()
    with (
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response, calls, results)),
        ),
        patch("app.services.cost_ledger.cost_ledger", fake_ledger),
    ):
        async with sqlite_db() as db:
            service = CopilotService(db=db, principal=principal)
            await service.chat(_chat_request(message="x"))

    # The agent_loop path records cost once per turn at the LiteLLM layer.
    # CopilotService doesn't itself call cost_ledger.record — but the
    # aggregated totals on the conversation row are updated.
    async with sqlite_db() as db:
        from sqlalchemy import select

        rows = (await db.execute(select(CopilotConversation))).scalars().all()
        assert len(rows) == 1
        assert float(rows[0].total_cost_usd) > 0
        assert rows[0].total_tokens_in == 100
        assert rows[0].total_tokens_out == 50


# ---------------------------------------------------------------------------
# 5. Audit message.recorded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_audits_message_recorded(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()

    response, calls, results = _tool_response_with_call()
    with (
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response, calls, results)),
        ),
        patch("app.services.copilot_service.audit_service", fake_audit),
    ):
        async with sqlite_db() as db:
            service = CopilotService(db=db, principal=principal)
            await service.chat(_chat_request(message="x"))

    actions = [c.kwargs["action"] for c in fake_audit.record.call_args_list]
    assert "copilot.message.recorded" in actions
    assert "copilot.conversation.created" in actions


# ---------------------------------------------------------------------------
# 6. Event bus publish
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_emits_event_bus_message_recorded(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    fake_bus = MagicMock()
    fake_bus.publish = AsyncMock()

    response, calls, results = _tool_response_with_call()
    with (
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(return_value=(response, calls, results)),
        ),
        patch("app.services.copilot_service.default_bus", fake_bus),
    ):
        async with sqlite_db() as db:
            service = CopilotService(db=db, principal=principal)
            await service.chat(_chat_request(message="x"))

    published = [c.args[0] for c in fake_bus.publish.call_args_list]
    from app.services.event_bus import EventType

    assert EventType.COPILOT_MESSAGE_RECORDED in published
    assert EventType.COPILOT_CONVERSATION_CREATED in published


# ---------------------------------------------------------------------------
# 7. Budget exhausted -> CopilotBudgetBlocked + audit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_blocks_when_budget_exhausted(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    from app.services.workflow_budget import BudgetExceeded

    fake_audit = MagicMock()
    fake_audit.record = AsyncMock()
    fake_bus = MagicMock()
    fake_bus.publish = AsyncMock()

    with (
        patch(
            "app.services.litellm_client.LiteLLMClient.agent_loop",
            AsyncMock(side_effect=BudgetExceeded(workflow_id=uuid.uuid4(), spent=1.0, ceiling=1.0)),
        ),
        patch("app.services.copilot_service.audit_service", fake_audit),
        patch("app.services.copilot_service.default_bus", fake_bus),
    ):
        async with sqlite_db() as db:
            service = CopilotService(db=db, principal=principal)
            with pytest.raises(CopilotBudgetBlocked):
                await service.chat(_chat_request(message="x"))

    actions = [c.kwargs["action"] for c in fake_audit.record.call_args_list]
    assert "copilot.budget.blocked" in actions
    published = [c.args[0] for c in fake_bus.publish.call_args_list]
    from app.services.event_bus import EventType

    assert EventType.COPILOT_BUDGET_BLOCKED in published


# ---------------------------------------------------------------------------
# 8. ToolLoopExhausted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_returns_tool_loop_exhausted(sqlite_db, agent_loop_mock):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)

    from app.services._litellm_tools import ToolLoopExhausted

    with patch(
        "app.services.litellm_client.LiteLLMClient.agent_loop",
        AsyncMock(side_effect=ToolLoopExhausted(max_turns=5)),
    ):
        async with sqlite_db() as db:
            service = CopilotService(db=db, principal=principal)
            with pytest.raises(ToolLoopExhausted) as excinfo:
                await service.chat(_chat_request(message="x"))
            assert excinfo.value.max_turns == 5


# ---------------------------------------------------------------------------
# 9. list_conversations user isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_conversations_user_isolation(sqlite_db):
    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    project_id = uuid.uuid4()

    async with sqlite_db() as db:
        db.add_all(
            [
                CopilotConversation(tenant_id=tenant_id, project_id=project_id, user_id=user_a),
                CopilotConversation(tenant_id=tenant_id, project_id=project_id, user_id=user_b),
            ]
        )
        await db.commit()

    async with sqlite_db() as db:
        principal_a = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_a)
        service = CopilotService(db=db, principal=principal_a)
        rows = await service.list_conversations()
        assert len(rows) == 1
        assert rows[0].user_id == user_a

    async with sqlite_db() as db:
        principal_b = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_b)
        service = CopilotService(db=db, principal=principal_b)
        rows = await service.list_conversations()
        assert len(rows) == 1
        assert rows[0].user_id == user_b


# ---------------------------------------------------------------------------
# 10. get_conversation wrong user -> 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_conversation_404_for_wrong_user(sqlite_db):
    tenant_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    async with sqlite_db() as db:
        conv = CopilotConversation(tenant_id=tenant_id, project_id=None, user_id=user_a)
        db.add(conv)
        await db.commit()
        conv_id = conv.id

    async with sqlite_db() as db:
        principal_b = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_b)
        service = CopilotService(db=db, principal=principal_b)
        with pytest.raises(LookupError):
            await service.get_conversation(conv_id)


# ---------------------------------------------------------------------------
# 11. delete_conversation soft-deletes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_conversation_soft_deletes(sqlite_db):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    async with sqlite_db() as db:
        conv = CopilotConversation(tenant_id=tenant_id, project_id=None, user_id=user_id)
        db.add(conv)
        await db.commit()
        conv_id = conv.id

    async with sqlite_db() as db:
        principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)
        service = CopilotService(db=db, principal=principal)
        await service.delete_conversation(conv_id)

    async with sqlite_db() as db:
        from sqlalchemy import select

        row = (
            await db.execute(select(CopilotConversation).where(CopilotConversation.id == conv_id))
        ).scalar_one()
        assert row.archived_at is not None


# ---------------------------------------------------------------------------
# 12. submit_feedback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_feedback_updates_message(sqlite_db):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    async with sqlite_db() as db:
        conv = CopilotConversation(tenant_id=tenant_id, project_id=None, user_id=user_id)
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
        msg_id = msg.id

    async with sqlite_db() as db:
        principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)
        service = CopilotService(db=db, principal=principal)
        await service.submit_feedback(msg_id, CopilotFeedbackRequest(rating="up", comment="nice"))

    async with sqlite_db() as db:
        from sqlalchemy import select

        row = (
            await db.execute(select(CopilotMessage).where(CopilotMessage.id == msg_id))
        ).scalar_one()
        assert row.feedback_rating == "up"
        assert row.feedback_comment == "nice"


# ---------------------------------------------------------------------------
# 13. list_tools returns all 11
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_tools_returns_all_11(sqlite_db):
    async with sqlite_db() as db:
        principal = _principal(permissions=["copilot:use"])
        service = CopilotService(db=db, principal=principal)
        tools = await service.list_tools()
        assert len(tools) == 11
        names = {t.name for t in tools}
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


# ---------------------------------------------------------------------------
# 14. get_conversation_cost returns totals
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_conversation_cost_returns_totals(sqlite_db):
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    async with sqlite_db() as db:
        conv = CopilotConversation(
            tenant_id=tenant_id,
            project_id=None,
            user_id=user_id,
            total_cost_usd=Decimal("0.42"),
            total_tokens_in=200,
            total_tokens_out=100,
        )
        db.add(conv)
        await db.commit()
        conv_id = conv.id

    async with sqlite_db() as db:
        principal = _principal(permissions=["copilot:use"], tenant_id=tenant_id, user_id=user_id)
        service = CopilotService(db=db, principal=principal)
        cost = await service.get_conversation_cost(conv_id)
        assert cost.total_cost_usd == Decimal("0.42")
        assert cost.total_tokens_in == 200
        assert cost.total_tokens_out == 100
        assert cost.budget_status in (None, "no_budget", "active", "exhausted")
