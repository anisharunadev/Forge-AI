"""Tests for forge_budget_guard — per-agent pre-call admission control.

(a) Over-ceiling blocks BEFORE any LiteLLM call (count zero outbound HTTP calls).
(b) Warn threshold (>90%) emits audit `forge.spend.budget_warning`.
(c) Below threshold returns {allow: True, warn: False}.
(d) LRU cache within 60s avoids duplicate DB queries.

The source fails open when spend_records / agent_virtual_key tables
are missing (Phase 4 migrations). We monkeypatch `_cached_spent` and
`_cached_ceiling` so this suite tests the guard's admission logic, not
SQL execution.
"""

from __future__ import annotations

import time
import uuid
from unittest.mock import AsyncMock

import pytest

from app.services import forge_budget_guard as guard_mod
from app.services.forge_budget_guard import (
    AgentBudgetExceeded,
    budget_guard,
)


def _agent() -> uuid.UUID:
    return uuid.UUID("11111111-1111-1111-1111-111111111111")


def _current_bucket() -> int:
    return int(time.time() // 60)


@pytest.fixture
def stub_spent(monkeypatch: pytest.MonkeyPatch):
    """Replace `_cached_spent` with a stub keyed on agent_id only (ignore bucket).

    Mirrors the real signature so the guard's call site is unchanged.
    Counts invocations so test (d) can assert cache-hit behaviour.
    """
    spent_map: dict[str, float] = {}
    call_count: dict[str, int] = {"n": 0}

    def _fake(agent_id: str, bucket: int) -> float:
        call_count["n"] += 1
        return spent_map.get(agent_id, 0.0)

    monkeypatch.setattr(guard_mod, "_cached_spent", _fake)

    def _set(spent: float, aid: str | None = None) -> None:
        spent_map[aid or str(_agent())] = spent

    return _set, call_count


@pytest.fixture
def stub_ceiling(monkeypatch: pytest.MonkeyPatch):
    """Replace `_cached_ceiling` with a stub keyed on agent_id."""
    ceiling_map: dict[str, float] = {}
    call_count: dict[str, int] = {"n": 0}

    def _fake(agent_id: str) -> float:
        call_count["n"] += 1
        return ceiling_map.get(agent_id, guard_mod.DEFAULT_BUDGET_USD)

    monkeypatch.setattr(guard_mod, "_cached_ceiling", _fake)

    def _set(ceiling: float, aid: str | None = None) -> None:
        ceiling_map[aid or str(_agent())] = ceiling

    return _set, call_count


@pytest.fixture
def stub_audit(monkeypatch: pytest.MonkeyPatch):
    """Replace `audit_service` with an AsyncMock so no DB writes happen."""
    mock = AsyncMock()
    mock.record = AsyncMock()
    monkeypatch.setattr(guard_mod, "audit_service", mock)
    return mock


# ---------------------------------------------------------------------------
# (a) Over-ceiling -> AgentBudgetExceeded, zero outbound HTTP calls
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pre_call_blocks_when_over_ceiling(
    stub_spent, stub_ceiling, stub_audit, monkeypatch: pytest.MonkeyPatch
) -> None:
    """$480 of $500 + $25 est must raise; no outbound http traffic at all."""
    _set_spent, _ = stub_spent
    _set_ceiling, _ = stub_ceiling
    aid = _agent()
    _set_spent(480.0, str(aid))
    _set_ceiling(500.0, str(aid))

    # Count anything that could be an outbound HTTP call by patching
    # `httpx.AsyncClient` on the *already-imported* httpx module object.
    # `forge_budget_guard` does NOT import httpx, so by patching the
    # class on the live httpx module we catch any accidental import that
    # routes through LiteLLM during the guard's pre-call.
    import httpx as _httpx

    outbound_calls: list[str] = []
    real_request = _httpx.AsyncClient.request

    def _count_request(self, method, url, *a, **kw):  # noqa: ANN001
        outbound_calls.append(f"{method} {url}")
        return real_request(self, method, url, *a, **kw)

    monkeypatch.setattr(_httpx.AsyncClient, "request", _count_request)

    with pytest.raises(AgentBudgetExceeded) as exc_info:
        await budget_guard.check_pre_call(aid, est_cost_usd=25.0)

    assert exc_info.value.spent_usd == 480.0
    assert exc_info.value.ceiling_usd == 500.0
    assert exc_info.value.code == "agent_budget_exceeded"
    assert exc_info.value.agent_id == aid

    # Strict: zero outbound HTTP. The guard must admit/deny purely from
    # DB spend + ceiling — no LiteLLM call in the path.
    assert outbound_calls == [], f"expected zero outbound HTTP calls, got: {outbound_calls}"

    # Audit row was attempted for the block event.
    stub_audit.record.assert_awaited_once()
    kwargs = stub_audit.record.await_args.kwargs
    assert kwargs["action"] == "forge.spend.budget_exceeded"


# ---------------------------------------------------------------------------
# (b) > 90% -> no exception, audit 'forge.spend.budget_warning' emitted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pre_call_warns_at_90_percent(stub_spent, stub_ceiling, stub_audit) -> None:
    _set_spent, _ = stub_spent
    _set_ceiling, _ = stub_ceiling
    aid = _agent()
    # 91% — above warn threshold (0.9), below ceiling.
    _set_spent(455.0, str(aid))
    _set_ceiling(500.0, str(aid))

    result = await budget_guard.check_pre_call(aid, est_cost_usd=0.0)

    assert result["allow"] is True
    assert result["warn"] is True
    assert result["spent_usd"] == 455.0
    assert result["ceiling_usd"] == 500.0
    assert result["pct"] == pytest.approx(0.91)

    stub_audit.record.assert_awaited_once()
    kwargs = stub_audit.record.await_args.kwargs
    assert kwargs["action"] == "forge.spend.budget_warning"
    assert kwargs["target_id"] == str(aid)


# ---------------------------------------------------------------------------
# (c) Below threshold -> {allow: True, warn: False}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pre_call_allows_below_threshold(stub_spent, stub_ceiling, stub_audit) -> None:
    _set_spent, _ = stub_spent
    _set_ceiling, _ = stub_ceiling
    aid = _agent()
    _set_spent(250.0, str(aid))
    _set_ceiling(500.0, str(aid))

    result = await budget_guard.check_pre_call(aid, est_cost_usd=10.0)

    assert result == {
        "allow": True,
        "warn": False,
        "spent_usd": 250.0,
        "ceiling_usd": 500.0,
        "pct": pytest.approx(0.5),
    }
    stub_audit.record.assert_not_awaited()


# ---------------------------------------------------------------------------
# (d) Cache hit within 60s -> second call skips DB
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_within_60s_no_db_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`_cached_spent` is `@lru_cache(maxsize=1024)` keyed on (agent_id, bucket).

    Within the same minute bucket the second call must not hit the DB.
    We verify by replacing `_cached_spent` with a *real* lru_cache-wrapped
    function and counting invocations of the body.
    """
    aid = _agent()

    db_query_count = {"n": 0}

    from functools import lru_cache as _lru_cache

    @_lru_cache(maxsize=1024)
    def _cached_spent_real(agent_id: str, bucket: int) -> float:
        db_query_count["n"] += 1
        return 100.0

    monkeypatch.setattr(guard_mod, "_cached_spent", _cached_spent_real)
    monkeypatch.setattr(guard_mod, "_cached_ceiling", lambda _: 500.0)

    # Bucket is computed from time.time() // 60. Two back-to-back calls
    # land in the same bucket unless they straddle a minute boundary.
    # The lru_cache key is (agent_id, bucket); same agent + same bucket
    # -> hit, no DB call.
    r1 = await budget_guard.check_pre_call(aid, est_cost_usd=0.0)
    r2 = await budget_guard.check_pre_call(aid, est_cost_usd=0.0)

    assert r1["spent_usd"] == 100.0
    assert r2["spent_usd"] == 100.0
    assert db_query_count["n"] == 1, (
        f"expected 1 DB call (cache hit on 2nd), got {db_query_count['n']}"
    )
