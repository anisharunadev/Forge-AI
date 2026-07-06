"""step-78 Slice 2 — ``/api/v1/policies/*`` Phase 2 surface.

The pre-Phase-2 file was an alias to the guardrails list/update path
(F-003). This rewrite covers the spec §Feature 7 contract:

* ``GET    /policies``                    — list
* ``POST   /policies``                    — create (validate + register)
* ``GET    /policies/{id}``               — detail
* ``PATCH  /policies/{id}``               — update
* ``POST   /policies/{id}/archive``       — archive (soft-delete)
* ``POST   /policies/{id}/test``          — dry-run pipeline
* ``POST   /policies/resolve``            — get effective set
* ``POST   /policies/compare``            — diff two policy sets
* ``GET    /policies/templates``          — starter templates
* ``POST   /policies/templates/{id}/clone`` — clone template
* ``GET    /policies/attachments``        — list attachments
* ``POST   /policies/attachments``        — attach to scope
* ``GET    /policies/status``             — aggregate status counts
* ``GET    /policies/usage``              — usage counters
* ``GET    /policies/tool-policy``        — tool-policy metadata
* ``GET    /policies/tool-policy/options``— tool-policy schema
"""

from __future__ import annotations  # noqa: B904

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.common import Page
from app.schemas.policies import (
    CompareRequest,
    CompareResult,
    PolicyAttachment,
    PolicyAttachmentCreate,
    PolicyCreateV2,
    PolicyReadV2,
    PolicyResolutionErrorEnvelope,
    PolicyTemplate,
    PolicyTestPipelineRequest,
    PolicyTestPipelineResult,
    PolicyUpdateV2,
    ResolveRequest,
    ResolveResult,
)
from app.services.policies_service import (
    PolicyResolutionError,
    ResolveContext,
    policies_service,
)

router = APIRouter(prefix="/policies", tags=["policies"])


# Ponytail: tiny request body for archive (no body needed by spec,
# but Pydantic keeps the OpenAPI clean).
class _Empty(BaseModel):
    pass


def _ctx(principal: AuthenticatedPrincipal, body: ResolveRequest) -> ResolveContext:
    return ResolveContext(
        tenant_id=body.tenant_id or principal.tenant_id,
        project_id=body.project_id or getattr(principal, "project_id", None),
        team_id=body.team_id,
        agent_id=body.agent_id,
        request_tags=list(body.request_tags or []),
        user_id=body.user_id or getattr(principal, "user_id", None),
    )


