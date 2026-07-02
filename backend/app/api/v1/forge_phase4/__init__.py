"""step-80 — Phase 4 API package.

Each sub-router is mounted under ``/api/v1/forge_phase4/<domain>`` via
``app/api/v1/router.py``. Top-level pass-through / SCIM / A2A paths
(``/openai/*``, ``/anthropic/*``, ``/.well-known/*``, ``/scim/v2/*``,
``/a2a/*``) are mounted directly on ``app`` in ``main.py``.

ponytail: one package, 10 router stubs. Each returns 501 with a TODO
pointer until the service is implemented. Replace stubs with real
handlers as each feature lands (build order: cache → pass_through →
identity → ops → realtime).
"""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse


def _stub(name: str) -> JSONResponse:
    """Single helper for all not-implemented-yet endpoints."""
    return JSONResponse(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        content={
            "error": "NOT_IMPLEMENTED",
            "feature": name,
            "message": f"Phase 4 {name} ships in a follow-up commit (see plan).",
        },
    )


router = APIRouter(prefix="/forge", tags=["phase4"])


@router.get("/_phase4/health", include_in_schema=False)
async def phase4_health() -> dict[str, str]:
    """Confirm the Phase 4 package is mounted and importable."""
    return {"status": "ok", "package": "forge_phase4"}


__all__ = ["router", "_stub"]