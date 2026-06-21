"""F-004 — Roles CRUD (RBAC bindings)."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.schemas.common import ForgeBaseModel
from app.db.models.role import Role
from sqlalchemy import select

router = APIRouter(prefix="/roles", tags=["roles"])


class RoleCreate(ForgeBaseModel):
    name: str
    description: str | None = None
    permissions: list[str] = []
    parent_role_id: str | None = None


class RoleRead(ForgeBaseModel):
    id: str
    name: str
    description: str | None
    permissions: list[str]


@router.get("", response_model=list[RoleRead])
@audit(action="roles.list", target_type="role")
async def list_roles(
    principal: Principal,
    _perm: Principal = require_permission("roles:read"),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[RoleRead]:
    stmt = select(Role).where(Role.tenant_id == principal.tenant_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        RoleRead(
            id=str(r.id),
            name=r.name,
            description=r.description,
            permissions=list(r.permissions),
        )
        for r in rows
    ]


@router.post("", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
@audit(action="roles.create", target_type="role")
async def create_role(
    body: RoleCreate,
    principal: Principal,
    _perm: Principal = require_permission("roles:create"),
    db: DbSession = None,  # type: ignore[assignment]
) -> RoleRead:
    role = Role(
        tenant_id=principal.tenant_id,
        name=body.name,
        description=body.description,
        permissions=body.permissions,
        parent_role_id=body.parent_role_id,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return RoleRead(
        id=str(role.id),
        name=role.name,
        description=role.description,
        permissions=list(role.permissions),
    )


__all__ = ["router"]
