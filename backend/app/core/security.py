"""JWT bearer token validation and tenant extraction (Rule 2).

Forge delegates identity to Keycloak (OIDC). The access token is verified
locally (HS256 in dev, RS256 via JWKS in prod), and tenant_id is extracted
from the `forge.tenant` claim so every downstream call carries it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import settings

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedPrincipal:
    """Resolved identity for the current request.

    tenant_id and project_id are pulled from JWT claims so downstream
    RLS context (app.db.rls.tenant_context) can be set without extra DB
    lookups for every request.
    """

    user_id: str
    email: str | None
    tenant_id: str
    project_id: str | None
    roles: list[str]
    raw_claims: dict[str, Any]

    @property
    def session_id(self) -> str | None:
        """Session id claim (set by Keycloak/refresh-token chain).

        Routers that talk to ``user_sessions`` resolve the *current*
        row through this claim; falls back to ``None`` if upstream
        identity didn't issue one.
        """
        value = self.raw_claims.get("forge.session_id")
        return str(value) if value is not None else None


def decode_token(token: str) -> dict[str, Any]:
    """Decode + verify a JWT, raising HTTPException on failure.

    Phase 7 SC-7.2: when settings.jwt_secret_previous is set (the
    rotation overlap window), try the primary key first and fall back
    to the previous key on JWTError. Only applies when
    jwt_algorithm is symmetric (HS256/HS384/HS512) — the RS256 /
    JWKS path in prod does not have a single fallback key.
    """
    options = {"verify_aud": settings.jwt_audience is not None}
    common = dict(
        algorithms=[settings.jwt_algorithm],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
        options=options,
    )
    try:
        return jwt.decode(token, settings.jwt_secret, **common)
    except JWTError as primary_exc:
        prev = settings.jwt_secret_previous
        symmetric = settings.jwt_algorithm.upper().startswith("HS")
        if prev and symmetric:
            try:
                return jwt.decode(token, prev, **common)
            except JWTError:
                # fall through to the original 401
                pass
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {primary_exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from primary_exc


def principal_from_token(token: str) -> AuthenticatedPrincipal:
    """Build an AuthenticatedPrincipal from a raw JWT string."""
    claims = decode_token(token)
    tenant_id = claims.get("forge.tenant") or claims.get("tenant_id")
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token missing tenant_id claim (forge.tenant)",
        )
    return AuthenticatedPrincipal(
        user_id=str(claims.get("sub", "")),
        email=claims.get("email"),
        tenant_id=str(tenant_id),
        project_id=claims.get("forge.project") or claims.get("project_id"),
        roles=list(claims.get("realm_access", {}).get("roles", []) or []),
        raw_claims=claims,
    )


async def get_current_principal(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedPrincipal:
    """FastAPI dependency: extract & verify the bearer token."""
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return principal_from_token(creds.credentials)
