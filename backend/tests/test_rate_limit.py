"""Phase 6 SC-6.2 + SC-6.3 — per-tenant rate limit defaults + Retry-After."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.core.rate_limit import (
    RateLimitExceeded,
    TenantRateLimiter,
    enforce_rate_limit,
)


@pytest.mark.asyncio
async def test_default_limit_is_60(two_tenants) -> None:
    """First 60 calls pass; 61st raises."""
    ta, _tb, _pa = two_tenants
    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(60):
        out = await limiter.check(tenant_id=ta.id, surface="chat")
        assert out.allowed is True
    with pytest.raises(RateLimitExceeded) as exc_info:
        await limiter.check(tenant_id=ta.id, surface="chat")
    assert exc_info.value.limit == 60
    assert exc_info.value.retry_after_seconds > 0


@pytest.mark.asyncio
async def test_tenant_override_lowers_cap(two_tenants) -> None:
    """Tenant override lowers the cap; default is bypassed."""
    import sqlalchemy as sa

    from app.db.models.tenant import Tenant
    from app.db.session import get_session_factory

    ta, _tb, _pa = two_tenants
    factory = get_session_factory()
    async with factory() as s:
        row = (await s.execute(sa.select(Tenant).where(Tenant.id == ta.id))).scalar_one()
        row.settings = {"rate_limit_overrides": {"chat": 5}}
        await s.commit()

    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(5):
        out = await limiter.check(tenant_id=ta.id, surface="chat")
        assert out.allowed is True
    with pytest.raises(RateLimitExceeded) as exc_info:
        await limiter.check(tenant_id=ta.id, surface="chat")
    assert exc_info.value.limit == 5


@pytest.mark.asyncio
async def test_retry_after_header_format(two_tenants) -> None:
    """enforce_rate_limit dependency raises HTTPException with Retry-After."""
    ta, _tb, _pa = two_tenants
    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(60):
        await limiter.check(tenant_id=ta.id, surface="chat")
    with pytest.raises(HTTPException) as exc_info:
        await enforce_rate_limit("chat", tenant_id=ta.id)
    assert exc_info.value.status_code == 429
    assert "Retry-After" in exc_info.value.headers
    retry_after = int(exc_info.value.headers["Retry-After"])
    assert 0 < retry_after <= 61


@pytest.mark.asyncio
async def test_separate_surfaces_have_separate_buckets(two_tenants) -> None:
    """chat and rag counters are independent."""
    ta, _tb, _pa = two_tenants
    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(60):
        await limiter.check(tenant_id=ta.id, surface="chat")
    with pytest.raises(RateLimitExceeded):
        await limiter.check(tenant_id=ta.id, surface="chat")
    # rag is a separate bucket; still allowed.
    out = await limiter.check(tenant_id=ta.id, surface="rag")
    assert out.allowed is True


@pytest.mark.asyncio
async def test_missing_tenant_uses_default(sqlite_db) -> None:
    """A tenant with no row uses the global default."""
    fake = uuid.uuid4()
    limiter = TenantRateLimiter(redis_client=None)
    for _ in range(60):
        out = await limiter.check(tenant_id=fake, surface="chat")
        assert out.allowed is True
    with pytest.raises(RateLimitExceeded):
        await limiter.check(tenant_id=fake, surface="chat")
