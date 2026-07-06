"""Phase 5 -- cost aggregator unit tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.observability.cost_aggregator import _aggregate_once


@pytest.mark.asyncio
async def test_aggregate_once_groups_by_tenant(monkeypatch):
    """Two logs for the same tenant collapse into one rollup row."""
    fake_client = SimpleNamespace(
        list_spend_logs=AsyncMock(
            return_value=[
                {"tenant_id": "t1", "spend": 0.5},
                {"tenant_id": "t1", "spend": 0.25},
                {"tenant_id": "t2", "spend": 1.0},
            ]
        )
    )
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.execute = AsyncMock(return_value=None)
    session.commit = AsyncMock(return_value=None)
    factory = MagicMock(return_value=session)

    n = await _aggregate_once(factory, fake_client, redis=None)
    assert n == 2
    assert session.execute.await_count == 2


@pytest.mark.asyncio
async def test_aggregate_once_handles_no_logs():
    """An empty LiteLLM response short-circuits without touching the DB."""
    fake_client = SimpleNamespace(list_spend_logs=AsyncMock(return_value=[]))

    def factory():
        raise AssertionError("factory must not be called when no logs")

    n = await _aggregate_once(factory, fake_client, redis=None)
    assert n == 0


@pytest.mark.asyncio
async def test_aggregate_once_swallows_upstream_errors():
    """LiteLLM unavailability must not crash the scheduler."""
    fake_client = SimpleNamespace(
        list_spend_logs=AsyncMock(side_effect=RuntimeError("litellm down"))
    )
    factory = MagicMock()
    n = await _aggregate_once(factory, fake_client, redis=None)
    assert n == 0
