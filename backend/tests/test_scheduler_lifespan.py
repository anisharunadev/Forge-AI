"""Tests for the in-process Scheduler wrapper (Phase 3).

Verifies:
- ``Scheduler.start()`` brings up APScheduler with two registered jobs.
- ``Scheduler.shutdown()`` calls ``scheduler.shutdown(wait=False)``.
- ``get_jobs()`` lists the expected job ids.
"""

from __future__ import annotations

from unittest.mock import MagicMock


def test_scheduler_start_registers_two_jobs(monkeypatch):
    """start() registers daily_ideation_ingest + memory_consolidate."""
    from app.services.scheduler.service import Scheduler

    class _Job:
        def __init__(self, id_):
            self.id = id_

    class FakeAsyncIOScheduler:
        def __init__(self):
            self.added: list[tuple[object, str]] = []
            self.shutdown_called_with = None

        def add_job(self, fn, trigger, **kw):
            self.added.append((fn, kw["id"]))

        def start(self):
            pass

        def shutdown(self, wait=False):
            self.shutdown_called_with = wait

        def get_jobs(self):
            return [_Job(jid) for _, jid in self.added]

    fake_instance = FakeAsyncIOScheduler()
    fake_module = MagicMock()
    fake_module.AsyncIOScheduler = MagicMock(return_value=fake_instance)

    import sys

    sys.modules["apscheduler"] = fake_module
    sys.modules["apscheduler.schedulers"] = fake_module
    sys.modules["apscheduler.schedulers.asyncio"] = fake_module
    sys.modules["apscheduler.triggers"] = fake_module
    sys.modules["apscheduler.triggers.cron"] = fake_module

    sched = Scheduler()
    sched.start()

    ids = sched.get_jobs()
    assert "daily_ideation_ingest" in ids
    assert "memory_consolidate" in ids

    sched.shutdown()
    assert fake_instance.shutdown_called_with is False


def test_scheduler_shutdown_noop_when_not_started():
    from app.services.scheduler.service import Scheduler

    sched = Scheduler()
    sched.shutdown()  # must not raise
    assert sched.is_started is False
