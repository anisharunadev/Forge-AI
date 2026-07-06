"""Phase 3 scheduler package — wraps APScheduler's AsyncIOScheduler.

The scheduler runs in-process, started by ``app.main.lifespan``. It
owns two cron jobs (daily ideation ingest, nightly memory
consolidate). Multi-replica deployments need a Postgres advisory
lock around each job; that's out of scope for Phase 3 and flagged
for follow-up in the plan's "Risks and judgment calls" section.
"""

from __future__ import annotations

from app.services.scheduler.service import Scheduler, scheduler

__all__ = ["Scheduler", "scheduler"]
