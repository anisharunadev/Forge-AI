"""F-002 — Templates CRUD."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import DbSession, get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.templates import TemplateCreate, TemplateRead

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TemplateRead])
@audit(action="templates.list", target_type="template")
async def list_templates(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("templates:read")),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[TemplateRead]:
    from sqlalchemy import select

    from app.db.models.template import Template

    stmt = select(Template).where(Template.tenant_id == principal.tenant_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [TemplateRead.model_validate(r) for r in rows]


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
@audit(action="templates.create", target_type="template")
async def create_template(
    body: TemplateCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("templates:create")),
    db: DbSession = None,  # type: ignore[assignment]
) -> TemplateRead:
    from app.db.models.template import Template

    template = Template(
        tenant_id=principal.tenant_id,
        project_id=body.project_id or principal.project_id,
        type=body.type,
        name=body.name,
        content=body.content,
        variables=body.variables,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return TemplateRead.model_validate(template)


__all__ = ["router"]
