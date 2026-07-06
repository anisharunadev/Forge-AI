"""Model Provider Registry (F-012, DL-025).

Maps LiteLLM model aliases (e.g. `gpt-4o-mini`, `claude-3-5-sonnet`)
to a tenant's configured provider so LiteLLMClient can route traffic.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.model_provider import ModelProvider, ModelProviderType
from app.db.session import get_session_factory

logger = get_logger(__name__)


class ModelProviderRegistry:
    """Tenant-scoped registry for upstream LLM providers."""

    async def list_providers(self, tenant_id: UUID | str) -> list[ModelProvider]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(ModelProvider)
                .where(ModelProvider.tenant_id == str(tenant_id))
                .order_by(ModelProvider.created_at.desc())
            )
            return list((await session.execute(stmt)).scalars().all())

    async def get_provider(self, provider_id: UUID | str) -> ModelProvider:
        factory = get_session_factory()
        async with factory() as session:
            provider = await session.get(ModelProvider, str(provider_id))
            if provider is None:
                raise LookupError(f"ModelProvider {provider_id} not found")
            return provider

    async def create_provider(
        self,
        *,
        tenant_id: UUID | str,
        name: str,
        type: ModelProviderType,
        config: dict[str, Any],
        litellm_model_alias: str,
        enabled: bool = True,
        rate_limit_rpm: int = 0,
        rate_limit_tpm: int = 0,
    ) -> ModelProvider:
        factory = get_session_factory()
        async with factory() as session:
            provider = ModelProvider(
                tenant_id=str(tenant_id),
                name=name,
                type=type,
                config=config,
                litellm_model_alias=litellm_model_alias,
                enabled=enabled,
                rate_limit_rpm=rate_limit_rpm,
                rate_limit_tpm=rate_limit_tpm,
            )
            session.add(provider)
            await session.commit()
            await session.refresh(provider)
        logger.info(
            "model_provider.created",
            provider_id=str(provider.id),
            alias=litellm_model_alias,
            tenant_id=str(tenant_id),
        )
        return provider

    async def update_provider(
        self,
        provider_id: UUID | str,
        *,
        name: str | None = None,
        config: dict[str, Any] | None = None,
        enabled: bool | None = None,
        rate_limit_rpm: int | None = None,
        rate_limit_tpm: int | None = None,
    ) -> ModelProvider:
        factory = get_session_factory()
        async with factory() as session:
            provider = await session.get(ModelProvider, str(provider_id))
            if provider is None:
                raise LookupError(f"ModelProvider {provider_id} not found")
            if name is not None:
                provider.name = name
            if config is not None:
                provider.config = config
            if enabled is not None:
                provider.enabled = enabled
            if rate_limit_rpm is not None:
                provider.rate_limit_rpm = rate_limit_rpm
            if rate_limit_tpm is not None:
                provider.rate_limit_tpm = rate_limit_tpm
            await session.commit()
            await session.refresh(provider)
        return provider

    async def delete_provider(self, provider_id: UUID | str) -> None:
        factory = get_session_factory()
        async with factory() as session:
            provider = await session.get(ModelProvider, str(provider_id))
            if provider is None:
                raise LookupError(f"ModelProvider {provider_id} not found")
            await session.delete(provider)
            await session.commit()

    async def resolve_provider(
        self,
        tenant_id: UUID | str,
        model_alias: str,
    ) -> ModelProvider:
        """Return the enabled provider for a LiteLLM model alias.

        Raises LookupError when no enabled provider matches — callers
        (LiteLLMClient) fall back to default routing in that case.
        """
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(ModelProvider)
                .where(
                    ModelProvider.tenant_id == str(tenant_id),
                    ModelProvider.litellm_model_alias == model_alias,
                    ModelProvider.enabled.is_(True),
                )
                .limit(1)
            )
            provider = (await session.execute(stmt)).scalar_one_or_none()
            if provider is None:
                raise LookupError(
                    f"No enabled ModelProvider for tenant {tenant_id} alias {model_alias!r}"
                )
            return provider

    async def rate_limit_check(
        self,
        tenant_id: UUID | str,
        model_alias: str,
        *,
        current_rpm: int,
        current_tpm: int,
    ) -> tuple[bool, str | None]:
        """Check current usage against the provider's configured caps.

        Returns (allowed, reason_if_blocked). reason_if_blocked is None
        when allowed=True.
        """
        provider = await self.resolve_provider(tenant_id, model_alias)
        if provider.rate_limit_rpm and current_rpm >= provider.rate_limit_rpm:
            return False, f"rpm_cap_exceeded:{current_rpm}/{provider.rate_limit_rpm}"
        if provider.rate_limit_tpm and current_tpm >= provider.rate_limit_tpm:
            return False, f"tpm_cap_exceeded:{current_tpm}/{provider.rate_limit_tpm}"
        return True, None


model_provider_registry = ModelProviderRegistry()


__all__ = ["ModelProviderRegistry", "model_provider_registry"]
