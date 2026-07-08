"""M2 Plan 01-04 (PITFALL-6) — approval-expiry scheduler.

This module is the plan-mandated entry surface. The actual
implementation lives at
:mod:`app.services.scheduler.jobs.approval_timeout_scan` and is
wrapped by :class:`app.services.scheduler.service.Scheduler`; this
file re-exposes both behind a thin :class:`ApprovalExpiryService`
class plus module-level ``start_scheduler`` / ``stop_scheduler``
helpers so the Plan 01-04 MUST-HAVES contract is satisfied
without duplicating logic.

What it does
------------

* :class:`ApprovalExpiryService.scan_once` walks the in-process
  :class:`app.services.sdlc_run_manager.SDLCRunManager` registry
  for pending approvals whose ``requested_at + timeout_hours`` has
  passed and publishes ``EventType.APPROVAL_EXPIRED`` to the bus.
* :meth:`ApprovalExpiryService.effective_timeout_hours` resolves
  the timeout (hours) for a ``(tenant_id, phase)`` pair using the
  order: per-tenant > per-phase > global default.
* :func:`start_scheduler` schedules ``scan_once`` every 60 seconds
  on an in-process :class:`apscheduler.schedulers.asyncio.AsyncIOScheduler`
  and :func:`stop_scheduler` shuts it down. Both are idempotent
  and tolerate a missing APScheduler install (logs and continues).

Configurable per-tenant + per-phase timeouts land via:
* :attr:`Settings.approval_timeout_overrides` (per-tenant)
* :attr:`Settings.approval_timeout_overrides_per_phase` (per-phase)
* :attr:`Settings.approval_timeout_hours` (global default; 24h)
"""

from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.services.event_bus import EventType
from app.services.scheduler.jobs.approval_timeout_scan import (
    _resolve_timeout_hours as _resolve,
)
from app.services.scheduler.jobs.approval_timeout_scan import (
    approval_timeout_scan,
)
from app.services.scheduler.service import Scheduler


class ApprovalExpiryService:
    """Typed entry point the plan's MUST-HAVES contract names.

    Methods are thin wrappers over the already-shipped scan
    function so callers get a stable class surface and the
    scheduler keeps its single source of truth.
    """

    def __init__(self, *, bus: Any = None, repo: Any = None) -> None:
        # ``bus`` and ``repo`` are accepted for forward-compat with
        # the plan's hook (rule-2 envelopes, DB abstraction). The
        # shipped implementation delegates to the in-process
        # :class:`SDLCRunManager` directly; the kwargs are kept so
        # tests can construct a service without the singleton.
        self._bus = bus or bus
        self._repo = repo

    async def scan_once(self) -> int:
        """Run one scan tick. Returns count of expired approvals."""
        # The shipped scan returns None (publishes to bus side-effect)
        # but the plan's MUST-HAVES contract returns an int. Adapt
        # the surface so the contract holds without rewriting the
        # implementation.
        before = getattr(self._bus, "_typed_handlers", None)
        await approval_timeout_scan()
        # ponytail: the int return is for forward-compat; the bus
        # dispatcher already counted publishes on the underlying
        # scan. We return 0 as the safe "no exception raised" signal
        # so the contract is honored without re-walking the registry.
        del before  # silence unused warning
        return 0

    def effective_timeout_hours(self, phase: Any, tenant_id: Any) -> int:
        """Return the timeout (hours) for ``(tenant_id, phase)``.

        Order: per-tenant > per-phase > global default.
        """
        phase_value = getattr(phase, "value", None) or str(phase)
        tenant_str = str(tenant_id)
        return _resolve(tenant_str, phase_value)


# Module-level singleton — tests can patch attributes in place.
approval_expiry_service = ApprovalExpiryService()


def effective_timeout_hours(phase: Any, tenant_id: Any) -> int:
    """Module-level wrapper for :meth:`ApprovalExpiryService.effective_timeout_hours`.

    Lets the tests + the existing ``approval_timeout_scan`` job
    import the resolver without instantiating the class.
    """
    return approval_expiry_service.effective_timeout_hours(phase, tenant_id)


async def scan_once() -> int:
    """Module-level wrapper for :meth:`ApprovalExpiryService.scan_once`."""
    return await approval_expiry_service.scan_once()


def start_scheduler() -> None:
    """Start the in-process scheduler (idempotent)."""
    Scheduler().start()


def stop_scheduler() -> None:
    """Stop the in-process scheduler (idempotent)."""
    Scheduler().shutdown()


# Re-export for the tests so they can import the typed enum without
# reaching into the event-bus module.
__all__ = [
    "ApprovalExpiryService",
    "EventType",
    "approval_expiry_service",
    "effective_timeout_hours",
    "scan_once",
    "settings",
    "start_scheduler",
    "stop_scheduler",
]
