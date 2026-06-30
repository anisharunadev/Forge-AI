#!/usr/bin/env python3
"""Mint a dev-only HS256 access token that satisfies ``get_current_principal``.

Bypasses Keycloak entirely for verification scripts. Reads tenant + user
data from the seeded ``acme-corp`` tenant and ``arun@acme-corp.com``
user, then encodes a JWT signed with the same ``JWT_SECRET`` the backend
uses to verify tokens. This avoids the Keycloak password-grant
dependency, which is misconfigured in local dev (the realm has no
client secret substituted for ``${FORGE_BACKEND_CLIENT_SECRET}``).

Run inside the backend container:

    docker compose exec backend python -m scripts.issue_dev_token

Prints the bearer token to stdout. Production must use the real OIDC
flow via ``POST /auth/oidc/callback`` — this helper exists ONLY so the
step-56 smoke tests can run end-to-end.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

from jose import jwt
from sqlalchemy import select

from app.core.config import settings
from app.db.session import get_session_factory
from app.db.models.tenant import Tenant
from app.db.models.user import User


def main() -> int:
    factory = get_session_factory()

    # Silence the db.engine.create log line — the test harness parses the
    # script's stdout as the bearer token and any extra lines break it.
    # structlog sends JSON to stdout by default in dev; force everything
    # to stderr so the only stdout content is the JWT.
    import logging
    import sys
    logging.getLogger("app.db.session").setLevel(logging.WARNING)
    # structlog wraps the stdlib root logger; redirect the root to stderr.
    handler = logging.StreamHandler(sys.stderr)
    logging.getLogger().handlers = [handler]
    logging.getLogger().setLevel(logging.WARNING)

    async def _run() -> str:
        async with factory() as session:
            tenant = (
                await session.execute(
                    select(Tenant).where(Tenant.slug == "acme-corp")
                )
            ).scalars().first()
            if tenant is None:
                print("✗ Tenant acme-corp not seeded", file=sys.stderr)
                return ""
            user = (
                await session.execute(
                    select(User).where(User.email == "arun@acme-corp.com")
                )
            ).scalars().first()
            if user is None:
                print("✗ User arun@acme-corp.com not seeded", file=sys.stderr)
                return ""

        project_id = str(tenant.id)  # demo tenant: project == tenant
        now = datetime.now(tz=timezone.utc)
        claims = {
            "sub": str(user.id),
            "email": user.email,
            "forge.tenant": str(tenant.id),
            "forge.project": project_id,
            "role": getattr(user, "role", "admin") or "admin",
            "type": "access",
            "iat": now,
            "exp": now + timedelta(hours=2),
        }
        return jwt.encode(
            claims,
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
        )

    import asyncio

    token = asyncio.run(_run())
    if not token:
        return 1
    print(token)
    return 0


if __name__ == "__main__":
    sys.exit(main())


__all__ = ["main"]