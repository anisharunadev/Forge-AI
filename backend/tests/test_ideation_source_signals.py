"""Tests for the Phase 3 ideation source signals table.

Verifies:
- Idempotent insert via the UNIQUE constraint
- Cluster-by-keyword grouping on uncategorized signals
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.ideation import Idea, IdeaSource, IdeaStatus
from app.db.models.ideation_signal import IdeaSourceSignal
from app.db.session import get_session_factory


pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def signals_setup(sqlite_db):
    """Seed a tenant + a project so the FK constraints are happy."""
    factory = get_session_factory()
    async with factory() as session:
        idea = Idea(
            id=uuid.uuid4(),
            tenant_id="11111111-1111-1111-1111-111111111111",
            project_id="22222222-2222-2222-2222-222222222222",
            title="placeholder",
            description="placeholder",
            source=IdeaSource.USER,
            submitted_by=uuid.uuid4(),
            status=IdeaStatus.NEW,
            tags=[],
            attachments=[],
        )
        session.add(idea)
        await session.commit()
        await session.refresh(idea)
    return idea


async def test_unique_constraint_blocks_duplicate_signals(sqlite_db, signals_setup):
    factory = get_session_factory()
    now = datetime.now(timezone.utc)
    payload = {
        "id": uuid.uuid4(),
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "project_id": "22222222-2222-2222-2222-222222222222",
        "source": "confluence",
        "external_id": "cf-001",
        "title": "Test page",
        "body": "body",
        "occurred_at": now,
        "ingested_at": now,
    }
    async with factory() as session:
        # First insert succeeds.
        stmt = pg_insert(IdeaSourceSignal).values(payload)
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["tenant_id", "source", "external_id"]
        )
        await session.execute(stmt)
        await session.commit()

        # Re-inserting the same external_id is a no-op.
        payload["id"] = uuid.uuid4()
        stmt = pg_insert(IdeaSourceSignal).values(payload)
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["tenant_id", "source", "external_id"]
        )
        await session.execute(stmt)
        await session.commit()

        stmt = select(IdeaSourceSignal).where(
            IdeaSourceSignal.tenant_id == payload["tenant_id"],
            IdeaSourceSignal.external_id == "cf-001",
        )
        rows = list((await session.execute(stmt)).scalars().all())
        assert len(rows) == 1


async def test_keyword_overlap_clustering_groups_signals():
    """The synthesizer groups signals that share ≥2 keywords in the title."""
    from app.services.ideation.sources.synthesizer import _keyword_overlap

    # Same three keywords ⇒ clusters together.
    a = "migrate postgres schema for billing service"
    b = "billing service schema migration plan"
    c = "unrelated random content here"
    assert _keyword_overlap(a, b) >= 2
    assert _keyword_overlap(a, c) < 2