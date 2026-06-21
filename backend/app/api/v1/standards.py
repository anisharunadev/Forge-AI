"""F-001 — Standards CRUD."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.schemas.standards import StandardCreate, StandardRead

router = APIRouter(prefix="/standards", tags=["standards"])


@router.get("", response_model=list[StandardRead])
@audit(action="standards.list", target_type="standard")
async def list_standards(
    principal: Principal,
    _perm: Principal = require_permission("standards:read"),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[StandardRead]:
    """List standards visible to the caller (RBAC + RLS scoped)."""
    from sqlalchemy import select

    from app.db.models.standard import Standard

    stmt = select(Standard).where(Standard.tenant_id == principal.tenant_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [StandardRead.model_validate(r) for r in rows]


@router.post("", response_model=StandardRead, status_code=status.HTTP_201_CREATED)
@audit(action="standards.create", target_type="standard")
async def create_standard(
    body: StandardCreate,
    principal: Principal,
    _perm: Principal = require_permission("standards:create"),
    db: DbSession = None,  # type: ignore[assignment]
) -> StandardRead:
    from app.db.models.standard import Standard

    standard = Standard(
        tenant_id=principal.tenant_id,
        project_id=body.project_id or principal.project_id,
        name=body.name,
        content=body.content,
        status=body.status,
        metadata_=body.metadata,
    )
    db.add(standard)
    await db.commit()
    await db.refresh(standard)
    return StandardRead.model_validate(standard)


__all__ = ["router"]
