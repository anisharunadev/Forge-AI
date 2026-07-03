"""step-77 Slice 1 — ``/api/v1/guardrails/*`` HTTP surface.

Thin handlers that shape the service layer's typed outputs for the
Forge UI. Per backend/CLAUDE.md "No business logic in routes": every
non-trivial operation lives in :mod:`app.services.guardrails_service`.

The spec (§Feature 6 Forge Backend contract) calls for a single
``/api/forge/guardrails`` prefix; per the project prefix-decision we
mount under ``/api/v1/guardrails`` (the existing 60+ routers all use
this prefix and the orphan-router footgun is a real risk).

Endpoints:
* ``GET    /guardrails``                 — list (catalog + per-tenant active set)
* ``GET    /guardrails/{name}``          — detail
* ``POST   /guardrails``                 — admin register (with custom-code validation)
* ``PATCH  /guardrails/{name}``          — update
* ``POST   /guardrails/{name}/test``     — dry-run on sample text
* ``POST   /guardrails/test-custom-code``— validate before deploy
* ``GET    /guardrails/submissions``     — submissions log
* ``GET    /guardrails/ui``              — rule-builder list
* ``POST   /guardrails/ui``              — rule-builder save
* ``GET    /guardrails/ui/{rule_id}``    — rule-builder get
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import Principal, get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.schemas.common import Page
from app.schemas.guardrails import (
    GuardrailApplyResult,
    GuardrailRead,
    GuardrailRegistration,
    GuardrailSubmissionRead,
    GuardrailTestCustomCodeRequest,
    GuardrailTestRequest,
    GuardrailUIRule,
    GuardrailUpdate,
    GuardrailViolationError,
)
from app.services.guardrails_service import (
    GuardrailViolation,
    guardrails_service,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/guardrails", tags=["guardrails"])


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


def _envelope_block(violation: GuardrailViolation) -> HTTPException:
    """Map a :class:`GuardrailViolation` to the spec's typed error envelope."""
    body = GuardrailViolationError(
        guardrail_name=violation.guardrail_name,
        decision=violation.decision,
        kind=violation.kind,
        reason=violation.reason,
        policy_id=violation.policy_id,
        occurred_at=datetime.now(timezone.utc),
    )
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=body.model_dump(mode="json"),
    )


async def _principal_tenant(principal: AuthenticatedPrincipal) -> str:
    """The tenant the caller is bound to. We never expose cross-tenant rows."""
    return str(principal.tenant_id)


# ---------------------------------------------------------------------
# List
# ---------------------------------------------------------------------


@router.get("", response_model=Page[GuardrailRead])
@audit(action="guardrails.list", target_type="litellm_guardrail")
async def list_guardrails_endpoint(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
) -> Page[GuardrailRead]:
    """List the LiteLLM guardrail catalog (read-only)."""
    rows = await guardrails_service.list_catalog(tenant_id=await _principal_tenant(principal))
    items = [GuardrailRead(**r) for r in rows]
    return Page(items=items, total=len(items))


# ---------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------


@router.get("/{name}", response_model=GuardrailRead)
@audit(action="guardrails.detail", target_type="litellm_guardrail")
async def get_guardrail_endpoint(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
) -> GuardrailRead:
    info = await guardrails_service.info(name)
    if info is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="guardrail not found")
    return GuardrailRead(
        id=info.get("guardrail_name", name),
        name=info.get("display_name") or info.get("guardrail_name", name),
        description=info.get("description", ""),
        kind=info.get("kind"),
        default_params=info.get("litellm_params", {}) or {},
        enabled=bool(info.get("enabled", True)),
    )


# ---------------------------------------------------------------------
# Register / update
# ---------------------------------------------------------------------


