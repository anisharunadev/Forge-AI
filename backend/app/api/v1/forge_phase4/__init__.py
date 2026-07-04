"""step-80 — Phase 4 API package.

Each sub-router is mounted under ``/api/v1/forge/<domain>`` via
``app/api/v1/router.py``. Top-level pass-through / discovery / A2A
paths (``/openai/*``, ``/.well-known/*``, ``/a2a/*``) are mounted
directly on ``app`` in ``main.py`` via the ``mount_*`` helpers below.

Build order: cache → pass_through → identity → ops → realtime.
"""

from typing import Any

from fastapi import APIRouter

# F19 — Cache
from app.api.v1.forge_phase4.cache import router as cache_router

# F18 — Identity
from app.api.v1.forge_phase4.identity import (
    mount_identity_discovery,
)
from app.api.v1.forge_phase4.identity import (
    router as identity_router,
)
from app.api.v1.forge_phase4.media import router as media_router

# F20 — Ops / Credentials / Vault / FinOps / Settings
from app.api.v1.forge_phase4.ops import router as ops_router
from app.api.v1.forge_phase4.passthrough import (
    mount_passthrough,
)
from app.api.v1.forge_phase4.passthrough import (
    router as passthrough_router,
)

# F16 — Providers (admin) + Pass-through proxy + Media
from app.api.v1.forge_phase4.providers import router as providers_router

# F17 — Realtime / A2A / Sessions
from app.api.v1.forge_phase4.sessions import (
    mount_a2a,
)
from app.api.v1.forge_phase4.sessions import (
    router as sessions_router,
)

router = APIRouter(prefix="/forge", tags=["phase4"])
router.include_router(cache_router)
router.include_router(providers_router)
router.include_router(passthrough_router)
router.include_router(media_router)
router.include_router(identity_router)
router.include_router(ops_router)
router.include_router(sessions_router)

# M1 T1.8 — module-level flag the top-level ``/healthz`` route (T1.3)
# reads to confirm Phase 4 was wired in. Flipped by
# :func:`mount_phase4_top_level` (defined below) once the top-level
# pass-through / identity / A2A routers are mounted on ``app``.
# Declared here (after imports and after the include_router calls)
# so a missing main.py call surfaces as
# ``forge_phase4_mounted == False`` at /healthz time rather than a
# NameError. Read directly by ``app.api.healthz.healthz``.
forge_phase4_mounted: bool = False


@router.get("/_phase4/health", include_in_schema=False)
async def phase4_health() -> dict[str, str]:
    """Confirm the Phase 4 package is mounted and importable."""
    return {"status": "ok", "package": "forge_phase4"}


def mount_phase4_top_level(app: Any) -> None:
    """Mount Phase 4 routes that live at app root, not under /api/v1/forge.

    Called from ``app/main.py`` after the v1 routers are included.
    Idempotent: subsequent calls are no-ops so a refactor that adds a
    second ``app`` (e.g. for A/B testing) does not double-mount.
    """
    global forge_phase4_mounted  # noqa: PLW0603 — module-level flag is the documented contract for the /healthz probe.
    if forge_phase4_mounted:
        return
    mount_passthrough(app)
    mount_identity_discovery(app)
    mount_a2a(app)
    forge_phase4_mounted = True


__all__ = ["router", "mount_phase4_top_level", "forge_phase4_mounted"]