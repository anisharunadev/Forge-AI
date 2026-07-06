"""step-77 Phase 2 — Shared schemas for the LiteLLM safety & tooling slice.

Every Phase 2 feature (Guardrails, Policies, Skills, MCP, Tools) imports
its cross-cutting typed primitives from this module. Keeping them in one
file means:

* No circular imports between feature schemas — every feature schema
  can import from ``litellm_common`` without dragging in another
  feature's runtime code.
* The closed-set taxonomies (guardrail kinds, tool kinds, policy scopes)
  live in one place so docs and tests can point at a single source.
* Pydantic v2 ``Literal`` types are the v2-idiomatic way to constrain
  a string field to a known set — the same pattern used elsewhere
  in ``app/schemas/``.

Rule 4 (typed artifacts): every value that crosses an HTTP boundary
in Phase 2 should derive one of its types from this file. If a new
value shape appears more than once, promote it here.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel

# ---------------------------------------------------------------------
# Guardrails (Feature 6)
# ---------------------------------------------------------------------

# Closed set of guardrail kinds defined by the spec §Feature 6
# ("Hook kinds"). Each kind maps to a different point in the chat
# hot path that the pre-/post-call envelope in
# ``ForgeLLMClient.chat`` consults.
GuardrailKind = Literal[
    "pre_call_input",  # applied to the user message BEFORE the model call
    "pre_call_llm",  # applied to the system prompt + history
    "post_call_output",  # applied to the model's final message
    "during_call",  # applied per-chunk during streaming
]

# Closed set of decisions an ``/apply_guardrail`` call can return.
# ``mask`` carries ``masked_text``; ``block`` carries ``reason``;
# ``pass`` is a noop.
GuardrailDecision = Literal["pass", "block", "mask"]


class LitellmParams(ForgeBaseModel):
    """Free-form LiteLLM guardrail configuration.

    The fields are intentionally loose — the catalog of legal params
    differs per ``GuardrailKind`` (PII uses ``pii_entities``; prompt
    injection uses ``blocked_phrases``; etc.). The forge side is a
    passthrough; the LiteLLM proxy validates the shape per guardrail
    name. See ``docs/litellm/forge-litellm-integration.md`` §Guardrails.
    """

    # A handful of commonly-used params are typed for IDE / OpenAPI
    # benefits. Anything else lands in ``extra`` and is forwarded
    # verbatim to LiteLLM.
    blocked_phrases: list[str] | None = None
    pii_entities: list[str] | None = None
    score_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    model: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------
# Tools (Feature 10 + MCP)
# ---------------------------------------------------------------------

# A Tool can come from any of four sources. The ``mcp`` kind is the
# canonical one for Slice 4 (MCP server tools); the others are the
# rest of the Tools registry.
ToolKind = Literal["mcp", "native", "function", "passthrough"]


class ToolRef(ForgeBaseModel):
    """Lightweight reference to a tool the model can call.

    Used in skill composition (``SkillRead.tools: list[ToolRef]``)
    and in the resolved palette returned to ``chat/completions``.
    The full tool body (JSON schema, version, requires_approval)
    lives in the Tools registry; ``ToolRef`` is what flows through
    the hot path.
    """

    name: str
    kind: ToolKind
    # Only set for ``kind == "mcp"``. Identifies the MCP server that
    # owns the tool; needed by the dispatch path in
    # ``mcp_service.dispatch_tool_call``.
    server_id: UUID | None = None


# ---------------------------------------------------------------------
# Policies (Feature 7)
# ---------------------------------------------------------------------

# Where a policy can be attached. A policy with a more specific
# scope (e.g. ``agent``) outranks a less specific one (``tenant``)
# during resolve. See ``policies_service.resolve`` composition rules.
PolicyScope = Literal["tenant", "team", "agent", "request"]

# Lifecycle state. Active policies participate in resolve; archived
# ones drop out immediately (no cross-status caching — spec AC #7).
PolicyStatus = Literal["draft", "active", "archived"]

# Decision rule when a guardrail fires. ``block`` short-circuits
# the request; ``warn`` lets it through with an audit row;
# ``modify`` / ``redact`` swap the offending text.
PolicyDecisionLogic = Literal["block", "warn", "modify", "redact"]

# How multiple policy decisions combine. Spec §"Composition rules":
# deny wins over allow → translates to ``any_violation_blocks``.
PolicyCombineStrategy = Literal["any", "all", "majority", "any_violation_blocks"]


# ---------------------------------------------------------------------
# Generic envelopes
# ---------------------------------------------------------------------


class NameRef(ForgeBaseModel):
    """Identifies a named LiteLLM object (guardrail, policy, skill, tool).

    Used everywhere a feature talks to a name on the proxy side (e.g.
    ``POST /guardrails/{name}/test`` accepts a ``NameRef`` body).
    """

    name: str = Field(min_length=1, max_length=128)


__all__ = [
    "GuardrailDecision",
    "GuardrailKind",
    "LitellmParams",
    "NameRef",
    "PolicyCombineStrategy",
    "PolicyDecisionLogic",
    "PolicyScope",
    "PolicyStatus",
    "ToolKind",
    "ToolRef",
]
