"""Phase 5 -- SLO alert sustained-breach + cooldown tests."""

from __future__ import annotations

import time

import pytest

from app.services.observability.alerts import alert_manager
from app.services.observability.slo_alerts import SLOAlert, _BreachWindow


@pytest.fixture(autouse=True)
def _reset():
    """Clear fired-alerts state between tests."""
    alert_manager._fired.clear()
    yield
    alert_manager._fired.clear()


def test_breach_window_requires_sustained():
    w = _BreachWindow(window_seconds=60)
    now = 1000.0
    assert w.add("chat", "latency_p95_ms", True, now) is False
    assert w.add("chat", "latency_p95_ms", True, now + 30) is False
    assert w.add("chat", "latency_p95_ms", True, now + 61) is True


def test_breach_resets_on_recovery():
    w = _BreachWindow(window_seconds=60)
    assert w.add("chat", "x", True, 1000.0) is False
    w.add("chat", "x", False, 1010.0)
    # After a recovery the clock resets -- one fresh breach should not fire.
    assert w.add("chat", "x", True, 1020.0) is False
    assert w.add("chat", "x", True, 1081.0) is True


def test_alert_cooldown_throttles():
    a = SLOAlert(
        surface="chat",
        metric="x",
        threshold=1.0,
        comparator=lambda v, t: v > t,
        window_seconds=0,
        cooldown_seconds=3600,
    )
    now = time.time()
    assert a.evaluate(2.0, now) is True
    assert a.evaluate(2.0, now + 1) is False
    assert a.evaluate(2.0, now + 3601) is True


@pytest.mark.asyncio
async def test_evaluate_all_publishes_breach(monkeypatch):
    """A metric above its threshold (after the breach window) emits a payload."""
    # Force every alert's window to 0 so the first observation fires.
    from app.services.observability import slo_alerts as mod

    # Reset the lazy module-level list.
    mod._ALERTS = []
    alerts = mod.install_default_alerts()
    for a in alerts:
        a._window.window_seconds = 0
        a.cooldown_seconds = 0
    mod._ALERTS = alerts

    fired = await mod.evaluate_all({("chat", "latency_p95_ms"): 2000.0})
    assert len(fired) == 1
    assert fired[0].surface == "chat"
    assert fired[0].metric == "latency_p95_ms"
    # alert_manager.send was awaited; the payload should be in _fired.
    assert any("SLO breach" in p.alertname for p in alert_manager.fired())
