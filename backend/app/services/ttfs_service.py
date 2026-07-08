"""TTFS — Time-to-First-Success (M15-3).

Definition: elapsed wall-clock seconds from a user's onboarding-start
audit row to the first typed-artifact creation (idea or PRD).

We deliberately reuse ``audit_events`` rather than introduce a new
table:

  * ``action = 'onboarding.start'``  ← trigger
  * ``action = 'ideation.idea.create'``  ← first artifact
  * ``action = 'ideation.prd.generate'``  ← second checkpoint

The window for one user is bounded by ``(tenant_id, project_id)``
because the events must share a project (Rule 2 multi-tenancy).
Cross-project noise is avoided by scoping the search.

The output percentiles are over every observed (start, first_artifact)
pair in the requested window. The service is read-only against
``audit_events`` so it is safe to run concurrently with mutations.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.audit import AuditEvent
from app.db.session import get_session_factory

logger = get_logger(__name__)


@dataclass(frozen=True)
class TTFSReport:
    """Result type for TTFSService.compute() — typed artifact (R4)."""

    p50_seconds: float
    p95_seconds: float
    sample_count: int
    window_days: int
    observation_window_start: datetime
    observation_window_end: datetime

    def as_dict(self) -> dict:
        return {
            "p50_seconds": self.p50_seconds,
            "p95_seconds": self.p95_seconds,
            "sample_count": self.sample_count,
            "window_days": self.window_days,
            "observation_window_start": self.observation_window_start.isoformat(),
            "observation_window_end": self.observation_window_end.isoformat(),
        }


class TTFSService:
    """Compute time-to-first-success percentiles from audit_events."""

    START_ACTIONS = ("onboarding.start",)
    # first_artifact_actions is ordered by preference: earliest first.
    FIRST_ARTIFACT_ACTIONS = (
        "ideation.idea.create",
        "ideation.prd.generate",
    )

    async def compute(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        window_days: int = 30,
    ) -> TTFSReport:
        """Return p50/p95 seconds from onboarding.start → first_artifact.

        Filters to one (tenant_id, project_id) window. If project_id is
        None, aggregates across all projects for the tenant — that's
        the dashboard view; the per-project view is for individual
        orgs to debug their wizard.
        """
        if window_days < 1 or window_days > 365:
            raise ValueError("window_days must be between 1 and 365")

        end = datetime.now(UTC)
        start = end - timedelta(days=window_days)
        tenant_uuid = str(UUID(str(tenant_id)))

        factory = get_session_factory()
        async with factory() as session:
            stmt = select(
                AuditEvent.actor_id,
                AuditEvent.project_id,
                AuditEvent.action,
                AuditEvent.occurred_at,
            ).where(
                AuditEvent.tenant_id == tenant_uuid,
                AuditEvent.occurred_at >= start,
                AuditEvent.occurred_at <= end,
                AuditEvent.action.in_(list(self.START_ACTIONS) + list(self.FIRST_ARTIFACT_ACTIONS)),
            )
            if project_id is not None:
                stmt = stmt.where(AuditEvent.project_id == str(project_id))
            stmt = stmt.order_by(AuditEvent.occurred_at)
            rows = (await session.execute(stmt)).all()

        # Anchor per (actor, project): first start → first first_artifact.
        starts: dict[tuple[str, str], datetime] = {}
        durations: list[float] = []
        for actor, project, action, ts in rows:
            key = (str(actor), str(project or ""))
            if action in self.START_ACTIONS:
                starts.setdefault(key, ts)
            elif action in self.FIRST_ARTIFACT_ACTIONS and key in starts:
                start_ts = starts.pop(key)
                elapsed = (ts - start_ts).total_seconds()
                if elapsed >= 0 and elapsed < 24 * 3600:  # sanity bound
                    durations.append(elapsed)

        if not durations:
            report = TTFSReport(
                p50_seconds=0.0,
                p95_seconds=0.0,
                sample_count=0,
                window_days=window_days,
                observation_window_start=start,
                observation_window_end=end,
            )
            logger.info(
                "ttfs.compute",
                tenant_id=tenant_uuid,
                project_id=str(project_id) if project_id else None,
                samples=0,
            )
            return report

        durations_sorted = sorted(durations)
        p50 = statistics.median(durations_sorted)
        p95 = _percentile(durations_sorted, 0.95)

        report = TTFSReport(
            p50_seconds=p50,
            p95_seconds=p95,
            sample_count=len(durations),
            window_days=window_days,
            observation_window_start=start,
            observation_window_end=end,
        )
        logger.info(
            "ttfs.compute",
            tenant_id=tenant_uuid,
            project_id=str(project_id) if project_id else None,
            samples=len(durations),
            p50=round(p50, 1),
            p95=round(p95, 1),
        )
        return report


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Linear-interpolation percentile for small samples.

    stdlib's ``statistics.quantiles`` requires 2 samples minimum and
    uses inclusive interpolation. This is a ponytail dedup of the
    one-line that ships with statistics.
    """
    if not sorted_values:
        return 0.0
    if pct <= 0:
        return sorted_values[0]
    if pct >= 1:
        return sorted_values[-1]
    # Nearest-rank with linear interpolation.
    n = len(sorted_values)
    rank = pct * (n - 1)
    lo = int(rank)
    hi = min(lo + 1, n - 1)
    return sorted_values[lo] + (rank - lo) * (sorted_values[hi] - sorted_values[lo])


ttfs_service = TTFSService()
