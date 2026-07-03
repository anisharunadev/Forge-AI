"""step-78 Phase 2 — Typed artifacts for the Policies surface.

The pre-Phase-2 ``PolicyBase`` (F-003) stays for backward
compatibility; Phase 2 layers ``PolicyRead``, ``PolicyCreate``,
``PolicyUpdate``, ``ResolveRequest``, ``ResolveResult``, etc. on top.

Rule 4: typed artifacts only. Free-form ``dict`` is permitted only
inside proxy passthroughs (``extra`` fields).
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.db.models.policy import PolicySeverity  # noqa: F401 — preserved for F-003
from app.schemas.common import ForgeBaseModel, TenantScopedModel
from app.schemas.litellm_common import PolicyScope


# ---------------------------------------------------------------------
# Legacy F-003 shapes — preserved for backward compatibility.
# ---------------------------------------------------------------------


class PolicyBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    expression: dict[str, Any]
    severity: PolicySeverity = PolicySeverity.WARN
    enabled: bool = True


class PolicyCreate(PolicyBase):
    pass


class PolicyRead(PolicyBase, TenantScopedModel):
    id: UUID


# ---------------------------------------------------------------------
# Phase 2 — typed artifacts for the resolve / compare / lifecycle surface.
# ---------------------------------------------------------------------


# A decision rule a single policy contributes.
PolicyDecision = Literal["block", "warn", "modify", "redact"]


class PolicyGuardrailRef(ForgeBaseModel):
    """One entry in ``Policy.guardrails[]``."""

    name: str = Field(min_length=1, max_length=128)
    kind: Literal["pre_call_input", "pre_call_llm", "post_call_output", "during_call"] = "pre_call_input"
    order: int = 0


class PolicyToolPolicy(ForgeBaseModel):
    """Spec §Feature 7 ``tool_policy`` block."""

    allowed_tools: list[str] = Field(default_factory=list)
    denied_tools: list[str] = Field(default_factory=list)
    requires_approval: list[str] = Field(default_factory=list)
    rate_limits: dict[str, dict[str, int]] = Field(default_factory=dict)


class PolicyDecisionLogic(ForgeBaseModel):
    """Spec §Feature 7 ``decision_logic`` block."""

    on_violation: PolicyDecision = "block"
    on_multiple_violations: Literal["any", "all", "majority"] = "any"
    budget_override: dict[str, Any] | None = None


class PolicyScopeBlock(ForgeBaseModel):
    """Spec §Feature 7 ``scope`` block.

    All fields optional; composition rules (priority + scope) live
    in :mod:`app.services.policies_service`.
    """

    tenant_id: UUID | str | None = None
    team_id: UUID | str | None = None
    agent_id: UUID | str | None = None
    request_tags: list[str] = Field(default_factory=list)


class PolicyReadV2(ForgeBaseModel):
    """Phase 2 read shape. Distinct from F-003 ``PolicyRead``."""

    id: str
    name: str
    description: str = ""
    scope: PolicyScopeBlock = Field(default_factory=PolicyScopeBlock)
    guardrails: list[PolicyGuardrailRef] = Field(default_factory=list)
    tool_policy: PolicyToolPolicy = Field(default_factory=PolicyToolPolicy)
    decision_logic: PolicyDecisionLogic = Field(default_factory=PolicyDecisionLogic)
    priority: int = 0
    status: Literal["draft", "review", "active", "archived"] = "active"
    active: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class PolicyCreateV2(ForgeBaseModel):
    """Phase 2 create body."""

    id: str | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    scope: PolicyScopeBlock = Field(default_factory=PolicyScopeBlock)
    guardrails: list[PolicyGuardrailRef] = Field(default_factory=list)
    tool_policy: PolicyToolPolicy = Field(default_factory=PolicyToolPolicy)
    decision_logic: PolicyDecisionLogic = Field(default_factory=PolicyDecisionLogic)
    priority: int = 0
    status: Literal["draft", "review", "active", "archived"] = "draft"


class PolicyUpdateV2(ForgeBaseModel):
    """Phase 2 update body (all fields optional)."""

    name: str | None = None
    description: str | None = None
    scope: PolicyScopeBlock | None = None
    guardrails: list[PolicyGuardrailRef] | None = None
    tool_policy: PolicyToolPolicy | None = None
    decision_logic: PolicyDecisionLogic | None = None
    priority: int | None = None
    status: Literal["draft", "review", "active", "archived"] | None = None


class ResolveRequest(ForgeBaseModel):
    """Body of ``POST /api/v1/policies/resolve``."""

    tenant_id: UUID | str
    project_id: UUID | str | None = None
    team_id: UUID | str | None = None
    agent_id: UUID | str | None = None
    request_tags: list[str] = Field(default_factory=list)
    user_id: UUID | str | None = None


class ResolveResult(ForgeBaseModel):
    """The effective envelope returned by resolve.

    Spec §Feature 7 "Resolution algorithm" steps 3-5:
    * Effective policies (priority-ordered)
    * Effective guardrail list (deduped, priority-resolved)
    * Effective tool policy (intersect allow, union deny)
    """

    policies: list[str] = Field(default_factory=list)
    effective_guardrails: list[str] = Field(default_factory=list)
    tool_policy: PolicyToolPolicy = Field(default_factory=PolicyToolPolicy)
    # Optional cache metadata (for UI debug).
    cache_hit: bool = False
    resolved_at: str | None = None


class CompareRequest(ForgeBaseModel):
    """Body of ``POST /api/v1/policies/compare``."""

    left: dict[str, Any]
    right: dict[str, Any]


class CompareResult(ForgeBaseModel):
    """Spec §Feature 7 ``compare`` response."""

    additions: list[str] = Field(default_factory=list)
    removals: list[str] = Field(default_factory=list)
    modifications: list[str] = Field(default_factory=list)
    conflict_warnings: list[str] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


class PolicyTemplate(ForgeBaseModel):
    """A starter template the UI can clone."""

    id: str
    name: str
    description: str = ""
    category: str = "starter"
    body: dict[str, Any] = Field(default_factory=dict)


class PolicyAttachment(ForgeBaseModel):
    """A scope-binding for a policy."""

    policy_id: str
    scope: PolicyScope
    target_id: UUID | str | None = None
    inherit: bool = True
    override_lower_priority: bool = True


class PolicyAttachmentCreate(PolicyAttachment):
    pass


class PolicyResolutionErrorEnvelope(ForgeBaseModel):
    """Typed error envelope for invalid contexts (spec AC #4)."""

    code: str = "policy_resolution_error"
    missing_fields: list[str] = Field(default_factory=list)


class PolicyTestPipelineRequest(ForgeBaseModel):
    """Body of ``POST /api/v1/policies/{id}/test``."""

    policy_id: str
    sample_chat: dict[str, Any] = Field(default_factory=dict)


class PolicyTestPipelineResult(ForgeBaseModel):
    """Spec §Feature 7 ``test-pipeline`` response."""

    blocked_by: str | None = None
    modified_text: str | None = None
    decisions: list[dict[str, Any]] = Field(default_factory=list)


__all__ = [
    # Legacy F-003
    "PolicyBase",
    "PolicyCreate",
    "PolicyRead",
    # Phase 2
    "CompareRequest",
    "CompareResult",
    "PolicyAttachment",
    "PolicyAttachmentCreate",
    "PolicyCreateV2",
    "PolicyDecision",
    "PolicyDecisionLogic",
    "PolicyGuardrailRef",
    "PolicyReadV2",
    "PolicyResolutionErrorEnvelope",
    "PolicyScopeBlock",
    "PolicyTemplate",
    "PolicyTestPipelineRequest",
    "PolicyTestPipelineResult",
    "PolicyToolPolicy",
    "PolicyUpdateV2",
    "ResolveRequest",
    "ResolveResult",
]