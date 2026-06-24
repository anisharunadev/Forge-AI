"""Tests for the production-safety gate."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from backend.seeds.framework.exceptions import ProductionSeedBlockedError
from backend.seeds.framework.production_safety import check_production_safety


def _manifest(*, tenant_type: str = "demo", allow_in_prod: bool = False) -> dict:
    return {
        "name": "acme-corp",
        "version": 1,
        "tenant_type": tenant_type,
        "production_safety": {"allow_in_prod": allow_in_prod},
    }


def _audit_mock() -> AsyncMock:
    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    return audit


@pytest.mark.asyncio
async def test_demo_seed_blocked_in_production_without_override() -> None:
    audit = _audit_mock()
    with pytest.raises(ProductionSeedBlockedError):
        await check_production_safety(
            manifest=_manifest(tenant_type="demo"),
            env="production",
            allow_in_prod=False,
            audit_service=audit,
            actor_id=uuid.uuid4(),
        )
    audit.record.assert_called()
    call_kwargs = audit.record.call_args.kwargs
    assert call_kwargs["action"] == "seed.production_blocked"


@pytest.mark.asyncio
async def test_demo_seed_allowed_when_caller_passes_flag() -> None:
    audit = _audit_mock()
    await check_production_safety(
        manifest=_manifest(tenant_type="demo"),
        env="production",
        allow_in_prod=True,
        audit_service=audit,
        actor_id=uuid.uuid4(),
    )
    call_kwargs = audit.record.call_args.kwargs
    assert call_kwargs["action"] == "seed.production_override"


@pytest.mark.asyncio
async def test_demo_seed_allowed_when_manifest_says_so() -> None:
    """production_safety.allow_in_prod=true overrides the caller flag."""
    audit = _audit_mock()
    await check_production_safety(
        manifest=_manifest(tenant_type="demo", allow_in_prod=True),
        env="production",
        allow_in_prod=False,
        audit_service=audit,
        actor_id=uuid.uuid4(),
    )
    call_kwargs = audit.record.call_args.kwargs
    assert call_kwargs["action"] == "seed.production_override"


@pytest.mark.asyncio
async def test_reference_seed_unaffected_by_production_env() -> None:
    """Reference seeds are not gated."""
    audit = _audit_mock()
    await check_production_safety(
        manifest=_manifest(tenant_type="reference"),
        env="production",
        allow_in_prod=False,
        audit_service=audit,
        actor_id=uuid.uuid4(),
    )
    audit.record.assert_not_called()


@pytest.mark.asyncio
async def test_demo_seed_in_development_passes() -> None:
    audit = _audit_mock()
    await check_production_safety(
        manifest=_manifest(tenant_type="demo"),
        env="development",
        allow_in_prod=False,
        audit_service=audit,
        actor_id=uuid.uuid4(),
    )
    audit.record.assert_not_called()


@pytest.mark.asyncio
async def test_customer_seed_in_production_passes() -> None:
    """customer_seed seeds are not blocked."""
    audit = _audit_mock()
    await check_production_safety(
        manifest=_manifest(tenant_type="customer_seed"),
        env="production",
        allow_in_prod=False,
        audit_service=audit,
        actor_id=uuid.uuid4(),
    )
    audit.record.assert_not_called()