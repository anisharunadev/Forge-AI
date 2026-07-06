"""Daily 03:00 UTC rotation sweep for stale or budget-pressured virtual keys.

Iterates every active ``agent_virtual_key`` row and rotates the agent's
LiteLLM key when any of these triggers fire:

* age > ``ROTATE_AGE_DAYS`` (default 7 days), or
* 30-day spend / max_budget >= ``ROTATE_BUDGET_PCT`` (default 0.80).

Rotations are best-effort — a single failure is logged and skipped so
one bad agent does not block the rest of the sweep.

Registered in :mod:`app.services.scheduler.service` at ``0 3 * * *``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models.cost import CostEntry
from app.db.session import get_session_factory

logger = get_logger(__name__)

#: Age threshold matched against ``ROTATE_AGE_DAYS`` on the broker.
_ROTATE_AGE_DAYS: int = 7

#: Spend / budget threshold matched against ``ROTATE_BUDGET_PCT``.
_ROTATE_BUDGET_PCT: float = 0.80

#: Spend window for the budget-pressure check.
_BUDGET_WINDOW_DAYS: int = 30

#: Default max budget when the row has none recorded.
_DEFAULT_MAX_BUDGET_USD: float = 500.00


async def run() -> None:
    """Scheduler entry point — runs once per cron tick, iterates active keys."""
    # ponytail: lazy import keeps the scheduler module importable in
    # environments where the broker / its deps are not exercised.
    from app.services.forge_key_broker import (
        BUDGET_WINDOW_DAYS,
        ROTATE_AGE_DAYS,
        ROTATE_BUDGET_PCT,
        AgentVirtualKey,
        forge_key_broker,
    )

    age_days = ROTATE_AGE_DAYS
    budget_pct = ROTATE_BUDGET_PCT
    window_days = BUDGET_WINDOW_DAYS

    factory = get_session_factory()
    cutoff_age = datetime.now(UTC) - timedelta(days=age_days)
    cutoff_spend = datetime.now(UTC) - timedelta(days=window_days)

    async with factory() as session:
        rows = list(
            (
                await session.execute(
                    select(AgentVirtualKey).where(AgentVirtualKey.status == "active")
                )
            ).scalars()
        )

    if not rows:
        logger.info("forge_key_rotate.no_active_keys")
        return

    rotated = 0
    skipped = 0
    for row in rows:
        try:
            stale = bool(row.created_at and row.created_at < cutoff_age)
            over_budget = await _is_over_budget(
                session_factory=factory, row=row, cutoff_spend=cutoff_spend, threshold=budget_pct
            )
            if not (stale or over_budget):
                skipped += 1
                continue
            reason = "auto_age" if stale else "auto_budget"
            await forge_key_broker.rotate(row.agent_id, reason=reason)
            rotated += 1
        except Exception as exc:  # noqa: BLE001 — best-effort per agent
            logger.warning(
                "forge_key_rotate.agent_failed",
                agent_id=str(row.agent_id),
                error=f"{type(exc).__name__}: {exc}",
            )

    logger.info(
        "forge_key_rotate.completed",
        scanned=len(rows),
        rotated=rotated,
        skipped=skipped,
    )


async def _is_over_budget(
    *,
    session_factory: Any,
    row: Any,
    cutoff_spend: datetime,
    threshold: float,
) -> bool:
    """Return True if 30-day spend / max_budget_usd >= threshold."""
    max_budget = float(row.max_budget_usd or _DEFAULT_MAX_BUDGET_USD)
    if max_budget <= 0:
        return False
    async with session_factory() as session:
        total = await session.scalar(
            select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
                CostEntry.agent_id == row.agent_id,
                CostEntry.created_at >= cutoff_spend,
            )
        )
    spent = float(total or 0.0)
    return (spent / max_budget) >= threshold


__all__ = ["run"]
