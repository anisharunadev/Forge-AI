"""Phase 5 -- periodic SLO evaluator loop.

Runs every 60s. Fetches the current metric snapshot and routes it
through :func:``slo_alerts.evaluate_all``. Tick failures are logged
and swallowed so a transient metrics backend blip does not crash
the scheduler.
"""
from __future__ import annotations

import asyncio
import logging

from app.services.observability import slo_alerts
from app.services.observability.metrics_query import fetch_current_metrics

log = logging.getLogger(__name__)


async def _loop(stop: asyncio.Event, interval_seconds: int = 60) -> None:
    while not stop.is_set():
        try:
            metrics = await fetch_current_metrics()
            await slo_alerts.evaluate_all(metrics)
        except Exception:  # noqa: BLE001
            log.exception("slo_evaluator_tick_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except asyncio.TimeoutError:
            pass


def start() -> asyncio.Task:
    stop = asyncio.Event()
    task = asyncio.create_task(_loop(stop), name="slo-evaluator")
    task.stop_event = stop  # type: ignore[attr-defined]
    return task


def stop(task: asyncio.Task) -> None:
    task.stop_event.set()  # type: ignore[attr-defined]
    task.cancel()


__all__ = ["start", "stop"]
