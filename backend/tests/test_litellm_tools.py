"""Tests for the LiteLLM tool-calling surface (F-800 Plan 0.2).

The LiteLLM proxy is mocked with :class:`httpx.MockTransport` so we
can assert request bodies, simulate budget exhaustion, and drive the
multi-turn agent loop deterministically. No live proxy or DB required.
"""

from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any

import httpx
import pytest
import pytest_asyncio

# Stub ``app.db.session`` BEFORE importing the integration package so
# any eager module-load-time DB usage does not try to open an async
# engine against the in-memory SQLite URL (which lacks the
# ``pool_size``/``max_overflow`` kwargs the factory passes). The mocked
# httpx transport intercepts every LiteLLM call, so a stub session
# factory is enough.
import app.db.session as _session_mod


class _StubSession:
    async def __aenter__(self) -> "_StubSession":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def commit(self) -> None:
        return None


class _StubSessionFactory:
    def __call__(self, *args: Any, **kwargs: Any) -> _StubSession:
        return _StubSession()


def _stub_get_session_factory() -> _StubSessionFactory:
    return _StubSessionFactory()


_session_mod.get_session_factory = _stub_get_session_factory  # type: ignore[assignment]


from app.services._litellm_tools import (
    ToolCall,
    ToolLoopExhausted,
    ToolResult,
)
from app.services.workflow_budget import (
    BudgetExceeded,
    Decision,
)


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class FakeLedger:
    """Records calls instead of writing to a DB."""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    async def record(self, **kwargs: Any) -> None:
        self.records.append(kwargs)


class FakeBudgetService:
    """Returns a scripted :class:`BudgetCheck` per call."""

    def __init__(self, decision: Decision = Decision.ALLOWED) -> None:
        self._decision = decision
        self.checks: list[dict[str, Any]] = []
        self.recorded: list[dict[str, Any]] = []

    async def check_budget(self, **kwargs: Any) -> Any:
        from app.services.workflow_budget import BudgetCheck

        self.checks.append(kwargs)
        return BudgetCheck(
            decision=self._decision,
            workflow_id=kwargs.get("workflow_id"),
            ceiling_usd=1.0,
            spent_usd=1.0 if self._decision is Decision.BLOCKED else 0.0,
            projected_cost_usd=float(kwargs.get("projected_cost_usd", 0.0)),
            reason="fake",
        )

    async def record_spend(self, **kwargs: Any) -> None:
        self.recorded.append(kwargs)


@pytest_asyncio.fixture
async def mock_client() -> Any:
    """Yield a 5-tuple ``(client, request_log, state, ledger, budget)``."""
    from app.services.litellm_client import LiteLLMClient

    request_log: list[dict[str, Any]] = []
    queue_ref: dict[str, list[dict[str, Any]]] = {"items": []}

    async def handler(request: httpx.Request) -> httpx.Response:
        body: dict[str, Any] = {}
        if request.content:
            try:
                body = json.loads(request.content)
            except json.JSONDecodeError:
                body = {}
        request_log.append({"method": request.method, "url": str(request.url), "body": body})
        if not queue_ref["items"]:
            return httpx.Response(500, json={"error": "no scripted response"})
        # Each entry is the response body itself (status defaults to 200).
        return httpx.Response(200, json=queue_ref["items"].pop(0))

    transport = httpx.MockTransport(handler)
    fake_ledger = FakeLedger()
    fake_budget = FakeBudgetService()
    client = LiteLLMClient(
        base_url="http://litellm.test",
        api_key="test-key",
        cost_ledger=fake_ledger,
        budget_service=fake_budget,
    )

    # Bind ``_impl`` directly so ``__aenter__`` is bypassed — the
    # mocked transport is what we want to exercise, not the real
    # ``ForgeLLMClient`` constructor.
    client._impl = httpx.AsyncClient(
        base_url="http://litellm.test",
        timeout=10.0,
        headers={
            "Authorization": "Bearer test-key",
            "Content-Type": "application/json",
        },
        transport=transport,
    )

    def push(responses: list[dict[str, Any]]) -> None:
        queue_ref["items"] = list(responses)

    try:
        yield client, request_log, push, fake_ledger, fake_budget
    finally:
        await client._impl.aclose()
        client._impl = None


def _tool_response(
    *,
    content: str | None = "Hello!",
    tool_calls: list[dict[str, Any]] | None = None,
    prompt_tokens: int = 10,
    completion_tokens: int = 5,
    cost_usd: float = 0.001,
) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {
        "id": "chatcmpl-test",
        "model": "gpt-4o-mini",
        "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost_usd": cost_usd,
        },
    }


SAMPLE_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "Search the project knowledge graph.",
            "parameters": {
                "type": "object",
                "properties": {"q": {"type": "string"}},
                "required": ["q"],
            },
        },
    }
]


