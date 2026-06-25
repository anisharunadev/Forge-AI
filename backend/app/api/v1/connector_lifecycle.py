"""Connector Lifecycle REST endpoints (Pillar 1 — Phase 4).

Thin HTTP wrapper over :class:`ConnectorLifecycle`. Each endpoint
performs the RBAC check first (so a denied caller never reaches the
service), then delegates.

Routes
------

- ``POST /connectors/install``  RBAC ``connector:install``  (Eng Lead only)
- ``POST /connectors/{id}/rotate``  RBAC ``connector:rotate``
- ``POST /connectors/{id}/test``   RBAC ``connector:read``    (broadest)

The existing ``/connectors`` endpoints (Phase 1) handle list/get/create
already; this router adds the lifecycle verbs and keeps them under a
distinct path so the Phase 1 surface is preserved.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.connectors import ConnectorRead, ConnectorTestResult
from app.services.connectors.lifecycle import connector_lifecycle

router = APIRouter(prefix="/connectors", tags=["connectors"])


@router.post("/install", response_model=ConnectorRead, status_code=201)
@audit(action="connector.install", target_type="connector")
async def install_connector(
    body: dict,
    principal: Principal,
    _perm: Principal = require_permission("connector:install"),
) -> ConnectorRead:
    """Install a new connector and immediately probe it."""
    from app.db.models.connector import ConnectorType

    try:
        connector_type = ConnectorType(body["type"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    config = dict(body.get("config") or {})
    project_id = body.get("project_id") or principal.project_id
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")

    connector = await connector_lifecycle.install(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        connector_type=connector_type,
        name=name,
        config=config,
        actor_id=principal.user_id,
    )
    return ConnectorRead.model_validate(connector)


@router.post("/{connector_id}/rotate", response_model=ConnectorRead)
@audit(action="connector.rotate", target_type="connector")
async def rotate_connector(
    connector_id: UUID,
    body: dict,
    principal: Principal,
    _perm: Principal = require_permission("connector:rotate"),
) -> ConnectorRead:
    """Rotate credentials on an existing connector."""
    new_credentials = dict(body.get("new_credentials") or {})
    if not new_credentials:
        raise HTTPException(status_code=400, detail="new_credentials is required")
    try:
        connector = await connector_lifecycle.rotate(
            connector_id=connector_id,
            new_credentials=new_credentials,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return ConnectorRead.model_validate(connector)


@router.post("/{connector_id}/test", response_model=ConnectorTestResult)
@audit(action="connector.test", target_type="connector")
async def test_connector(
    connector_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("connector:read"),
) -> ConnectorTestResult:
    """Probe a connector's reachability + record a health-history row."""
    try:
        result = await connector_lifecycle.test(
            connector_id=connector_id,
            tenant_id=principal.tenant_id,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return ConnectorTestResult(
        connector_id=result.connector_id,
        ok=result.ok,
        latency_ms=result.latency_ms,
        detail=result.detail,
        checked_at=result.checked_at,
    )


__all__ = ["router"]
