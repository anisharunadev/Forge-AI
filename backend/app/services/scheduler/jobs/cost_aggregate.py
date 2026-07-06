"""Phase 5 -- scheduler wiring for the cost aggregator."""

from __future__ import annotations

import asyncio
from typing import Any

from app.services.observability.cost_aggregator import aggregate_loop


def start(session_factory: Any, litellm_client: Any, redis: Any | None = None) -> asyncio.Task:
    stop = asyncio.Event()
    task = asyncio.create_task(
        aggregate_loop(stop, session_factory, litellm_client, redis),
        name="cost-aggregator",
    )
    task.stop_event = stop  # type: ignore[attr-defined]
    return task


def stop(task: asyncio.Task) -> None:
    task.stop_event.set()  # type: ignore[attr-defined]
    task.cancel()


__all__ = ["start", "stop"]
