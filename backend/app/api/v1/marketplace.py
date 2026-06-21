"""F-015 — Connector Marketplace REST endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.marketplace import (
    MarketplaceConnectorRead,
    MarketplaceInstallRequest,
    MarketplaceInstallResult,
)
from app.services.connector_manager import connector_manager
from app.services.marketplace import marketplace
from app.schemas.connectors import ConnectorRead

router = APIRouter(prefix="/marketplace/connectors", tags=["marketplace"])


@router.get("", response_model=list[MarketplaceConnectorRead])
@audit(action="marketplace.list", target_type="marketplace_connector")
async def list_marketplace(
    principal: Principal,
    _perm: Principal = require_permission("marketplace:read"),
) -> list[MarketplaceConnectorRead]:
    rows = await marketplace.list_available()
    return [
        MarketplaceConnectorRead(
            slug=r.slug,
            name=r.name,
            type=r.type,
            description=r.description,
            config_schema=r.config_schema,
            icon=r.icon,
            version=r.version,
            author=r.author,
            downloads=r.downloads,
            rating=r.rating,
        )
        for r in rows
    ]


@router.get("/{slug}", response_model=MarketplaceConnectorRead)
@audit(action="marketplace.get", target_type="marketplace_connector")
async def get_marketplace_entry(
    slug: str,
    principal: Principal,
    _perm: Principal = require_permission("marketplace:read"),
) -> MarketplaceConnectorRead:
    try:
        entry = await marketplace.get_details(slug)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return MarketplaceConnectorRead(
        slug=entry.slug,
        name=entry.name,
        type=entry.type,
        description=entry.description,
        config_schema=entry.config_schema,
        icon=entry.icon,
        version=entry.version,
        author=entry.author,
        downloads=entry.downloads,
        rating=entry.rating,
    )


@router.post("/{slug}/install", response_model=MarketplaceInstallResult)
@audit(action="marketplace.install", target_type="connector")
async def install_marketplace(
    slug: str,
    body: MarketplaceInstallRequest,
    principal: Principal,
    _perm: Principal = require_permission("connectors:create"),
) -> MarketplaceInstallResult:
    try:
        entry, connector = await marketplace.install(
            slug,
            tenant_id=principal.tenant_id,
            project_id=body.project_id,
            name=body.name,
            config=body.config,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return MarketplaceInstallResult(
        slug=entry.slug,
        connector_id=connector.id,
        installed_at=datetime.now(timezone.utc).isoformat(),
    )


__all__ = ["router"]
