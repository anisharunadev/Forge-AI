"""step-77 Slice 1 — Typed artifacts for the Guardrails surface.

Every HTTP boundary in ``app/api/v1/guardrails.py`` (and the apply
path in ``ForgeLLMClient.chat``) shapes payloads through these
schemas. The service layer in :mod:`app.services.guardrails_service`
is the only place that may construct the dataclass variant of the
apply result; everything HTTP-facing is Pydantic.

Rule 4: typed artifacts only. Never return a free-form dict from a
router.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel
from app.schemas.litellm_common import (
    GuardrailDecision,
    GuardrailKind,
    LitellmParams,
)

# ---------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------


class GuardrailRead(ForgeBaseModel):
    """One guardrail as the UI / API surface it.

    Mirrors the normalized catalog row from
    :func:`app.integrations.litellm.guardrail_apply.list_guardrails`.
    """

    id: str
    name: str
    description: str = ""
    kind: GuardrailKind | None = None
    default_params: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


# ---------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------


class GuardrailRegistration(ForgeBaseModel):
    """Body of ``POST /api/v1/guardrails`` (admin register).

    The :class:`LitellmParams` carries the proxy-side configuration.
    ``custom_code`` is only used for ``kind == "custom_code"`` and
    is validated via ``/guardrails/test_custom_code`` before the
    register call (AC #5).
    """

    guardrail_name: str = Field(min_length=1, max_length=128)
    litellm_params: LitellmParams
    kind: GuardrailKind = "pre_call_input"
    custom_code: str | None = None


class GuardrailUpdate(ForgeBaseModel):
    """Body of ``PATCH /api/v1/guardrails/{name}``.

    Updates are idempotent on ``name`` (AC #7). The proxy merges
    the new params with the existing record; only the supplied
    fields are changed.
    """

    litellm_params: LitellmParams
    enabled: bool | None = None


# ---------------------------------------------------------------------
# Apply / test
# ---------------------------------------------------------------------


class GuardrailApplyResult(ForgeBaseModel):
    """Normalized response of an apply or test call.

    AC #6: ``latency_ms`` is always present (zero when the proxy
    omits it). AC #3: ``reason`` carries the block reason on a
    block decision. ``masked_text`` carries the masked replacement
    on a mask decision.
    """

    decision: GuardrailDecision
    text: str
    masked_text: str | None = None
    reason: str | None = None
    latency_ms: int = 0
    evaluations: list[dict[str, Any]] = Field(default_factory=list)


class GuardrailTestRequest(ForgeBaseModel):
    """Body of ``POST /api/v1/guardrails/{name}/test`` (dry-run)."""

    text: str = Field(min_length=1, max_length=64_000)
    user_id: UUID | str | None = None
    request_id: str | None = None


class GuardrailTestCustomCodeRequest(ForgeBaseModel):
    """Body of ``POST /api/v1/guardrails/test-custom-code``."""

    code: str = Field(min_length=1, max_length=64_000)
    sample_text: str = Field(default="ping", min_length=1, max_length=4096)


# ---------------------------------------------------------------------
# Submissions
# ---------------------------------------------------------------------


class GuardrailSubmissionRead(ForgeBaseModel):
    """One row of the submissions log.

    The proxy returns either a flat dict or one wrapped in
    ``submission`` — both normalize to this shape. ``latency_ms``
    is guaranteed (AC #6).
    """

    ts: datetime
    guardrail_name: str
    request_id: str | None = None
    decision: GuardrailDecision
    latency_ms: int = 0
    text_hash: str | None = None
    actor_id: UUID | str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------
# UI rule-builder
# ---------------------------------------------------------------------


class GuardrailUIRule(ForgeBaseModel):
    """UI rule-builder entry. The rule-builder shape is intentionally
    free-form (it can express anything the catalog supports) so the
    underlying dict is preserved as ``definition``.
    """

    id: str | None = None
    name: str
    description: str = ""
    kind: GuardrailKind
    definition: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------


class GuardrailViolationError(ForgeBaseModel):
    """The typed error envelope returned when a guardrail blocks.

    Mirrors the spec §Feature 6 "typed error" requirement. The
    router maps :class:`GuardrailsService.GuardrailViolation` into
    an HTTP 422 with this body.
    """

    code: str = "guardrail_violation"
    guardrail_name: str
    decision: GuardrailDecision
    kind: GuardrailKind | None = None
    reason: str | None = None
    policy_id: str | None = None
    request_id: str | None = None
    occurred_at: datetime


__all__ = [
    "GuardrailApplyResult",
    "GuardrailRead",
    "GuardrailRegistration",
    "GuardrailSubmissionRead",
    "GuardrailTestCustomCodeRequest",
    "GuardrailTestRequest",
    "GuardrailUIRule",
    "GuardrailUpdate",
    "GuardrailViolationError",
]
