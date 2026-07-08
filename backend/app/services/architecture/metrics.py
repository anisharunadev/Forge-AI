"""Architecture Center metrics aggregations (Day 2 mock-removal track I).

Replaces the previous frontend `MOCK_DECISION_VELOCITY` array with a real
SQL aggregation over ``architecture_adrs.approved_at``.

The ``decision_velocity`` method groups accepted ADRs by week
(SQL: ``date_trunc('week', approved_at)``) for the last N weeks and
returns exactly ``weeks`` integers (oldest first, current week last),
filling any empty weeks with 0.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models.architecture import ADR
from app.db.session import get_session_factory

logger = get_logger(__name__)


class MetricsService:
    """Read-only aggregations over Architecture Center tables.

    No session is held — each method opens its own connection from the
    factory. The slice returned is intentionally bounded (1..52 weeks) so
    callers can pass user-supplied ``weeks`` without worrying about
    unbounded scans.
    """

    WEEK_MIN = 1
    WEEK_MAX = 52
    DEFAULT_WEEKS = 12

    async def decision_velocity(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        weeks: int = DEFAULT_WEEKS,
    ) -> list[int]:
        """Count ADRs accepted per week for the last ``weeks`` weeks.

        Returns ``weeks`` integers, oldest first, current week last.
        Missing weeks are filled with 0 so the response always has the
        shape the frontend sparkline expects.
        """
        weeks = max(self.WEEK_MIN, min(self.WEEK_MAX, weeks))
        factory = get_session_factory()
        async with factory() as session:
            # Postgres truncates to Monday 00:00 in the session timezone;
            # the column is `DateTime(timezone=True)`, so the truncation
            # is comparable to a UTC-midnight Monday.
            week_col = func.date_trunc("week", ADR.approved_at).label("week")
            stmt = (
                select(week_col, func.count(ADR.id).label("n"))
                .where(
                    ADR.tenant_id == str(tenant_id),
                    ADR.project_id == str(project_id),
                    ADR.approved_at.isnot(None),
                )
                .group_by(week_col)
                .order_by(week_col)
            )
            rows = (await session.execute(stmt)).all()

        counts: dict[datetime, int] = {row.week: int(row.n) for row in rows}
        now = datetime.now(UTC)
        current_week_start = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
            days=now.weekday()
        )

        result: list[int] = []
        for offset in range(weeks - 1, -1, -1):
            week_start = current_week_start - timedelta(weeks=offset)
            # Normalize the key (strip tzinfo) so it matches what
            # `date_trunc` returned before dict lookup.
            key = week_start.replace(tzinfo=None)
            result.append(counts.get(key, 0))
        return result


__all__ = ["MetricsService"]
