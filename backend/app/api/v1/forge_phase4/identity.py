"""F18 — Identity HTTP surface (SSO + SCIM + OAuth + JWT)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.deps import require_permission
from app.core.security import AuthenticatedPrincipal
from app.services.phase4_identity import (
    configure_sso,
    create_jwt_key,
    delete_jwt_key,
    get_sso_config,
    jwks,
    list_jwt_keys,
    list_oauth_clients,
    oauth_authorization_server_metadata,
    openid_configuration,
    register_oauth_client,
    revoke_oauth_client,
    rotate_jwt_key,
    rotate_scim_token,
    scim_status,
    sso_readiness,
    sso_test_connection,
)
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

router = APIRouter(prefix="/identity", tags=["phase4-identity"])


# ── Schemas ──────────────────────────────────────────────────────────


class SsoConfigIn(BaseModel):
    provider: str
    issuer_url: str
    client_id: str
    client_secret: str
    claim_mapping: dict[str, Any] | None = None
    scopes: list[str] | None = None
    enabled: bool = True


class OAuthClientIn(BaseModel):
    name: str
    redirect_uris: list[str]
    scopes: list[str] = Field(default_factory=lambda: ["forge.chat"])


# ── SSO ──────────────────────────────────────────────────────────────


@router.get("/sso/status")
async def sso_status(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    cfg = await get_sso_config(principal.tenant_id)
    readiness = await sso_readiness(principal.tenant_id)
    return {"config": cfg, "readiness": readiness}
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/sso/configure")
async def sso_configure(
    body: SsoConfigIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await configure_sso(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        provider=body.provider,
        issuer_url=body.issuer_url,
        client_id=body.client_id,
        client_secret=body.client_secret,
        claim_mapping=body.claim_mapping,
        scopes=body.scopes,
        enabled=body.enabled,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/sso/test")
async def sso_test(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await sso_test_connection(principal.tenant_id)


# ── SCIM ─────────────────────────────────────────────────────────────


@router.get("/scim/status")
async def scim_status_ep(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return await scim_status(principal.tenant_id)
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/scim/token")
async def scim_rotate(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await rotate_scim_token(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
    )


# ── OAuth clients ────────────────────────────────────────────────────


@router.get("/oauth/clients")
async def oauth_clients_list(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return {"clients": await list_oauth_clients(principal.tenant_id)}
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/oauth/clients")
async def oauth_clients_register(
    body: OAuthClientIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await register_oauth_client(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        name=body.name,
        redirect_uris=body.redirect_uris,
        scopes=body.scopes,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.delete("/oauth/clients/{client_id}")
async def oauth_clients_revoke(
    client_id: UUID,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    await revoke_oauth_client(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        client_db_id=client_id,
    )
    return {"revoked": True}


# ── JWT signing keys ─────────────────────────────────────────────────


@router.get("/jwt/keys")
async def jwt_keys_list(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return {"keys": await list_jwt_keys()}
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/jwt/keys")
async def jwt_keys_create(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await create_jwt_key(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.post("/jwt/keys/rotate")
async def jwt_keys_rotate(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await rotate_jwt_key(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
    )
@require_approval_phase(SDLCPhase.PLANNING)


@router.delete("/jwt/keys/{key_id}")
async def jwt_keys_delete(
    key_id: UUID,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    await delete_jwt_key(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        key_id=key_id,
    )
    return {"deleted": True}


# ── Discovery (public, no auth) ──────────────────────────────────────


def mount_identity_discovery(app: Any) -> None:
    """Mount ``/.well-known/*`` on the root app."""

    async def _oidc(request: Request) -> dict[str, Any]:
        return openid_configuration(str(request.base_url).rstrip("/"))

    async def _jwks() -> dict[str, Any]:
        return await jwks()

    async def _oauth_metadata(request: Request) -> dict[str, Any]:
        return oauth_authorization_server_metadata(str(request.base_url).rstrip("/"))

    app.add_api_route(
        "/.well-known/openid-configuration",
        _oidc,
        methods=["GET"],
        include_in_schema=False,
    )
    app.add_api_route(
        "/.well-known/jwks.json",
        _jwks,
        methods=["GET"],
        include_in_schema=False,
    )
    app.add_api_route(
        "/.well-known/oauth-authorization-server",
        _oauth_metadata,
        methods=["GET"],
        include_in_schema=False,
    )


__all__ = ["router", "mount_identity_discovery"]