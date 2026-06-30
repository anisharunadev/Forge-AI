"""Auth middleware shim (step-53 Zone 3).

The canonical implementation lives in ``app.core.security`` — it
implements HS256/RS256 verification, JWKS support, and the
``AuthenticatedPrincipal`` dataclass consumed by ``app.api.deps``.

This module re-exports the two helpers the step-53 spec names
(``get_current_user`` + ``get_current_tenant``) so:

  * The spec's call sites (``from app.core.auth import
    get_current_user``) work without modification.
  * We keep a single implementation path for JWT verification — the
    two-name surface is just an alias.

Why not delete this file and inline the spec? Future OIDC-only routes
that want to accept a bearer token without the heavier
``AuthenticatedPrincipal`` (no RBAC, no audit) can be wired against
``get_current_tenant`` here without going through ``deps.Principal``.
"""

from __future__ import annotations

from fastapi import Request

from app.core.security import (
    AuthenticatedPrincipal,
    get_current_principal,
    principal_from_token,
)


async def get_current_user(
    request: Request,
    principal: AuthenticatedPrincipal | None = None,
) -> dict:
    """Resolve the current principal to a DB-backed user dict.

    Used by the OIDC callback's ``GET /auth/me`` and any endpoint that
    wants the principal as a plain dict (not the ``AuthenticatedPrincipal``
    dataclass used by the rest of the API).

    Falls back to extracting the bearer token directly from the request
    header so this function is usable both as a FastAPI dependency and
    from ad-hoc contexts (scripts, tests).
    """
    if principal is not None:
        token_principal = principal
    else:
        # Hand-rolled extraction so this helper doesn't require
        # ``Depends(get_current_principal)`` at every call site.
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.lower().startswith("bearer "):
            from fastapi import HTTPException, status

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Bearer token required",
            )
        token_principal = principal_from_token(auth_header[7:])

    # Lazy import — keeps this module importable in tests that don't
    # have a database configured.
    from app.db.session import get_session_factory
    from app.services.users import get_user_by_id

    factory = get_session_factory()
    async with factory() as session:
        user = await get_user_by_id(
            session,
            user_id=token_principal.user_id,
            tenant_id=token_principal.tenant_id,
        )
    if user is None:
        from fastapi import HTTPException, status

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_not_found",
        )
    return user


async def get_current_tenant(request: Request) -> str:
    """Pull ``tenant_id`` straight from the bearer token.

    Cheaper than ``get_current_user`` because it doesn't hit the
    database — useful in hot paths (audit middleware, tenant-scoped
    loggers) where you only need the claim value.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        from fastapi import HTTPException, status

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required",
        )
    principal = principal_from_token(auth_header[7:])
    return principal.tenant_id


# FastAPI-friendly dependency aliases so callers can do:
#
#     from app.core.auth import CurrentUser, CurrentTenant
#
# CurrentUser = Annotated[AuthenticatedPrincipal, Depends(get_current_principal)]
# CurrentTenant = Annotated[str, Depends(get_current_tenant)]
from typing import Annotated  # noqa: E402

from fastapi import Depends  # noqa: E402

CurrentUser = Annotated[AuthenticatedPrincipal, Depends(get_current_principal)]
CurrentTenant = Annotated[str, Depends(get_current_tenant)]


__all__ = [
    "get_current_user",
    "get_current_tenant",
    "CurrentUser",
    "CurrentTenant",
]
