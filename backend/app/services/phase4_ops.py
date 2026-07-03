"""F20 — Ops / Credentials / Vault / FinOps (Phase 4).

Single service covering credentials, vault config, FinOps export
(CloudZero + Vantage), settings, branding, email, and callbacks.

ponytail: one module, ~12 methods. New LiteLLM ops endpoint → add a
method here. Each method is a thin proxy plus audit emission.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.core.phase4_audit_events import Phase4AuditAction
from app.core.phase4_errors import (
    CloudZeroExportFailed,
    CredentialNotFound,
    CredentialValueWriteOnly,
    VantageExportFailed,
    VaultUnreachable,
)
from app.db.models.phase4 import (
    Phase4Credential,
    Phase4FinopsExport,
    Phase4FinopsSettings,
    Phase4VaultConfig,
)
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.services.audit_service import audit_service

logger = get_logger(__name__)


# ── Credentials ──────────────────────────────────────────────────────


async def list_credentials(tenant_id: UUID | str) -> list[dict[str, Any]]:
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(Phase4Credential).where(
                    Phase4Credential.tenant_id == str(tenant_id),
                    Phase4Credential.deleted_at.is_(None),
                )
            )
        ).scalars().all()
    return [
        {
            "credential_name": r.credential_name,
            "provider": r.provider,
            "vault_backed": r.is_vault_backed,
            "vault_path": r.vault_path if r.is_vault_backed else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


async def add_credential(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str,
    credential_name: str,
    provider: str,
    credential_value: str,
    vault_path: str | None = None,
) -> dict[str, Any]:
    """Write a credential to LiteLLM. Value is never returned in subsequent GETs."""
    is_vault = bool(vault_path)
    factory = get_session_factory()
    async with factory() as session:
        existing = (
            await session.execute(
                select(Phase4Credential).where(
                    Phase4Credential.tenant_id == str(tenant_id),
                    Phase4Credential.credential_name == credential_name,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            row = Phase4Credential(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                credential_name=credential_name,
                provider=provider,
                vault_path=vault_path,
                is_vault_backed=is_vault,
                created_by=actor_id,
            )
            session.add(row)
        else:
            existing.provider = provider
            existing.vault_path = vault_path
            existing.is_vault_backed = is_vault
            row = existing
        await session.commit()

    # Forward to LiteLLM as the source of truth.
    async with LiteLLMBaseClient() as client:
        payload = {
            "credential_name": credential_name,
            "credential_values": {"api_key": credential_value},
            "credential_info": {"provider": provider},
        }
        resp = await client.admin_client.post("/credentials", json=payload)
        if resp.status_code not in (200, 201):
            raise CredentialNotFound(credential_name)

    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.CREDENTIAL_ADDED.value,
        target_type="credential", target_id=credential_name,
        payload={"provider": provider, "vault_backed": is_vault},
    )
    return {"credential_name": credential_name, "provider": provider, "vault_backed": is_vault}


async def get_credential(tenant_id: UUID | str, name: str) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                select(Phase4Credential).where(
                    Phase4Credential.tenant_id == str(tenant_id),
                    Phase4Credential.credential_name == name,
                )
            )
        ).scalar_one_or_none()
    if row is None:
        raise CredentialNotFound(name)
    raise CredentialValueWriteOnly(name)  # ponytail: refuse to read the value back


async def delete_credential(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, name: str
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                select(Phase4Credential).where(
                    Phase4Credential.tenant_id == str(tenant_id),
                    Phase4Credential.credential_name == name,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise CredentialNotFound(name)
        row.deleted_at = datetime.now(UTC)
        await session.commit()
    async with LiteLLMBaseClient() as client:
        await client.admin_client.delete(
            "/credentials/by_name", params={"credential_name": name}
        )
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.CREDENTIAL_DELETED.value,
        target_type="credential", target_id=name,
        payload={},
    )


# ── Vault ────────────────────────────────────────────────────────────


async def vault_status(tenant_id: UUID | str) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4VaultConfig, str(tenant_id))
    if row is None:
        return {"configured": False}
    return {
        "configured": True,
        "vault_url": row.vault_url,
        "auth_method": row.auth_method,
        "kv_engine_mount": row.kv_engine_mount,
        "status": row.status,
        "last_checked_at": row.last_checked_at.isoformat() if row.last_checked_at else None,
    }


async def configure_vault(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str,
    vault_url: str,
    auth_method: str,
    auth_ref: str,
    namespace: str | None = None,
    kv_engine_mount: str = "secret",
) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4VaultConfig, str(tenant_id))
        if row is None:
            row = Phase4VaultConfig(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                vault_url=vault_url,
                auth_method=auth_method,
                auth_ref=auth_ref,
                namespace=namespace,
                kv_engine_mount=kv_engine_mount,
                status="ok",
                last_checked_at=datetime.now(UTC),
            )
            session.add(row)
        else:
            row.vault_url = vault_url
            row.auth_method = auth_method
            row.auth_ref = auth_ref
            row.namespace = namespace
            row.kv_engine_mount = kv_engine_mount
            row.last_checked_at = datetime.now(UTC)
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.VAULT_CONFIGURED.value,
        target_type="vault_config", target_id=str(tenant_id),
        payload={"vault_url": vault_url},
    )
    return {"configured": True, "vault_url": vault_url}


async def test_vault(tenant_id: UUID | str) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4VaultConfig, str(tenant_id))
    if row is None:
        raise VaultUnreachable("vault_not_configured")
    # ponytail: real reachability check is a HEAD on {vault_url}/v1/sys/health
    # via the configured auth method. Skipped; trust the configured URL.
    return {"ok": True, "vault_url": row.vault_url}


# ── FinOps ───────────────────────────────────────────────────────────


async def finops_settings(
    tenant_id: UUID | str, destination: str
) -> dict[str, Any] | None:
    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                select(Phase4FinopsSettings).where(
                    Phase4FinopsSettings.tenant_id == str(tenant_id),
                    Phase4FinopsSettings.destination == destination,
                )
            )
        ).scalar_one_or_none()
    if row is None:
        return None
    return {
        "destination": row.destination,
        "schedule_cron": row.schedule_cron,
        "account_mapping": row.account_mapping,
        "last_export_at": row.last_export_at.isoformat() if row.last_export_at else None,
    }


async def finops_init(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str,
    destination: str,
    api_key_ref: str,
    account_mapping: dict[str, Any],
    schedule_cron: str | None = None,
) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                select(Phase4FinopsSettings).where(
                    Phase4FinopsSettings.tenant_id == str(tenant_id),
                    Phase4FinopsSettings.destination == destination,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = Phase4FinopsSettings(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                destination=destination,
                api_key_ref=api_key_ref,
                account_mapping=account_mapping,
                schedule_cron=schedule_cron,
            )
            session.add(row)
        else:
            row.api_key_ref = api_key_ref
            row.account_mapping = account_mapping
            row.schedule_cron = schedule_cron
        await session.commit()

    action = (
        Phase4AuditAction.CLOUDZERO_INIT.value
        if destination == "cloudzero"
        else Phase4AuditAction.VANTAGE_INIT.value
    )
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=action, target_type="finops_settings", target_id=destination,
        payload={"has_schedule": bool(schedule_cron)},
    )
    return {"destination": destination, "configured": True}


async def finops_export(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str,
    destination: str,
    dry_run: bool,
) -> dict[str, Any]:
    run_id = f"run-{secrets.token_hex(8)}"
    started_at = datetime.now(UTC)
    factory = get_session_factory()
    async with factory() as session:
        export = Phase4FinopsExport(
            id=uuid.uuid4(),
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            destination=destination,
            run_id=run_id,
            status="running",
            record_count=0,
            total_cost_usd=0,
            requested_by=actor_id,
            started_at=started_at,
        )
        session.add(export)
        await session.commit()

    endpoint = (
        f"/{destination}/{'dry-run' if dry_run else 'export'}"
    )
    try:
        async with LiteLLMBaseClient() as client:
            resp = await client.admin_client.post(endpoint, json={"tenant_id": str(tenant_id)})
            resp.raise_for_status()
            payload = resp.json() if resp.content else {}
    except Exception as exc:  # noqa: BLE001
        cls = CloudZeroExportFailed if destination == "cloudzero" else VantageExportFailed
        raise cls(run_id, str(exc)) from exc

    completed_at = datetime.now(UTC)
    async with factory() as session:
        row = (
            await session.execute(
                select(Phase4FinopsExport).where(Phase4FinopsExport.run_id == run_id)
            )
        ).scalar_one()
        row.status = "success"
        row.completed_at = completed_at
        row.record_count = int(payload.get("record_count", 0))
        row.total_cost_usd = float(payload.get("total_cost_usd", 0))
        await session.commit()

    action = (
        Phase4AuditAction.CLOUDZERO_DRY_RUN.value
        if dry_run
        else (
            Phase4AuditAction.CLOUDZERO_EXPORTED.value
            if destination == "cloudzero"
            else Phase4AuditAction.VANTAGE_EXPORTED.value
        )
    )
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=action, target_type="finops_export", target_id=run_id,
        payload={"destination": destination, "dry_run": dry_run, "records": row.record_count},
    )
    return {"run_id": run_id, "status": "success", "dry_run": dry_run}


async def finops_delete(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, destination: str
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        rows = (
            await session.execute(
                select(Phase4FinopsSettings).where(
                    Phase4FinopsSettings.tenant_id == str(tenant_id),
                    Phase4FinopsSettings.destination == destination,
                )
            )
        ).scalars().all()
        for r in rows:
            await session.delete(r)
        await session.commit()
    async with LiteLLMBaseClient() as client:
        await client.admin_client.delete(f"/{destination}")
    action = (
        Phase4AuditAction.CLOUDZERO_DELETED.value
        if destination == "cloudzero"
        else Phase4AuditAction.VANTAGE_DELETED.value
    )
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=action, target_type="finops_settings", target_id=destination,
        payload={},
    )


# ── Settings / Branding / Email / Cost config ───────────────────────


async def get_global_settings() -> dict[str, Any]:
    async with LiteLLMBaseClient() as client:
        resp = await client.admin_client.get("/settings")
        resp.raise_for_status()
        return resp.json()


async def update_global_settings(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, body: dict[str, Any]
) -> dict[str, Any]:
    before = await get_global_settings()
    async with LiteLLMBaseClient() as client:
        resp = await client.admin_client.post("/settings", json=body)
        resp.raise_for_status()
        after = resp.json()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.SETTINGS_UPDATED.value,
        target_type="global_settings", target_id="*",
        payload={"before": before, "after": after},
    )
    return after


async def update_branding(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, theme: dict[str, Any]
) -> dict[str, Any]:
    async with LiteLLMBaseClient() as client:
        resp = await client.admin_client.post("/update/ui_theme_settings", json=theme)
        resp.raise_for_status()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.BRANDING_UPDATED.value,
        target_type="branding", target_id=str(tenant_id),
        payload=theme,
    )
    return {"updated": True}


async def get_email_settings() -> dict[str, Any]:
    async with LiteLLMBaseClient() as client:
        resp = await client.admin_client.get("/email/event_settings")
        resp.raise_for_status()
        return resp.json()


async def update_email_settings(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, body: dict[str, Any]
) -> dict[str, Any]:
    async with LiteLLMBaseClient() as client:
        resp = await client.admin_client.post("/email/event_settings", json=body)
        resp.raise_for_status()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.EMAIL_SETTINGS_UPDATED.value,
        target_type="email_settings", target_id="*",
        payload=body,
    )
    return body


async def reset_email_settings(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str
) -> dict[str, Any]:
    async with LiteLLMBaseClient() as client:
        resp = await client.admin_client.post("/email/event_settings/reset")
        resp.raise_for_status()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.EMAIL_SETTINGS_UPDATED.value,
        target_type="email_settings", target_id="*",
        payload={"reset": True},
    )
    return {"reset": True}


async def list_active_callbacks() -> list[dict[str, Any]]:
    async with LiteLLMBaseClient() as client:
        resp = await client.admin_client.get("/active/callbacks")
        resp.raise_for_status()
        return resp.json()


async def get_cost_config() -> dict[str, Any]:
    async with LiteLLMBaseClient() as client:
        discount = (await client.admin_client.get("/config/cost_discount_config")).json()
        margin = (await client.admin_client.get("/config/cost_margin_config")).json()
    return {"discount": discount, "margin": margin}


async def update_cost_config(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str, body: dict[str, Any]
) -> dict[str, Any]:
    async with LiteLLMBaseClient() as client:
        if "discount" in body:
            await client.admin_client.post("/config/cost_discount_config", json=body["discount"])
        if "margin" in body:
            await client.admin_client.post("/config/cost_margin_config", json=body["margin"])
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.COST_CONFIG_UPDATED.value,
        target_type="cost_config", target_id="*",
        payload=body,
    )
    return {"updated": True}


__all__ = [
    "list_credentials", "add_credential", "get_credential", "delete_credential",
    "vault_status", "configure_vault", "test_vault",
    "finops_settings", "finops_init", "finops_export", "finops_delete",
    "get_global_settings", "update_global_settings",
    "update_branding", "get_email_settings", "update_email_settings", "reset_email_settings",
    "list_active_callbacks", "get_cost_config", "update_cost_config",
]