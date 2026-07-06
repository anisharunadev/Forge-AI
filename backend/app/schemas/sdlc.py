"""Pydantic schemas for the SDLC Run Manager API (F-301..F-310 partial).

These are wire-format DTOs used by the ``/api/v1/runs`` endpoints and
the WebSocket bridge. The internal :class:`SDLCState` is the canonical
state; these schemas wrap it for the API contract.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.agents.sdlc_state import SDLCPhase
from app.schemas.common import ForgeBaseModel, Page

# ---------------------------------------------------------------------------
# Run create / read
# ---------------------------------------------------------------------------


class SDLCRunCreateRequest(ForgeBaseModel):
    """POST /api/v1/runs request body."""

    project_id: UUID
    initial_context: dict[str, Any] = Field(default_factory=dict)
    workspace_path: str | None = None
    repo_path: str | None = None


class PhaseTransitionResponse(ForgeBaseModel):
    """One entry in ``state.phase_history``."""

    from_phase: SDLCPhase | None
    to_phase: SDLCPhase
    at: datetime
    actor_id: UUID | None = None
    reason: str = ""


class ArtifactSummary(ForgeBaseModel):
    """Compact artifact reference for API responses."""

    artifact_id: UUID
    type: str
    version: int
    phase: SDLCPhase
    content_hash: str
    summary: str = ""


class ApprovalSnapshot(ForgeBaseModel):
    """Serialized :class:`backend.app.agents.sdlc_state.ApprovalRequest`."""

    approval_id: UUID
    type: str
    required_role: str
    requested_at: datetime
    expires_at: datetime
    target_artifact_id: UUID | None = None
    reason: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class CostSummaryResponse(ForgeBaseModel):
    """GET /api/v1/runs/{id}/cost body."""

    run_id: UUID
    total_usd: Decimal = Decimal("0")
    by_phase: dict[str, Decimal] = Field(default_factory=dict)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    call_count: int = 0


class SDLCRunStateResponse(ForgeBaseModel):
    """GET /api/v1/runs/{id} body."""

    run_id: UUID
    tenant_id: UUID
    project_id: UUID
    actor_id: UUID
    current_phase: SDLCPhase
    phase_history: list[PhaseTransitionResponse] = Field(default_factory=list)
    artifacts: dict[str, ArtifactSummary] = Field(default_factory=dict)
    pending_approval: ApprovalSnapshot | None = None
    cost_so_far: Decimal = Decimal("0")
    errors: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)


class SDLCRunListResponse(Page["SDLCRunStateResponse"]):
    """GET /api/v1/runs body."""

    items: list[SDLCRunStateResponse] = Field(default_factory=list)  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Approval response
# ---------------------------------------------------------------------------


class ApprovalResponseRequest(ForgeBaseModel):
    """POST /api/v1/runs/{id}/resume request body."""

    approval_id: UUID
    granted: bool
    reason: str = ""


class ApprovalResponseResponse(ForgeBaseModel):
    """POST /api/v1/runs/{id}/resume response."""

    run_id: UUID
    approval_id: UUID
    granted: bool
    decided_by: UUID
    decided_at: datetime
    reason: str = ""
    resumed: bool = True


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------


class SDLCancelRequest(ForgeBaseModel):
    """POST /api/v1/runs/{id}/cancel request body."""

    reason: str = ""


# ---------------------------------------------------------------------------
# Streaming / WS
# ---------------------------------------------------------------------------

WSMessageType = Literal[
    "state",  # server -> client: full state snapshot
    "approval",  # server -> client: approval request snapshot
    "artifact",  # server -> client: artifact produced
    "phase",  # server -> client: phase transition
    "approval_response",  # client -> server: response
    "error",  # server -> client: error envelope
    "ping",  # bidirectional heartbeat
]


class WSEnvelope(ForgeBaseModel):
    """WebSocket envelope shared by both directions."""

    type: WSMessageType
    payload: dict[str, Any] = Field(default_factory=dict)
    sent_at: datetime


__all__ = [
    "SDLCRunCreateRequest",
    "PhaseTransitionResponse",
    "ArtifactSummary",
    "ApprovalSnapshot",
    "CostSummaryResponse",
    "SDLCRunStateResponse",
    "SDLCRunListResponse",
    "ApprovalResponseRequest",
    "ApprovalResponseResponse",
    "SDLCancelRequest",
    "WSEnvelope",
    "WSMessageType",
]
