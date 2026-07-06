"""APScheduler wrapper for Forge (Pillar 1 — Phase 3).

Wraps :class:`apscheduler.schedulers.asyncio.AsyncIOScheduler` with
the two Phase 3 cron jobs:

- ``daily_ideation_ingest`` — runs at ``IDEATION_INGEST_HOUR`` UTC
  (default 06:00). One job iterates all tenants (NOT one job per
  tenant — would explode at scale).
- ``memory_consolidate`` — runs at 02:00 UTC nightly.

The :data:`scheduler` singleton is started from ``app.main.lifespan``
and shut down on process exit. ``start()`` and ``shutdown()`` are
idempotent so tests can exercise the lifecycle without leaking state
between cases.
"""

from __future__ import annotations

import os
from typing import Any

from app.core.logging import get_logger
from app.services.scheduler.jobs.approval_timeout_scan import (
    approval_timeout_scan,
)
from app.services.scheduler.jobs.forge_key_rotate import (
    run as forge_key_rotate,
)
from app.services.scheduler.jobs.forge_spend_reconcile import (
    run as forge_spend_reconcile,
)
from app.services.scheduler.jobs.ideation_ingest import (
    daily_ideation_ingest,
)
from app.services.scheduler.jobs.lessons_digest import (
    monthly_lessons_digest,
)
from app.services.scheduler.jobs.litellm_anomaly_check import (
    anomaly_check_job,
)
from app.services.scheduler.jobs.litellm_reconcile import (
    reconcile_job,
)
from app.services.scheduler.jobs.memory_consolidate import (
    nightly_memory_consolidate,
)

logger = get_logger(__name__)


class Scheduler:
    """Thin wrapper around APScheduler's AsyncIOScheduler."""

    def __init__(self) -> None:
        self._scheduler: Any | None = None
        self._started = False

    @property
    def is_started(self) -> bool:
        return self._started

    def start(self) -> None:
        """Add the cron jobs and start the scheduler. Idempotent."""
        if self._started:
            return
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from apscheduler.triggers.cron import CronTrigger
        except ImportError as exc:  # pragma: no cover — phase-3 dep
            logger.warning(
                "scheduler.apscheduler_unavailable",
                error=str(exc),
            )
            return

        ingest_hour = int(os.environ.get("IDEATION_INGEST_HOUR", "6"))
        self._scheduler = AsyncIOScheduler()
        self._scheduler.add_job(
            daily_ideation_ingest,
            CronTrigger.from_crontab(f"0 {ingest_hour} * * *"),
            id="daily_ideation_ingest",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            nightly_memory_consolidate,
            CronTrigger.from_crontab("0 2 * * *"),
            id="memory_consolidate",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        # F-829 — Phase D Polish
        # - ``litellm_reconcile``: nightly at 02:30 UTC; compares Forge
        #   cost_ledger to LiteLLM /spend/logs and bumps last_synced_at.
        # - ``litellm_anomaly_check``: every 15 min; flags >3σ spend
        #   spikes per tenant.
        self._scheduler.add_job(
            reconcile_job,
            CronTrigger.from_crontab("30 2 * * *"),
            id="litellm_reconcile",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.add_job(
            anomaly_check_job,
            "interval",
            minutes=15,
            id="litellm_anomaly_check",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        # F-002-LESSON — Steward monthly review digests (step-64 Sub-step B)
        self._scheduler.add_job(
            monthly_lessons_digest,
            CronTrigger.from_crontab("0 8 1 * *"),
            id="lessons_digest_monthly",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        # step-75 F5 — 5-min spend reconciliation against /spend/logs
        self._scheduler.add_job(
            forge_spend_reconcile,
            CronTrigger.from_crontab("*/5 * * * *"),
            id="forge_spend_reconcile",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        # step-75 P4 — daily 03:00 UTC virtual key rotation sweep.
        self._scheduler.add_job(
            forge_key_rotate,
            CronTrigger.from_crontab("0 3 * * *"),
            id="forge_key_rotate",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        # M2 T-A7 — PITFALL-6 closure.  Every 5 minutes the
        # approval-timeout scan walks the in-process run registry for
        # pending approvals whose ``requested_at + timeout_hours``
        # has passed.  Each stale approval gets
        # ``EventType.APPROVAL_EXPIRED`` published to the bus so
        # audit + WS subscribers can mark the run as failed and the
        # operator dashboard can render the 'Stale approval' badge.
        # Per-tenant timeout overrides land via
        # :attr:`Settings.approval_timeout_overrides`.
        self._scheduler.add_job(
            approval_timeout_scan,
            "interval",
            minutes=5,
            id="approval_timeout_scan",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self._scheduler.start()
        self._started = True
        logger.info(
            "scheduler.started",
            jobs=[
                "daily_ideation_ingest",
                "memory_consolidate",
                "litellm_reconcile",
                "litellm_anomaly_check",
                "lessons_digest_monthly",
                "forge_spend_reconcile",
                "forge_key_rotate",
                "approval_timeout_scan",
            ],
            ingest_hour_utc=ingest_hour,
        )

    def shutdown(self) -> None:
        """Stop the scheduler. ``wait=False`` to avoid blocking on in-flight runs."""
        if not self._started or self._scheduler is None:
            return
        try:
            self._scheduler.shutdown(wait=False)
        except Exception as exc:  # noqa: BLE001
            logger.warning("scheduler.shutdown_failed", error=str(exc))
        finally:
            self._started = False
            self._scheduler = None
            logger.info("scheduler.shutdown")

    def get_jobs(self) -> list[str]:
        """Return registered job ids (testing seam)."""
        if self._scheduler is None:
            return []
        try:
            return [str(j.id) for j in self._scheduler.get_jobs()]
        except Exception:  # noqa: BLE001
            return []


# Module-level singleton for convenience (DI-friendly).
scheduler = Scheduler()


__all__ = ["Scheduler", "scheduler"]
