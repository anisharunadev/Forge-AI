"""Roles endpoint (Settings → Members tab role selector)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DbSession, Principal
from app.core.audit import audit
from app.db.models.role import Role

router = APIRouter(prefix="/roles", tags=["roles"])


class RoleRead(BaseModel):
    id: UUID
    tenant_id: UUID
    name: str
    description: Optional[str] = None
    permissions: list[str]
    parent_role_id: Optional[UUID] = None
    is_system: bool = False

    model_config = {"from_attributes": True}


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[list[str]] = None


@router.get("", response_model=list[RoleRead])
@audit(action="roles.list", target_type="tenant")
async def list_roles(
    principal: Principal,
    db: DbSession,
) -> list[RoleRead]:
    """List every role in the caller's tenant.

    Order: system roles first (Owner, Admin, Member, Viewer) then
    tenant-defined roles alphabetically.
    """
    result = await db.execute(
        select(Role)
        .where(Role.tenant_id == UUID(principal.tenant_id))
        .order_by(Role.name)
    )
    rows = result.scalars().all()
    # Sort: system roles first.
    rows = sorted(rows, key=lambda r: (not (r.permissions == ["*"]), r.name))
    return [RoleRead.model_validate(r) for r in rows]


@router.patch("/{role_id}", response_model=RoleRead)
@audit(action="roles.update", target_type="role")
async def update_role(
    role_id: UUID,
    body: RoleUpdate,
    principal: Principal,
    db: DbSession,
) -> RoleRead:
    """Update a tenant-defined role's name / description / permissions."""
    role = (
        await db.execute(
            select(Role).where(
                Role.id == role_id,
                Role.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=404, detail="role_not_found")

    if role.permissions == ["*"] and body.permissions is not None:
        raise HTTPException(
            status_code=403, detail="cannot_modify_system_role_permissions"
        )

    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if body.permissions is not None:
        role.permissions = body.permissions

    role.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(role)
    return RoleRead.model_validate(role)


__all__ = ["router", "RoleRead", "RoleUpdate"]
