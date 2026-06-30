"""Connector Credential vault routes (Step 55).

Step-55-v2 Zone 2 — adds the Credentials-tab endpoints the frontend
already calls (`GET /connectors/credentials`, `POST`, `/{id}/reveal`,
`/{id}/rotate`, `DELETE`). Mounted on the same router-prefix as
``connectors.py`` so the URL space stays consistent.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.connector_credentials import (
    ConnectorCredentialCreate,
    ConnectorCredentialRead,
    ConnectorCredentialReveal,
)
from app.services.credential_vault import credential_vault

router = APIRouter(prefix="/connectors/credentials", tags=["connectors"])


@router.get("", response_model=list[ConnectorCredentialRead])
@audit(action="connector.credentials.list", target_type="connector_credential")
async def list_credentials(
    principal: Principal,
    connector_id: UUID | None = Query(default=None),
    _perm: Principal = require_permission("connectors:read"),
) -> list[ConnectorCredentialRead]:
    rows = await credential_vault.list_for_tenant(
        tenant_id=principal.tenant_id,
        connector_id=connector_id,
    )
    return [ConnectorCredentialRead.model_validate(r) for r in rows]


@router.post("", response_model=ConnectorCredentialRead, status_code=201)
@audit(action="connector.credentials.create", target_type="connector_credential")
async def create_credential(
    body: ConnectorCredentialCreate,
    principal: Principal,
    _perm: Principal = require_permission("connectors:create"),
) -> ConnectorCredentialRead:
    cred = await credential_vault.create(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        connector_id=body.connector_id,
        name=body.name,
        type=body.type,
        scope=body.scope,
        secret=body.secret,
        meta=body.meta,
        expires_at=body.expires_at,
        rotation_reminder_days=body.rotation_reminder_days,
        actor_id=principal.user_id,
    )
    return ConnectorCredentialRead.model_validate(cred)


@router.post("/{credential_id}/reveal", response_model=ConnectorCredentialReveal)
@audit(action="connector.credentials.reveal", target_type="connector_credential")
async def reveal_credential(
    credential_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("connectors:read"),
) -> ConnectorCredentialReveal:
    try:
        result = await credential_vault.reveal(
            credential_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return ConnectorCredentialReveal(
        id=result.id,
        secret=result.secret,
        expires_at=result.expires_at,
        rotated_at=result.rotated_at,
    )


@router.post("/{credential_id}/rotate", response_model=ConnectorCredentialRead)
@audit(action="connector.credentials.rotate", target_type="connector_credential")
async def rotate_credential(
    credential_id: UUID,
    body: dict,
    principal: Principal,
    _perm: Principal = require_permission("connectors:update"),
) -> ConnectorCredentialRead:
    new_secret = str(body.get("secret") or "")
    if not new_secret:
        raise HTTPException(status_code=400, detail="secret is required")
    try:
        cred = await credential_vault.rotate(
            credential_id,
            tenant_id=principal.tenant_id,
            new_secret=new_secret,
            actor_id=principal.user_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return ConnectorCredentialRead.model_validate(cred)


@router.delete(
    "/{credential_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
@audit(action="connector.credentials.revoke", target_type="connector_credential")
async def revoke_credential(
    credential_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("connectors:delete"),
) -> None:
    try:
        await credential_vault.revoke(
            credential_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


__all__ = ["router"]
