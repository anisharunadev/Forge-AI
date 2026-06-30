"""Tenant service — OIDC bootstrap helpers (step-53 Zone 4).

The first time a Keycloak user signs in, we need to materialize a
matching ``Tenant`` row in our database so the rest of the platform
(Rule 2 — multi-tenancy) can scope queries to it.

The full tenant lifecycle (settings, billing, feature flags) lives in
``tenant_directory`` + ``seeding``; this module is intentionally small:
it only handles the idempotent "find or create" path used by the OIDC
callback.

Tenant identifiers come from Keycloak user attributes
(``tenant_id`` / ``tenant_slug`` / ``tenant_name``) and are plain
strings — we coerce them to UUIDs here so the rest of the platform can
treat them as opaque UUIDs (see ADR-002 + Rule 2).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.tenant import Tenant
from app.core.logging import get_logger

logger = get_logger(__name__)

# Field name on Tenant.settings — kept in one place so the OIDC
# callback and any future seeding path agree.
_PLAN_KEY = "plan"
_REGION_KEY = "region"
_DEFAULT_PLAN = "pro"
_DEFAULT_REGION = "us-east-1"

# Stable UUID namespace for deriving tenant IDs from non-UUID slugs.
# ``uuid5(namespace, name)`` is deterministic — the same slug always
# yields the same UUID across processes and restarts, so an "acme-corp"
# Keycloak user attribute maps to the same Tenant row on every login.
# NAMESPACE_DNS is the canonical RFC 4122 example namespace.
_TENANT_UUID_NAMESPACE = UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _coerce_tenant_id(value: str) -> UUID:
    """Accept a UUID-shaped string OR a slug and return a UUID.

    Keycloak's ``tenant_id`` user attribute can be either a real UUID
    (production) or a human-readable slug like ``acme-corp`` (dev demo
    realm). We must coerce the latter into a UUID so the rest of the
    platform's foreign keys line up with the ``Tenant.id`` column type.
    """
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        # Not a UUID — derive a stable UUID5 from the slug so repeated
        # logins materialize the same Tenant row.
        return uuid5(_TENANT_UUID_NAMESPACE, str(value).strip().lower())


async def get_or_create_tenant(
    db: AsyncSession,
    id: str,
    slug: str,
    name: str,
    plan: str = _DEFAULT_PLAN,
    region: str = _DEFAULT_REGION,
) -> dict[str, Any]:
    """Find an existing tenant by id, or create one.

    The id comes from Keycloak's ``tenant_id`` user attribute. We coerce
    it to a UUID so the platform's foreign keys (``users.tenant_id``,
    every audit/artifact row) line up with the column type.
    """
    tenant_uuid = _coerce_tenant_id(id)
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_uuid))
    tenant = result.scalar_one_or_none()

    if tenant is None:
        tenant = Tenant(
            id=tenant_uuid,
            slug=slug,
            name=name,
            status="active",
            settings={_PLAN_KEY: plan, _REGION_KEY: region},
        )
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

        # Hook: ensure a matching LiteLLM team exists for the new
        # tenant (Zone 8 — team_sync). Failure here must not block
        # the local tenant row — log and continue.
        try:
            from app.services.team_sync import ensure_team_for_tenant

            await ensure_team_for_tenant(
                tenant_id=str(tenant.id),
                tenant_name=tenant.name,
                max_budget=1000.0,  # default budget — replace with config
            )
        except Exception as e:
            logger.warning(
                "litellm_team_sync_failed",
                tenant_id=str(tenant.id),
                error=str(e),
            )

    settings = dict(tenant.settings or {})
    return {
        "id": str(tenant.id),
        "slug": tenant.slug,
        "name": tenant.name,
        "plan": settings.get(_PLAN_KEY, _DEFAULT_PLAN),
        "region": settings.get(_REGION_KEY, _DEFAULT_REGION),
    }


__all__ = ["get_or_create_tenant", "_coerce_tenant_id"]
