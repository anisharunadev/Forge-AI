"""F-003 — Policies CRUD."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.schemas.policies import PolicyCreate, PolicyRead

router = APIRouter(prefix="/policies", tags=["policies"])


@router.get("", response_model=list[PolicyRead])
@audit(action="policies.list", target_type="policy")
async def list_policies(
    principal: Principal,
    _perm: Principal = require_permission("policies:read"),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[PolicyRead]:
    from sqlalchemy import select

    from app.db.models.policy import Policy

    stmt = select(Policy).where(Policy.tenant_id == principal.tenant_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [PolicyRead.model_validate(r) for r in rows]


@router.post("", response_model=PolicyRead, status_code=status.HTTP_201_CREATED)
@audit(action="policies.create", target_type="policy")
async def create_policy(
    body: PolicyCreate,
    principal: Principal,
    _perm: Principal = require_permission("policies:create"),
    db: DbSession = None,  # type: ignore[assignment]
) -> PolicyRead:
    from app.db.models.policy import Policy
    from app.services.policy_engine import policy_engine

    policy = Policy(
        tenant_id=principal.tenant_id,
        name=body.name,
        description=body.description,
        expression=body.expression,
        severity=body.severity,
        enabled=body.enabled,
    )
    db.add(policy)
    await db.commit()
    await db.refresh(policy)

    # Warm the in-memory cache so the next evaluation is fast.
    policy_engine.register(
        policy.id,
        policy.expression,
        tenant_id=principal.tenant_id,
    )
    return PolicyRead.model_validate(policy)


__all__ = ["router"]
