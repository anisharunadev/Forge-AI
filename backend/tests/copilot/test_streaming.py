"""SSE streaming tests for the Co-pilot chat endpoint.

Verifies the wire format of ``POST /api/v1/copilot/conversations:stream``
by mocking the LiteLLM streaming call and asserting the ``data:`` lines
the route emits.

Run with: ``pytest tests/copilot/test_streaming.py -v``
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest


def _delta_chunk(text: str) -> dict[str, Any]:
    """Build an OpenAI-shaped streaming chunk carrying one content delta."""

    class _Delta:
        def __init__(self, content: str) -> None:
            self.content = content
            self.tool_calls: list[Any] = []

    class _Choice:
        def __init__(self, content: str) -> None:
            self.delta = _Delta(content)

    class _Chunk:
        def __init__(self, content: str) -> None:
            self.choices = [_Choice(content)]
            self.usage: dict[str, Any] = {}

    return _Chunk(text)  # type: ignore[arg-type]  # noqa: F821


def _terminal_chunk(
    tokens_in: int = 3,
    tokens_out: int = 7,
    cost_usd: float = 0.001,
) -> dict[str, Any]:
    """Terminal chunk carrying the usage block."""

    class _Delta:
        content: str | None = None
        tool_calls: list[Any] = []

    class _Choice:
        delta = _Delta()

    class _Chunk:
        def __init__(self) -> None:
            self.choices = [_Choice()]
            self.usage = {
                "prompt_tokens": tokens_in,
                "completion_tokens": tokens_out,
                "cost_usd": cost_usd,
            }

    return _Chunk()  # type: ignore[return-value]


class _StubLiteLLMClient:
    """Stand-in for ``LiteLLMClient`` whose ``chat`` returns a deterministic
    3-token stream and whose ``__aenter__`` / ``__aexit__`` are no-ops."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self) -> _StubLiteLLMClient:
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(
        self, messages: list[dict[str, Any]], **kwargs: Any
    ) -> AsyncIterator[dict[str, Any]]:
        self.calls.append({"messages": messages, "kwargs": kwargs})
        for chunk_text in ("Hello", " there", " world"):
            yield _delta_chunk(chunk_text)
        # Terminal chunk carries usage.
        yield _terminal_chunk()


@pytest.mark.asyncio
async def test_chat_stream_emits_sse_events(
    client: Any,
    principal_steward: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``POST /conversations:stream`` emits start → token* → done with
    the expected headers + content."""

    monkeypatch.setattr(
        "app.services.copilot_service.LiteLLMClient",
        _StubLiteLLMClient,
    )

    response = await client.post(
        "/api/v1/copilot/conversations:stream",
        json={
            "message": "Hi",
            "context": {
                "current_page": "/copilot",
                "current_center": None,
                "current_artifact_id": None,
                "recent_actions": [],
            },
        },
        headers=principal_steward,
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    # ponytail: these two headers defeat nginx buffering; runs.py omits
    # them — the streaming route must NOT omit them.
    assert response.headers.get("cache-control") == "no-cache"
    assert response.headers.get("x-accel-buffering") == "no"

    body = response.text
    events: list[dict[str, Any]] = []
    for line in body.split("\n"):
        line = line.strip()  # noqa: PLW2901
        if not line.startswith("data:"):
            continue
        try:
            events.append(json.loads(line[5:].strip()))
        except json.JSONDecodeError:
            continue

    assert events, "expected at least one SSE event"
    assert events[0]["event"] == "start"
    assert "conversation_id" in events[0]["data"]

    token_events = [e for e in events if e["event"] == "token"]
    assert len(token_events) == 3
    assert "".join(e["data"] for e in token_events) == "Hello there world"

    done = [e for e in events if e["event"] == "done"]
    assert len(done) == 1
    assert done[0]["data"]["content"] == "Hello there world"
    assert done[0]["data"]["tokens_in"] == 3
    assert done[0]["data"]["tokens_out"] == 7


@pytest.mark.asyncio
async def test_chat_stream_emits_error_event_on_llm_failure(
    client: Any,
    principal_steward: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the LLM client raises mid-stream, the route emits one
    ``error`` event and closes."""

    class _BoomLiteLLMClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> _BoomLiteLLMClient:
            return self

        async def __aexit__(self, *_exc: Any) -> None:
            return None

        async def chat(
            self, messages: list[dict[str, Any]], **kwargs: Any
        ) -> AsyncIterator[dict[str, Any]]:
            raise RuntimeError("provider down")
            yield  # pragma: no cover — makes this an async generator

    monkeypatch.setattr(
        "app.services.copilot_service.LiteLLMClient",
        _BoomLiteLLMClient,
    )

    response = await client.post(
        "/api/v1/copilot/conversations:stream",
        json={
            "message": "Hi",
            "context": {
                "current_page": "/copilot",
                "current_center": None,
                "current_artifact_id": None,
                "recent_actions": [],
            },
        },
        headers=principal_steward,
    )
    assert response.status_code == 200

    body = response.text
    error_events: list[dict[str, Any]] = []
    for line in body.split("\n"):
        line = line.strip()  # noqa: PLW2901
        if not line.startswith("data:"):
            continue
        try:
            evt = json.loads(line[5:].strip())
        except json.JSONDecodeError:
            continue
        if evt.get("event") == "error":
            error_events.append(evt)

    assert len(error_events) == 1
    assert error_events[0]["data"]["code"] == "internal"
    assert "provider down" in error_events[0]["data"]["message"]
