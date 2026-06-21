"""TestModelProviderRegistry — create, resolve, rate_limit_check."""

from __future__ import annotations

import uuid

import pytest

from app.db.models.model_provider import ModelProviderType
from app.services.model_provider_registry import ModelProviderRegistry


@pytest.fixture
async def reg(sqlite_db):
    return ModelProviderRegistry()


async def test_create_and_resolve(reg, sqlite_db):
    tenant_id = str(uuid.uuid4())
    provider = await reg.create_provider(
        tenant_id=tenant_id,
        name="anthropic-prod",
        type=ModelProviderType.ANTHROPIC,
        config={"api_key_ref": "vault://anthropic-prod"},
        litellm_model_alias="claude-3-5-sonnet",
        enabled=True,
        rate_limit_rpm=600,
        rate_limit_tpm=200_000,
    )
    assert provider.id is not None

    resolved = await reg.resolve_provider(tenant_id, "claude-3-5-sonnet")
    assert resolved.id == provider.id


async def test_resolve_unknown_raises(reg, sqlite_db):
    with pytest.raises(LookupError):
        await reg.resolve_provider(str(uuid.uuid4()), "nonexistent")


async def test_rate_limit_check(reg, sqlite_db):
    tenant_id = str(uuid.uuid4())
    await reg.create_provider(
        tenant_id=tenant_id,
        name="openai",
        type=ModelProviderType.OPENAI,
        config={"api_key_ref": "vault://openai"},
        litellm_model_alias="gpt-4o-mini",
        enabled=True,
        rate_limit_rpm=10,
        rate_limit_tpm=0,
    )

    allowed, _ = await reg.rate_limit_check(
        tenant_id, "gpt-4o-mini", current_rpm=2, current_tpm=0
    )
    assert allowed is True

    blocked, reason = await reg.rate_limit_check(
        tenant_id, "gpt-4o-mini", current_rpm=20, current_tpm=0
    )
    assert blocked is False
    assert reason and reason.startswith("rpm_cap_exceeded")


async def test_disable_prevents_resolve(reg, sqlite_db):
    tenant_id = str(uuid.uuid4())
    p = await reg.create_provider(
        tenant_id=tenant_id,
        name="disabled-one",
        type=ModelProviderType.GOOGLE,
        config={},
        litellm_model_alias="gemini-pro",
        enabled=True,
    )
    await reg.update_provider(p.id, enabled=False)

    with pytest.raises(LookupError):
        await reg.resolve_provider(tenant_id, "gemini-pro")
