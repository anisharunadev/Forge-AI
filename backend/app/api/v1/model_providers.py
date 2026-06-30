"""F-012 — Model Provider Registry REST endpoints."""

import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.schemas.model_providers import (
    ModelProviderCreate,
    ModelProviderRead,
    ModelProviderResolveResult,
    ModelProviderUpdate,
)
from app.services.model_provider_registry import model_provider_registry

logger = get_logger(__name__)

router = APIRouter(prefix="/model-providers", tags=["model-providers"])


@router.get("", response_model=list[ModelProviderRead])
@audit(action="model_providers.list", target_type="model_provider")
async def list_providers(
    principal: Principal,
    _perm: Principal = require_permission("model_providers:read"),
) -> list[ModelProviderRead]:
    rows = await model_provider_registry.list_providers(principal.tenant_id)
    return [ModelProviderRead.model_validate(r) for r in rows]


@router.get("/{provider_id}", response_model=ModelProviderRead)
@audit(action="model_providers.get", target_type="model_provider")
async def get_provider(
    provider_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("model_providers:read"),
) -> ModelProviderRead:
    try:
        provider = await model_provider_registry.get_provider(provider_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(provider.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="model_provider_not_found")
    return ModelProviderRead.model_validate(provider)


@router.post("", response_model=ModelProviderRead, status_code=status.HTTP_201_CREATED)
@audit(action="model_providers.create", target_type="model_provider")
async def create_provider(
    body: ModelProviderCreate,
    principal: Principal,
    _perm: Principal = require_permission("model_providers:create"),
) -> ModelProviderRead:
    provider = await model_provider_registry.create_provider(
        tenant_id=principal.tenant_id,
        name=body.name,
        type=body.type,
        config=body.config,
        litellm_model_alias=body.litellm_model_alias,
        enabled=body.enabled,
        rate_limit_rpm=body.rate_limit_rpm,
        rate_limit_tpm=body.rate_limit_tpm,
    )
    return ModelProviderRead.model_validate(provider)


@router.patch("/{provider_id}", response_model=ModelProviderRead)
@audit(action="model_providers.update", target_type="model_provider")
async def update_provider(
    provider_id: UUID,
    body: ModelProviderUpdate,
    principal: Principal,
    _perm: Principal = require_permission("model_providers:update"),
) -> ModelProviderRead:
    try:
        existing = await model_provider_registry.get_provider(provider_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(existing.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="model_provider_not_found")
    updated = await model_provider_registry.update_provider(
        provider_id,
        name=body.name,
        config=body.config,
        enabled=body.enabled,
        rate_limit_rpm=body.rate_limit_rpm,
        rate_limit_tpm=body.rate_limit_tpm,
    )
    return ModelProviderRead.model_validate(updated)


@router.delete(
    "/{provider_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    response_class=Response,
)
@audit(action="model_providers.delete", target_type="model_provider")
async def delete_provider(
    provider_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("model_providers:delete"),
):
    try:
        existing = await model_provider_registry.get_provider(provider_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(existing.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="model_provider_not_found")
    await model_provider_registry.delete_provider(provider_id)


@router.get("/resolve/{model_alias:path}", response_model=ModelProviderResolveResult)
@audit(action="model_providers.resolve", target_type="model_provider")
async def resolve_provider(
    model_alias: str,
    principal: Principal,
    _perm: Principal = require_permission("model_providers:read"),
) -> ModelProviderResolveResult:
    try:
        provider = await model_provider_registry.resolve_provider(
            principal.tenant_id, model_alias
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ModelProviderResolveResult(
        alias=model_alias,
        provider=ModelProviderRead.model_validate(provider),
        resolved_at=datetime.now(UTC),
    )


# step-54 — Phase 2 real connection test. Performs an actual HTTP
# round-trip to the upstream provider and reports real status +
# latency_ms. The exact URL/headers/body shape is dictated by the
# provider type (anthropic, openai, bedrock, vertex, azure_openai,
# custom) — see the spec at docs/goals/step-54-v4.md.
@router.post("/{provider_id}/test")
@audit(action="model_providers.test", target_type="model_provider")
async def test_provider(  # noqa: PLR0911, PLR0912 — spec-driven branching
    provider_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("model_providers:read"),
) -> dict[str, Any]:
    try:
        existing = await model_provider_registry.get_provider(provider_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if str(existing.tenant_id) != str(principal.tenant_id):
        raise HTTPException(status_code=404, detail="model_provider_not_found")

    config = existing.config or {}
    api_key = config.get("api_key") or config.get("apiKey")
    api_base = config.get("api_base")
    model = config.get("default_model") or existing.litellm_model_alias

    if not existing.enabled:
        return {
            "status": "error",
            "message": "Provider is disabled. Enable it before testing.",
            "provider_id": str(existing.id),
            "latency_ms": 0,
        }
    if not api_key:
        return {
            "status": "error",
            "message": "No api_key configured. Edit the provider and add one.",
            "provider_id": str(existing.id),
            "latency_ms": 0,
        }

    provider_type = existing.type.value

    # Dispatch the call by provider type. Anthropic and OpenAI use a
    # minimal messages request so the upstream returns 200 fast. The
    # other providers (bedrock / vertex / azure_openai / custom) use
    # the LiteLLM-compatible /v1/models probe.
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if provider_type == "anthropic":
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": str(api_key),
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
            elif provider_type == "openai":
                base = (api_base or "https://api.openai.com/v1").rstrip("/")
                response = await client.post(
                    f"{base}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
            else:
                # bedrock / vertex / azure_openai / custom — probe
                # {api_base}/v1/models with bearer auth.
                if not api_base:
                    return {
                        "status": "error",
                        "message": (
                            f"No api_base configured for provider type "
                            f"'{provider_type}'. Add api_base to the config."
                        ),
                        "provider_id": str(existing.id),
                        "latency_ms": 0,
                    }
                base = api_base.rstrip("/")
                response = await client.get(
                    f"{base}/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
    except httpx.TimeoutException:
        return {
            "status": "error",
            "message": "Timeout after 10s",
            "provider_id": str(existing.id),
            "latency_ms": int((time.monotonic() - start) * 1000),
        }
    except Exception as exc:  # noqa: BLE001 — surface upstream error verbatim
        logger.warning(
            "model_providers.test.connection_failed",
            provider_id=str(existing.id),
            error=str(exc),
        )
        return {
            "status": "error",
            "message": f"Connection failed: {str(exc)[:200]}",
            "provider_id": str(existing.id),
            "latency_ms": int((time.monotonic() - start) * 1000),
        }

    latency_ms = int((time.monotonic() - start) * 1000)
    status_code = response.status_code

    if status_code == 200:
        return {
            "status": "ok",
            "message": (
                f"Provider '{existing.name}' ({provider_type}) reachable"
            ),
            "provider_id": str(existing.id),
            "latency_ms": latency_ms,
            "http_status": status_code,
        }
    if status_code in (401, 403):
        return {
            "status": "error",
            "message": f"Authentication failed (HTTP {status_code})",
            "provider_id": str(existing.id),
            "latency_ms": latency_ms,
            "http_status": status_code,
        }
    if status_code == 404:
        return {
            "status": "error",
            "message": (
                f"Upstream returned 404 — check api_base and model name "
                f"(model='{model}')"
            ),
            "provider_id": str(existing.id),
            "latency_ms": latency_ms,
            "http_status": status_code,
        }
    return {
        "status": "error",
        "message": (
            f"Upstream returned HTTP {status_code}: "
            f"{response.text[:200] if response.text else 'no body'}"
        ),
        "provider_id": str(existing.id),
        "latency_ms": latency_ms,
        "http_status": status_code,
    }


__all__ = ["router"]
