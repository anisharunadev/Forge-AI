"""Phase 5 -- SLO alerts with sustained-breach throttling.

Each :class:``SLOAlert`` watches one ``(surface, metric)`` pair. A
breach is only emitted when the same key breaches the threshold
contiguously for ``window_seconds``; this is what suppresses
single-sample flapping. Once an alert fires it enters a cooldown so
the same breach cannot page again until the cooldown elapses
(default 1 hour).

The list of installed alerts is built by
:func:``install_default_alerts`` and matches the surface/metric rows
in ``docs/standards/slos.md``. ``scripts/check-slos.sh`` enforces
that every row in the doc maps to an alert.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from typing import Callable

from app.services.observability.alerts import alert_manager


@dataclass
class SLOBreach:
    surface: str
    metric: str
    value: float
    threshold: float
    at: float


class _BreachWindow:
    """Tracks contiguous breaches; only fires when ``window_seconds`` is met.

    Ponytail: in-memory state only. Acceptable because a missed
    breach on a process restart is just a delayed page, not a missed
    SLO. Promote to Redis when multi-process evaluation needs
    consistency.
    """

    def __init__(self, window_seconds: int = 300) -> None:
        self.window_seconds = window_seconds
        self._since: dict[tuple[str, str], float] = {}

    def add(self, surface: str, metric: str, breached: bool, now: float) -> bool:
        """Record one observation. Return True iff this observation
        completes a sustained-breach window for the key.
        """
        key = (surface, metric)
        if not breached:
            self._since.pop(key, None)
            return False
        started = self._since.get(key)
        if started is None:
            self._since[key] = now
            # ponytail: window_seconds=0 means "fire on the first
            # observation". Anything larger requires sustained
            # observation across the window before firing.
            return self.window_seconds <= 0
        if now - started >= self.window_seconds:
            # Fire once; reset so the next breach has to re-accumulate.
            self._since.pop(key, None)
            return True
        return False


@dataclass
class SLOAlert:
    surface: str
    metric: str
    threshold: float
    comparator: Callable[[float, float], bool]
    window_seconds: int = 300
    cooldown_seconds: float = 3600.0

    def __post_init__(self) -> None:
        self._window = _BreachWindow(window_seconds=self.window_seconds)
        self._last_fired: float = 0.0

    def evaluate(self, value: float, now: float) -> bool:
        """Return True iff this evaluation should emit a breach."""
        breached = self.comparator(value, self.threshold)
        sustained = self._window.add(self.surface, self.metric, breached, now)
        if not sustained:
            return False
        if now - self._last_fired < self.cooldown_seconds:
            return False
        self._last_fired = now
        return True


async def _publish(alert: SLOAlert, value: float) -> None:
    await alert_manager.send(
        title=f"SLO breach: {alert.surface}/{alert.metric}",
        body=f"value={value:.4f} threshold={alert.threshold:.4f}",
        labels={
            "surface": alert.surface,
            "metric": alert.metric,
            "severity": "page",
        },
        severity="error",
    )


def install_default_alerts() -> list[SLOAlert]:
    """Build the canonical alert set from ``docs/standards/slos.md``."""
    return [
        SLOAlert(surface="chat", metric="latency_p95_ms", threshold=1500.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="chat", metric="error_rate", threshold=0.01, comparator=lambda v, t: v > t),
        SLOAlert(surface="chat", metric="availability", threshold=0.999, comparator=lambda v, t: v < t),
        SLOAlert(surface="kg", metric="latency_p95_ms", threshold=2000.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="kg", metric="error_rate", threshold=0.01, comparator=lambda v, t: v > t),
        SLOAlert(surface="kg", metric="availability", threshold=0.999, comparator=lambda v, t: v < t),
        SLOAlert(surface="ideation", metric="latency_p95_ms", threshold=10000.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="ideation", metric="error_rate", threshold=0.02, comparator=lambda v, t: v > t),
        SLOAlert(surface="ideation", metric="availability", threshold=0.995, comparator=lambda v, t: v < t),
        SLOAlert(surface="forge-models", metric="latency_p95_ms", threshold=3000.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="forge-models", metric="error_rate", threshold=0.01, comparator=lambda v, t: v > t),
        SLOAlert(surface="forge-models", metric="availability", threshold=0.999, comparator=lambda v, t: v < t),
        SLOAlert(surface="terminal", metric="latency_p95_ms", threshold=500.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="terminal", metric="error_rate", threshold=0.005, comparator=lambda v, t: v > t),
        SLOAlert(surface="terminal", metric="availability", threshold=0.999, comparator=lambda v, t: v < t),
        SLOAlert(surface="copilot", metric="latency_p95_ms", threshold=800.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="copilot", metric="error_rate", threshold=0.01, comparator=lambda v, t: v > t),
        SLOAlert(surface="copilot", metric="availability", threshold=0.999, comparator=lambda v, t: v < t),
    ]


_ALERTS: list[SLOAlert] = []


async def evaluate_all(metrics: dict[tuple[str, str], float]) -> list[SLOBreach]:
    """Evaluate every default alert against the latest metric snapshot.

    ``metrics`` is keyed by ``(surface, metric)``. Missing keys are
    skipped -- an alert with no data cannot be breached.
    """
    global _ALERTS
    if not _ALERTS:
        _ALERTS = install_default_alerts()
    now = time.time()
    fired: list[SLOBreach] = []
    for alert in _ALERTS:
        value = metrics.get((alert.surface, alert.metric))
        if value is None:
            continue
        if alert.evaluate(value, now):
            await _publish(alert, value)
            fired.append(SLOBreach(alert.surface, alert.metric, value, alert.threshold, now))
    return fired


__all__ = [
    "SLOAlert",
    "SLOBreach",
    "_BreachWindow",
    "evaluate_all",
    "install_default_alerts",
]
