"""step-78 Slice 3 — ``/api/v1/skills/*`` Phase 2 surface.

Spec §Feature 9 Forge Backend contract:

* ``GET    /skills``              — list (filter by category, status)
* ``POST   /skills``              — admin create
* ``GET    /skills/{id}``         — detail (specific version)
* ``PATCH  /skills/{id}``         — update (creates new version)
* ``POST   /skills/{id}/archive`` — archive
* ``GET    /skills/hub``          — public marketplace
* ``POST   /skills/hub/import``   — import a public skill
* ``POST   /skills/preview``      — render a skill's prompt with variables
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.common import Page
from app.schemas.skills import (
    SkillCreate,
    SkillHubEntry,
    SkillHubImport,
    SkillRead,
    SkillRenderError,
    SkillRenderRequest,
    SkillRenderResult,
    SkillUpdate,
)
from app.services.skills_service import SkillRenderError as SkillRenderExc
from app.services.skills_service import skills_service

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=Page[SkillRead])
@audit(action="skills.list", target_type="litellm_skill")
async def list_skills(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:read")),
    category: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
) -> Page[SkillRead]:
    items = await skills_service.list(
        tenant_id=principal.tenant_id, category=category, status=status_filter
    )
    return Page(items=items, total=len(items))


@router.post("", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
@audit(action="skills.create", target_type="litellm_skill")
async def create_skill(
    body: SkillCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:write")),
) -> SkillRead:
    try:
        return await skills_service.create_or_update(
            body=body,
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
        )
    except SkillRenderExc as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=SkillRenderError(skill_id=exc.skill_id, template_error=exc.message).model_dump(),
        )


@router.get("/hub", response_model=list[SkillHubEntry])
@audit(action="skills.hub.list", target_type="litellm_skill")
async def list_hub(
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:read")),
) -> list[SkillHubEntry]:
    rows = await skills_service.hub()
    out: list[SkillHubEntry] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        out.append(
            SkillHubEntry(
                id=str(r.get("id") or r.get("name") or ""),
                name=str(r.get("name") or r.get("id") or ""),
                description=str(r.get("description") or ""),
                category=r.get("category") or "custom",
                tags=list(r.get("tags") or []),
                source=str(r.get("source") or "public"),
                extra={k: v for k, v in r.items() if k not in {"id", "name", "description", "category", "tags", "source"}},
            )
        )
    return out


@router.post("/hub/import", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
@audit(action="skills.hub.import", target_type="litellm_skill")
async def import_hub(
    body: SkillHubImport,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:write")),
) -> SkillRead:
    try:
        return await skills_service.hub_import(
            hub_id=body.hub_id,
            tenant_id=body.tenant_id or principal.tenant_id,
            actor_id=getattr(principal, "user_id", None),
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/preview", response_model=SkillRenderResult)
@audit(action="skills.preview", target_type="litellm_skill")
async def preview_skill(
    body: SkillRenderRequest,
    _principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:read")),
) -> SkillRenderResult:
    template = body.prompt_template
    skill_id: str | None = None
    if template is None and body.skill is not None:
        template = body.skill.prompt_template
        skill_id = body.skill.id or body.skill.name
    if not template:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="prompt_template or skill.prompt_template required",
        )
    try:
        rendered = await skills_service.preview(
            prompt_template=template,
            variables=body.variables,
            skill_id=skill_id,
        )
    except SkillRenderExc as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=SkillRenderError(skill_id=exc.skill_id, template_error=exc.message).model_dump(),
        )
    return SkillRenderResult(rendered=rendered, variables_used=sorted(body.variables.keys()))


@router.get("/{skill_id}", response_model=SkillRead)
@audit(action="skills.detail", target_type="litellm_skill")
async def get_skill(
    skill_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:read")),
) -> SkillRead:
    detail = await skills_service.detail(skill_id, tenant_id=principal.tenant_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    return detail


@router.patch("/{skill_id}", response_model=SkillRead)
@audit(action="skills.update", target_type="litellm_skill")
async def update_skill(
    skill_id: str,
    body: SkillUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:write")),
) -> SkillRead:
    try:
        result = await skills_service.update(
            skill_id=skill_id,
            body=body,
            tenant_id=principal.tenant_id,
            project_id=getattr(principal, "project_id", None),
            actor_id=getattr(principal, "user_id", None),
        )
    except SkillRenderExc as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=SkillRenderError(skill_id=exc.skill_id, template_error=exc.message).model_dump(),
        )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    return result


@router.post("/{skill_id}/archive", response_model=SkillRead)
@audit(action="skills.archive", target_type="litellm_skill")
async def archive_skill(
    skill_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("skills:write")),
) -> SkillRead:
    result = await skills_service.archive(
        skill_id=skill_id,
        tenant_id=principal.tenant_id,
        project_id=getattr(principal, "project_id", None),
        actor_id=getattr(principal, "user_id", None),
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="skill not found")
    return result


__all__ = ["router"]