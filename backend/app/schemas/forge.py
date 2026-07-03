"""Schemas for Phase 1 / step-75 Forge-wide endpoints.

The only Phase 1 schema here is `ForgeHealth` (P1 deliverable for the
`GET /api/forge/health` endpoint, spec line 88). Per-service schemas
(models, spend, keys, chat) live in their own files.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LiteLLMHealthDetail(BaseModel):
    """The `litellm` field of `/api/forge/health`."""

    version: str | None = Field(default=None, description="LiteLLM Proxy version reported by /health/readiness")
    reachable: bool = Field(description="Whether /health/readiness returned 200 within the cache window")
    db: str | None = Field(default=None, description='`ok` | `Not connected` | `unknown`')
    cache: str | None = Field(default=None, description="LiteLLM cache backend status")
    callbacks: list[str] | None = Field(default=None, description="Registered callback names")


class ForgeHealth(BaseModel):
    """Response for `GET /api/forge/health` (spec line 88)."""

    status: str = Field(description='`ok` | `degraded` | `down`')
    litellm: LiteLLMHealthDetail


__all__ = ["ForgeHealth", "LiteLLMHealthDetail"]
