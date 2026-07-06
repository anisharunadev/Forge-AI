"""Tests for ``AlertManager`` + bus subscriber wiring (Pillar 1 — Phase 4).

Covers:
- ``check_and_alert`` with ``outcome != 'ok'`` fires an AlertPayload
  record (and, when ``ALERTMANAGER_WEBHOOK_URL`` is set, would POST).
- Without ``ALERTMANAGER_WEBHOOK_URL`` set, the manager logs but does
  NOT raise (log-only mode).
- Bus subscriber wiring: an ``APPROVAL_DENIED`` event triggers
  ``check_and_alert``.

The webhook POST is exercised by patching ``httpx`` to a fake client
so we can assert on the URL + payload without a live network.
"""

from __future__ import annotations

import uuid

import pytest

from app.services.event_bus import Event, EventType
from app.services.observability import alerts as alerts_mod


@pytest.fixture(autouse=True)
def _reset_manager_state():
    """Clear the module-level ``alert_manager._fired`` between tests."""
    alerts_mod.alert_manager._fired.clear()
    yield
    alerts_mod.alert_manager._fired.clear()


# ---------------------------------------------------------------------------
# check_and_alert
# ---------------------------------------------------------------------------


async def test_check_and_alert_fires_when_outcome_not_ok():
    event = Event(
        event_type=EventType.APPROVAL_DENIED,
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        payload={"outcome": "denied", "approval_id": "abc"},
    )
    await alerts_mod.alert_manager.check_and_alert(event)

    fired = alerts_mod.alert_manager.fired()
    assert len(fired) == 1
    payload = fired[0]
    assert "approval_denied" in payload.alertname
    assert payload.severity == "error"
    assert payload.labels["outcome"] == "denied"
    assert payload.labels["tenant_id"] == event.tenant_id


async def test_check_and_alert_skips_when_outcome_ok():
    event = Event(
        event_type=EventType.APPROVAL_GRANTED,
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        payload={"outcome": "ok"},
    )
    await alerts_mod.alert_manager.check_and_alert(event)
    assert alerts_mod.alert_manager.fired() == []


async def test_check_and_alert_logs_only_when_no_webhook(monkeypatch):
    """Without ``ALERTMANAGER_WEBHOOK_URL`` the manager must not error."""
    monkeypatch.delenv("ALERTMANAGER_WEBHOOK_URL", raising=False)

    event = Event(
        event_type=EventType.AGENT_RUN_FAILED,
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        payload={"outcome": "failed"},
    )
    # Should not raise.
    await alerts_mod.alert_manager.check_and_alert(event)

    fired = alerts_mod.alert_manager.fired()
    # The payload is recorded on the manager regardless of whether the
    # webhook POST happens — tests can introspect ``fired()`` to assert
    # on the alertmanager-bound body that WOULD have been POSTed.
    assert len(fired) == 1
    assert fired[0].labels["outcome"] == "failed"


async def test_check_and_alert_posts_when_webhook_configured(monkeypatch):
    """When ``ALERTMANAGER_WEBHOOK_URL`` is set the manager POSTs."""
    captured: list[dict] = []

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json):
            captured.append({"url": url, "json": json})

            class _Resp:
                status_code = 200
                text = ""

            return _Resp()

    import sys

    fake_module = type(sys)("httpx_fake")
    fake_module.AsyncClient = _FakeClient
    monkeypatch.setitem(sys.modules, "httpx", fake_module)
    monkeypatch.setenv("ALERTMANAGER_WEBHOOK_URL", "http://alertmgr:9093/webhook")

    event = Event(
        event_type=EventType.CONNECTOR_FAILED,
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        payload={"outcome": "failed", "connector_id": "c1"},
    )

    # The manager schedules the POST as an asyncio.create_task; give the
    # loop a tick to drain.
    await alerts_mod.alert_manager.check_and_alert(event)
    import asyncio

    await asyncio.sleep(0)

    assert len(captured) == 1
    assert captured[0]["url"] == "http://alertmgr:9093/webhook"
    assert captured[0]["json"]["alertname"].startswith("forge_connector_failed")
    assert captured[0]["json"]["severity"] == "error"


# ---------------------------------------------------------------------------
# Subscriber wiring
# ---------------------------------------------------------------------------


async def test_approval_denied_event_triggers_check_and_alert(event_bus):
    """APPROVAL_DENIED event → subscriber → check_and_alert → fired."""
    alerts_mod.register(event_bus)

    await event_bus.publish(
        EventType.APPROVAL_DENIED,
        {"outcome": "denied", "approval_id": "x"},
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
    )

    fired = alerts_mod.alert_manager.fired()
    assert len(fired) == 1
    assert fired[0].labels["outcome"] == "denied"


async def test_approval_granted_event_does_not_fire(event_bus):
    """APPROVAL_GRANTED is a 'happy path' — no alert expected."""
    alerts_mod.register(event_bus)

    await event_bus.publish(
        EventType.APPROVAL_GRANTED,
        {"outcome": "ok"},
        tenant_id=str(uuid.uuid4()),
        project_id=str(uuid.uuid4()),
    )

    assert alerts_mod.alert_manager.fired() == []
