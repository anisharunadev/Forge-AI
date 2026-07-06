"""User service — OIDC bootstrap helpers (step-53 Zone 4).

Keycloak owns credential storage and authentication. We mirror the
principal into our database on first login so the rest of the platform
can join audit logs, runs, artifacts, etc. against a stable user id.

The full RBAC path (roles table, permissions join, role_ids array on
User) lives in ``rbac.py``; this module is intentionally narrow — it
only materializes the User row and a coarse ``role`` string that the
frontend uses for nav gating. The backend ``rbac`` service remains the
source of truth for permission decisions.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.user import User

logger = get_logger(__name__)

# Coarse RBAC hints surfaced to the frontend. Server-side
# ``services.rbac`` evaluates real permissions regardless of this value.
_DEFAULT_ROLE = "viewer"
_PROFILE_ROLE_KEY = "role"


async def get_or_create_user(
    db: AsyncSession,
    keycloak_id: str,
    email: str,
    name: str,
    tenant_id: str,
    role: str = _DEFAULT_ROLE,
) -> dict[str, Any]:
    """Find an existing user by Keycloak subject, or create one.

    ``keycloak_id`` is the ``sub`` claim from the OIDC userinfo
    response — globally unique across realms, stable across sessions,
    safe as our deduplication key.
    """
    tenant_uuid = UUID(str(tenant_id))
    result = await db.execute(select(User).where(User.keycloak_sub == keycloak_id))
    user = result.scalar_one_or_none()

    if user is None:
        profile = {_PROFILE_ROLE_KEY: role}
        user = User(
            tenant_id=tenant_uuid,
            keycloak_sub=keycloak_id,
            email=email,
            display_name=name or None,
            mfa_enabled=False,
            role_ids=[],
            profile=profile,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

        # Hook: mint a virtual key for the user under their tenant's
        # LiteLLM team (Zone 8 — team_sync). The user-to-tenant OIDC
        # bootstrap flow does NOT carry a project_id, so we cannot
        # call ensure_key_for_project here — log it instead. The
        # full key-per-project happens later, when the user joins
        # a project via the project-creation path.
        logger.info(
            "litellm_team_sync_user_created",
            user_id=str(user.id),
            tenant_id=str(user.tenant_id),
            email=email,
            note="project_id unknown at user-creation time; skipping ensure_key_for_project",
        )
    else:
        # Reconcile against the latest Keycloak claims on every sign-in:
        #   * tenant_id — Keycloak is the source of truth; a user who
        #     moved between tenants (or whose tenant attribute was added
        #     after their first login) should see their row reflect the
        #     current value.
        #   * profile.role — so a promotion in Keycloak is reflected on
        #     next login without needing a separate admin tool.
        # We don't touch display_name here — Keycloak is the source of
        # truth and the user can rename themselves in the account UI.
        changed = False
        if user.tenant_id != tenant_uuid:
            user.tenant_id = tenant_uuid
            changed = True
        if user.profile.get(_PROFILE_ROLE_KEY) != role:
            user.profile = {**user.profile, _PROFILE_ROLE_KEY: role}
            changed = True
        if changed:
            await db.commit()
            await db.refresh(user)

    return _to_dict(user)


async def get_user_by_id(
    db: AsyncSession,
    user_id: str,
    tenant_id: str,
) -> dict[str, Any] | None:
    """Look up a user by primary key, scoped to a tenant.

    Returns ``None`` when the (user_id, tenant_id) pair doesn't match —
    callers should treat that as 401 (token doesn't correspond to a
    known principal in the requested tenant).
    """
    user_uuid = UUID(str(user_id))
    tenant_uuid = UUID(str(tenant_id))
    result = await db.execute(
        select(User).where(User.id == user_uuid, User.tenant_id == tenant_uuid)
    )
    user = result.scalar_one_or_none()
    return _to_dict(user) if user is not None else None


def _to_dict(user: User) -> dict[str, Any]:
    """Project a User row into the wire shape consumed by the OIDC callback.

    ``profile`` is a JSON blob on the model but the wire shape
    advertises a coarse ``role`` string + optional ``avatar_url`` — both
    are stored under ``profile`` today, so we lift them out for the
    frontend.
    """
    profile = dict(user.profile or {})
    avatar_url = profile.get("avatar_url")
    return {
        "id": str(user.id),
        "keycloak_id": user.keycloak_sub,
        "email": user.email,
        "name": user.display_name or "",
        "tenant_id": str(user.tenant_id),
        "role": profile.get(_PROFILE_ROLE_KEY, _DEFAULT_ROLE),
        "avatar_url": avatar_url,
    }


__all__ = ["get_or_create_user", "get_user_by_id"]
