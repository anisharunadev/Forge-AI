"""Per-tenant LLM spend anomaly detection (F-829 — Phase D).

Runs every 15 minutes. For each tenant, fetches the last 24 hourly
buckets of spend; if the most recent 1h bucket is more than 3σ above
the 24h mean, emits an audit event (``litellm.anomaly.spike``) and a
Pulse event.

Threshold and minimum sample size are tuned to keep the false-positive
rate low (the spec requires >= 4 buckets of history before firing).
"""

from __future__ import annotations

import statistics
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.cost import CostEntry
from app.db.models.tenant import Tenant
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)

# Spike threshold (standard deviations above the 24h mean).
_SPIKE_SIGMA: float = 3.0

# Minimum number of hourly buckets required before firing (keeps the
# false-positive rate low — with < 4 samples std-dev is meaningless).
_MIN_SAMPLE_BUCKETS: int = 4

# Number of hourly buckets compared. 24 = last 24 hours.
_HOUR_BUCKETS: int = 24


async def anomaly_check_job() -> None:
    """Scheduler entry point — runs every 15 min, iterates tenants."""
    factory = get_session_factory()
    async with factory() as session:
        tenants = list((await session.execute(select(Tenant))).scalars().all())

    if not tenants:
        logger.info("litellm.anomaly.no_tenants")
        return

    now = datetime.now(UTC)
    window_start = now - timedelta(hours=_HOUR_BUCKETS)
    for tenant in tenants:
        try:
            await _check_one(str(tenant.id), window_start, now)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "litellm.anomaly.tenant_failed",
                tenant_id=str(tenant.id),
                error=f"{type(exc).__name__}: {exc}",
            )


async def _check_one(tenant_id: str, window_start: datetime, now: datetime) -> None:
    """Compute hourly buckets for `tenant_id` and detect >3σ spikes."""
    buckets = await _hourly_buckets(tenant_id, window_start, now)
    if len(buckets) < _MIN_SAMPLE_BUCKETS:
        logger.debug(
            "litellm.anomaly.insufficient_history",
            tenant_id=tenant_id,
            buckets=len(buckets),
        )
        return

    # Exclude the most recent bucket from the mean/std-dev so we are
    # comparing "the spike" against "typical history".
    history = buckets[:-1]
    current = buckets[-1]

    mean = statistics.fmean(history)
    # Population std-dev is fine here; sample std-dev with n>=4 is
    # negligibly different for our threshold.
    try:
        stdev = statistics.pstdev(history)
    except statistics.StatisticsError:  # pragma: no cover — guarded above
        return

    if stdev <= 0:
        # All prior buckets identical. Any non-zero current is a spike.
        if current <= 0:
            return
        z_score = float("inf")
    else:
        z_score = (current - mean) / stdev

    if z_score <= _SPIKE_SIGMA:
        return

    payload = {
        "current_usd": float(current),
        "mean_usd": float(mean),
        "stdev_usd": float(stdev),
        "z_score": float(z_score),
        "window_hours": _HOUR_BUCKETS,
        "sample_size": len(history),
    }
    logger.warning(
        "litellm.anomaly.spike",
        tenant_id=tenant_id,
        **payload,
    )
    await audit_service.record(
        tenant_id=tenant_id,
        project_id=None,
        actor_id=None,
        action="litellm.anomaly.spike",
        target_type="tenant",
        target_id=tenant_id,
        payload=payload,
    )

    # Best-effort Pulse event for live dashboards.
    try:
        await bus.publish(
            EventType.LITELLM_CALL_COMPLETED,
            {"kind": "anomaly_spike", **payload},
            tenant_id=tenant_id,
            project_id=None,
            actor_id=None,
        )
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning(
            "litellm.anomaly.pulse_publish_failed",
            tenant_id=tenant_id,
            error=str(exc),
        )


async def _hourly_buckets(tenant_id: str, window_start: datetime, now: datetime) -> list[float]:
    """Return ``_HOUR_BUCKETS`` floats of cost_usd, oldest first."""
    factory = get_session_factory()
    async with factory() as session, tenant_context(session, tenant_id):
        # Fetch raw rows in window; aggregate per-hour in Python to
        # keep this portable across PostgreSQL versions.
        stmt = (
            select(CostEntry.cost_usd, CostEntry.recorded_at)
            .where(
                CostEntry.tenant_id == tenant_id,
                CostEntry.source == "litellm",
                CostEntry.recorded_at >= window_start,
                CostEntry.recorded_at <= now,
            )
            .order_by(CostEntry.recorded_at.asc())
        )
        rows = (await session.execute(stmt)).all()

    buckets = [0.0] * _HOUR_BUCKETS
    for cost, recorded_at in rows:
        if recorded_at is None:
            continue
        recorded_at = (  # noqa: PLW2901
            recorded_at.astimezone(UTC) if hasattr(recorded_at, "astimezone") else recorded_at
        )
        idx = int((recorded_at - window_start).total_seconds() // 3600)
        if 0 <= idx < _HOUR_BUCKETS:
            try:
                buckets[idx] += float(cost or 0)
            except (TypeError, ValueError):
                continue
    return buckets


__all__ = ["anomaly_check_job"]