@router.post("", response_model=GuardrailRead, status_code=status.HTTP_201_CREATED)
@audit(action="guardrails.register", target_type="litellm_guardrail")
async def register_guardrail_endpoint(
    body: GuardrailRegistration,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> GuardrailRead:
    """Admin register. Idempotent on ``guardrail_name`` (AC #7, #8)."""
    try:
        await guardrails_service.register(
            guardrail_name=body.guardrail_name,
            litellm_params=body.litellm_params,
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
            custom_code=body.custom_code,
        )
    except GuardrailViolation as violation:
        raise _envelope_block(violation)

    return GuardrailRead(
        id=body.guardrail_name,
        name=body.guardrail_name,
        description="",
        kind=body.kind,
        default_params=body.litellm_params.model_dump(exclude_none=True),
        enabled=True,
    )


@router.patch("/{name}", response_model=GuardrailRead)
@audit(action="guardrails.update", target_type="litellm_guardrail")
async def update_guardrail_endpoint(
    name: str,
    body: GuardrailUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> GuardrailRead:
    """Update via the register path (idempotent on name — AC #7, #8)."""
    try:
        await guardrails_service.register(
            guardrail_name=name,
            litellm_params=body.litellm_params,
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
        )
    except GuardrailViolation as violation:
        raise _envelope_block(violation)

    return GuardrailRead(
        id=name,
        name=name,
        description="",
        kind=None,
        default_params=body.litellm_params.model_dump(exclude_none=True),
        enabled=bool(body.enabled) if body.enabled is not None else True,
    )


# ---------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------


@router.post("/{name}/test", response_model=GuardrailApplyResult)
@audit(action="guardrails.test", target_type="litellm_guardrail")
async def test_guardrail_endpoint(
    name: str,
    body: GuardrailTestRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
) -> GuardrailApplyResult:
    """Dry-run a guardrail against sample text."""
    raw = await guardrails_service.test(
        guardrail_name=name,
        text=body.text,
        user_id=str(body.user_id) if body.user_id else None,
        request_id=body.request_id,
    )
    return GuardrailApplyResult(
        decision=raw.get("decision", "pass"),
        text=body.text,
        masked_text=raw.get("text") if raw.get("decision") == "mask" else None,
        reason=raw.get("reason"),
        latency_ms=int(raw.get("latency_ms", 0)),
    )


@router.post("/test-custom-code", response_model=GuardrailApplyResult)
@audit(action="guardrails.test_custom_code", target_type="litellm_guardrail")
async def test_custom_code_endpoint(
    body: GuardrailTestCustomCodeRequest,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> GuardrailApplyResult:
    """Validate custom-code guardrail before deploy (AC #5)."""
    from app.integrations.litellm.guardrail_apply import test_custom_code

    result = await test_custom_code(code=body.code, sample_text=body.sample_text)
    valid = bool(result.get("valid"))
    return GuardrailApplyResult(
        decision="pass" if valid else "block",
        text=body.sample_text,
        masked_text=None,
        reason=result.get("error") if not valid else None,
        latency_ms=0,
    )


# ---------------------------------------------------------------------
# Submissions
# ---------------------------------------------------------------------


@router.get("/submissions", response_model=Page[GuardrailSubmissionRead])
@audit(action="guardrails.submissions", target_type="litellm_guardrail")
async def list_submissions_endpoint(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
    since_hours: int = Query(default=24, ge=1, le=24 * 30),
    guardrail_name: str | None = Query(default=None),
) -> Page[GuardrailSubmissionRead]:
    """Submissions log; every row carries ``latency_ms`` (AC #6)."""
    rows = await guardrails_service.submissions(
        since_hours=since_hours, guardrail_name=guardrail_name
    )
    items: list[GuardrailSubmissionRead] = []
    for r in rows:
        try:
            ts_raw = r.get("ts") or r.get("occurred_at") or r.get("created_at")
            ts = (
                datetime.fromisoformat(ts_raw)
                if isinstance(ts_raw, str)
                else datetime.now(timezone.utc)
            )
        except (TypeError, ValueError):
            ts = datetime.now(timezone.utc)
        items.append(
            GuardrailSubmissionRead(
                ts=ts,
                guardrail_name=r.get("guardrail_name", ""),
                request_id=r.get("request_id"),
                decision=r.get("decision", "pass"),
                latency_ms=int(r.get("latency_ms", 0) or 0),
                text_hash=r.get("text_hash"),
                actor_id=r.get("actor_id"),
                extra={
                    k: v
                    for k, v in r.items()
                    if k
                    not in {
                        "ts",
                        "occurred_at",
                        "created_at",
                        "guardrail_name",
                        "request_id",
                        "decision",
                        "latency_ms",
                        "text_hash",
                        "actor_id",
                    }
                },
            )
        )
    return Page(items=items, total=len(items))


# ---------------------------------------------------------------------
# UI rule-builder
# ---------------------------------------------------------------------


@router.get("/ui", response_model=Page[GuardrailUIRule])
@audit(action="guardrails.ui.list", target_type="litellm_guardrail")
async def list_ui_rules_endpoint(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
) -> Page[GuardrailUIRule]:
    rows = await guardrails_service.ui_list()
    items: list[GuardrailUIRule] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        items.append(
            GuardrailUIRule(
                id=r.get("id"),
                name=r.get("name", ""),
                description=r.get("description", ""),
                kind=r.get("kind", "pre_call_input"),
                definition={k: v for k, v in r.items() if k not in {"id", "name", "description", "kind"}},
            )
        )
    return Page(items=items, total=len(items))


@router.post("/ui", response_model=GuardrailUIRule, status_code=status.HTTP_201_CREATED)
@audit(action="guardrails.ui.save", target_type="litellm_guardrail")
async def save_ui_rule_endpoint(
    body: GuardrailUIRule,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:write")),
) -> GuardrailUIRule:
    raw = await guardrails_service.ui_save(body.model_dump())
    return GuardrailUIRule(
        id=(raw or {}).get("id") or body.id,
        name=body.name,
        description=body.description,
        kind=body.kind,
        definition=body.definition,
    )


@router.get("/ui/{rule_id}", response_model=GuardrailUIRule)
@audit(action="guardrails.ui.get", target_type="litellm_guardrail")
async def get_ui_rule_endpoint(
    rule_id: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("admin:read")),
) -> GuardrailUIRule:
    raw = await guardrails_service.ui_get(rule_id)
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="rule not found")
    return GuardrailUIRule(
        id=raw.get("id", rule_id),
        name=raw.get("name", ""),
        description=raw.get("description", ""),
        kind=raw.get("kind", "pre_call_input"),
        definition={k: v for k, v in raw.items() if k not in {"id", "name", "description", "kind"}},
    )


__all__ = ["router"]
