"""F-007 — Connectors REST endpoints."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.connectors import (
    ConnectorCreate,
    ConnectorRead,
    ConnectorSyncHistoryRead,
    ConnectorUpdate,
)
from app.services.connector_manager import connector_manager

router = APIRouter(prefix="/connectors", tags=["connectors"])


@router.get("", response_model=list[ConnectorRead])
@audit(action="connectors.list", target_type="connector")
async def list_connectors(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("connectors:read")),
) -> list[ConnectorRead]:
    rows = await connector_manager.list_connectors(
        principal.tenant_id,
        project_id=project_id or principal.project_id,
    )
    return [ConnectorRead.model_validate(r) for r in rows]


@router.get("/{connector_id}", response_model=ConnectorRead)
@audit(action="connectors.get", target_type="connector")
async def get_connector(
    connector_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("connectors:read")),
) -> ConnectorRead:
    try:
        connector = await connector_manager.get_connector(
            connector_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ConnectorRead.model_validate(connector)


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post("", response_model=ConnectorRead, status_code=status.HTTP_201_CREATED)
@audit(action="connectors.create", target_type="connector")
async def create_connector(
    body: ConnectorCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("connectors:create")),
) -> ConnectorRead:
    connector = await connector_manager.create_connector(
        tenant_id=principal.tenant_id,
        project_id=body.project_id or principal.project_id,
        name=body.name,
        type=body.type,
        config=body.config,
        actor_id=principal.user_id,
    )
    return ConnectorRead.model_validate(connector)


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.patch("/{connector_id}", response_model=ConnectorRead)
@audit(action="connectors.update", target_type="connector")
async def update_connector(
    connector_id: UUID,
    body: ConnectorUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("connectors:update")),
) -> ConnectorRead:
    try:
        await connector_manager.get_connector(connector_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    updated = await connector_manager.update_connector(
        connector_id,
        name=body.name,
        config=body.config,
        status=body.status,
        actor_id=principal.user_id,
    )
    return ConnectorRead.model_validate(updated)


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.delete(
    "/{connector_id}",
    response_model=None,
    response_class=Response,
)
@audit(action="connectors.delete", target_type="connector")
@audit(action="connectors.delete", target_type="connector")
async def delete_connector(
    connector_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("connectors:delete")),
):
    try:
        await connector_manager.get_connector(connector_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    quarantined = await connector_manager.delete_connector(connector_id, actor_id=principal.user_id)
    return ConnectorRead.model_validate(quarantined)


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post("/{connector_id}/sync", response_model=ConnectorSyncHistoryRead)
@audit(action="connectors.sync", target_type="connector")
async def trigger_sync(
    connector_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("connectors:sync")),
) -> ConnectorSyncHistoryRead:
    try:
        await connector_manager.get_connector(connector_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    history = await connector_manager.trigger_sync(connector_id, actor_id=principal.user_id)
    return ConnectorSyncHistoryRead.model_validate(history)


@router.get("/{connector_id}/history", response_model=list[ConnectorSyncHistoryRead])
@audit(action="connectors.history", target_type="connector")
async def get_history(
    connector_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    limit: int = Query(default=50, ge=1, le=500),
    _perm: AuthenticatedPrincipal = Depends(require_permission("connectors:read")),
) -> list[ConnectorSyncHistoryRead]:
    try:
        await connector_manager.get_connector(connector_id, tenant_id=principal.tenant_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    history = await connector_manager.get_sync_history(connector_id, limit=limit)
    return [ConnectorSyncHistoryRead.model_validate(h) for h in history]


# NOTE: POST /connectors/{connector_id}/test is owned by
# `connector_lifecycle.router` (it persists a ConnectorHealthHistory row).
# Registering it here too would raise a duplicate-route error at startup.
