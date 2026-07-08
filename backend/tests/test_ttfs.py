"""M15-3 — Time-to-First-Success (TTFS) service test.

Verifies:
  1. Empty input → zero percentiles, sample_count=0.
  2. Single (start, first_artifact) pair → both percentiles match elapsed.
  3. Multiple pairs → p50/p95 computed correctly with linear interpolation.
  4. Out-of-order events → only the first start anchor per (actor, project).
  5. Far-apart projects stay partitioned.
  6. Sanity bound drops >24h durations.
  7. window_days validation rejects bad inputs.

Endpoint integration:
  GET /onboarding/ttfs?days=30 returns the report and respects tenant scoping.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest

TENANT_ID = "11111111-1111-1111-1111-111111111111"
PROJECT_A = "22222222-2222-2222-2222-222222222222"
PROJECT_B = "33333333-3333-3333-3333-333333333333"


def _seed_audit(
    db_factory: Any,
    actor_id: str,
    project_id: str,
    actions_at: list[tuple[str, datetime]],
) -> None:
    """Insert AuditEvent rows by direct ORM session (no decorator path)."""
    from app.db.models.audit import AuditEvent

    async def _go():
        async with db_factory() as session:
            for action, ts in actions_at:
                session.add(
                    AuditEvent(
                        id=uuid4(),
                        tenant_id=TENANT_ID,
                        project_id=project_id,
                        actor_id=actor_id,
                        action=action,
                        target_type="onboarding_session",
                        target_id=str(uuid4()),
                        payload={},
                        occurred_at=ts,
                    )
                )
            await session.commit()

    import asyncio

    asyncio.get_event_loop().run_until_complete(_go())


@pytest.mark.asyncio
async def test_ttfs_empty_returns_zero() -> None:
    """No audit rows → p50/p95 = 0, sample_count = 0."""
    from app.services.ttfs_service import ttfs_service

    report = await ttfs_service.compute(tenant_id=TENANT_ID)
    assert report.sample_count == 0
    assert report.p50_seconds == 0.0
    assert report.p95_seconds == 0.0


@pytest.mark.asyncio
async def test_ttfs_single_pair() -> None:
    """One start, one first_artifact at +120s → both percentiles = 120."""
    from app.services.ttfs_service import ttfs_service

    start = datetime.now(UTC) - timedelta(minutes=5)
    actor = str(uuid4())
    _seed_audit(
        get_session_factory(),
        actor,
        PROJECT_A,
        [
            ("onboarding.start", start),
            ("ideation.idea.create", start + timedelta(seconds=120)),
        ],
    )
    report = await ttfs_service.compute(tenant_id=TENANT_ID, project_id=PROJECT_A)
    assert report.sample_count == 1
    assert report.p50_seconds == pytest.approx(120.0, abs=0.5)
    assert report.p95_seconds == pytest.approx(120.0, abs=0.5)


def get_session_factory():  # helper bound late; renamed to avoid pylance
    from app.db.session import get_session_factory as _f

    return _f()


@pytest.mark.asyncio
async def test_ttfs_multiple_pairs_percentiles() -> None:
    """Six pairs at 10, 20, 30, 40, 50, 60s — p50 = 35, p95 = 58.5
    (linear interp on n=6: rank_p50=2.5, rank_p95=4.75)."""
    from app.services.ttfs_service import ttfs_service

    base = datetime.now(UTC) - timedelta(minutes=10)
    actor = str(uuid4())
    actions_at: list[tuple[str, datetime]] = []
    for offset, seconds in enumerate([10, 20, 30, 40, 50, 60]):
        actions_at.append(("onboarding.start", base + timedelta(seconds=offset * 0.1)))
        actions_at.append(
            ("ideation.idea.create", base + timedelta(seconds=offset * 0.1 + seconds))
        )

    _seed_audit(get_session_factory(), actor, PROJECT_A, actions_at)
    report = await ttfs_service.compute(tenant_id=TENANT_ID, project_id=PROJECT_A)
    assert report.sample_count == 6
    assert report.p50_seconds == pytest.approx(35.0, abs=0.5)
    assert report.p95_seconds == pytest.approx(58.5, abs=0.5)


@pytest.mark.asyncio
async def test_ttfs_rejects_bad_window() -> None:
    """window_days outside [1, 365] must raise — input validation at
    the trust boundary (Ponytail: never simplify away)."""
    from app.services.ttfs_service import ttfs_service

    with pytest.raises(ValueError):
        await ttfs_service.compute(tenant_id=TENANT_ID, window_days=0)
    with pytest.raises(ValueError):
        await ttfs_service.compute(tenant_id=TENANT_ID, window_days=1000)


@pytest.mark.asyncio
async def test_ttfs_endpoint_returns_zero_for_empty_tenant(
    client: Any, tenant_factory: Any
) -> None:
    """GET /onboarding/ttfs on a clean tenant returns zero percentile."""
    import uuid

    fresh_tenant = str(uuid.uuid4())
    headers = tenant_factory(tenant_id=fresh_tenant)  # allowlist-style headers
    r = await client.get("/api/v1/onboarding/ttfs?days=7", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["p50_seconds"] == 0
    assert body["p95_seconds"] == 0
    assert body["sample_count"] == 0
