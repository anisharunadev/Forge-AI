"""step-78 Phase 2 — Typed artifacts for the Skills surface.

Spec §Feature 9 ``Skill`` object — mirrored as Pydantic models for
the HTTP boundary. ``SkillConfig`` covers the ``config`` block
(default_model / temperature / max_tokens / response_format /
reasoning_effort).
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel
from app.schemas.litellm_common import ToolRef


SkillStatus = Literal["draft", "active", "archived"]
SkillCategory = Literal["code", "review", "test", "docs", "ops", "custom"]
ResponseFormat = Literal["json", "text"]
ReasoningEffort = Literal["low", "medium", "high"]


class SkillConfig(ForgeBaseModel):
    default_model: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1)
    response_format: ResponseFormat | None = None
    reasoning_effort: ReasoningEffort | None = None


class SkillMetadata(ForgeBaseModel):
    forge_tenant_id: UUID | str | None = None
    created_by: str | None = None
    category: SkillCategory = "custom"
    tags: list[str] = Field(default_factory=list)


class SkillRead(ForgeBaseModel):
    """Read shape returned by ``GET /api/v1/skills/{id}``."""

    id: str
    name: str
    description: str = ""
    version: str = "1.0.0"
    status: SkillStatus = "draft"
    prompt_template: str = ""
    tools: list[ToolRef] = Field(default_factory=list)
    config: SkillConfig = Field(default_factory=SkillConfig)
    metadata: SkillMetadata = Field(default_factory=SkillMetadata)
    active: bool = True
    extra: dict[str, Any] = Field(default_factory=dict)


class SkillCreate(ForgeBaseModel):
    """Body of ``POST /api/v1/skills``."""

    id: str | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    version: str = "1.0.0"
    status: SkillStatus = "draft"
    prompt_template: str = ""
    tools: list[ToolRef] = Field(default_factory=list)
    config: SkillConfig = Field(default_factory=SkillConfig)
    metadata: SkillMetadata = Field(default_factory=SkillMetadata)


class SkillUpdate(ForgeBaseModel):
    """Body of ``PATCH /api/v1/skills/{id}``. AC: creates a new version."""

    name: str | None = None
    description: str | None = None
    prompt_template: str | None = None
    tools: list[ToolRef] | None = None
    config: SkillConfig | None = None
    metadata: SkillMetadata | None = None
    bump_version: bool = True


class SkillRenderRequest(ForgeBaseModel):
    """Body of ``POST /api/v1/skills/preview``.

    Used by the UI to render a skill's template with sample variables
    before saving (no chat call). AC #2.
    """

    skill: SkillCreate | None = None
    prompt_template: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)


class SkillRenderResult(ForgeBaseModel):
    rendered: str
    variables_used: list[str] = Field(default_factory=list)


class SkillHubEntry(ForgeBaseModel):
    """One entry in the public marketplace."""

    id: str
    name: str
    description: str = ""
    category: SkillCategory = "custom"
    tags: list[str] = Field(default_factory=list)
    source: str = "public"
    extra: dict[str, Any] = Field(default_factory=dict)


class SkillHubImport(ForgeBaseModel):
    """Body of ``POST /api/v1/skills/hub/import``. AC #6."""

    hub_id: str
    tenant_id: UUID | str | None = None
    name: str | None = None
    description: str | None = None


class SkillRenderError(ForgeBaseModel):
    """Typed error envelope for broken Jinja templates (AC #10)."""

    code: str = "skill_render_error"
    skill_id: str | None = None
    template_error: str


class SkillListPage(TenantScopedModel):
    items: list[SkillRead] = Field(default_factory=list)
    total: int = 0


__all__ = [
    "SkillCategory",
    "SkillConfig",
    "SkillCreate",
    "SkillHubEntry",
    "SkillHubImport",
    "SkillListPage",
    "SkillMetadata",
    "SkillRead",
    "SkillRenderError",
    "SkillRenderRequest",
    "SkillRenderResult",
    "SkillStatus",
    "SkillUpdate",
]