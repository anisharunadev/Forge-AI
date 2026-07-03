"""Pydantic schemas for step-75 P2 — Models Registry service."""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


class ModelSupports(BaseModel):
    """Capability flags derived from LiteLLM `/model/info`."""

    tools: bool = False
    vision: bool = False
    audio: bool = False
    streaming: bool = False
    json_mode: bool = False


class ModelCost(BaseModel):
    """Normalized cost per 1k tokens (USD)."""

    input_per_1k: float
    output_per_1k: float
    currency: str = "USD"


class ModelDescriptor(BaseModel):
    """One model exposed to the UI after caller-allow intersection."""

    id: str = Field(description="LiteLLM model id, e.g. 'gpt-4o' or 'bedrock/claude-3-5-sonnet'")
    provider: str = Field(description="Provider segment from 'id' split on '/', e.g. 'bedrock'")
    tier: str | None = Field(default=None, description="Coarse tier label, e.g. 'pro' | 'flagship' | 'small'")
    context_window: int | None = Field(default=None, description="Max context tokens reported by LiteLLM")
    supports: ModelSupports = Field(default_factory=ModelSupports)
    cost: ModelCost | None = Field(default=None, description="Normalized cost per 1k tokens")
    allowed_for_caller: bool = Field(description="True if the caller's virtual key permits this model")
    owned_by: str | None = Field(default=None, description="Optional upstream owner string")
    # Flat cost aliases — kept for back-compat with service code that reads these directly.
    input_cost_per_token: float | None = Field(default=None, description="USD per input token (from cost map)")
    output_cost_per_token: float | None = Field(default=None, description="USD per output token (from cost map)")


class ModelGroup(BaseModel):
    """Models grouped by provider segment."""

    provider: str
    models: list[ModelDescriptor]


class ModelsListResponse(BaseModel):
    """Flat + grouped model registry, per spec line 110."""

    models: list[ModelDescriptor]
    groups: list[ModelGroup]
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ModelsGroupedResponse(BaseModel):
    """Grouped-only payload (cheaper endpoint)."""

    groups: list[ModelGroup]
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RefreshResponse(BaseModel):
    """Result of a manual cache refresh."""

    refreshed: list[str] = Field(default_factory=list, description="Cache names cleared")
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


__all__ = [
    "ModelSupports",
    "ModelCost",
    "ModelDescriptor",
    "ModelGroup",
    "ModelsListResponse",
    "ModelsGroupedResponse",
    "RefreshResponse",
]
