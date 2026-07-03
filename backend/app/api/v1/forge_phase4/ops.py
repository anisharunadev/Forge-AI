"""F20 — Ops / Credentials / Vault / FinOps / Settings HTTP surface."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import require_permission
from app.core.security import AuthenticatedPrincipal
from app.services.phase4_ops import (
    add_credential,
    configure_vault,
    delete_credential,
    finops_delete,
    finops_export,
    finops_init,
    finops_settings,
    get_cost_config,
    get_credential,
    get_email_settings,
    get_global_settings,
    list_active_callbacks,
    list_credentials,
    reset_email_settings,
    test_vault,
    update_branding,
    update_cost_config,
    update_email_settings,
    update_global_settings,
    vault_status,
)

router = APIRouter(prefix="/ops", tags=["phase4-ops"])


# ── Schemas ──────────────────────────────────────────────────────────


class CredentialIn(BaseModel):
    credential_name: str
    provider: str
    credential_value: str = Field(description="Write-only. Never returned.")
    vault_path: str | None = None


class VaultConfigIn(BaseModel):
    vault_url: str
    auth_method: str = "token"
    auth_ref: str
    namespace: str | None = None
    kv_engine_mount: str = "secret"


class FinopsInitIn(BaseModel):
    api_key_ref: str
    account_mapping: dict[str, Any] = Field(default_factory=dict)
    schedule_cron: str | None = None


# ── Credentials ──────────────────────────────────────────────────────


@router.get("/credentials")
async def creds_list(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return {"credentials": await list_credentials(principal.tenant_id)}


@router.post("/credentials")
async def creds_add(
    body: CredentialIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await add_credential(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        credential_name=body.credential_name,
        provider=body.provider,
        credential_value=body.credential_value,
        vault_path=body.vault_path,
    )


@router.get("/credentials/{name}")
async def creds_get(
    name: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    # Spec: never return the value — refuse with CredentialValueWriteOnly.
    return await get_credential(principal.tenant_id, name)


@router.delete("/credentials/{name}")
async def creds_delete(
    name: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    await delete_credential(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        name=name,
    )
    return {"deleted": True}


# ── Vault ────────────────────────────────────────────────────────────


@router.get("/vault/status")
async def vault_status_ep(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await vault_status(principal.tenant_id)


@router.post("/vault/configure")
async def vault_configure(
    body: VaultConfigIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await configure_vault(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        vault_url=body.vault_url,
        auth_method=body.auth_method,
        auth_ref=body.auth_ref,
        namespace=body.namespace,
        kv_engine_mount=body.kv_engine_mount,
    )


@router.post("/vault/test")
async def vault_test(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await test_vault(principal.tenant_id)


# ── FinOps ───────────────────────────────────────────────────────────


@router.get("/finops/{destination}/settings")
async def finops_settings_ep(
    destination: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    if destination not in {"cloudzero", "vantage"}:
        return {"configured": False}
    return await finops_settings(principal.tenant_id, destination) or {"configured": False}


@router.post("/finops/{destination}/init")
async def finops_init_ep(
    destination: str,
    body: FinopsInitIn,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    if destination not in {"cloudzero", "vantage"}:
        return {"configured": False}
    return await finops_init(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        destination=destination,
        api_key_ref=body.api_key_ref,
        account_mapping=body.account_mapping,
        schedule_cron=body.schedule_cron,
    )


@router.post("/finops/{destination}/dry-run")
async def finops_dry_run_ep(
    destination: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    if destination not in {"cloudzero", "vantage"}:
        return {"error": "unknown_destination"}
    return await finops_export(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        destination=destination,
        dry_run=True,
    )


@router.post("/finops/{destination}/export")
async def finops_export_ep(
    destination: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    if destination not in {"cloudzero", "vantage"}:
        return {"error": "unknown_destination"}
    return await finops_export(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        destination=destination,
        dry_run=False,
    )


@router.delete("/finops/{destination}")
async def finops_delete_ep(
    destination: str,
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    if destination not in {"cloudzero", "vantage"}:
        return {"error": "unknown_destination"}
    await finops_delete(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        destination=destination,
    )
    return {"deleted": True}


# ── Settings / Branding / Email / Cost ──────────────────────────────


@router.get("/settings")
async def settings_get(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return await get_global_settings()


@router.patch("/settings")
async def settings_patch(
    body: dict[str, Any],
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await update_global_settings(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        body=body,
    )


@router.patch("/branding/theme")
async def branding_theme(
    body: dict[str, Any],
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await update_branding(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        theme=body,
    )


@router.get("/email/settings")
async def email_get(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await get_email_settings()


@router.patch("/email/settings")
async def email_patch(
    body: dict[str, Any],
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await update_email_settings(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        body=body,
    )


@router.post("/email/settings/reset")
async def email_reset(
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await reset_email_settings(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
    )


@router.get("/callbacks")
async def callbacks_list(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return {"callbacks": await list_active_callbacks()}


@router.get("/cost/config")
async def cost_get(
    principal: AuthenticatedPrincipal = Depends(require_permission("forge:read")),
) -> dict[str, Any]:
    return await get_cost_config()


@router.patch("/cost/config")
async def cost_patch(
    body: dict[str, Any],
    principal: AuthenticatedPrincipal = Depends(require_permission("tenants:manage")),
) -> dict[str, Any]:
    return await update_cost_config(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=principal.user_id,
        body=body,
    )


__all__ = ["router"]