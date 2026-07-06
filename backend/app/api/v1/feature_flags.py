"""Step-73 — Per-tenant feature flags.

Settings → Feature Flags tab. Two-tier merge:

  1. System defaults (``app/services/feature_flag_catalog.py``)
  2. Per-tenant overrides (``Tenant.settings['feature_flags']``)

The runtime merge is system-first, tenant-overrides-second (later
wins). PATCH writes only the override; the system tier is immutable
from this surface.

Permission gate: ``tenants:manage`` (only tenant admins can flip
feature flags). Implementation inline — extracting to a service
module is overkill for two endpoints.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import require_permission
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.feature_flag_catalog import get_catalog

logger = get_logger(__name__)

router = APIRouter(prefix="/feature-flags", tags=["feature-flags"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class FeatureFlag(BaseModel):
    key: str
    value: bool | int | str
    type: str
    description: str
    updated_at: str | None  # ISO timestamp if tenant override exists


class FeatureFlagUpdate(BaseModel):
    value: bool | int | str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[FeatureFlag])
async def list_feature_flags(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:read")),
) -> list[FeatureFlag]:
    """Merge system + tenant overrides; expose all known keys."""
    catalog = get_catalog()
    tenant_overrides = await _load_overrides(principal)
    flags: list[FeatureFlag] = []
    for key, spec in catalog.items():
        if key in tenant_overrides:
            row = tenant_overrides[key]
            flags.append(
                FeatureFlag(
                    key=key,
                    value=row["value"],
                    type=spec["type"],
                    description=spec["description"],
                    updated_at=row.get("updated_at"),
                )
            )
        else:
            flags.append(
                FeatureFlag(
                    key=key,
                    value=spec["default"],
                    type=spec["type"],
                    description=spec["description"],
                    updated_at=None,
                )
            )
    return flags


@require_approval_phase(SDLCPhase.PLANNING)
@router.patch("/{key}", response_model=FeatureFlag)
async def patch_feature_flag(
    key: str,
    body: FeatureFlagUpdate,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> FeatureFlag:
    """Set a per-tenant override for ``key``.

    Validates type against the catalog. Returns 404 if the key is not in
    the catalog (we don't want callers inventing flag names).
    """
    catalog = get_catalog()
    spec = catalog.get(key)
    if spec is None:
        raise HTTPException(status_code=404, detail="unknown_feature_flag")
    if not _value_matches_type(body.value, spec["type"]):
        raise HTTPException(
            status_code=400,
            detail=f"value_type_mismatch:{spec['type']}",
        )

    factory = get_session_factory()
    async with factory() as session:
        tenant_row = await session.get(Tenant, UUID(principal.tenant_id))
        if tenant_row is None:
            raise HTTPException(status_code=404, detail="tenant_not_found")
        settings = dict(tenant_row.settings or {})
        overrides = dict(settings.get("feature_flags") or {})
        overrides[key] = {
            "value": body.value,
            "updated_at": None,  # filled below
        }
        settings["feature_flags"] = overrides
        tenant_row.settings = settings
        await session.commit()
        await session.refresh(tenant_row)

    # Re-read to grab DB-side updated_at when the row has one.
    overrides = (tenant_row.settings or {}).get("feature_flags", {})
    updated_at = overrides.get(key, {}).get("updated_at")
    logger.info(
        "feature_flags.override_set",
        tenant_id=principal.tenant_id,
        key=key,
    )
    return FeatureFlag(
        key=key,
        value=body.value,
        type=spec["type"],
        description=spec["description"],
        updated_at=updated_at,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_overrides(principal: AuthenticatedPrincipal) -> dict[str, dict[str, Any]]:
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(Tenant.settings).where(Tenant.id == UUID(principal.tenant_id))
            )
        ).first()
    if rows is None or rows[0] is None:
        return {}
    return dict(rows[0].get("feature_flags") or {})


def _value_matches_type(value: Any, type_name: str) -> bool:
    if type_name == "bool":
        return isinstance(value, bool)
    if type_name == "int":
        return isinstance(value, int) and not isinstance(value, bool)
    if type_name == "str":
        return isinstance(value, str)
    return False


__all__ = ["router", "FeatureFlag", "FeatureFlagUpdate"]
