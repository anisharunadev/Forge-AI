"""F16 — Provider Pass-through catalog and tenant enablement.

Per-tenant enablement is two-tier:

  * System default: ``feature_flag_catalog`` key ``forge.pass_through.enabled``
  * Per-provider overrides: ``Tenant.settings['feature_flags']`` keys of the
    shape ``forge.provider.<name>.enabled``.

The runtime check is: provider feature flag enabled AND
``forge.pass_through.enabled`` enabled for the tenant.

ponytail: one module, three public functions (``list_providers``,
``is_enabled``, ``set_provider_enabled``). Keep provider list here so
the admin endpoint and the proxy handler agree on what's allowed.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.core.phase4_audit_events import Phase4AuditAction
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.audit_service import audit_service

logger = get_logger(__name__)


#: Static provider catalog — maps our short name to the LiteLLM upstream
#: mount prefix. When a new provider is added to LiteLLM, add it here.
#: ponytail: keep alphabetical for grep-ability.
PROVIDERS: dict[str, dict[str, Any]] = {
    "openai": {
        "display": "OpenAI",
        "upstream": "/openai",
        "wire": "openai",
        "streaming": True,
        "headers": ["anthropic-version"],  # unused but reserved
    },
    "openai_passthrough": {
        "display": "OpenAI (passthrough)",
        "upstream": "/openai_passthrough",
        "wire": "openai",
        "streaming": True,
    },
    "openai_deployments": {
        "display": "Azure OpenAI (deployments)",
        "upstream": "/openai/deployments",
        "wire": "openai",
        "streaming": True,
    },
    "anthropic": {
        "display": "Anthropic",
        "upstream": "/anthropic",
        "wire": "anthropic",
        "streaming": True,
    },
    "bedrock": {
        "display": "AWS Bedrock",
        "upstream": "/bedrock",
        "wire": "bedrock",
        "streaming": True,
    },
    "vertex_ai": {
        "display": "Google Vertex AI",
        "upstream": "/vertex_ai",
        "wire": "vertex",
        "streaming": True,
    },
    "gemini": {
        "display": "Google Gemini",
        "upstream": "/gemini/v1",
        "wire": "gemini",
        "streaming": True,
    },
    "mistral": {
        "display": "Mistral",
        "upstream": "/mistral/v1",
        "wire": "mistral",
        "streaming": True,
    },
    "cohere": {
        "display": "Cohere",
        "upstream": "/cohere/v1",
        "wire": "cohere",
        "streaming": False,
    },
    "assemblyai": {
        "display": "AssemblyAI (US)",
        "upstream": "/assemblyai/v2",
        "wire": "assemblyai",
        "streaming": False,
    },
    "eu_assemblyai": {
        "display": "AssemblyAI (EU)",
        "upstream": "/eu.assemblyai/v2",
        "wire": "assemblyai",
        "streaming": False,
    },
    "azure": {
        "display": "Azure",
        "upstream": "/azure",
        "wire": "openai",
        "streaming": True,
    },
    "azure_ai": {
        "display": "Azure AI Services",
        "upstream": "/azure_ai",
        "wire": "azure",
        "streaming": False,
    },
    "vllm": {
        "display": "vLLM (self-hosted)",
        "upstream": "/vllm",
        "wire": "openai",
        "streaming": True,
    },
    "cursor": {
        "display": "Cursor IDE",
        "upstream": "/cursor",
        "wire": "openai",
        "streaming": True,
    },
    "langfuse": {
        "display": "Langfuse",
        "upstream": "/langfuse",
        "wire": "langfuse",
        "streaming": False,
    },
}


def _flag_key(provider: str) -> str:
    return f"forge.provider.{provider}.enabled"


async def _tenant_overrides(tenant_id: UUID | str) -> dict[str, dict[str, Any]]:
    factory = get_session_factory()
    async with factory() as session:
        tenant_row = await session.get(Tenant, UUID(str(tenant_id)))
    if tenant_row is None:
        return {}
    return dict((tenant_row.settings or {}).get("feature_flags") or {})


def _resolve_flag(overrides: dict[str, dict[str, Any]], key: str, default: bool) -> bool:
    if key not in overrides:
        return default
    val = overrides[key].get("value")
    return bool(val) if isinstance(val, bool) else default


def list_providers() -> list[dict[str, Any]]:
    """Public catalog — used by the admin list endpoint."""
    return [
        {
            "name": name,
            "display": meta["display"],
            "wire": meta["wire"],
            "streaming": meta["streaming"],
            "upstream": meta["upstream"],
        }
        for name, meta in PROVIDERS.items()
    ]


async def is_provider_enabled(tenant_id: UUID | str, provider: str) -> bool:
    """Two-tier check: tenant pass-through flag + per-provider flag."""
    if provider not in PROVIDERS:
        return False
    overrides = await _tenant_overrides(tenant_id)
    if not _resolve_flag(overrides, "forge.pass_through.enabled", False):
        return False
    return _resolve_flag(overrides, _flag_key(provider), False)


async def set_provider_enabled(
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str,
    provider: str,
    enabled: bool,
) -> dict[str, Any]:
    """Flip the per-provider flag for a tenant; audit-logged."""
    if provider not in PROVIDERS:
        raise KeyError(provider)
    factory = get_session_factory()
    async with factory() as session:
        tenant_row = await session.get(Tenant, UUID(str(tenant_id)))
        if tenant_row is None:
            raise LookupError(f"tenant_not_found:{tenant_id}")
        settings = dict(tenant_row.settings or {})
        overrides = dict(settings.get("feature_flags") or {})
        prev = overrides.get(_flag_key(provider), {}).get("value")
        overrides[_flag_key(provider)] = {"value": enabled}
        # Enabling any provider implicitly enables the parent pass-through flag.
        if enabled:
            overrides["forge.pass_through.enabled"] = {"value": True}
        settings["feature_flags"] = overrides
        tenant_row.settings = settings
        await session.commit()

    action = (
        Phase4AuditAction.PROVIDER_ENABLED.value
        if enabled
        else Phase4AuditAction.PROVIDER_DISABLED.value
    )
    await audit_service.record(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        action=action,
        target_type="provider",
        target_id=provider,
        payload={"was_enabled": prev},
    )
    return {"provider": provider, "enabled": enabled}


async def record_accessed(
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str | None,
    provider: str,
    path: str,
    method: str,
) -> None:
    """Emit provider.accessed for a successful pass-through call."""
    await audit_service.record(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        action=Phase4AuditAction.PROVIDER_ACCESSED.value,
        target_type="provider",
        target_id=provider,
        payload={"path": path, "method": method},
    )


__all__ = [
    "PROVIDERS",
    "list_providers",
    "is_provider_enabled",
    "set_provider_enabled",
    "record_accessed",
]
