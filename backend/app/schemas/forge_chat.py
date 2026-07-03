"""Schemas for Step 75 F4 — Forge Chat streaming, cancellation, run status.

Stream shape: SSE chunk envelopes carrying tokens / reasoning / tool_calls /
finish / usage / error. Cancellation is a separate request so the run loop
can stop mid-stream. ForgeRunStatus is the durable record persisted on
completion (mirrors what /runs/{id} returns for any agent invocation).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from app.schemas.common import ForgeBaseModel

ChatRole = Literal["system", "user", "assistant", "tool"]
ToolCallType = Literal["function"]
ChatEvent = Literal["token", "reasoning", "tool_call", "finish", "usage", "error"]
RunStatus = Literal["pending", "streaming", "completed", "cancelled", "failed"]


class FunctionCallDelta(ForgeBaseModel):
    name: str | None = None
    arguments: str | None = None


class ToolCallDelta(ForgeBaseModel):
    id: str | None = None
    type: ToolCallType = "function"
    function: FunctionCallDelta


class ChatMessage(ForgeBaseModel):
    role: ChatRole
    content: str | None = None
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[ToolCallDelta] | None = None


class ChatStreamRequest(ForgeBaseModel):
    agent_id: UUID
    model: str
    messages: list[ChatMessage]
    stream: bool = True
    max_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    stop: list[str] | None = None
    user: str | None = None
    metadata: dict[str, Any] | None = None


class UsageDelta(ForgeBaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatStreamChunk(ForgeBaseModel):
    event: ChatEvent
    data: dict[str, Any]
    run_id: UUID
    agent_id: UUID
    model: str
    ts: datetime


class ChatCancelRequest(ForgeBaseModel):
    run_id: UUID
    reason: str | None = None


class ChatCancelResponse(ForgeBaseModel):
    run_id: UUID
    cancelled: bool
    cancelled_at: datetime


class ForgeRunStatus(ForgeBaseModel):
    run_id: UUID
    agent_id: UUID
    status: RunStatus
    started_at: datetime
    completed_at: datetime | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost_usd: float | None = None
    model: str
    error_code: str | None = None
    error_message: str | None = None


__all__ = [
    "ChatCancelRequest",
    "ChatCancelResponse",
    "ChatMessage",
    "ChatStreamChunk",
    "ChatStreamRequest",
    "ForgeRunStatus",
    "FunctionCallDelta",
    "ToolCallDelta",
    "UsageDelta",
]