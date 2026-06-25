"""Unit tests for ``app.integrations.litellm.llm_client`` (F-829j).

The new ``ForgeLLMClient`` is the hot path every Forge LLM call now
flows through. The tests cover:

  1. ``chat`` POSTs to ``/v1/chat/completions``.
  2. ``chat`` adds the ``X-Forge-Trace-Id`` header on every request.
  3. ``chat`` raises ``BudgetExceeded`` when the workflow budget
     service reports BLOCKED (pre-call admission control).
  4. ``chat`` raises ``LLMUnavailableError`` and records the
     ``LITELLM_DOWN`` health event when the proxy is unreachable.

The tests assume the module exposes (or will expose):

    class LLMUnavailableError(Exception): ...

    class ForgeLLMClient:
        def __init__(
            self,
            *,
            chat_client,
            trace_correlator=None,
            budget_service=None,
            health_monitor=None,
        ) -> None: ...

        async def chat(
            self,
            messages: list[dict],
            *,
            model: str = ...,
            tenant_id: str = ...,
            project_id: str = ...,
            workflow_id: str | None = None,
            forge_trace_id: str = ...,
        ) -> dict: ...
"""

from __future__ import annotations

import pytest


def _try_import_llm_client():
    return pytest.importorskip("app.integrations.litellm.llm_client")


def _make_chat_response(
    content: str = "hello world",
    *,
    prompt_tokens: int = 10,
    completion_tokens: int = 5,
    cost_usd: float = 0.0001,
):
    from unittest.mock import AsyncMock

    resp = AsyncMock(name="httpx_chat_response")
    resp.status_code = 200
    resp.json = lambda: {
        "id": "chatcmpl-fake",
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
            "total_tokens": prompt_tokens + completion_tokens,
            "cost_usd": cost_usd,
        },
    }
    resp.raise_for_status = lambda: None
    return resp


# ---------------------------------------------------------------------------
# 1. chat routes via LiteLLM (/v1/chat/completions)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_routes_via_litellm(
    mock_litellm_chat_client,
    settings_override,
    fake_tenant_id,
    fake_project_id,
):
    mod = _try_import_llm_client()
    client = mod.ForgeLLMClient(chat_client=mock_litellm_chat_client)

    mock_litellm_chat_client.post.return_value = _make_chat_response()

    out = await client.chat(
        messages=[{"role": "user", "content": "hi"}],
        model="gpt-4o-mini",
        tenant_id=fake_tenant_id,
        project_id=fake_project_id,
        forge_trace_id="trace-abc",
    )

    mock_litellm_chat_client.post.assert_awaited_once()
    call = mock_litellm_chat_client.post.await_args
    assert "/v1/chat/completions" in str(call.args[0])

    # Body must carry the model and messages.
    body = call.kwargs.get("json") or call.args[1]
    assert body["model"] == "gpt-4o-mini"
    assert body["messages"] == [{"role": "user", "content": "hi"}]

    # Result carries the assistant content.
    assert out["choices"][0]["message"]["content"] == "hello world"


# ---------------------------------------------------------------------------
# 2. chat adds X-Forge-Trace-Id header
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_adds_trace_id_header(
    mock_litellm_chat_client,
    settings_override,
    fake_tenant_id,
    fake_project_id,
):
    mod = _try_import_llm_client()
    client = mod.ForgeLLMClient(chat_client=mock_litellm_chat_client)
    mock_litellm_chat_client.post.return_value = _make_chat_response()

    forge_trace_id = "trace-deadbeef-1234"
    await client.chat(
        messages=[{"role": "user", "content": "hi"}],
        tenant_id=fake_tenant_id,
        project_id=fake_project_id,
        forge_trace_id=forge_trace_id,
    )

    call = mock_litellm_chat_client.post.await_args
    # Header may be passed via kwargs.headers OR inside the second
    # positional argument as a dict. Check both.
    headers = call.kwargs.get("headers") or {}
    if not headers and len(call.args) >= 2 and isinstance(call.args[1], dict):
        headers = call.args[1].get("headers", {})
    assert headers.get("X-Forge-Trace-Id") == forge_trace_id, (
        f"Expected X-Forge-Trace-Id={forge_trace_id}, got headers={headers!r}"
    )


# ---------------------------------------------------------------------------
# 3. chat raises BudgetExceeded when budget service says BLOCKED
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_budget_exceeded_raises(
    mock_litellm_chat_client,
    settings_override,
    fake_tenant_id,
    fake_project_id,
):
    """If the workflow budget service reports BLOCKED, chat must
    raise BEFORE making the upstream HTTP call. The hot path must
    short-circuit on admission control failures (NFR-044).
    """
    from unittest.mock import AsyncMock

    mod = _try_import_llm_client()

    # Build a fake budget service that returns a BLOCKED decision.
    from app.services.workflow_budget import BudgetExceeded, Decision  # type: ignore

    blocked_check = AsyncMock(name="budget_check")
    blocked_check.decision = Decision.BLOCKED
    blocked_check.ceiling_usd = 5.0
    blocked_check.spent_usd = 4.99
    blocked_check.projected_cost_usd = 0.05

    budget_service = AsyncMock(name="budget_service")
    budget_service.check_budget.return_value = blocked_check

    client = mod.ForgeLLMClient(
        chat_client=mock_litellm_chat_client,
        budget_service=budget_service,
    )

    with pytest.raises(BudgetExceeded):
        await client.chat(
            messages=[{"role": "user", "content": "hi"}],
            tenant_id=fake_tenant_id,
            project_id=fake_project_id,
            workflow_id="wf-123",
            forge_trace_id="trace-xyz",
        )

    # No upstream call should have been made.
    mock_litellm_chat_client.post.assert_not_called()
    budget_service.check_budget.assert_awaited_once()


# ---------------------------------------------------------------------------
# 4. chat raises LLMUnavailableError when LiteLLM is down
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_handles_litellm_down(
    mock_litellm_chat_client,
    settings_override,
    fake_tenant_id,
    fake_project_id,
):
    """When httpx raises ``ConnectionError`` (LiteLLM unreachable),
    chat raises ``LLMUnavailableError`` and notifies the health
    monitor so the cached state flips to unhealthy.
    """
    from unittest.mock import AsyncMock

    mod = _try_import_llm_client()
    Unavailable = mod.LLMUnavailableError

    health_monitor = AsyncMock(name="health_monitor")
    health_monitor.record_down = AsyncMock(name="health_monitor.record_down")
    health_monitor.record_success = AsyncMock(name="health_monitor.record_success")

    client = mod.ForgeLLMClient(
        chat_client=mock_litellm_chat_client,
        health_monitor=health_monitor,
    )

    # Simulate LiteLLM down.
    mock_litellm_chat_client.post.side_effect = ConnectionError("litellm unreachable")

    with pytest.raises(Unavailable):
        await client.chat(
            messages=[{"role": "user", "content": "hi"}],
            tenant_id=fake_tenant_id,
            project_id=fake_project_id,
            forge_trace_id="trace-down",
        )

    # The health monitor must have been notified of the failure.
    assert health_monitor.record_down.await_count >= 1
