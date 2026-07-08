"""M10 — Co-pilot streaming chunk hydration test (M10-G5).

Verifies the contract that the ``CopilotService.stream_chat`` SSE
pipeline emits multiple ``token`` events for a multi-token LLM response
and that the persisted ``CopilotMessage`` is finalized on the terminal
``done`` event (``updated_at`` set, ``typing_indicator = False``).

The test drives the service directly (no HTTP layer) and stubs
``LiteLLMClient`` to a deterministic multi-token stream. This is
resilient to the internal ``stream_chat`` implementation — the contract
is "≥2 chunks emitted, final state persisted" regardless of how the
service wires the LLM call internally.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio

# ---------------------------------------------------------------------------
# Stub LiteLLMClient that yields a deterministic 7-token stream
# ---------------------------------------------------------------------------


def _delta_chunk(text: str) -> dict[str, Any]:
    """OpenAI-shaped streaming chunk carrying one content delta.

    Returns a real ``dict`` so ``CopilotService._stream_one_turn`` can
    call ``chunk.get("choices")`` on it (the existing test_streaming
    helper returns an object with attribute access — that breaks the
    service contract that does ``chunk.get(...)`` everywhere).
    """
    return {
        "choices": [
            {
                "index": 0,
                "delta": {"content": text, "role": "assistant"},
                "finish_reason": None,
            }
        ],
        "usage": None,
    }


def _terminal_chunk(
    tokens_in: int = 11,
    tokens_out: int = 7,
) -> dict[str, Any]:
    """Final streaming chunk carrying the usage block."""
    return {
        "choices": [
            {
                "index": 0,
                "delta": {"content": "", "role": "assistant"},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": tokens_in,
            "completion_tokens": tokens_out,
            "cost_usd": 0.0017,
        },
    }


class _StreamingStubLiteLLMClient:
    """Stand-in for ``LiteLLMClient`` whose ``chat`` returns a 7-token stream.

    Yields 7 distinct content deltas (well above the spec's ≥5-token
    floor) followed by a terminal chunk carrying usage. The
    async-context-manager methods are no-ops — same shape as the stub
    in ``tests/copilot/test_streaming.py`` so the existing pattern is
    mirrored.

    Note on the ``chat`` shape: the real ``LiteLLMClient.chat`` is
    ``async def`` and returns either a ``dict`` (non-streaming) or an
    ``AsyncIterator[dict]`` (streaming). The Co-pilot service does
    ``stream_iter = await client.chat(...)`` then ``async for chunk in
    stream_iter`` — so when stream=True the awaited call must resolve
    to an AsyncIterator. The stub mirrors that exactly.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self) -> _StreamingStubLiteLLMClient:
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        return None

    async def chat(
        self, messages: list[dict[str, Any]], **kwargs: Any
    ) -> AsyncIterator[dict[str, Any]]:
        self.calls.append({"messages": messages, "kwargs": kwargs})

        async def _stream() -> AsyncIterator[dict[str, Any]]:
            for token in ("Sure", ",", " here", " is", " a", " 5-token", " answer"):
                yield _delta_chunk(token)
            yield _terminal_chunk()

        # Match the real facade: return an AsyncIterator when
        # stream=True. The caller awaits the coroutine to receive the
        # iterator (see ``CopilotService._stream_one_turn``).
        return _stream()


# ---------------------------------------------------------------------------
# Fixture: stub the LiteLLMClient import in copilot_service
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def streaming_litellm_stub(monkeypatch: pytest.MonkeyPatch):
    """Patch ``LiteLLMClient`` to the stub.

    ``copilot_service.stream_chat`` lazy-imports ``LiteLLMClient`` from
    ``app.services.litellm_client`` inside the function body — there is
    no module-level binding on ``copilot_service`` to patch. We patch
    the symbol at its source module so the lazy import resolves to the
    stub.
    """
    monkeypatch.setattr(
        "app.services.litellm_client.LiteLLMClient",
        _StreamingStubLiteLLMClient,
    )
    yield _StreamingStubLiteLLMClient


# ---------------------------------------------------------------------------
# Helpers
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


def _chat_request(*, message: str = "say something") -> Any:
    from app.schemas.copilot import CopilotChatRequest, CopilotPageContext

    # Phase 4 — null project_id now raises 422 (R2). Give the streaming
    # test fixture a project_id so it reaches the streaming path.
    return CopilotChatRequest(
        conversation_id=None,
        project_id=uuid.uuid4(),
        message=message,
        context=CopilotPageContext(
            current_page="/copilot",
            current_center="copilot",
            recent_actions=[],
        ),
    )


# ---------------------------------------------------------------------------
# M10-G5 — Streaming chunk hydration contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stream_chat_emits_multiple_sse_chunks(
    sqlite_db,
    streaming_litellm_stub,
) -> None:
    """``service.stream_chat`` emits ≥2 token chunks for a multi-token
    response and the persisted ``CopilotMessage`` is finalized
    (``updated_at`` set, ``typing_indicator = False``).

    Drives the inner service directly (no HTTP layer) so the test is
    resilient to changes in the route plumbing. The contract is:
    ≥2 chunks emitted AND the final assistant message row exists in
    the conversation with its updated_at stamp and the typing
    indicator cleared.
    """
    from sqlalchemy import select

    from app.db.models.copilot import CopilotMessage
    from app.services.copilot_service import CopilotService

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    principal = _principal(
        permissions=["copilot:use"],
        tenant_id=tenant_id,
        user_id=user_id,
    )

    events: list[dict[str, Any]] = []
    done_payload: dict[str, Any] | None = None

    async with sqlite_db() as db:
        service = CopilotService(db=db, principal=principal)
        async for event in service.stream_chat(_chat_request(message="ping")):
            events.append(event)
            if event.get("event") == "done":
                done_payload = event["data"]

    # ---- Contract: ≥2 token chunks emitted ---------------------------
    token_events = [e for e in events if e.get("event") == "token"]
    assert len(token_events) >= 2, f"expected ≥2 token chunks, got {len(token_events)}"
    full_text = "".join(str(e["data"]) for e in token_events)
    # Sanity: the stub emitted 7 distinct tokens totalling this string.
    assert full_text == "Sure, here is a 5-token answer"

    # ---- Contract: one terminal ``done`` event -----------------------
    assert done_payload is not None
    assert done_payload["content"] == full_text
    assert done_payload["tokens_in"] == 11
    assert done_payload["tokens_out"] == 7
    message_id = done_payload["message_id"]

    # ---- Contract: the persisted assistant message is finalized ------
    async with sqlite_db() as db:
        row = (
            await db.execute(
                select(CopilotMessage).where(CopilotMessage.id == uuid.UUID(message_id))
            )
        ).scalar_one()
        assert row.role == "assistant"
        assert row.content == full_text
        # M10-G5 — finalized state.
        assert row.typing_indicator is False
        assert row.updated_at is not None
        # Token + cost telemetry wired through to the DB row.
        assert row.tokens_out == 7
        assert float(row.cost_usd) == pytest.approx(0.0017)
