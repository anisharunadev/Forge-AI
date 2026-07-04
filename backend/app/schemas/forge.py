"""Schemas for Phase 1 / step-75 Forge-wide endpoints.

The Phase 1 schema is ``ForgeHealth`` (spec line 88, F15 extends it
with a ``forge`` sub-object per spec line 610). Per-feature schemas
(models, spend, keys, chat) live in their own files.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LiteLLMHealthDetail(BaseModel):
    """The ``litellm`` field of ``/api/forge/health``."""

    version: str | None = Field(
        default=None,
        description="LiteLLM Proxy version reported by /health/readiness",
    )
    reachable: bool = Field(
        description="Whether /health/readiness returned 200 within the cache window",
    )
    db: str | None = Field(
        default=None,
        description="`ok` | `Not connected` | `unknown`",
    )
    cache: str | None = Field(
        default=None,
        description="LiteLLM cache backend status",
    )
    callbacks: list[str] | None = Field(
        default=None,
        description="Registered callback names",
    )


class ForgeHealth(BaseModel):
    """Response for ``GET /api/forge/health`` (spec lines 88 + 610).

    ``forge`` was added in step-78 F15 with the per-process uptime,
    version, and error-rate fields the enterprise buyer dashboard
    expects. The Phase 1 ``status`` / ``litellm`` fields are unchanged
    so the original spec contract is preserved.
    """

    status: str = Field(description="`ok` | `degraded` | `down`")
    litellm: LiteLLMHealthDetail
    forge: dict | None = Field(
        default=None,
        description="F15 sub-object: uptime, version, error rates, latency percentiles.",
    )


__all__ = ["ForgeHealth", "LiteLLMHealthDetail"]
