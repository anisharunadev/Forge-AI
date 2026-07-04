"""Step-73 — User API tokens.

Self-service tokens the bearer can name, scope, and revoke from the
Settings → API Tokens tab. Same shape as LiteLLM Virtual Keys (step-65):
the full plaintext secret is returned to the client exactly once at
creation; only its ``fingerprint_sha256[12]`` and a full ``secret_hash``
persist. List endpoints never return the secret; a revoked row is
retained for audit but excluded from the "active" UI section.

Per Rule 2 every row carries ``tenant_id`` plus ``user_id``; both are
in the list query. No service extraction — endpoints are thin and the
logic is local.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal, get_current_principal
from app.db.models.user_session import UserApiToken
from app.db.session import get_session_factory
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

logger = get_logger(__name__)

router = APIRouter(prefix="/auth/api-tokens", tags=["auth"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ApiTokenCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    scope: str = Field("read", max_length=64)
    expires_in_days: int | None = Field(None, ge=1, le=365)


class ApiTokenRead(BaseModel):
    id: str
    name: str
    scope: str
    fingerprint_sha256: str
    created_at: str
    last_used_at: str | None
    expires_at: str | None
    revoked_at: str | None


class ApiTokenCreated(ApiTokenRead):
    """Returned exactly once at creation time — carries the plaintext."""

    secret: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ApiTokenRead])
async def list_api_tokens(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> list[ApiTokenRead]:
    """List all API tokens for the current user (Settings → API Tokens)."""
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(UserApiToken)
                .where(
                    UserApiToken.user_id == UUID(principal.user_id),
                    UserApiToken.tenant_id == UUID(principal.tenant_id),
                )
                .order_by(UserApiToken.created_at.desc())
            )
        ).scalars().all()

    return [_to_read(r) for r in rows]
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("", response_model=ApiTokenCreated, status_code=status.HTTP_201_CREATED)
async def create_api_token(
    body: ApiTokenCreate,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> ApiTokenCreated:
    """Issue a new API token. Plaintext secret returned exactly once."""
    secret = secrets.token_urlsafe(32)
    secret_hash = hashlib.sha256(secret.encode("utf-8")).hexdigest()
    fingerprint = secret_hash[:12]
    now = datetime.now(tz=timezone.utc)
    expires_at = (
        now + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    )

    row = UserApiToken(
        id=uuid4(),
        tenant_id=UUID(principal.tenant_id),
        user_id=UUID(principal.user_id),
        name=body.name,
        scope=body.scope,
        fingerprint_sha256=fingerprint,
        secret_hash=secret_hash,
        created_at=now,
        last_used_at=None,
        expires_at=expires_at,
        revoked_at=None,
    )

    factory = get_session_factory()
    async with factory() as session:
        session.add(row)
        await session.commit()
        await session.refresh(row)

    logger.info(
        "auth.api_tokens.created",
        user_id=principal.user_id,
        token_id=str(row.id),
        scope=body.scope,
    )
    return ApiTokenCreated(**_to_read(row).model_dump(), secret=secret)
@require_approval_phase(SDLCPhase.PLANNING)


@router.delete("/{token_id}")
async def revoke_api_token(
    token_id: UUID,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> None:
    """Revoke a token. Idempotent — already-revoked rows return 204."""
    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            update(UserApiToken)
            .where(
                UserApiToken.id == token_id,
                UserApiToken.user_id == UUID(principal.user_id),
                UserApiToken.tenant_id == UUID(principal.tenant_id),
            )
            .values(revoked_at=datetime.now(tz=timezone.utc))
        )
        await session.commit()
        if result.rowcount == 0:
            # Not yours, doesn't exist, or already revoked — surface as
            # no-op 204 so the UI doesn't need to handle 404.
            logger.info(
                "auth.api_tokens.revoke.noop",
                user_id=principal.user_id,
                token_id=str(token_id),
            )
            return

    logger.info(
        "auth.api_tokens.revoked",
        user_id=principal.user_id,
        token_id=str(token_id),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_read(row: UserApiToken) -> ApiTokenRead:
    return ApiTokenRead(
        id=str(row.id),
        name=row.name,
        scope=row.scope,
        fingerprint_sha256=row.fingerprint_sha256,
        created_at=row.created_at.isoformat() if row.created_at else "",
        last_used_at=row.last_used_at.isoformat() if row.last_used_at else None,
        expires_at=row.expires_at.isoformat() if row.expires_at else None,
        revoked_at=row.revoked_at.isoformat() if row.revoked_at else None,
    )


__all__ = ["router", "ApiTokenRead", "ApiTokenCreated"]
