"""F-012 — Model Provider Registry REST endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.model_providers import (
    ModelProviderCreate,
    ModelProviderRead,
    ModelProviderResolveResult,
    ModelProviderUpdate,
)
from app.services.model_provider_registry import model_provider_registry

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
    if provider.tenant_id != principal.tenant_id:
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
    if existing.tenant_id != principal.tenant_id:
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
    response_class=Response,
@audit(action="model_providers.delete", target_type="model_provider")
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
    if existing.tenant_id != principal.tenant_id:
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
        resolved_at=datetime.now(timezone.utc),
    )


__all__ = ["router"]
