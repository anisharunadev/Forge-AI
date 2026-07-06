"""Step-73 — User sessions.

Settings → Sessions tab. Lists every live or revoked session the
principal owns; revoke kills a session row (the corresponding refresh
token is rejected by ID at next refresh).

Why a dedicated table instead of deriving from audit: audit rows
don't carry a stable session id, and the Settings UI needs the
``User-Agent`` + ``ip`` pair that audit captures only opportunistically.
The row is small and indexed on ``(user_id, revoked_at)`` for the hot
list path.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal, get_current_principal
from app.db.models.user_session import UserSession
from app.db.session import get_session_factory

logger = get_logger(__name__)

router = APIRouter(prefix="/auth/sessions", tags=["auth"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SessionRead(BaseModel):
    id: str
    label: str
    user_agent: str
    ip: str
    last_seen_at: str
    created_at: str
    is_current: bool
    revoked_at: str | None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[SessionRead])
async def list_sessions(
    request: Request,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> list[SessionRead]:
    """List the principal's sessions (Settings → Sessions).

    Active (non-revoked) first, then alphabetically. The principal's
    session_id claim is the canonical "current" session marker.
    """
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            (
                await session.execute(
                    select(UserSession)
                    .where(
                        UserSession.user_id == UUID(principal.user_id),
                        UserSession.tenant_id == UUID(principal.tenant_id),
                    )
                    .order_by(UserSession.last_seen_at.desc())
                )
            )
            .scalars()
            .all()
        )

    return [
        SessionRead(
            id=str(r.id),
            label=r.label,
            user_agent=r.user_agent,
            ip=r.ip or _client_ip(request),
            last_seen_at=r.last_seen_at.isoformat() if r.last_seen_at else "",
            created_at=r.created_at.isoformat() if r.created_at else "",
            is_current=r.is_current,
            revoked_at=r.revoked_at.isoformat() if r.revoked_at else None,
        )
        for r in rows
    ]


@require_approval_phase(SDLCPhase.PLANNING)
@router.delete("/{session_id}")
async def revoke_session(
    session_id: UUID,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> None:
    """Revoke a session (Settings → Sessions).

    Idempotent. Refuses to revoke the *current* session because that
    would log the user out mid-PATCH — the user can use the logout
    button instead, which calls ``POST /auth/logout``.
    """
    if session_id and str(session_id) == principal.session_id:
        raise HTTPException(
            status_code=409,
            detail="cannot_revoke_current_session_use_logout",
        )

    factory = get_session_factory()
    async with factory() as session:
        # Mark the targeted session revoked (verify ownership first to
        # avoid silent no-op on a stranger's session_id).
        result = await session.execute(
            update(UserSession)
            .where(
                UserSession.id == session_id,
                UserSession.user_id == UUID(principal.user_id),
                UserSession.tenant_id == UUID(principal.tenant_id),
            )
            .values(revoked_at=datetime.now(tz=UTC))
        )
        await session.commit()
        if result.rowcount == 0:
            # Either not yours or doesn't exist; 204 either way.
            logger.info(
                "auth.sessions.revoke.noop",
                user_id=principal.user_id,
                session_id=str(session_id),
            )
            return

    logger.info(
        "auth.sessions.revoked",
        user_id=principal.user_id,
        session_id=str(session_id),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return (request.client.host if request.client else "") or ""


__all__ = ["router", "SessionRead"]
