"""Model Provider Registry — upstream LLM providers (F-012, DL-025)."""

from __future__ import annotations

import enum
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, Index, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TimestampMixin, UUIDPrimaryKeyMixin


class ModelProviderType(str, enum.Enum):
    """The set of supported model providers."""

    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GOOGLE = "google"
    BEDROCK = "bedrock"
    AZURE_OPENAI = "azure_openai"
    CUSTOM = "custom"


class ModelProvider(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A configured upstream LLM provider.

    `config` holds provider-specific settings (region, deployment,
    credentials reference). `litellm_model_alias` is the model name
    the LiteLLM Proxy expects when routing traffic to this provider.
    `rate_limit_rpm` / `rate_limit_tpm` enforce soft caps at the proxy
    layer; the ledger reads them to surface budget pressure.
    """

    __tablename__ = "model_providers"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[ModelProviderType] = mapped_column(
        SAEnum(ModelProviderType, name="model_provider_type"), nullable=False
    )
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    litellm_model_alias: Mapped[str] = mapped_column(String(200), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    rate_limit_rpm: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rate_limit_tpm: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        Index("ix_model_providers_tenant_enabled", "tenant_id", "enabled"),
        Index(
            "uq_model_providers_tenant_alias",
            "tenant_id",
            "litellm_model_alias",
            unique=True,
        ),
    )

    _audit_skip = ("catalog", "Vendor catalog (model provider). Read-only.")


__all__ = ["ModelProvider", "ModelProviderType"]
