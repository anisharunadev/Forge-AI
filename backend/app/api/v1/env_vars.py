"""Per-project environment variables (encrypted at rest).

Settings → Env Vars tab. Values are Fernet-encrypted on insert/update
and never returned in list responses. The /reveal endpoint decrypts on
demand and writes an audit row (Rule 6).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, Principal, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.core.crypto import decrypt, encrypt
from app.db.models.env_var import EnvVar

router = APIRouter(prefix="/projects/{project_id}/env-vars", tags=["env-vars"])


class EnvVarRead(BaseModel):
    id: UUID
    project_id: UUID
    key: str
    description: Optional[str] = None
    scope: str
    visibility: str
    last_used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EnvVarReveal(BaseModel):
    key: str
    value: str


class EnvVarCreate(BaseModel):
    key: str = Field(..., pattern=r"^[A-Z][A-Z0-9_]*$", min_length=2, max_length=128)
    value: str = Field(..., min_length=1)
    description: Optional[str] = None
    scope: Literal["build", "runtime", "test"] = "runtime"
    visibility: Literal["secret", "public"] = "secret"


class EnvVarUpdate(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None
    scope: Optional[Literal["build", "runtime", "test"]] = None
    visibility: Optional[Literal["secret", "public"]] = None


def _to_read(ev: EnvVar) -> EnvVarRead:
    return EnvVarRead(
        id=ev.id,
        project_id=ev.project_id,
        key=ev.key,
        description=ev.description,
        scope=ev.scope,
        visibility=ev.visibility,
        last_used_at=ev.last_used_at,
        created_at=ev.created_at,
        updated_at=ev.updated_at,
    )


@router.get("", response_model=list[EnvVarRead])
@audit(action="env_vars.list", target_type="project")
async def list_env_vars(
    project_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> list[EnvVarRead]:
    """List env-var metadata. Values are NEVER returned."""
    result = await db.execute(
        select(EnvVar)
        .where(
            EnvVar.project_id == project_id,
            EnvVar.tenant_id == UUID(principal.tenant_id),
        )
        .order_by(EnvVar.key)
    )
    return [_to_read(ev) for ev in result.scalars().all()]


@router.post("", response_model=EnvVarRead, status_code=201)
@audit(action="env_vars.create", target_type="project")
async def create_env_var(
    project_id: UUID,
    body: EnvVarCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> EnvVarRead:
    """Create a new encrypted env var."""
    existing = (
        await db.execute(
            select(EnvVar).where(
                EnvVar.project_id == project_id,
                EnvVar.key == body.key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="key_already_exists")

    now = datetime.now(timezone.utc)
    ev = EnvVar(
        id=uuid4(),
        tenant_id=UUID(principal.tenant_id),
        project_id=project_id,
        key=body.key,
        encrypted_value=encrypt(body.value),
        description=body.description,
        scope=body.scope,
        visibility=body.visibility,
        created_by=UUID(principal.user_id) if principal.user_id else uuid4(),
        created_at=now,
        updated_at=now,
    )
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return _to_read(ev)


@router.patch("/{env_var_id}", response_model=EnvVarRead)
@audit(action="env_vars.update", target_type="project")
async def update_env_var(
    project_id: UUID,
    env_var_id: UUID,
    body: EnvVarUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> EnvVarRead:
    """Update an env var's value / description / scope / visibility."""
    ev = (
        await db.execute(
            select(EnvVar).where(
                EnvVar.id == env_var_id,
                EnvVar.project_id == project_id,
                EnvVar.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).scalar_one_or_none()
    if ev is None:
        raise HTTPException(status_code=404, detail="env_var_not_found")

    if body.value is not None:
        ev.encrypted_value = encrypt(body.value)
    if body.description is not None:
        ev.description = body.description
    if body.scope is not None:
        ev.scope = body.scope
    if body.visibility is not None:
        ev.visibility = body.visibility

    ev.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ev)
    return _to_read(ev)


@router.delete("/{env_var_id}")
@audit(action="env_vars.delete", target_type="project")
async def delete_env_var(
    project_id: UUID,
    env_var_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> None:
    """Delete an env var (irreversible)."""
    ev = (
        await db.execute(
            select(EnvVar).where(
                EnvVar.id == env_var_id,
                EnvVar.project_id == project_id,
                EnvVar.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).scalar_one_or_none()
    if ev is None:
        raise HTTPException(status_code=404, detail="env_var_not_found")

    await db.delete(ev)
    await db.commit()
    return None


@router.post("/{env_var_id}/reveal", response_model=EnvVarReveal)
@audit(action="env_vars.reveal", target_type="project")
async def reveal_env_var(
    project_id: UUID,
    env_var_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> EnvVarReveal:
    """Decrypt and return an env var's value. Audit row written by decorator."""
    ev = (
        await db.execute(
            select(EnvVar).where(
                EnvVar.id == env_var_id,
                EnvVar.project_id == project_id,
                EnvVar.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).scalar_one_or_none()
    if ev is None:
        raise HTTPException(status_code=404, detail="env_var_not_found")

    return EnvVarReveal(key=ev.key, value=decrypt(ev.encrypted_value))


__all__ = ["router", "EnvVarRead", "EnvVarReveal", "EnvVarCreate", "EnvVarUpdate"]
