"""F-800 — System features endpoint.

Returns the 5 F-800 feature flags so the frontend can gate UI on them.

Scoping
-------
The endpoint is intentionally **public** (no auth required) for V1.
Flags are global defaults from ``Settings``; per-tenant overrides land
when the existing ``tenants`` config JSONB gains a co-pilot block.

Hiding the surface
------------------
When ``settings.copilot_enabled`` is False we still return the flag
set but with ``COPILOT_ENABLED=False`` so the frontend can hide the
hotkey + nav. Returning the full shape (rather than 404-ing) keeps the
endpoint contract stable for callers that want to read the other
flags without enabling the feature.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.config import get_settings

router = APIRouter(prefix="/system", tags=["system"])


class SystemFeatures(BaseModel):
    """Co-pilot feature flags exposed to the frontend.

    Field names match the frontend ``Features`` interface in
    ``apps/forge/lib/feature-flags.ts`` exactly — any rename here
    must mirror there.
    """

    COPILOT_ENABLED: bool = Field(..., description="Master toggle for the Co-pilot surface")
    COPILOT_STREAMING: bool = Field(default=False, description="V1.1; always False in V1")
    COPILOT_DEFAULT_BUDGET_USD: float = Field(..., description="Per-conversation budget ceiling")
    COPILOT_TOOL_CALL_MAX: int = Field(..., description="Max tool-call turns per agent loop")
    COPILOT_RATE_LIMIT_PER_MIN: int = Field(..., description="Per-user message cap")


@router.get("/features", response_model=SystemFeatures)
async def get_features() -> SystemFeatures:
    """Return the current feature flag set.

    V1: every tenant sees the same global defaults from ``Settings``.
    When per-tenant override storage lands (existing ``tenants.config``
    JSONB is the natural home), this endpoint will resolve the caller's
    tenant_id from the bearer token and prefer the tenant row.

    Resolves settings via ``get_settings()`` (lru_cache) instead of
    the module-level singleton so tests can ``cache_clear()`` between
    assertions. In production the cache stays warm for the process
    lifetime so the lookup is a single dict read.
    """
    s = get_settings()
    return SystemFeatures(
        COPILOT_ENABLED=s.copilot_enabled,
        COPILOT_STREAMING=False,  # V1.1 deferred
        COPILOT_DEFAULT_BUDGET_USD=s.copilot_default_budget_usd,
        COPILOT_TOOL_CALL_MAX=s.copilot_tool_call_max,
        COPILOT_RATE_LIMIT_PER_MIN=s.copilot_rate_limit_per_min,
    )


__all__ = ["router", "SystemFeatures"]
