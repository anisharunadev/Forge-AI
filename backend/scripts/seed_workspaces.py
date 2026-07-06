#!/usr/bin/env python3
"""Seed a second workspace (acme-platform) under the demo user.

Step-61 Zone 7 — makes the ``TenantSwitcher`` dropdown visibly
demonstrate two workspaces without going through the full create
flow. Idempotent: re-running the script is a no-op once the rows
exist.

Run: ``python -m scripts.seed_workspaces``
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import get_session_factory

logger = get_logger(__name__)

DEMO_EMAIL = "arun@acme-corp.com"
WORKSPACE_NAME = "Acme Platform"
WORKSPACE_SLUG = "acme-platform"


async def seed() -> None:
    factory = get_session_factory()
    async with factory() as session:
        # Demo user — the same person OIDC bootstraps into acme-corp.
        user = (
            await session.execute(select(User).where(User.email == DEMO_EMAIL))
        ).scalar_one_or_none()
        if user is None:
            print(f"✗ User {DEMO_EMAIL} not found — sign in once first.")
            return

        # Workspace — idempotent.
        existing = (
            await session.execute(select(Tenant).where(Tenant.slug == WORKSPACE_SLUG))
        ).scalar_one_or_none()
        if existing is not None:
            tenant = existing
            print(f"  → {WORKSPACE_SLUG} workspace already exists")
        else:
            tenant = Tenant(
                id=uuid4(),
                name=WORKSPACE_NAME,
                slug=WORKSPACE_SLUG,
                status="active",
                settings={
                    "plan": "enterprise",
                    "region": "us-east-1",
                    "logo_url": None,
                },
            )
            session.add(tenant)
            await session.flush()
            print(f"✓ Created workspace: {tenant.name} ({tenant.id})")

        # Mirror the demo user into the new workspace so /auth/me and
        # tenant-switch flows work for the seeded tenant too.
        already_mirrored = (
            await session.execute(
                select(User).where(
                    User.keycloak_sub == user.keycloak_sub,
                    User.tenant_id == tenant.id,
                )
            )
        ).scalar_one_or_none()
        if already_mirrored is None:
            mirror = User(
                tenant_id=tenant.id,
                keycloak_sub=user.keycloak_sub,
                email=user.email,
                display_name=user.display_name,
                mfa_enabled=user.mfa_enabled,
                role_ids=list(user.role_ids or []),
                profile=dict(user.profile or {}),
            )
            session.add(mirror)
            print(f"✓ Mirrored {user.email} as owner of {tenant.slug}")
        else:
            print(f"  → {user.email} already mirrored into {tenant.slug}")

        await session.commit()

        # Best-effort LiteLLM team sync — must NOT block seed.
        try:
            from app.services.team_sync import (  # noqa: PLC0415
                ensure_team_for_tenant,
            )

            await ensure_team_for_tenant(
                tenant_id=str(tenant.id),
                tenant_name=tenant.name,
                max_budget=100.0,
            )
            print("✓ LiteLLM team synced")
        except Exception as exc:  # noqa: BLE001 — best-effort
            logger.warning(
                "seed.litellm_sync_failed",
                tenant_id=str(tenant.id),
                error=str(exc),
            )

    print("\n✅ Workspaces seeded. The TenantSwitcher dropdown should now show two workspaces.")


if __name__ == "__main__":
    asyncio.run(seed())
