"""Phase 6 SC-6.1 — TenantBudgetGuard returns the right admit/block signal.

Tests ``TenantBudgetGuard`` independently of the SSE path. The SSE-to-429
mapping is covered in ``test_stream_chat_budget.py`` (separate file).
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
import sqlalchemy as sa

from app.db.models.tenant import Tenant
from app.services.cost_ledger import cost_ledger
from app.services.forge_budget_guard import (
    TenantBudgetExceeded,
    tenant_budget_guard,
)


@pytest.mark.asyncio
async def test_under_budget_passes(two_tenants) -> None:
    """Spent < ceiling → admit, no raise."""
    ta, _tb, _pa = two_tenants
    with patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=10.0)):
        out = await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=0.0)
    assert out["allow"] is True
    assert out["spent_usd"] == 10.0
    assert out["ceiling_usd"] == tenant_budget_guard.DEFAULT_CEILING_USD


@pytest.mark.asyncio
async def test_at_budget_warns_passes(two_tenants) -> None:
    """99% of ceiling — admits the call but logs the warning."""
    ta, _tb, _pa = two_tenants
    with patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=4950.0)):
        out = await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=1.0)
    assert out["allow"] is True
    assert 0.98 < out["pct"] < 1.0


@pytest.mark.asyncio
async def test_over_budget_raises(two_tenants) -> None:
    """Over the ceiling — TenantBudgetExceeded raised."""
    ta, _tb, _pa = two_tenants
    with (
        patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=5100.0)),
        pytest.raises(TenantBudgetExceeded) as exc_info,
    ):
        await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=0.0)
    assert exc_info.value.spent_usd == 5100.0
    assert exc_info.value.ceiling_usd == tenant_budget_guard.DEFAULT_CEILING_USD
    assert exc_info.value.retry_after_seconds > 0
    assert exc_info.value.code == "tenant_budget_exceeded"


@pytest.mark.asyncio
async def test_enforcement_flag_disables_guard(two_tenants) -> None:
    """budget_enforcement_v2=false → guard always passes (override via JSONB)."""
    ta, _tb, _pa = two_tenants
    from app.db.session import get_session_factory

    factory = get_session_factory()
    async with factory() as s:
        row = (await s.execute(sa.select(Tenant).where(Tenant.id == ta.id))).scalar_one()
        row.settings = {"budget_enforcement_v2": False}
        await s.commit()
    # Bust the in-process cache so the new setting is honored.
    tenant_budget_guard._cache.pop(str(ta.id), None)

    with patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=99999.0)):
        out = await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=0.0)
    assert out["allow"] is True


@pytest.mark.asyncio
async def test_tenant_ceiling_override(two_tenants) -> None:
    """Tenant.settings['tenant_budget_usd'] overrides the default."""
    ta, _tb, _pa = two_tenants
    from app.db.session import get_session_factory

    factory = get_session_factory()
    async with factory() as s:
        row = (await s.execute(sa.select(Tenant).where(Tenant.id == ta.id))).scalar_one()
        row.settings = {"tenant_budget_usd": 100.0}
        await s.commit()
    tenant_budget_guard._cache.pop(str(ta.id), None)

    with (
        patch.object(cost_ledger, "get_total_for_tenant", AsyncMock(return_value=101.0)),
        pytest.raises(TenantBudgetExceeded) as exc_info,
    ):
        await tenant_budget_guard.check_pre_call(tenant_id=ta.id, est_cost_usd=0.0)
    assert exc_info.value.ceiling_usd == 100.0


@pytest.mark.asyncio
async def test_missing_tenant_uses_default(sqlite_db) -> None:
    """A tenant that doesn't exist falls back to DEFAULT_CEILING_USD."""
    fake = uuid.uuid4()
    out = await tenant_budget_guard.check_pre_call(tenant_id=fake, est_cost_usd=0.0)
    assert out["allow"] is True
    assert out["ceiling_usd"] == tenant_budget_guard.DEFAULT_CEILING_USD
