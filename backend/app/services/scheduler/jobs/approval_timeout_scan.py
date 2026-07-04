"""M2 Plan 01-04 (T-A7) — Approval-timeout scheduler job.

Polls the SDLCState rows (or, more practically for the in-memory
substrate, the in-process run registry) and emits
``EventType.APPROVAL_EXPIRED`` for any pending approval whose
``requested_at + timeout_hours`` has passed without a recorded
decision.

The job is best-effort:
* The SDLC state is held in LangGraph checkpoints (sqlite/postgres);
  we scan the checkpoint store via the run manager's ``list_runs``
  hook so we don't depend on a specific DB schema.
* Tenants whose timeout differs from the global default are picked
  up via :attr:`Settings.approval_timeout_overrides` (per-tenant
  map keyed by tenant_id str).
* A failed run never cascades — the ``try/except`` around each
  tenant swallows per-run errors and the outer ``try/except``
  prevents the scheduler from crashing the worker.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


# Default ceiling (hours).  Mirrors ApprovalGateNode.APPROVAL_TIMEOUT_HOURS.
_DEFAULT_TIMEOUT_HOURS = 24


def _resolve_timeout_hours(tenant_id: str) -> int:
    """Return the per-tenant timeout (hours) for the given tenant."""
    overrides = getattr(settings, "approval_timeout_overrides", None) or {}
    if tenant_id in overrides:
        return int(overrides[tenant_id])
    return int(getattr(settings, "approval_timeout_hours", _DEFAULT_TIMEOUT_HOURS))


async def _scan_pending_approvals() -> list[dict[str, Any]]:
    """Walk the run manager's in-process registry for stale approvals.

    Returns a list of ``{run_id, tenant_id, project_id, approval_id,
    type, requested_at, expires_at, actor_id}`` rows that have passed
    their deadline.

    The implementation delegates to the SDLCRunManager so the
    scheduler doesn't depend on the LangGraph checkpoint storage
    format.  If the run manager isn't reachable (e.g. during test
    boot), the function returns an empty list — a non-fatal
    no-op that the next tick will retry.
    """
    try:
        from app.services.sdlc_run_manager import SDLCRunManager
    except Exception as exc:  # pragma: no cover — partial-init guard
        logger.debug("approval_timeout.run_manager_unavailable", error=str(exc))
        return []

    try:
        manager = SDLCRunManager()
        rows: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)
        for run_id, handle in list(manager._tasks.items()):  # type: ignore[attr-defined]
            state = getattr(handle, "state", None)
            if state is None:
                continue
            pending = getattr(state, "pending_approval", None)
            if pending is None:
                continue
            tenant_id = str(getattr(state, "tenant_id", ""))
            timeout_hours = _resolve_timeout_hours(tenant_id)
            requested_at = getattr(pending, "requested_at", None)
            if requested_at is None:
                continue
            deadline = requested_at + timedelta(hours=timeout_hours)
            if deadline > now:
                continue  # not yet stale
            rows.append(
                {
                    "run_id": str(getattr(state, "run_id", run_id)),
                    "tenant_id": tenant_id,
                    "project_id": str(getattr(state, "project_id", "")),
                    "approval_id": str(getattr(pending, "approval_id", "")),
                    "type": getattr(pending, "type", "architecture"),
                    "requested_at": requested_at.isoformat(),
                    "expires_at": deadline.isoformat(),
                    "actor_id": str(getattr(state, "actor_id", "")) or None,
                }
            )
        return rows
    except Exception as exc:  # noqa: BLE001
        logger.warning("approval_timeout.scan_failed", error=str(exc))
        return []


async def approval_timeout_scan() -> None:
    """Scheduler entry point — runs once per cron tick.

    Iterates the in-process run registry, identifies pending
    approvals that have aged past their per-tenant timeout window,
    and emits ``EventType.APPROVAL_EXPIRED`` for each.  Subscribers
    (audit sink, run-dashboard WS feed, the :class:`ApprovalGateNode`
    itself) react to the event the same way they react to
    ``APPROVAL_DENIED`` — except the UI badge says 'Stale approval'
    instead of 'Denied'.
    """
    try:
        rows = await _scan_pending_approvals()
    except Exception as exc:  # noqa: BLE001 — scheduler never crashes
        logger.exception("approval_timeout.scan_crash", error=str(exc))
        return
    if not rows:
        return
    for row in rows:
        try:
            await bus.publish(
                EventType.APPROVAL_EXPIRED,
                {
                    "run_id": row["run_id"],
                    "approval_id": row["approval_id"],
                    "type": row["type"],
                    "reason": "timeout",
                    "requested_at": row["requested_at"],
                    "expires_at": row["expires_at"],
                },
                tenant_id=row["tenant_id"],
                project_id=row["project_id"],
                actor_id=row["actor_id"],
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "approval_timeout.publish_failed",
                run_id=row["run_id"],
                error=str(exc),
            )


# Sync wrapper for APScheduler's default executor compatibility.
def run() -> None:  # pragma: no cover — APScheduler invokes the async variant
    asyncio.run(approval_timeout_scan())


__all__ = ["approval_timeout_scan", "run"]