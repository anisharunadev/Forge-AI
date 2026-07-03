"""Scheduler dashboard + run-now endpoints (Pillar 1 — Phase 4).

Exposes the in-process :class:`~app.services.scheduler.service.Scheduler`
singleton (created in Phase 3) over HTTP so the Connector Center /
Ideation dashboard can:

- ``GET  /v1/scheduler/jobs``           — list registered jobs.
- ``POST /v1/scheduler/jobs/{id}/run``  — trigger a job immediately.

The ``run`` verb is gated by ``ideation:enhance`` because the two
Phase 3 jobs both touch ideation surfaces (daily ingest + persona
consolidate). A future broadening is trivial once more personas land.

Endpoints are decorated with ``@audit(...)`` (Rule 6) — the operator
identity, target job id, and outcome are all captured.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


# ---------------------------------------------------------------------------
# Job-shape helpers
# ---------------------------------------------------------------------------


def _job_to_dict(job: Any) -> dict[str, Any]:
    """Translate an APScheduler ``Job`` to a JSON-safe dict.

    APScheduler's ``Job`` exposes ``id``, ``name``, ``next_run_time``
    (a ``datetime`` or ``None``), and ``trigger`` (an opaque trigger
    object — we only need its string repr for the dashboard).
    """
    next_run = getattr(job, "next_run_time", None)
    trigger = getattr(job, "trigger", None)
    return {
        "id": str(getattr(job, "id", "")),
        "name": str(getattr(job, "name", "") or getattr(job, "id", "")),
        "next_run_time": (
            next_run.isoformat() if isinstance(next_run, datetime) else None
        ),
        "trigger": str(trigger) if trigger is not None else None,
    }


def _list_jobs() -> list[dict[str, Any]]:
    """Read jobs off the scheduler singleton. Safe when scheduler is unstarted."""
    from app.services.scheduler.service import scheduler as _sched

    if not _sched.is_started:
        return []
    # ``get_jobs()`` is our public surface; reach into the underlying
    # APScheduler only when we need the full job objects for the
    # ``next_run_time`` / ``trigger`` fields.
    inner = getattr(_sched, "_scheduler", None)
    if inner is None:
        return []
    try:
        raw_jobs = inner.get_jobs()
    except Exception:  # noqa: BLE001 — defensive: scheduler may be shutting down
        return []
    return [_job_to_dict(j) for j in raw_jobs]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/jobs")
@audit(action="scheduler.list", target_type="scheduler_job")
async def list_jobs(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read"))
) -> dict[str, Any]:
    """Return registered jobs (id, name, next_run_time, trigger)."""
    return {"jobs": _list_jobs()}


@router.post("/jobs/{job_id}/run")
@audit(action="scheduler.run", target_type="scheduler_job")
async def run_job(
    job_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:enhance"))
) -> dict[str, Any]:
    """Run ``job_id`` immediately and return a status payload.

    Implementation note
    -------------------
    APScheduler's :meth:`modify_job` API would let us reschedule, but
    the cleanest "run now" path is :meth:`AsyncIOScheduler.modify_job`
    to set ``next_run_time=now()`` — the scheduler picks it up on the
    next tick. For a more direct path we just ``run_job`` synchronously
    via the scheduler's internal ``_scheduler.add_job`` override isn't
    possible without a private API, so we use ``modify_job``.

    The function under test in :mod:`app.services.scheduler.jobs.*`
    is a coroutine; APScheduler wraps it in a sync ``Job`` which knows
    how to await it.
    """
    from app.services.scheduler.service import scheduler as _sched

    if not _sched.is_started:
        raise HTTPException(status_code=503, detail="scheduler_not_started")

    inner = getattr(_sched, "_scheduler", None)
    if inner is None:
        raise HTTPException(status_code=503, detail="scheduler_not_started")

    job = inner.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"job_not_found:{job_id}")

    # Force the next tick to be "now".
    try:
        inner.modify_job(job_id, next_run_time=datetime.now(timezone.utc))
    except Exception as exc:  # noqa: BLE001
        logger.warning("scheduler.run_now_failed", job_id=job_id, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    logger.info(
        "scheduler.run_now",
        job_id=job_id,
        actor_id=principal.user_id,
    )
    # We do NOT wait for completion — the run is asynchronous; the
    # operator polls the dashboard or the Ideation ingest status for
    # the eventual row.
    return {
        "job_id": job_id,
        "status": "scheduled",
        "requested_at": datetime.now(timezone.utc).isoformat(),
    }


__all__ = ["router"]
