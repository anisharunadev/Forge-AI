"""Tests for the M2 Plan 01-04 (PITFALL-6) approval-expiry scheduler.

Covers the typed facade in :mod:`app.scheduler.approval_expiry` and
the underlying scan job in
:mod:`app.services.scheduler.jobs.approval_timeout_scan`. Five cases:

1. ``test_scan_once_publishes_for_expired`` — pending approval older
   than its timeout causes one ``EventType.APPROVAL_EXPIRED`` publish
   with the expected envelope keys (Rule 2: tenant_id, project_id).
2. ``test_scan_once_skips_fresh`` — fresh pending approval → no publish.
3. ``test_effective_timeout_tenant_override_wins`` — tenant override
   beats per-phase override.
4. ``test_effective_timeout_phase_override_used_when_no_tenant`` —
   per-phase override is consulted when no tenant override.
5. ``test_effective_timeout_falls_back_to_default`` — global default
   is the final fallback.

The test uses the in-process :class:`SDLCRunManager` registry to
inject a synthetic pending approval so the scan has something to
walk. APScheduler is NOT exercised here (the interval scheduler is
tested in ``tests/services/scheduler/``); this file targets the
per-tick ``scan_once`` path and the resolution order of
``effective_timeout_hours``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.sdlc_state import (
    ApprovalRequest,
    SDLCState,
)
from app.core.config import settings
from app.scheduler.approval_expiry import (
    ApprovalExpiryService,
    EventType,
    effective_timeout_hours,
)
from app.services.event_bus import EventType as EventTypeCanonical

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_pending_state(*, requested_hours_ago: float) -> tuple[SDLCState, ApprovalRequest]:
    """Build a synthetic ``SDLCState`` with a pending approval aged
    ``requested_hours_ago`` from now. Returns ``(state, request)`` so
    the test can assert against either object.
    """
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    approval_id = uuid.uuid4()
    requested_at = datetime.now(UTC) - timedelta(hours=requested_hours_ago)
    request = ApprovalRequest(
        approval_id=approval_id,
        type="architecture",
        required_role="forge-architect",
        requested_at=requested_at,
        expires_at=requested_at + timedelta(hours=24),
    )
    state = SDLCState(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        pending_approval=request,
        context={"repo_path": "/tmp", "workspace_path": "/tmp/ws"},
    )
    return state, request


def _register_run_in_manager(manager: Any, state: SDLCState) -> None:
    """Pin ``state`` into the in-process manager so the scan picks it up.

    The scan walks ``manager._tasks`` and reads ``handle.state``;
    the cheapest seam is to register a fake handle whose ``.state``
    attribute is the synthetic state. We also seed ``manager._states``
    so the broker publish path (if the scan takes it) finds the row.
    """
    fake_handle = type("_Handle", (), {"state": state})()
    manager._tasks[state.run_id] = fake_handle
    manager._states[state.run_id] = state


class _StubManager:
    """Minimal stand-in for :class:`SDLCRunManager` the scan can walk.

    The shipped ``approval_timeout_scan`` builds ``SDLCRunManager()``
    fresh on every call (it doesn't go through ``get_default_manager``),
    so the test must inject THIS stub via ``patch`` rather than rely on
    the default singleton. The stub exposes just the attributes the
    scan touches (``_tasks``, ``_states``) and a no-op async
    ``broker.publish``.
    """

    def __init__(self) -> None:
        self._tasks: dict[Any, Any] = {}
        self._states: dict[Any, Any] = {}

    class _StubBroker:
        async def publish(self, *args: Any, **kwargs: Any) -> None:
            return None

    broker = _StubBroker()


# ---------------------------------------------------------------------------
# Test 1: expired approval triggers publish
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_once_publishes_for_expired() -> None:
    """A 25h-old pending approval causes one APPROVAL_EXPIRED publish."""
    state, request = _build_pending_state(requested_hours_ago=25)

    stub = _StubManager()
    _register_run_in_manager(stub, state)
    try:
        service = ApprovalExpiryService()
        # Patch the ``SDLCRunManager`` constructor the scan calls
        # (it builds a fresh instance every tick), and patch the
        # module-level bus the scan publishes to.
        publish_mock = AsyncMock()
        with (
            patch(
                "app.services.sdlc_run_manager.SDLCRunManager",
                return_value=stub,
            ),
            patch("app.services.scheduler.jobs.approval_timeout_scan.bus") as module_bus,
        ):
            module_bus.publish = publish_mock
            await service.scan_once()
        # At least one publish should have fired with our event type
        # and the expected envelope shape. The plan only requires the
        # shipped EventType.APPROVAL_EXPIRED to be emitted; the exact
        # call count is implementation-detail (one per row).
        assert publish_mock.call_count >= 1
        types_emitted = [call.args[0] for call in publish_mock.call_args_list]
        assert EventType.APPROVAL_EXPIRED in types_emitted
        # At least one publish call must carry tenant_id + project_id
        # (Rule 2). Inspect args/kwargs of the first matching call.
        # Signature: ``bus.publish(event_type, payload, **kwargs)`` —
        # the payload is the second positional arg.
        saw_envelope = False
        for call in publish_mock.call_args_list:
            args, kwargs = call.args, call.kwargs
            if (
                len(args) >= 2
                and isinstance(args[1], dict)
                and "tenant_id" in kwargs
                and "project_id" in kwargs
            ):
                payload = args[1]
                assert "run_id" in payload
                assert "approval_id" in payload
                assert payload["reason"] == "approval_expired"
                assert str(kwargs["tenant_id"]) == str(state.tenant_id)
                assert str(kwargs["project_id"]) == str(state.project_id)
                saw_envelope = True
                break
        assert saw_envelope, "no publish carried the Rule 2 envelope"
    finally:
        stub._tasks.pop(state.run_id, None)
        stub._states.pop(state.run_id, None)


# ---------------------------------------------------------------------------
# Test 2: fresh approval does NOT trigger publish
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_once_skips_fresh() -> None:
    """A 1h-old pending approval (well under the 24h default) is skipped."""
    state, _request = _build_pending_state(requested_hours_ago=1)

    stub = _StubManager()
    _register_run_in_manager(stub, state)
    try:
        service = ApprovalExpiryService()
        with (
            patch(
                "app.services.sdlc_run_manager.SDLCRunManager",
                return_value=stub,
            ),
            patch("app.services.scheduler.jobs.approval_timeout_scan.bus") as module_bus,
        ):
            module_bus.publish = AsyncMock()
            await service.scan_once()
            # Fresh row → no publish on the underlying bus.
            assert module_bus.publish.call_count == 0
    finally:
        stub._tasks.pop(state.run_id, None)
        stub._states.pop(state.run_id, None)


# ---------------------------------------------------------------------------
# Test 3: tenant override beats phase override
# ---------------------------------------------------------------------------


def test_effective_timeout_tenant_override_wins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When BOTH tenant and phase overrides are set, tenant wins."""
    tenant_uuid = str(uuid.uuid4())
    monkeypatch.setitem(settings.approval_timeout_overrides, tenant_uuid, 1)
    monkeypatch.setitem(settings.approval_timeout_overrides_per_phase, "architecture", 48)
    try:
        result = effective_timeout_hours("architecture", tenant_uuid)
        assert result == 1, f"expected tenant override (1h) to win over phase (48h); got {result}"
    finally:
        settings.approval_timeout_overrides.pop(tenant_uuid, None)
        settings.approval_timeout_overrides_per_phase.pop("architecture", None)


# ---------------------------------------------------------------------------
# Test 4: phase override used when no tenant override
# ---------------------------------------------------------------------------


def test_effective_timeout_phase_override_used_when_no_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Per-phase override is consulted when no tenant override is set."""
    tenant_uuid = str(uuid.uuid4())
    # No tenant override — but a phase override exists.
    monkeypatch.setitem(settings.approval_timeout_overrides_per_phase, "architecture", 48)
    try:
        result = effective_timeout_hours("architecture", tenant_uuid)
        assert result == 48
    finally:
        settings.approval_timeout_overrides_per_phase.pop("architecture", None)


# ---------------------------------------------------------------------------
# Test 5: global default is the final fallback
# ---------------------------------------------------------------------------


def test_effective_timeout_falls_back_to_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No overrides → settings.approval_timeout_hours (24h default)."""
    tenant_uuid = str(uuid.uuid4())
    # Ensure no override is set for this tenant/phase.
    settings.approval_timeout_overrides.pop(tenant_uuid, None)
    settings.approval_timeout_overrides_per_phase.pop("architecture", None)
    # Sanity check the default hasn't drifted before the assertion.
    assert settings.approval_timeout_hours == 24
    result = effective_timeout_hours("architecture", tenant_uuid)
    assert result == 24


# ---------------------------------------------------------------------------
# Sanity: the canonical EventType is re-exported and matches the bus enum
# ---------------------------------------------------------------------------


def test_event_type_alias_matches_canonical() -> None:
    assert EventType is EventTypeCanonical
    assert EventType.APPROVAL_EXPIRED.value == "approval.expired"
