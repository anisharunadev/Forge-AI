"""Shared helpers for the smoke-test scripts in ``backend/scripts/test_*.py``.

Two things are extracted here because the four in-process scripts
that need them otherwise re-import the same boilerplate:

  * the acme-corp dev identity constants (tenant / user IDs and the
    seed user email) — see ``app/services/day_one_bootstrap.py``
    for the matching row
  * ``mint_dev_token`` — a small wrapper around ``jose.jwt.encode``
    that builds the same HS256 token the in-process scripts used
    to build inline. Kept in-process (not a subprocess to
    ``issue_dev_token``) because the in-process shape differs from
    the canonical one: the smoke tests authenticate as the hard-coded
    ``ACME_USER_ID`` regardless of which row is in the DB.

Per-script ``expect`` / ``probe`` / ``_call`` helpers stay in their
respective files: the return shapes differ (some return
``(ok, status, text)``, others return ``(ok, parsed_body)``, others
return ``(1|0, body)``), and forcing a single contract would change
behaviour for callers that depend on the variant.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from jose import jwt

# acme-corp tenant + recon seed user. These are the same values the
# ``app.services.day_one_bootstrap`` and ``seeds/framework`` write
# into the DB on first boot, so an HS256 token signed for them is
# accepted by the backend's ``get_current_principal`` (which only
# verifies the signature and the ``sub``/``forge.tenant`` claims).
ACME_TENANT_ID = "a6500631-1930-5afa-9d38-24de9bedcb37"
ACME_USER_ID = "00000000-0000-0000-0000-000000000999"
ACME_USER_EMAIL = "arun@acme-corp.com"


def mint_dev_token(*, forge_project_id: str | None = None) -> str:
    """Build an HS256 JWT the backend's ``get_current_principal`` accepts.

    Reads ``JWT_SECRET`` from the environment. The token carries the
    same claims the in-process smoke tests used to build by hand:
    ``sub``, ``email``, ``forge.tenant`` (plus a ``tenant_id`` alias
    for older code paths), ``forge.project``, ``realm_access.roles``,
    ``iat``, ``exp``. One-hour expiry.

    ``forge_project_id`` lets callers scope the token to a project
    (the backend's project-scoped queries filter on this claim). When
    ``None`` — the default — the token is tenant-scoped only, which
    is what the bulk of the smoke tests want.
    """
    secret = os.environ["JWT_SECRET"]
    now = datetime.now(timezone.utc)
    claims = {
        "sub": ACME_USER_ID,
        "email": ACME_USER_EMAIL,
        "forge.tenant": ACME_TENANT_ID,
        "tenant_id": ACME_TENANT_ID,
        "forge.project": forge_project_id,
        "realm_access": {"roles": ["forge-admin"]},
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
    }
    return jwt.encode(claims, secret, algorithm="HS256")
