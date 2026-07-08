"""Phase 5 -- per-tenant per-minute cost aggregation.

The ``cost_aggregate`` scheduler job (see
``app/services/scheduler/jobs/cost_aggregate.py``) calls
:func:``_aggregate_once`` on a 60s tick. Each tick reads LiteLLM
spend logs for the previous minute window, groups them by
``(tenant_id, minute)``, and UPSERTs into ``cost_minute_rollup``.

``query_cost`` is the read path exposed to
``GET /v1/observability/cost`` -- the admin cost dashboard.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.logging import get_logger
from app.db.models.cost_rollup import CostMinuteRollup

log = get_logger(__name__)


async def _aggregate_once(
    session_factory: Any,
    litellm_client: Any,
    redis: Any | None = None,
) -> int:
    """Aggregate the previous minute of spend logs.

    Returns the number of rollup rows written (or updated).
    """
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    window_start = now - timedelta(minutes=1)
    try:
        logs = await litellm_client.list_spend_logs(start=window_start, end=now)
    except Exception as exc:  # noqa: BLE001
        log.warning("cost_aggregator.list_spend_logs_failed", error=str(exc))
        return 0
    if not logs:
        return 0

    # Group by (tenant_id, minute). LiteLLM may not return minute
    # granularity so we collapse everything to the window_start bucket.
    rows: dict[str, tuple[float, int]] = {}
    for entry in logs:
        tid_raw = entry.get("tenant_id")
        if not tid_raw:
            continue
        tid = str(tid_raw)
        spend, count = rows.get(tid, (0.0, 0))
        rows[tid] = (spend + float(entry.get("spend", 0.0) or 0.0), count + 1)

    async with session_factory() as session:
        for tenant_id, (spend, count) in rows.items():
            stmt = (
                pg_insert(CostMinuteRollup)
                .values(
                    tenant_id=tenant_id,
                    minute=window_start,
                    spend_usd=spend,
                    request_count=count,
                )
                .on_conflict_do_update(
                    index_elements=["tenant_id", "minute"],
                    set_={"spend_usd": spend, "request_count": count},
                )
            )
            await session.execute(stmt)
        await session.commit()
    return len(rows)


async def aggregate_loop(
    stop: Any,
    session_factory: Any,
    litellm_client: Any,
    redis: Any | None = None,
    interval_seconds: int = 60,
) -> None:
    """Periodic loop: aggregate, then wait ``interval_seconds`` or for stop."""
    import asyncio

    while not stop.is_set():
        try:
            await _aggregate_once(session_factory, litellm_client, redis)
        except Exception:  # noqa: BLE001
            log.exception("cost_aggregate_tick_failed")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)


async def query_cost(
    session_factory: Any,
    tenant_id: str,
    since: datetime,
) -> list[CostMinuteRollup]:
    """Return rollup rows for ``tenant_id`` at or after ``since``."""
    async with session_factory() as session:
        stmt = (
            select(CostMinuteRollup)
            .where(
                CostMinuteRollup.tenant_id == tenant_id,
                CostMinuteRollup.minute >= since,
            )
            .order_by(CostMinuteRollup.minute)
        )
        return list((await session.execute(stmt)).scalars())


__all__ = ["_aggregate_once", "aggregate_loop", "query_cost"]
