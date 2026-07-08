"""F-800 — Pydantic schemas for the Forge Co-pilot API.

Request/response types for the 7 endpoints in
``backend/app/api/v1/copilot.py`` (Plan 1). All types inherit
``TenantScopedModel`` (or ``ForgeBaseModel``) per the schema-base
convention; all are Pydantic v2 with ``from_attributes=True`` for
direct ORM → schema mapping.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel

# ---------------------------------------------------------------------------
# Page context
# ---------------------------------------------------------------------------


class CopilotPageContext(ForgeBaseModel):
    """Snapshot of the page the user is currently looking at.

    The Co-pilot uses this to ground its answers — it knows which
    Center the user is on, what artifact they have open, and what
    they have clicked recently. Sent on every ``POST /copilot/conversations``.
    """

    current_page: str = Field(..., description="Pathname, e.g. /project-intelligence")
    current_center: str | None = Field(
        default=None,
        description="Center id, e.g. project_intelligence",
    )
    current_artifact_id: UUID | None = Field(default=None)
    recent_actions: list[str] = Field(
        default_factory=list,
        description="Last N user actions on this page (for grounding)",
    )


# ---------------------------------------------------------------------------
# Request shapes
# ---------------------------------------------------------------------------


class CopilotChatRequest(ForgeBaseModel):
    """Body of ``POST /copilot/conversations``."""

    conversation_id: UUID | None = Field(
        default=None,
        description="Existing conversation id, or null to start a new one",
    )
    project_id: UUID | None = Field(default=None)
    message: str = Field(..., min_length=1, max_length=8000)
    context: CopilotPageContext
    # Phase 3 — model picker reaches the backend. The frontend
    # persists the user's choice (auto / sonnet / opus / gpt4o) and
    # forwards it here. ``auto`` and ``None`` both fall back to the
    # tenant default from forge-core; explicit labels are routed by
    # the LiteLLM registry.
    model: str | None = Field(
        default=None,
        max_length=64,
        description="UI model label (auto / sonnet / opus / gpt4o). Null = tenant default.",
    )


class CopilotFeedbackRequest(ForgeBaseModel):
    """Body of ``POST /copilot/messages/{id}/feedback``."""

    rating: Literal["up", "down"]
    comment: str | None = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# Response shapes
# ---------------------------------------------------------------------------


class CopilotCitation(ForgeBaseModel):
    """A source citation in a Co-pilot response."""

    type: Literal["service", "adr", "standard", "template", "doc", "kg_node", "command"]
    id: str
    label: str
    snippet: str = Field(..., max_length=200)
    url: str


class CopilotToolCall(ForgeBaseModel):
    """A tool invocation visible in the response."""

    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    result_status: Literal["success", "error"] = "success"
    duration_ms: int = 0
    error: str | None = None


class CopilotSuggestedAction(ForgeBaseModel):
    """A clickable next-step suggested to the user."""

    label: str
    action_type: Literal["navigate", "run_command", "draft", "open_modal"]
    payload: dict[str, Any] = Field(default_factory=dict)


class CopilotMessageRead(ForgeBaseModel):
    """One message in a conversation (read shape)."""

    id: UUID
    conversation_id: UUID
    role: Literal["user", "assistant", "system", "tool"]
    content: str
    citations: list[CopilotCitation] = Field(default_factory=list)
    tool_calls: list[CopilotToolCall] = Field(default_factory=list)
    suggested_actions: list[CopilotSuggestedAction] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] | None = None
    feedback_rating: Literal["up", "down"] | None = None
    model: str | None = None
    cost_usd: Decimal = Decimal("0")
    tokens_in: int = 0
    tokens_out: int = 0
    latency_ms: int = 0
    created_at: datetime


class CopilotConversationSummary(TenantScopedModel):
    """Compact conversation row (list view)."""

    id: UUID
    user_id: UUID
    title: str | None
    message_count: int
    total_cost_usd: Decimal
    archived_at: datetime | None


class CopilotConversationRead(TenantScopedModel):
    """Full conversation with messages."""

    id: UUID
    user_id: UUID
    title: str | None
    message_count: int
    total_cost_usd: Decimal
    total_tokens_in: int
    total_tokens_out: int
    messages: list[CopilotMessageRead] = Field(default_factory=list)
    archived_at: datetime | None


class CopilotChatResponse(ForgeBaseModel):
    """Response to a chat turn.

    Mirrors spec §7.2. Carries citations, tool-call transcript,
    suggested next actions, confidence, and cost telemetry.
    """

    conversation_id: UUID
    message_id: UUID
    content: str
    citations: list[CopilotCitation] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "medium"
    tool_calls: list[CopilotToolCall] = Field(default_factory=list)
    suggested_actions: list[CopilotSuggestedAction] = Field(default_factory=list)
    cost_usd: Decimal = Decimal("0")
    tokens_in: int = 0
    tokens_out: int = 0
    model: str
    latency_ms: int = 0


class CopilotCostRead(ForgeBaseModel):
    """Response to ``GET /copilot/conversations/{id}/cost``."""

    conversation_id: UUID
    total_cost_usd: Decimal
    total_tokens_in: int
    total_tokens_out: int
    budget_remaining_usd: Decimal | None = None
    budget_ceiling_usd: Decimal | None = None
    budget_status: Literal["active", "exhausted", "closed"] | None = None


class CopilotToolRead(ForgeBaseModel):
    """Metadata for a tool, returned by ``GET /copilot/tools`` (Steward)."""

    name: str
    description: str
    permission: str
    rate_limit_per_min: int


__all__ = [
    "CopilotPageContext",
    "CopilotChatRequest",
    "CopilotFeedbackRequest",
    "CopilotCitation",
    "CopilotToolCall",
    "CopilotSuggestedAction",
    "CopilotMessageRead",
    "CopilotConversationSummary",
    "CopilotConversationRead",
    "CopilotChatResponse",
    "CopilotCostRead",
    "CopilotToolRead",
]
