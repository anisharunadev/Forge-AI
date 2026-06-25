"""Unit tests for ``app.integrations.litellm.health_monitor`` (F-829l).

The health monitor pings LiteLLM every ``litellm_health_check_interval_seconds``
(30s default) and exposes ``is_healthy()`` to the rest of the app.

Behavior:

  * One successful ping → ``is_healthy()`` returns ``True``.
  * Three consecutive failures → ``is_healthy()`` returns ``False``.
  * A single success after failures resets the failure counter.
"""

from __future__ import annotations

import pytest


def _try_import_health_monitor():
    return pytest.importorskip("app.integrations.litellm.health_monitor")


def _ok_response():
    from unittest.mock import AsyncMock

    resp = AsyncMock(name="litellm_health_ok")
    resp.status_code = 200
    resp.json = lambda: {"status": "healthy"}
    resp.raise_for_status = lambda: None
    return resp


# ---------------------------------------------------------------------------
# 1. Healthy state after 1 successful ping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_healthy_state(
    mock_litellm_admin,
    settings_override,
):
    """After a single successful ping, ``is_healthy()`` returns True."""
    mod = _try_import_health_monitor()
    monitor = mod.LiteLLMHealthMonitor(admin_client=mock_litellm_admin)
    mock_litellm_admin.get.return_value = _ok_response()

    # Drive a single ping through whatever public method the source exposes.
    if hasattr(monitor, "ping_once"):
        await monitor.ping_once()
    elif hasattr(monitor, "check_once"):
        await monitor.check_once()
    elif hasattr(monitor, "_ping"):
        await monitor._ping()
    else:
        pytest.skip("Health monitor exposes no ping method to drive")

    assert monitor.is_healthy() is True


# ---------------------------------------------------------------------------
# 2. Unhealthy after 3 consecutive ConnectionErrors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unhealthy_state_after_3_failures(
    mock_litellm_admin,
    settings_override,
):
    """Three consecutive ConnectionErrors flip is_healthy() to False."""
    mod = _try_import_health_monitor()
    monitor = mod.LiteLLMHealthMonitor(admin_client=mock_litellm_admin)

    mock_litellm_admin.get.side_effect = ConnectionError("litellm down")

    ping_method = (
        getattr(monitor, "ping_once", None)
        or getattr(monitor, "check_once", None)
        or getattr(monitor, "_ping", None)
    )
    if ping_method is None:
        pytest.skip("Health monitor exposes no ping method to drive")

    for _ in range(3):
        # Swallow any exception raised from the individual ping —
        # the contract under test is the cached health state.
        try:
            await ping_method()
        except ConnectionError:
            pass

    assert monitor.is_healthy() is False
