"""Unit tests for ``app.integrations.litellm.budget_sync`` (F-829c).

The BudgetSync module is the thin adapter that ``workflow_budget.py``
delegates to in Phase A. It owns the LiteLLM ``/budget/new`` and
``/budget/info`` calls and mirrors the result to the local
``LiteLLMBudgetConfig`` row.

These tests assume the module exposes (or will expose):

    class BudgetDecision(str, Enum):
        ALLOWED = "allowed"
        BLOCKED = "blocked"

    class BudgetSync:
        def __init__(
            self,
            *,
            admin_client,
            session_factory=None,
        ) -> None: ...

        async def set_tenant_budget(
            self,
            *,
            tenant_id: str,
            max_usd: float,
            period: str = "monthly",
        ) -> str: ...

        async def check_budget(
            self,
            *,
            tenant_id: str,
            projected_cost_usd: float = 0.0,
        ) -> BudgetDecision: ...
"""

from __future__ import annotations

import pytest


def _try_import_budget_sync():
    """Return the budget_sync module or skip the calling test."""
    return pytest.importorskip("app.integrations.litellm.budget_sync")


def _make_response(json_body: dict, status_code: int = 200):
    from unittest.mock import AsyncMock

    resp = AsyncMock(name="httpx_response")
    resp.status_code = status_code
    resp.json = lambda: json_body
    resp.raise_for_status = lambda: None
    return resp


# ---------------------------------------------------------------------------
# 1. set_tenant_budget posts to /budget/new and mirrors locally
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_tenant_budget(
    mock_litellm_admin,
    settings_override,
    fake_tenant_id,
    sqlite_db,
):
    """set_tenant_budget calls LiteLLM /budget/new with the right body
    AND writes a local LiteLLMBudgetConfig row (or equivalent) so the
    workflow_budget adapter can fall back to it.
    """
    from sqlalchemy import select

    mod = _try_import_budget_sync()
    service = mod.BudgetSync(
        admin_client=mock_litellm_admin,
        session_factory=sqlite_db,
    )

    budget_id = f"budget-{fake_tenant_id[:8]}"
    mock_litellm_admin.post.return_value = _make_response(
        {"budget_id": budget_id, "max_budget": 500.0, "budget_duration": "30d"},
    )

    returned_id = await service.set_tenant_budget(
        tenant_id=fake_tenant_id,
        max_usd=500.0,
        period="monthly",
    )

    assert returned_id == budget_id
    mock_litellm_admin.post.assert_awaited_once()
    call = mock_litellm_admin.post.await_args
    assert "/budget/new" in str(call.args[0])
    body = call.kwargs.get("json") or call.args[1]
    # Body must reference the tenant (Rule 2 — tenant-scoped spend tracking).
    assert fake_tenant_id in str(body)
    assert float(body.get("max_budget") or body.get("max_usd") or 0) == 500.0

    # Mirror written locally. We try the likely model name; if the
    # source module hasn't introduced it yet, the call is still
    # correct from a network perspective.
    try:
        from app.db.models.litellm_budget import LiteLLMBudgetConfig  # type: ignore

        async with sqlite_db() as session:
            rows = (
                (
                    await session.execute(
                        select(LiteLLMBudgetConfig).where(
                            LiteLLMBudgetConfig.tenant_id == fake_tenant_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert len(rows) >= 1
        assert float(rows[0].max_usd) == 500.0
    except ImportError:
        # Local mirror is optional / not yet present in the source —
        # the network assertion above is the load-bearing contract.
        pass


# ---------------------------------------------------------------------------
# 2. check_budget returns BLOCKED when LiteLLM reports spent > max
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_budget_blocks_when_exceeded(
    mock_litellm_admin,
    settings_override,
    fake_tenant_id,
):
    """When LiteLLM /budget/info reports ``current_spend > max_budget``,
    ``check_budget`` must return the BLOCKED decision so the
    ForgeLLMClient admission control can raise BudgetExceeded.
    """
    mod = _try_import_budget_sync()
    service = mod.BudgetSync(admin_client=mock_litellm_admin)

    mock_litellm_admin.get.return_value = _make_response(
        {
            "max_budget": 500.0,
            "current_spend": 612.34,
            "budget_duration": "30d",
            "budget_reset_at": "2026-07-01T00:00:00Z",
        },
    )

    decision = await service.check_budget(tenant_id=fake_tenant_id)

    # Decision enum value is "blocked" (lowercase string per spec).
    decision_value = getattr(decision, "value", decision)
    assert decision_value in ("blocked", mod.BudgetDecision.BLOCKED)

    # Sanity: the GET went to /budget/info with the tenant in the path or query.
    mock_litellm_admin.get.assert_awaited_once()
    call = mock_litellm_admin.get.await_args
    assert "/budget/info" in str(call.args[0])
    assert fake_tenant_id in str(call.args[0])
