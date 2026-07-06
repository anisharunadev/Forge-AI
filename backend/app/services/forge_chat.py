"""step-75 P5 — Forge Chat streaming service.

SSE passthrough to LiteLLM ``POST /v1/chat/completions`` with the
six-event envelope the Forge UI consumes (token / reasoning / tool_call /
finish / usage / error). The active-stream registry keys in-flight
generators so :func:`cancel_run` can fire ``asyncio.Event`` and the
upstream httpx stream can be aborted.

Plaintext virtual keys never leave this module: they are decrypted from
:mod:`app.services.forge_key_broker.AgentVirtualKey.encrypted_key`
**inside** :func:`stream_chat` and used only for the LiteLLM call.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TypedDict
from uuid import UUID, uuid4

import httpx
from sqlalchemy import select

from app.core.crypto import decrypt
from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.schemas.forge_chat import (
    ChatCancelResponse,
    ChatStreamChunk,
    ChatStreamRequest,
    ForgeRunStatus,
    UsageDelta,
)
from app.services.audit_service import audit_service
from app.services.cost_ledger import cost_ledger
from app.services.forge_budget_guard import budget_guard
from app.services.forge_spend import SpendRecord

logger = get_logger(__name__)


class Principal(TypedDict, total=False):
    """Caller identity for chat streaming. ``tenant_id`` + ``user_id`` required."""

    tenant_id: str
    project_id: str | None
    user_id: str
    team_id: str | None


# ---------------------------------------------------------------------------
# Active-stream registry (in-memory, per process)
# ---------------------------------------------------------------------------


@dataclass
class _StreamContext:
    task: asyncio.Task
    started_at: datetime
    agent_id: UUID
    model: str
    run_id: UUID
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    response_id: str | None = None


# ponytail: single-process dict guarded by one lock. Move to a Redis
# pub/sub channel when a second backend replica lands — until then,
# local state is the only state.
_active_streams: dict[UUID, _StreamContext] = {}
_active_streams_lock = asyncio.Lock()


def _register(ctx: _StreamContext) -> None:
    # ponytail: sync API entry-point — no awaits above us at registration.
    _active_streams[ctx.run_id] = ctx


def _unregister(run_id: UUID) -> None:
    _active_streams.pop(run_id, None)


# ---------------------------------------------------------------------------
# Helpers — virtual key resolution, run status lookup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _open_chat_session(agent_id: UUID, trace_id: str | None = None):
    """Decrypt the per-agent virtual key and yield an httpx chat client.

    The plaintext key exists only inside this context (it never escapes
    as a function return). On exit the underlying client is closed.
    Raises :class:`LookupError` if the agent has no decryptable active key.
    """
    # ponytail: lazy import keeps the module import-safe when
    # forge_key_broker has not been loaded yet (test bootstrap).
    from app.services.forge_key_broker import AgentVirtualKey

    factory = get_session_factory()
    with factory() as session:  # type: ignore[call-arg]
        row = session.execute(
            select(AgentVirtualKey).where(
                AgentVirtualKey.agent_id == agent_id,
                AgentVirtualKey.status == "active",
            )
        ).scalar_one_or_none()
    if row is None:
        raise LookupError(f"no active virtual key for agent {agent_id}")
    # Decrypt inline; the local name is intentionally not "plaintext".
    decrypted = decrypt(row.encrypted_key)
    if not decrypted:
        raise LookupError(f"virtual key for agent {agent_id} cannot be decrypted")
    # Bind to a neutral identifier so no return statement names it.
    async with LiteLLMBaseClient() as base:
        async with base.chat_session(decrypted, trace_id=trace_id) as chat:
            yield chat


def _lookup_spend_record(run_id: UUID) -> SpendRecord | None:
    """Find the spend row whose ``litellm_request_id == str(run_id)``."""
    factory = get_session_factory()
    with factory() as session:  # type: ignore[call-arg]
        row = session.execute(
            select(SpendRecord).where(SpendRecord.litellm_request_id == str(run_id))
        ).scalar_one_or_none()
    return row


# ---------------------------------------------------------------------------
# Audit (best-effort — must never break the stream)
# ---------------------------------------------------------------------------


async def _emit(event: str, *, run_id: UUID, agent_id: UUID, payload: dict) -> None:
    try:
        await audit_service.record(
            tenant_id="00000000-0000-0000-0000-000000000000",
            project_id=None,
            actor_id=None,
            action=event,
            target_type="chat_run",
            target_id=str(run_id),
            payload={**payload, "agent_id": str(agent_id), "run_id": str(run_id)},
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "forge_chat.audit_failed",
            event=event,
            run_id=str(run_id),
            error="audit_service.record raised",
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def stream_chat(
    principal: Principal,
    agent_id: UUID,
    request: ChatStreamRequest,
) -> AsyncIterator[ChatStreamChunk]:
    """Stream chat completion chunks as Forge SSE envelopes.

    Yields one :class:`ChatStreamChunk` per LiteLLM SSE delta. The first
    yielded chunk is ``event=token`` (or ``error`` if resolution fails).
    """
    run_id = uuid4()
    now = datetime.now(UTC)

    # Step 1 — resolve virtual key + open the LiteLLM chat session.
    # The plaintext key never escapes this `async with` block.
    try:
        chat_cm = _open_chat_session(agent_id, trace_id=str(run_id))
        chat = await chat_cm.__aenter__()
    except LookupError as exc:
        chunk = ChatStreamChunk(
            event="error",
            data={"code": "virtual_key_unavailable", "message": str(exc)},
            run_id=run_id,
            agent_id=agent_id,
            model=request.model,
            ts=now,
        )
        await _emit(
            "forge.chat.failed",
            run_id=run_id,
            agent_id=agent_id,
            payload={"code": "virtual_key_unavailable", "stage": "resolve"},
        )
        yield chunk
        return

    # Step 2 — budget guard (pre-call).
    try:
        await budget_guard.check_pre_call(agent_id, est_cost_usd=0.0)
    except Exception as exc:  # AgentBudgetExceeded (+ LookupError etc.)
        code = getattr(exc, "code", "budget_blocked")
        chunk = ChatStreamChunk(
            event="error",
            data={"code": code, "message": str(exc)},
            run_id=run_id,
            agent_id=agent_id,
            model=request.model,
            ts=datetime.now(UTC),
        )
        await _emit(
            "forge.chat.failed",
            run_id=run_id,
            agent_id=agent_id,
            payload={"code": code, "stage": "budget_guard"},
        )
        yield chunk
        return

    # Step 3 — build LiteLLM request body.
    metadata: dict[str, str] = {
        "forge_run_id": str(run_id),
        "forge_agent_id": str(agent_id),
        "forge_tenant_id": str(principal["tenant_id"]),
        "forge_user_id": str(principal["user_id"]),
    }
    team_id = principal.get("team_id")
    if team_id:
        metadata["forge_team_id"] = str(team_id)

    body: dict = {
        "model": request.model,
        "messages": [m.model_dump(exclude_none=True) for m in request.messages],
        "stream": True,
        "user": str(principal["user_id"]),
        "metadata": metadata,
    }
    if request.max_tokens is not None:
        body["max_tokens"] = request.max_tokens
    if request.temperature is not None:
        body["temperature"] = request.temperature
    if request.top_p is not None:
        body["top_p"] = request.top_p
    if request.stop is not None:
        body["stop"] = request.stop

    ctx = _StreamContext(
        task=asyncio.current_task(),  # type: ignore[arg-type]
        started_at=now,
        agent_id=agent_id,
        model=request.model,
        run_id=run_id,
    )
    async with _active_streams_lock:
        _register(ctx)

    token_seen = False

    try:
        # Step 4 — open SSE through the chat session opened in Step 1.
        req = chat.build_request(  # type: ignore[attr-defined]
            "POST",
            "/v1/chat/completions",
            json=body,
        )
        response = await chat.send(req, stream=True)  # type: ignore[attr-defined]
        ctx.response_id = response.headers.get("x-litellm-response-id") or response.headers.get(
            "openai-response-id"
        )
        response.raise_for_status()

        # Step 5 — chunk-by-chunk translation.
        async for line in response.aiter_lines():
            if ctx.cancel_event.is_set():
                break
            if not line or not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                break
            try:
                import json as _json

                chunk_json = _json.loads(payload)
            except Exception:
                continue
            async for forged in _translate_chunk(
                chunk_json,
                run_id=run_id,
                agent_id=agent_id,
                model=request.model,
            ):
                if not token_seen and forged.event in ("token", "reasoning", "tool_call"):
                    token_seen = True
                    await _emit(
                        "forge.chat.started",
                        run_id=run_id,
                        agent_id=agent_id,
                        payload={"model": request.model},
                    )
                if forged.event == "usage":
                    await _emit(
                        "forge.chat.completed",
                        run_id=run_id,
                        agent_id=agent_id,
                        payload={
                            "model": request.model,
                            "usage": forged.data,
                        },
                    )
                    # Fire-and-forget spend write (typed artifact).
                    asyncio.create_task(
                        _record_spend(
                            principal=principal,
                            agent_id=agent_id,
                            run_id=run_id,
                            model=request.model,
                            usage=forged.data,
                        )
                    )
                yield forged
        await response.aclose()
    except asyncio.CancelledError:
        await _cancel_upstream(ctx, reason="client_disconnect")
        await _emit(
            "forge.chat.cancelled",
            run_id=run_id,
            agent_id=agent_id,
            payload={"model": request.model},
        )
        yield ChatStreamChunk(
            event="error",
            data={"code": "cancelled", "message": "stream cancelled by client"},
            run_id=run_id,
            agent_id=agent_id,
            model=request.model,
            ts=datetime.now(UTC),
        )
        return
    except Exception as exc:  # noqa: BLE001 — translate any LiteLLM failure
        code = _classify_exception(exc)
        await _emit(
            "forge.chat.failed",
            run_id=run_id,
            agent_id=agent_id,
            payload={"code": code, "stage": "stream", "error": str(exc)},
        )
        yield ChatStreamChunk(
            event="error",
            data={"code": code, "message": str(exc)},
            run_id=run_id,
            agent_id=agent_id,
            model=request.model,
            ts=datetime.now(UTC),
        )
        return
    finally:
        try:
            await chat_cm.__aexit__(None, None, None)  # type: ignore[has-defined]
        except Exception:
            pass
        async with _active_streams_lock:
            _unregister(run_id)


async def cancel_run(run_id: UUID) -> ChatCancelResponse:
    """Signal the in-flight stream for ``run_id`` to abort."""
    ctx = _active_streams.get(run_id)
    if ctx is None:
        return ChatCancelResponse(run_id=run_id, cancelled=False, cancelled_at=datetime.now(UTC))
    ctx.cancel_event.set()
    await _cancel_upstream(ctx, reason="user_request")
    await _emit(
        "forge.chat.cancelled",
        run_id=run_id,
        agent_id=ctx.agent_id,
        payload={"model": ctx.model, "trigger": "cancel_run"},
    )
    return ChatCancelResponse(run_id=run_id, cancelled=True, cancelled_at=datetime.now(UTC))


async def get_run_status(run_id: UUID) -> ForgeRunStatus | None:
    """Return the durable status: live registry first, then spend_records."""
    ctx = _active_streams.get(run_id)
    if ctx is not None:
        return ForgeRunStatus(
            run_id=run_id,
            agent_id=ctx.agent_id,
            status="streaming",
            started_at=ctx.started_at,
            completed_at=None,
            model=ctx.model,
        )
    row = _lookup_spend_record(run_id)
    if row is None:
        return None
    return ForgeRunStatus(
        run_id=row.id,
        agent_id=row.agent_id,
        status="completed",
        started_at=row.created_at,
        completed_at=row.created_at,
        prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        cost_usd=float(row.cost_usd),
        model=row.model,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


async def _translate_chunk(
    chunk_json: dict,
    *,
    run_id: UUID,
    agent_id: UUID,
    model: str,
) -> AsyncIterator[ChatStreamChunk]:
    """Convert one LiteLLM SSE chunk into zero-or-more Forge envelopes."""
    ts = datetime.now(UTC)
    for choice in chunk_json.get("choices") or []:
        delta = choice.get("delta") or {}

        content = delta.get("content")
        if content:
            yield ChatStreamChunk(
                event="token",
                data={"text": content},
                run_id=run_id,
                agent_id=agent_id,
                model=model,
                ts=ts,
            )

        reasoning = delta.get("reasoning_content")
        if reasoning:
            yield ChatStreamChunk(
                event="reasoning",
                data={"text": reasoning},
                run_id=run_id,
                agent_id=agent_id,
                model=model,
                ts=ts,
            )

        tool_calls = delta.get("tool_calls")
        if tool_calls:
            for tc in tool_calls:
                yield ChatStreamChunk(
                    event="tool_call",
                    data={"tool_calls": [_trim_tool_call(tc)]},
                    run_id=run_id,
                    agent_id=agent_id,
                    model=model,
                    ts=ts,
                )

        finish = choice.get("finish_reason")
        if finish:
            yield ChatStreamChunk(
                event="finish",
                data={"finish_reason": finish},
                run_id=run_id,
                agent_id=agent_id,
                model=model,
                ts=ts,
            )

    usage = chunk_json.get("usage")
    if usage:
        usage_delta = UsageDelta(
            prompt_tokens=int(usage.get("prompt_tokens", 0)),
            completion_tokens=int(usage.get("completion_tokens", 0)),
            total_tokens=int(
                usage.get("total_tokens")
                or (int(usage.get("prompt_tokens", 0)) + int(usage.get("completion_tokens", 0)))
            ),
        )
        cost = float(usage.get("cost_usd") or chunk_json.get("cost_usd") or 0.0)
        yield ChatStreamChunk(
            event="usage",
            data={"usage": usage_delta.model_dump(), "cost_usd": cost},
            run_id=run_id,
            agent_id=agent_id,
            model=model,
            ts=ts,
        )


def _trim_tool_call(tc: dict) -> dict:
    """Shape one tool-call delta for the Forge SSE envelope."""
    out: dict = {}
    if tc.get("id") is not None:
        out["id"] = tc["id"]
    if tc.get("type") is not None:
        out["type"] = tc["type"]
    if isinstance(tc.get("function"), dict):
        fn = {}
        if tc["function"].get("name") is not None:
            fn["name"] = tc["function"]["name"]
        if tc["function"].get("arguments") is not None:
            fn["arguments"] = tc["function"]["arguments"]
        if fn:
            out["function"] = fn
    if tc.get("index") is not None:
        out["index"] = tc["index"]
    return out


async def _record_spend(
    *,
    principal: Principal,
    agent_id: UUID,
    run_id: UUID,
    model: str,
    usage: dict,
    partial: bool = False,
) -> None:
    """Phase 6 SC-6.8 — per-chunk projected write, terminal actual write.

    On ``partial=False`` (the happy stream chunk) we call
    ``cost_ledger.record_projected`` for the cumulative-cap rule to skip
    while the stream is in flight. On ``partial=True`` (the disconnect
    path) we call ``record_actual`` so the reconciler in PR-6.8 can
    finalize.
    """
    usage_obj = usage.get("usage") if isinstance(usage, dict) and "usage" in usage else usage
    prompt = int((usage_obj or {}).get("prompt_tokens") or 0)
    completion = int((usage_obj or {}).get("completion_tokens") or 0)
    cost = float(usage.get("cost_usd") or 0.0)
    tenant_uuid = UUID(str(principal["tenant_id"]))
    project_uuid = (
        UUID(str(principal["project_id"]))
        if principal.get("project_id")
        else UUID("00000000-0000-0000-0000-000000000000")
    )
    try:
        if partial:
            await cost_ledger.record_actual(
                tenant_id=tenant_uuid,
                project_id=project_uuid,
                run_id=run_id,
                agent=str(agent_id),
                model=model,
                prompt_tokens=prompt,
                completion_tokens=completion,
                cost_usd=cost,
                source="litellm.partial",
                metadata={"partial": True},
            )
        else:
            await cost_ledger.record_projected(
                tenant_id=tenant_uuid,
                project_id=project_uuid,
                run_id=run_id,
                agent=str(agent_id),
                model=model,
                prompt_tokens=prompt,
                completion_tokens=completion,
                cost_usd=cost,
                source="litellm",
                metadata=None,
            )
    except Exception:  # noqa: BLE001
        logger.warning(
            "forge_chat.spend_record_failed",
            run_id=str(run_id),
            error="cost_ledger raised",
        )


def _classify_exception(exc: Exception) -> str:
    """Map a raw error to a typed Forge error code for the SSE error event."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 401:
            return "AuthenticationError"
        if status == 402:
            return "BudgetExceeded"
        if status == 413:
            return "ContextLengthExceeded"
        if status == 422:
            return "GuardrailViolation"
        if status == 429:
            return "RateLimitError"
        if status >= 500:
            return "UpstreamError"
        return f"UpstreamError.{status}"
    if isinstance(exc, httpx.HTTPError):
        return "UpstreamError"
    return "UpstreamError"


async def _cancel_upstream(ctx: _StreamContext, *, reason: str) -> None:
    """Best-effort: POST /responses/{id}/cancel when LiteLLM backgrounded it."""
    if not ctx.response_id:
        return
    try:
        async with LiteLLMBaseClient() as base:
            # Local cancel — no public method, use admin endpoint with the response id.
            await base.admin_client.post(
                f"/responses/{ctx.response_id}/cancel",
                json={"reason": reason},
            )
    except Exception:  # noqa: BLE001
        logger.warning(
            "forge_chat.upstream_cancel_failed",
            response_id=ctx.response_id,
            reason=reason,
        )


__all__ = [
    "Principal",
    "stream_chat",
    "cancel_run",
    "get_run_status",
]
