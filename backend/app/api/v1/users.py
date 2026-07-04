"""Step-73 — Self-service user profile + notification preferences.

Settings → Notifications tab. Notification preferences are stored in the
``User.profile`` JSONB column under the ``notifications`` key. There is
no dedicated table because the preference object is tiny and per-user.

The PATCH endpoint takes any subset of the four fields; Pydantic's
``exclude_unset=True`` enforces partial-update semantics so the UI
doesn't have to round-trip unchanged fields.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal, get_current_principal
from app.db.models.user import User
from app.db.session import get_session_factory
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

logger = get_logger(__name__)

router = APIRouter(prefix="/users/me", tags=["users"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class NotificationPrefs(BaseModel):
    """Self-service notification toggles.

    Defaults match sensible UX: emails on, in-app on, slack off, webhook
    blank until the user pastes one.
    """

    email_digest: bool = True
    inapp: bool = True
    slack_dm: bool = False
    webhook_url: str | None = Field(default=None, max_length=500)


_DEFAULT_PREFS = NotificationPrefs().model_dump()


class NotificationPrefsRead(NotificationPrefs):
    pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/notifications", response_model=NotificationPrefsRead)
async def get_notification_prefs(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> NotificationPrefsRead:
    """Return the principal's notification preferences.

    Falls back to defaults when ``User.profile.notifications`` is unset.
    """
    prefs = await _load_prefs(principal)
    return NotificationPrefsRead(**prefs)
@require_approval_phase(SDLCPhase.PLANNING)


@router.patch("/notifications", response_model=NotificationPrefsRead)
async def patch_notification_prefs(
    body: NotificationPrefs,
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> NotificationPrefsRead:
    """Partial update — only fields explicitly set are written.

    Full body roundtrip via Pydantic so unknown keys are rejected.
    """
    factory = get_session_factory()
    async with factory() as session:
        user_row = await session.get(User, UUID(principal.user_id))
        if user_row is None:
            raise HTTPException(status_code=404, detail="user_not_found")
        profile = dict(user_row.profile or {})
        existing = dict(profile.get("notifications") or _DEFAULT_PREFS)
        update = body.model_dump(exclude_unset=True)
        existing.update(update)
        profile["notifications"] = existing
        user_row.profile = profile
        await session.commit()

    logger.info(
        "users.notifications.updated",
        user_id=principal.user_id,
        fields=list(update.keys()),
    )
    return NotificationPrefsRead(**existing)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_prefs(principal: AuthenticatedPrincipal) -> dict:
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(User.profile).where(User.id == UUID(principal.user_id))
            )
        ).first()
    if rows is None or rows[0] is None:
        return dict(_DEFAULT_PREFS)
    profile = rows[0]
    return {**_DEFAULT_PREFS, **(profile.get("notifications") or {})}


__all__ = ["router", "NotificationPrefs", "NotificationPrefsRead"]
