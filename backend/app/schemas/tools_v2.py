"""step-77 Slice 5 — Typed artifacts for the broader Tools registry.

Mirrors :mod:`app.schemas.guardrails` for spec §Feature 10.

Rule 4: typed artifacts only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel
from app.schemas.litellm_common import ToolKind


# ---------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------


class ToolRead(ForgeBaseModel):
    """One tool as the UI / API surface it.

    AC #10: ``name`` is the canonical id; ``display_name`` is the
    human label.
    """

    name: str
    display_name: str | None = None
    kind: ToolKind
    description: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    server_id: str | None = None
    version: str | None = None
    deprecated: bool = False
    requires_approval: bool = False
    cost_estimate_usd: float | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------


class ToolLogRead(ForgeBaseModel):
    """One row of the per-tool invocation log.

    AC #2 — hashes only; no raw payloads.
    """

    ts: datetime
    request_id: str | None = None
    agent_id: str | None = None
    arguments_hash: str = ""
    result_hash: str = ""
    duration_ms: int = 0
    status: str = "ok"
    extra: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------
# Overrides
# ---------------------------------------------------------------------


class ToolOverrides(ForgeBaseModel):
    """Per-tool overrides (spec §"Overrides").

    AC #3 — ``max_calls_per_run: 1`` blocks a second call within the
    same chat loop.
    AC #9 — overrides propagate within 60s (60s TTL on the catalog).
    """

    max_calls_per_run: int | None = Field(default=None, ge=0)
    timeout_ms: int | None = Field(default=None, ge=0)
    requires_approval: bool | None = None
    model_replacement: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class ToolOverrideUpdate(ForgeBaseModel):
    """Body of ``PUT /api/v1/tools/{name}/overrides``."""

    overrides: ToolOverrides


# ---------------------------------------------------------------------
# Search tools
# ---------------------------------------------------------------------


class SearchToolRead(ForgeBaseModel):
    """One search-tool row."""

    id: str
    name: str
    description: str | None = None
    kind: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class SearchToolTestResult(ForgeBaseModel):
    """Body of ``POST /api/v1/search-tools/{id}/test``."""

    tool_id: str
    reachable: bool
    latency_ms: int = 0
    error: str | None = None


__all__ = [
    "SearchToolRead",
    "SearchToolTestResult",
    "ToolLogRead",
    "ToolOverrides",
    "ToolOverrideUpdate",
    "ToolRead",
]