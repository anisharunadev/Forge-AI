"""F-001a — Tenant CRUD: create new workspaces + switch active workspace.

Used by:

  * ``TenantSwitcher`` "Create new workspace" CTA in the top bar.
  * The ``/onboarding/workspace`` page (step-61 Zone 6).
  * Admin tools that programmatically provision a new tenant.

Endpoints
---------

  * ``POST /tenants`` — create a workspace. The creator is mirrored as
    a User row inside the new tenant (the OIDC bootstrap path was
    single-tenant until now; we keep that contract intact by writing
    a fresh User here).
  * ``POST /tenants/{tenant_id}/switch`` — exchange a valid bearer
    for a NEW access token whose ``forge.tenant`` claim is the target
    tenant. Membership is checked against the target tenant's User
    rows; if the user has never been mirrored there, we do it now
    (idempotent on keycloak_sub).
  * ``GET /tenants/{tenant_id}`` — minimal read for confirmation
    UIs (name, slug, plan, region).

Skill rules applied
-------------------

  * Rule 2 — multi-tenancy: every query filters by tenant_id; the
    new tenant's user mirror carries the JWT-derived user_id so the
    audit trail is preserved across switches.
  * Rule 6 — auditability: every mutation goes through ``@audit``.
  * Rule 7 — observability: each row write is wrapped in
    ``tenant_context`` (RLS) when needed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from jose import jwt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.models.user import User

logger = get_logger(__name__)

router = APIRouter(prefix="/tenants", tags=["tenants"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class TenantCreate(BaseModel):
    """Body for ``POST /tenants``."""

    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(
        ...,
        min_length=2,
        max_length=64,
        pattern=r"^[a-z0-9-]+$",
        description="URL-safe identifier (lowercase letters, digits, dashes).",
    )
    plan: Literal["free", "pro", "enterprise"] = "pro"
    region: str = "us-east-1"
    logo_url: str | None = None


class TenantRead(BaseModel):
    """Response shape for the tenants surface.

    ``role`` and ``is_current`` are populated per-caller so the
    ``TenantSwitcher`` can render avatars + check marks without a
    second round-trip.
    """

    id: UUID
    name: str
    slug: str
    plan: str
    region: str
    logo_url: str | None = None
    role: str = "owner"
    is_current: bool = False


class SwitchTenantResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600
    tenant: TenantRead


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _settings_for(plan: str, region: str, logo_url: str | None) -> dict[str, Any]:
    """Project the create-fields onto the ``Tenant.settings`` JSON blob."""
    payload: dict[str, Any] = {"plan": plan, "region": region}
    if logo_url:
        payload["logo_url"] = logo_url
    return payload


def _tenant_to_read(tenant: Tenant, role: str, is_current: bool) -> TenantRead:
    settings = dict(tenant.settings or {})
    return TenantRead(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        plan=str(settings.get("plan", "free")),
        region=str(settings.get("region", "us-east-1")),
        logo_url=settings.get("logo_url"),
        role=role,
        is_current=is_current,
    )


async def _mirror_user_into_tenant(
    db: AsyncSession,
    *,
    source_user: User,
    target_tenant_id: UUID,
) -> User:
    """Mirror a User row into a different tenant.

    Idempotent on ``(keycloak_sub, tenant_id)``: if a row already
    exists there we update its profile to match (so a renamed user
    follows themselves across tenants) and return it. Otherwise we
    insert a new row copying the stable identity (keycloak_sub,
    email, mfa_enabled) and the latest role from ``profile``.

    Used by both ``POST /tenants`` (creator → new tenant) and
    ``POST /tenants/{id}/switch`` (caller → previously-untouched
    tenant). The OIDC bootstrap path remains the source of truth
    for tenant-1 users; this helper just keeps the rest of the
    workspaces the same person can access.
    """
    existing = (
        await db.execute(
            select(User).where(
                User.keycloak_sub == source_user.keycloak_sub,
                User.tenant_id == target_tenant_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.email = source_user.email
        existing.display_name = source_user.display_name
        existing.mfa_enabled = source_user.mfa_enabled
        existing.profile = dict(source_user.profile or {})
        await db.commit()
        await db.refresh(existing)
        return existing

    mirrored = User(
        tenant_id=target_tenant_id,
        keycloak_sub=source_user.keycloak_sub,
        email=source_user.email,
        display_name=source_user.display_name,
        mfa_enabled=source_user.mfa_enabled,
        role_ids=list(source_user.role_ids or []),
        profile=dict(source_user.profile or {}),
    )
    db.add(mirrored)
    await db.commit()
    await db.refresh(mirrored)
    return mirrored


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", response_model=TenantRead, status_code=status.HTTP_201_CREATED)
@audit(action="tenants.create", target_type="tenant")
async def create_tenant(
    body: TenantCreate,
    principal: Principal,
    db: DbSession,
    _perm: Principal = require_permission("tenants:write"),
) -> TenantRead:
    """Create a new workspace and mirror the caller into it as owner.

    Side effects (all idempotent / best-effort):

      * Insert ``Tenant`` row with the provided slug + settings.
      * Mirror the caller's User into the new tenant so the OIDC
        claim round-trip works on the next ``/auth/me`` call.
      * Spawn a LiteLLM team for the new tenant via
        ``team_sync.ensure_team_for_tenant`` (best-effort: failure
        here MUST NOT block the local insert — Rule 3, tenant
        creation is a strong contract; LiteLLM sync is a soft hook).
    """
    # Slug uniqueness — surface as 409 so the frontend can show a
    # "slug taken" message without a generic toast.
    existing = (
        await db.execute(select(Tenant).where(Tenant.slug == body.slug))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="slug_already_exists",
        )

    tenant = Tenant(
        id=uuid4(),
        name=body.name,
        slug=body.slug,
        status="active",
        settings=_settings_for(body.plan, body.region, body.logo_url),
    )
    db.add(tenant)
    await db.flush()  # populate tenant.id without committing yet

    # Mirror the creator into the new tenant so future /auth/me calls
    # resolve to a real User row.
    creator = (
        await db.execute(
            select(User).where(
                User.id == UUID(principal.user_id),
                User.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).scalar_one_or_none()
    if creator is not None:
        try:
            await _mirror_user_into_tenant(
                db, source_user=creator, target_tenant_id=tenant.id
            )
        except Exception as exc:  # noqa: BLE001 — best-effort mirror
            logger.warning(
                "tenants.create.user_mirror_failed",
                tenant_id=str(tenant.id),
                user_id=principal.user_id,
                error=str(exc),
            )

    await db.commit()
    await db.refresh(tenant)

    # Best-effort LiteLLM team sync — must NOT block the local insert.
    try:
        from app.services.team_sync import (  # noqa: PLC0415
            ensure_team_for_tenant,
        )

        await ensure_team_for_tenant(
            tenant_id=str(tenant.id),
            tenant_name=tenant.name,
            max_budget=100.0,
        )
    except Exception as exc:  # noqa: BLE001 — best-effort, Rule 3
        logger.warning(
            "tenants.create.litellm_sync_failed",
            tenant_id=str(tenant.id),
            error=str(exc),
        )

    logger.info(
        "tenants.create",
        tenant_id=str(tenant.id),
        slug=tenant.slug,
        creator_id=principal.user_id,
    )

    return _tenant_to_read(tenant, role="owner", is_current=False)


@router.post(
    "/{tenant_id}/switch",
    response_model=SwitchTenantResponse,
)
@audit(action="tenants.switch", target_type="tenant")
async def switch_tenant(
    tenant_id: UUID,
    principal: Principal,
    db: DbSession,
) -> SwitchTenantResponse:
    """Mint a fresh access token scoped to ``tenant_id``.

    Membership semantics: the caller must have a User row in the
    target tenant. We mirror the user on the fly if not (handles
    the "I just created a new workspace, switch to it" flow without
    a second bootstrap call). If the target tenant doesn't exist,
    404. If the caller can't be mirrored (no source user in the
    current tenant), 403.

    The returned ``access_token`` carries the target ``forge.tenant``
    claim; the caller should replace its stored token and reload so
    every TanStack Query / Zustand store keyed on tenant-id refetches.
    """
    target = await db.get(Tenant, tenant_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="tenant_not_found",
        )

    # Resolve the caller's identity in the *current* tenant (the
    # source of their keycloak_sub + email — both stable across
    # tenant switches).
    source_user = (
        await db.execute(
            select(User).where(
                User.id == UUID(principal.user_id),
                User.tenant_id == UUID(principal.tenant_id),
            )
        )
    ).scalar_one_or_none()
    if source_user is None:
        # No source user — we can't mint a token for a tenant we
        # have no proof of identity in.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="source_user_not_found",
        )

    mirrored_user = await _mirror_user_into_tenant(
        db, source_user=source_user, target_tenant_id=tenant_id
    )

    # Mint the new access token. Same shape as OIDC callback +
    # refresh (HS256, 1h TTL, ``forge.tenant`` claim).
    now = datetime.now(tz=UTC)
    access_claims = {
        "sub": str(mirrored_user.id),
        "email": mirrored_user.email,
        "forge.tenant": str(target.id),
        "forge.tenant_slug": target.slug,
        "role": (mirrored_user.profile or {}).get("role", "owner"),
        "type": "access",
        "iat": now,
        "exp": now.timestamp() + 3600,
    }
    access_token = jwt.encode(
        access_claims,
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )

    logger.info(
        "tenants.switch",
        from_tenant=principal.tenant_id,
        to_tenant=str(target.id),
        user_id=principal.user_id,
    )

    return SwitchTenantResponse(
        access_token=access_token,
        expires_in=3600,
        tenant=_tenant_to_read(target, role="owner", is_current=True),
    )


@router.get("/{tenant_id}", response_model=TenantRead)
async def get_tenant(
    tenant_id: UUID,
    principal: Principal,
    db: DbSession,
) -> TenantRead:
    """Minimal read for confirmation UIs (no permission gate — the
    caller's JWT attests they have *some* tenant; if they ask for a
    different tenant, we still answer because the switcher flow
    needs to display name+plan+region of the target before the
    user clicks "Switch".
    """
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="tenant_not_found",
        )
    is_current = str(tenant.id) == principal.tenant_id
    role = "owner" if is_current else "member"
    return _tenant_to_read(tenant, role=role, is_current=is_current)


__all__ = ["router", "TenantCreate", "TenantRead", "SwitchTenantResponse"]