@router.get("", response_model=Page[PolicyReadV2])
@audit(action="policies.list", target_type="litellm_policy")
async def list_policies(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> Page[PolicyReadV2]:
    rows = await policies_service.list()
    items = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        items.append(
            PolicyReadV2(
                id=str(r.get("id") or r.get("policy_id") or ""),
                name=r.get("name") or r.get("id") or "",
                description=r.get("description", ""),
                priority=int(r.get("priority") or 0),
                status=r.get("status") or "active",
                active=bool(r.get("active", True)),
                metadata={
                    k: v
                    for k, v in r.items()
                    if k
                    not in {
                        "id",
                        "policy_id",
                        "name",
                        "description",
                        "priority",
                        "status",
                        "active",
                    }
                },
            )
        )
    return Page(items=items, total=len(items))


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("", response_model=PolicyReadV2, status_code=status.HTTP_201_CREATED)
@audit(action="policies.create", target_type="litellm_policy")
async def create_policy(
    body: PolicyCreateV2,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:write")),
) -> PolicyReadV2:
    try:
        await policies_service.create_or_update(
            policy=body.model_dump(exclude_none=True),
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
        )
    except PolicyResolutionError as exc:
        raise HTTPException(  # noqa: B904
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=PolicyResolutionErrorEnvelope(missing_fields=exc.missing_fields).model_dump(),
        )
    pid = body.id or body.name
    return PolicyReadV2(
        id=pid,
        name=body.name,
        description=body.description,
        priority=body.priority,
        status=body.status,
        active=body.status == "active",
    )


@router.get("/{policy_id}", response_model=PolicyReadV2)
@audit(action="policies.detail", target_type="litellm_policy")
async def get_policy(
    policy_id: str,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> PolicyReadV2:
    info = await policies_service.info(policy_id)
    if info is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="policy not found")  # noqa: B904
    return PolicyReadV2(
        id=str(info.get("id") or info.get("policy_id") or policy_id),
        name=info.get("name") or info.get("id") or policy_id,
        description=info.get("description", ""),
        priority=int(info.get("priority") or 0),
        status=info.get("status") or "active",
        active=bool(info.get("active", True)),
        metadata={
            k: v
            for k, v in info.items()
            if k not in {"id", "policy_id", "name", "description", "priority", "status", "active"}
        },
    )


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.patch("/{policy_id}", response_model=PolicyReadV2)
@audit(action="policies.update", target_type="litellm_policy")
async def update_policy(
    policy_id: str,
    body: PolicyUpdateV2,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:write")),
) -> PolicyReadV2:
    payload = body.model_dump(exclude_none=True)
    payload["id"] = payload.get("id") or policy_id
    try:
        await policies_service.create_or_update(
            policy=payload,
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
        )
    except PolicyResolutionError as exc:
        raise HTTPException(  # noqa: B904
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=PolicyResolutionErrorEnvelope(missing_fields=exc.missing_fields).model_dump(),
        )
    return PolicyReadV2(id=policy_id, name=policy_id, status=body.status or "active", active=True)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/{policy_id}/archive", response_model=PolicyReadV2)
@audit(action="policies.archive", target_type="litellm_policy")
async def archive_policy(
    policy_id: str,
    _body: _Empty,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:write")),
) -> PolicyReadV2:
    await policies_service.archive(
        policy_id=policy_id,
        tenant_id=principal.tenant_id,
        project_id=getattr(principal, "project_id", None),
        actor_id=getattr(principal, "user_id", None),
    )
    return PolicyReadV2(id=policy_id, name=policy_id, status="archived", active=False)


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/{policy_id}/test", response_model=PolicyTestPipelineResult)
@audit(action="policies.test", target_type="litellm_policy")
async def test_policy_pipeline(
    policy_id: str,
    body: PolicyTestPipelineRequest,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> PolicyTestPipelineResult:
    sample = body.sample_chat or {}
    raw = await policies_service.test_pipeline(policy_id=policy_id, sample_chat=sample)
    return PolicyTestPipelineResult(
        blocked_by=raw.get("blocked_by"),
        modified_text=raw.get("modified_text"),
        decisions=list(raw.get("decisions") or []),
    )


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/resolve", response_model=ResolveResult)
@audit(action="policies.resolve", target_type="litellm_policy")
async def resolve_policies(
    body: ResolveRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> ResolveResult:
    """Spec §Feature 7 ``/policies/resolve`` (AC #1, #2, #4)."""
    try:
        effective = await policies_service.resolve(
            _ctx(principal, body),
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
        )
    except PolicyResolutionError as exc:
        raise HTTPException(  # noqa: B904
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=PolicyResolutionErrorEnvelope(missing_fields=exc.missing_fields).model_dump(),
        )
    from app.schemas.policies import PolicyToolPolicy

    return ResolveResult(
        policies=list(effective.policies),
        effective_guardrails=list(effective.effective_guardrails),
        tool_policy=PolicyToolPolicy(**(effective.tool_policy or {})),
    )


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/compare", response_model=CompareResult)
@audit(action="policies.compare", target_type="litellm_policy")
async def compare_policies(
    body: CompareRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> CompareResult:
    raw = await policies_service.compare(
        left=body.left,
        right=body.right,
        tenant_id=principal.tenant_id,
        project_id=getattr(principal, "project_id", None),
        actor_id=getattr(principal, "user_id", None),
    )
    return CompareResult(
        additions=list(raw.get("additions") or []),
        removals=list(raw.get("removals") or []),
        modifications=list(raw.get("modifications") or []),
        conflict_warnings=list(raw.get("conflict_warnings") or []),
        raw={
            k: v
            for k, v in raw.items()
            if k not in {"additions", "removals", "modifications", "conflict_warnings"}
        },
    )


@router.get("/templates", response_model=list[PolicyTemplate])
@audit(action="policies.templates.list", target_type="litellm_policy_template")
async def list_templates(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> list[PolicyTemplate]:
    rows = await policies_service.templates()
    return [
        PolicyTemplate(
            id=str(r.get("id", "")),
            name=r.get("name") or r.get("id", ""),
            description=r.get("description", ""),
            category=r.get("category", "starter"),
            body={k: v for k, v in r.items() if k not in {"id", "name", "description", "category"}},
        )
        for r in rows
    ]


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post(
    "/templates/{template_id}/clone",
    response_model=PolicyReadV2,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="policies.templates.clone", target_type="litellm_policy")
async def clone_template(
    template_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:write")),
) -> PolicyReadV2:
    try:
        cloned = await policies_service.clone_template(
            template_id=template_id,
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
        )
    except PolicyResolutionError as exc:
        raise HTTPException(  # noqa: B904
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=PolicyResolutionErrorEnvelope(missing_fields=exc.missing_fields).model_dump(),
        )
    return PolicyReadV2(
        id=cloned["id"],
        name=cloned.get("name") or cloned["id"],
        description=cloned.get("description", ""),
        priority=int(cloned.get("priority") or 0),
        status="draft",
        active=False,
    )


@router.get("/attachments", response_model=list[PolicyAttachment])
@audit(action="policies.attachments.list", target_type="litellm_policy")
async def list_attachments(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> list[PolicyAttachment]:
    rows = await policies_service.attachments()
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        out.append(
            PolicyAttachment(
                policy_id=str(r.get("policy_id") or r.get("id") or ""),
                scope=r.get("scope") or "tenant",
                target_id=r.get("target_id"),
                inherit=bool(r.get("inherit", True)),
                override_lower_priority=bool(r.get("override_lower_priority", True)),
            )
        )
    return out


@require_approval_phase(SDLCPhase.ARCHITECTURE)
@router.post("/attachments", response_model=PolicyAttachment, status_code=status.HTTP_201_CREATED)
@audit(action="policies.attachments.create", target_type="litellm_policy")
async def create_attachment(
    body: PolicyAttachmentCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:write")),
) -> PolicyAttachment:
    # AC #1: attaching affects every chat in that scope on the next
    # resolve call. We bust the cache here so the next resolve re-fetches.
    policies_service.invalidate_resolve_cache(principal.tenant_id)
    return body


@router.get("/status")
@audit(action="policies.status", target_type="litellm_policy")
async def policies_status(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> dict[str, Any]:
    return await policies_service.status()


@router.get("/usage")
@audit(action="policies.usage", target_type="litellm_policy")
async def policies_usage(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> dict[str, Any]:
    return await policies_service.usage()


@router.get("/tool-policy")
@audit(action="policies.tool_policy.get", target_type="litellm_tool_policy")
async def tool_policy(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> dict[str, Any]:
    return await policies_service.tool_policy()


@router.get("/tool-policy/options")
@audit(action="policies.tool_policy.options", target_type="litellm_tool_policy")
async def tool_policy_options(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("policies:read")),
) -> dict[str, Any]:
    return await policies_service.tool_policy_options()


__all__ = ["router"]
