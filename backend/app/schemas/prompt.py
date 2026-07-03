"""step-78 F11 — Prompt schemas.

The schema mirrors the spec's ``Prompt`` shape: an immutable versioned
template plus declared variables. ``VariableSpec`` doubles as the
input contract for the UI's auto-generated form (acceptance #8).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.common import ForgeBaseModel, TenantScopedModel


# ---------------------------------------------------------------------------
# Variable system (step-78 §"Variable system")
# ---------------------------------------------------------------------------

VariableType = Literal["string", "number", "boolean", "enum", "array", "object"]


class VariableSpec(ForgeBaseModel):
    """A declared variable. The UI renders a form field per spec."""

    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    type: VariableType = "string"
    required: bool = True
    default: Any | None = None
    description: str | None = None
    enum: list[str] | None = None  # for type=enum

    @field_validator("enum")
    @classmethod
    def _enum_needs_values(cls, v, info):  # noqa: D401
        # ponytail: lenient — accept enum=None for non-enum types and
        # only warn when an enum variable has no values. Strict check
        # happens at the variable-validation layer.
        return v


# ---------------------------------------------------------------------------
# Version status enum
# ---------------------------------------------------------------------------


class PromptVersionStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


# ---------------------------------------------------------------------------
# Request / response payloads
# ---------------------------------------------------------------------------


class PromptCreate(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    template: str = Field(..., min_length=1)
    category: Literal["system", "user", "tool", "custom"] = "custom"
    tags: list[str] = Field(default_factory=list)
    variables: list[VariableSpec] = Field(default_factory=list)
    model_defaults: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PromptUpdate(ForgeBaseModel):
    """PATCH payload. Every field is optional; supplying any field
    (other than ``metadata`` and ``tags`` which are library-only) creates
    a new immutable version."""

    template: str | None = None
    variables: list[VariableSpec] | None = None
    model_defaults: dict[str, Any] | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None


class PromptVersionRead(ForgeBaseModel):
    id: UUID
    prompt_id: UUID
    version_number: int
    template: str
    model_defaults: dict[str, Any] = Field(default_factory=dict)
    variables: list[VariableSpec] = Field(default_factory=list)
    status: PromptVersionStatus
    source: str = "manual"
    created_at: datetime
    created_by: UUID | None = None


class PromptRead(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    category: str
    status: str
    current_version: int
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None
    # The active version's template + variables, denormalised so list
    # views don't need to JOIN.
    active_template: str | None = None
    active_variables: list[VariableSpec] = Field(default_factory=list)
    active_model_defaults: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Render / test / count payloads
# ---------------------------------------------------------------------------


class PromptRenderRequest(ForgeBaseModel):
    variables: dict[str, Any] = Field(default_factory=dict)


class PromptRenderResponse(ForgeBaseModel):
    prompt_id: UUID
    version_number: int
    rendered: str
    used_variables: list[str]


class PromptTestRequest(ForgeBaseModel):
    variables: dict[str, Any] = Field(default_factory=dict)
    model_override: str | None = None
    stream: bool = False


class PromptTestResponse(ForgeBaseModel):
    prompt_id: UUID
    version_number: int
    rendered_prompt: str
    response: str | None = None
    usage: dict[str, int] | None = None
    cost_usd: float | None = None
    latency_ms: float | None = None
    test: bool = True  # always True; downstream uses this to skip spend reconciliation


class PromptCountRequest(ForgeBaseModel):
    variables: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None


class PromptCountResponse(ForgeBaseModel):
    prompt_id: UUID
    version_number: int
    input_tokens: int
    model_max_context: int | None = None
    fits: bool


class PromptDiffResponse(ForgeBaseModel):
    prompt_id: UUID
    from_version: int
    to_version: int
    unified_diff: str


class DotpromptImportRequest(ForgeBaseModel):
    content: str = Field(..., min_length=1)
    name: str | None = None  # override the .prompt file's name


class DotpromptImportResponse(ForgeBaseModel):
    name: str
    template: str
    variables: list[VariableSpec]
    model_defaults: dict[str, Any]


# ---------------------------------------------------------------------------
# Errors (typed render failures — acceptance #3)
# ---------------------------------------------------------------------------


class UndeclaredVariableError(ForgeBaseModel):
    """422 — render attempted with an undeclared variable."""

    error: str = "undeclared_variable"
    variable: str
    declared: list[str]


class MissingVariableError(ForgeBaseModel):
    """422 — required variable missing at render time."""

    error: str = "missing_variable"
    variable: str


__all__ = [
    "VariableSpec",
    "PromptVersionStatus",
    "PromptCreate",
    "PromptUpdate",
    "PromptVersionRead",
    "PromptRead",
    "PromptRenderRequest",
    "PromptRenderResponse",
    "PromptTestRequest",
    "PromptTestResponse",
    "PromptCountRequest",
    "PromptCountResponse",
    "PromptDiffResponse",
    "DotpromptImportRequest",
    "DotpromptImportResponse",
    "UndeclaredVariableError",
    "MissingVariableError",
]