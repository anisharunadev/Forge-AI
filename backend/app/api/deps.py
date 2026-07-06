"""FastAPI dependency providers.

Centralizes db session, current user, and tenant context so individual
endpoints stay terse and RLS is impossible to forget.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import AuthenticatedPrincipal, get_current_principal
from app.db.session import get_session
from app.services.rbac import rbac


async def db_session() -> AsyncIterator[AsyncSession]:
    """Re-export the session dependency under a stable name."""
    async for s in get_session():
        yield s


DbSession = Annotated[AsyncSession, Depends(db_session)]
Principal = Annotated[AuthenticatedPrincipal, Depends(get_current_principal)]


async def get_current_tenant(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> UUID:
    """Resolve the current tenant UUID from the request's principal.

    Stub added in step-56 wiring — ``policies.py`` (step-55) imports
    this dependency. Long-term it should additionally enforce tenant
    isolation via RLS context (DL-026); for now we just project the
    ``forge.tenant`` claim to UUID.
    """
    try:
        return UUID(principal.tenant_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="invalid_tenant_claim",
        ) from exc


def require_permission(permission: str, *, policy_id: UUID | None = None):
    """Build a dependency that asserts the principal has `permission`.

    Optional `policy_id` adds a policy-engine check on top of RBAC.

    The inner dependency uses an explicit ``Annotated[...]`` form for
    ``principal`` rather than re-referencing the module-level
    ``Principal`` alias. With ``from __future__ import annotations``
    on, the alias would be a ``ForwardRef`` at type-check time and
    Pydantic's TypeAdapter fails to resolve it for nested dependencies
    raised by ``require_permission(...)``. Using the explicit form
    keeps the type resolvable at request time.
    """

    async def _dep(
        principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    ) -> AuthenticatedPrincipal:
        result = rbac.check(principal, permission, policy_id=policy_id)
        if not result.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=result.reason,
            )
        return principal

    return _dep


__all__ = [
    "db_session",
    "DbSession",
    "Principal",
    "get_current_tenant",
    "require_permission",
]
