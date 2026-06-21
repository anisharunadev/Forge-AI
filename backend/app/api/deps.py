"""FastAPI dependency providers.

Centralizes db session, current user, and tenant context so individual
endpoints stay terse and RLS is impossible to forget.
"""

from __future__ import annotations

from typing import Annotated, AsyncIterator
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


def require_permission(permission: str, *, policy_id: UUID | None = None):
    """Build a dependency that asserts the principal has `permission`.

    Optional `policy_id` adds a policy-engine check on top of RBAC.
    """

    async def _dep(principal: Principal) -> AuthenticatedPrincipal:
        result = await rbac.check(principal, permission, policy_id=policy_id)
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
    "require_permission",
]
