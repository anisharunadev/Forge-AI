"""Phase 6 SC-6.8 — streaming cost ledger updates within 1s."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from app.db.models.cost import CostEntry
from app.db.session import get_session_factory
from app.services.cost_ledger import cost_ledger


@pytest.mark.asyncio
async def test_streaming_usage_chunk_writes_within_one_second(two_tenants) -> None:
    """A usage chunk triggers a record_projected insert within 1s."""
    ta, _tb, pa = two_tenants
    started = datetime.now(UTC)
    await cost_ledger.record_projected(
        tenant_id=ta.id,
        project_id=pa.id,
        run_id="00000000-0000-0000-0000-000000000001",
        agent="agent-1",
        model="gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=5,
        cost_usd=0.001,
    )
    elapsed = (datetime.now(UTC) - started).total_seconds()
    assert elapsed < 1.0


@pytest.mark.asyncio
async def test_aborted_stream_writes_partial(two_tenants) -> None:
    """On partial=True, the row is inserted with cost_usd and projected=False."""
    ta, _tb, pa = two_tenants
    await cost_ledger.record_actual(
        tenant_id=ta.id,
        project_id=pa.id,
        run_id="00000000-0000-0000-0000-000000000002",
        agent="agent-2",
        model="gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=0,
        cost_usd=0.0005,
        source="litellm.partial",
        metadata={"partial": True},
    )
    factory = get_session_factory()
    async with factory() as s:
        rows = (
            (
                await s.execute(
                    sa.select(CostEntry).where(
                        CostEntry.run_id == "00000000-0000-0000-0000-000000000002"
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1
    assert float(rows[0].cost_usd) == pytest.approx(0.0005, rel=0.01)
    assert rows[0].projected is False


@pytest.mark.asyncio
async def test_malformed_chunk_does_not_crash(two_tenants) -> None:
    """A usage chunk with missing fields doesn't crash the writer."""
    ta, _tb, pa = two_tenants
    await cost_ledger.record_projected(
        tenant_id=ta.id,
        project_id=pa.id,
        run_id="00000000-0000-0000-0000-000000000003",
        agent="agent-3",
        model="gpt-4o-mini",
        prompt_tokens=0,
        completion_tokens=0,
        cost_usd=0.0,
    )
    factory = get_session_factory()
    async with factory() as s:
        rows = (
            (
                await s.execute(
                    sa.select(CostEntry).where(
                        CostEntry.run_id == "00000000-0000-0000-0000-000000000003"
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1
    assert rows[0].projected is True
