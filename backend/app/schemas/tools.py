"""step-78 Phase 2 — Typed artifacts for the Tools (broader registry) surface.

Spec §Feature 10. The ``Tool`` taxonomy is sourced from
:mod:`app.schemas.litellm_common` (``ToolKind`` literal). This file
adds the read/write shapes + the ``ToolOverride`` + audit payloads.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel
from app.schemas.litellm_common import ToolKind

ToolOverrideDecision = Literal["allowed", "denied", "approval_required", "overridden"]


class ToolRead(ForgeBaseModel):
    """Spec §"Detail" response. AC #10 — both ``name`` and ``display_name``."""

    name: str
    display_name: str = ""
    kind: ToolKind = "function"
    description: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)
    server_id: UUID | str | None = None
    version: str = "1.0.0"
    deprecated: bool = False
    requires_approval: bool = False
    cost_estimate_usd: float | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class ToolListQuery(ForgeBaseModel):
    """Query params for ``GET /api/v1/tools``."""

    kind: ToolKind | None = None
    server_id: str | None = None
    include_archived: bool = False
    q: str | None = None


class ToolOverride(ForgeBaseModel):
    """Per-tool override payload. AC #3 + #4."""

    max_calls_per_run: int | None = Field(default=None, ge=1)
    timeout_ms: int | None = Field(default=None, ge=1)
    requires_approval: bool | None = None
    model_replacement: str | None = None


class ToolOverridesPut(ForgeBaseModel):
    """Body of ``PUT /api/v1/tools/{name}/overrides``."""

    overrides: ToolOverride


class ToolLogRow(ForgeBaseModel):
    """One row of the tool invocation log. AC #2 — hashes only."""

    ts: datetime
    request_id: str | None = None
    agent_id: str | None = None
    arguments_hash: str | None = None
    result_hash: str | None = None
    duration_ms: int = 0
    status: str = "ok"
    extra: dict[str, Any] = Field(default_factory=dict)


class ToolLogPage(ForgeBaseModel):
    items: list[ToolLogRow] = Field(default_factory=list)
    total: int = 0


class ToolInvocationAudit(ForgeBaseModel):
    """Spec §"Audit" — ``forge.tools.invoked`` payload."""

    tool_name: str
    kind: ToolKind = "function"
    request_id: str | None = None
    agent_id: str | None = None
    duration_ms: int = 0
    status: str = "ok"
    decision: ToolOverrideDecision = "allowed"


class SearchToolRead(ForgeBaseModel):
    """One entry in the search-tool picker."""

    id: str
    name: str
    description: str = ""
    kind: ToolKind = "function"
    extra: dict[str, Any] = Field(default_factory=dict)


class SearchToolTest(ForgeBaseModel):
    """AC #7 — unreachable returns ``reachable: false``."""

    tool_id: str
    reachable: bool
    latency_ms: int = 0
    error: str | None = None


__all__ = [
    "SearchToolRead",
    "SearchToolTest",
    "ToolListQuery",
    "ToolLogPage",
    "ToolLogRow",
    "ToolOverride",
    "ToolOverrideDecision",
    "ToolOverridesPut",
    "ToolRead",
    "ToolInvocationAudit",
]