def _tool_call_payload(
    name: str, args: dict[str, Any], call_id: str | None = None
) -> dict[str, Any]:
    return {
        "id": call_id or f"call_{uuid.uuid4().hex[:8]}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


# ---------------------------------------------------------------------------
# chat_with_tools
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_with_tools_single_call(mock_client: Any) -> None:
    client, _log, push, _ledger, _budget = mock_client
    push([_tool_response(content="final answer", cost_usd=0.0)])
    response, calls = await client.chat_with_tools(
        messages=[{"role": "user", "content": "hi"}],
        tools=SAMPLE_TOOLS,
        tenant_id="tenant-1",
        project_id="project-1",
    )
    assert response["choices"][0]["message"]["content"] == "final answer"
    assert calls == []


@pytest.mark.asyncio
async def test_chat_with_tools_records_cost(mock_client: Any) -> None:
    client, _log, push, ledger, _budget = mock_client
    push([_tool_response(prompt_tokens=42, completion_tokens=7, cost_usd=0.0123)])
    await client.chat_with_tools(
        messages=[{"role": "user", "content": "hi"}],
        tools=SAMPLE_TOOLS,
        tenant_id="tenant-1",
        project_id="project-1",
    )
    assert len(ledger.records) == 1
    row = ledger.records[0]
    assert row["prompt_tokens"] == 42
    assert row["completion_tokens"] == 7
    assert row["cost_usd"] == pytest.approx(0.0123)
    assert row["source"] == "litellm"


@pytest.mark.asyncio
async def test_chat_with_tools_blocks_on_budget(mock_client: Any) -> None:
    client, _log, _push, _ledger, budget = mock_client
    budget._decision = Decision.BLOCKED
    with pytest.raises(BudgetExceeded):
        await client.chat_with_tools(
            messages=[{"role": "user", "content": "hi"}],
            tools=SAMPLE_TOOLS,
            tenant_id="tenant-1",
            project_id="project-1",
            workflow_id="wf-1",
        )
    assert len(budget.checks) == 1


@pytest.mark.asyncio
async def test_chat_with_tools_forwards_tool_choice(mock_client: Any) -> None:
    client, log, push, _ledger, _budget = mock_client
    push([_tool_response(content="ok")])
    await client.chat_with_tools(
        messages=[{"role": "user", "content": "hi"}],
        tools=SAMPLE_TOOLS,
        tenant_id="tenant-1",
        project_id="project-1",
        tool_choice="auto",
    )
    assert log[0]["body"]["tool_choice"] == "auto"
    assert log[0]["body"]["tools"] == SAMPLE_TOOLS


# ---------------------------------------------------------------------------
# agent_loop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_loop_multi_turn(mock_client: Any) -> None:
    client, log, push, _ledger, _budget = mock_client
    call_id = "call_abc"
    push([
        _tool_response(tool_calls=[_tool_call_payload("search_knowledge", {"q": "auth"}, call_id)]),
        _tool_response(content="Auth is handled by Keycloak."),
    ])

    async def executor(call: ToolCall) -> ToolResult:
        assert call.name == "search_knowledge"
        assert call.id == call_id
        return ToolResult(
            tool_call_id=call.id,
            name=call.name,
            content="keycloak is the auth provider",
        )

    response, calls, results = await client.agent_loop(
        messages=[{"role": "user", "content": "Who owns auth?"}],
        tools=SAMPLE_TOOLS,
        tool_executor=executor,
        max_turns=5,
        tenant_id="tenant-1",
        project_id="project-1",
    )
    assert response["choices"][0]["message"]["content"] == "Auth is handled by Keycloak."
    assert len(calls) == 1
    assert len(results) == 1
    assert len(log) == 2
    tool_messages = [m for m in log[1]["body"]["messages"] if m.get("role") == "tool"]
    assert len(tool_messages) == 1
    assert tool_messages[0]["tool_call_id"] == call_id
    assert "keycloak" in tool_messages[0]["content"].lower()


@pytest.mark.asyncio
async def test_agent_loop_tool_result_passed_back(mock_client: Any) -> None:
    client, log, push, _ledger, _budget = mock_client
    call_id = "call_xyz"
    push([
        _tool_response(tool_calls=[_tool_call_payload("search_knowledge", {"q": "x"}, call_id)]),
        _tool_response(content="done"),
    ])

    async def executor(call: ToolCall) -> ToolResult:
        return ToolResult(tool_call_id=call.id, name=call.name, content="RESULT-CONTENT")

    await client.agent_loop(
        messages=[{"role": "user", "content": "q"}],
        tools=SAMPLE_TOOLS,
        tool_executor=executor,
        max_turns=5,
        tenant_id="tenant-1",
        project_id="project-1",
    )
    second_messages = log[1]["body"]["messages"]
    tool_msgs = [m for m in second_messages if m.get("role") == "tool"]
    assert tool_msgs[0]["content"] == "RESULT-CONTENT"
    assistant_msgs = [m for m in second_messages if m.get("role") == "assistant"]
    assert assistant_msgs, "assistant tool-call message must be echoed back"


@pytest.mark.asyncio
async def test_agent_loop_exhausted(mock_client: Any) -> None:
    client, log, push, _ledger, _budget = mock_client
    push([
        _tool_response(tool_calls=[_tool_call_payload("search_knowledge", {"q": "1"})]),
        _tool_response(tool_calls=[_tool_call_payload("search_knowledge", {"q": "2"})]),
    ])

    async def executor(call: ToolCall) -> ToolResult:
        return ToolResult(tool_call_id=call.id, name=call.name, content="no result")

    with pytest.raises(ToolLoopExhausted) as excinfo:
        await client.agent_loop(
            messages=[{"role": "user", "content": "loop"}],
            tools=SAMPLE_TOOLS,
            tool_executor=executor,
            max_turns=2,
            tenant_id="tenant-1",
            project_id="project-1",
        )
    assert excinfo.value.max_turns == 2
    assert len(log) == 2


@pytest.mark.asyncio
async def test_agent_loop_no_tool_choice_by_default(mock_client: Any) -> None:
    client, log, push, _ledger, _budget = mock_client
    push([_tool_response(content="ok")])

    async def never_called(_call: ToolCall) -> ToolResult:
        raise AssertionError("executor should not run when model answers directly")

    await client.agent_loop(
        messages=[{"role": "user", "content": "hi"}],
        tools=SAMPLE_TOOLS,
        tool_executor=never_called,
        max_turns=2,
        tenant_id="tenant-1",
        project_id="project-1",
    )
    assert log[0]["body"]["tool_choice"] == "auto"