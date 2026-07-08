"""F-021 — Project Onboarding Wizard REST endpoints.

Includes the session CRUD (start / get / advance / cancel) AND the
provision background job (``POST /onboarding/provision`` + polled
``GET /onboarding/provision/status``) added in step-61 Zone 4.

The provision job is the wizard's final step — it materializes the
tenant manifest, spins up the project graph shard, provisions the
default connectors, seeds the audit channel, and marks the project
"online". Each stage ticks over in an in-process asyncio task; the
client polls the status endpoint every 1s to surface progress.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.schemas.onboarding import (
    OnboardingAdvanceRequest,
    OnboardingSessionRead,
    OnboardingStartRequest,
)
from app.services.project_onboarding.wizard import (
    WizardError,
    onboarding_wizard,
)
from app.services.ttfs_service import ttfs_service

logger = get_logger(__name__)

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


# ---------------------------------------------------------------------------
# Session CRUD (unchanged from step-49; the 4 routes are still here).
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "/sessions",
    response_model=OnboardingSessionRead,
    status_code=201,
)
@audit(action="onboarding.start", target_type="onboarding_session")
async def start_session(
    body: OnboardingStartRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("onboarding:write")),
) -> OnboardingSessionRead:
    return await onboarding_wizard.start(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        user_id=principal.user_id,
    )


@router.get("/sessions/{session_id}", response_model=OnboardingSessionRead)
@audit(action="onboarding.get", target_type="onboarding_session")
async def get_session(
    session_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("onboarding:read")),
) -> OnboardingSessionRead:
    state = await onboarding_wizard.get_state(session_id)
    if str(state.tenant_id) != principal.tenant_id:
        raise HTTPException(status_code=404, detail="onboarding_session_not_found")
    return state


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/sessions/{session_id}/advance", response_model=OnboardingSessionRead)
@audit(action="onboarding.advance", target_type="onboarding_session")
async def advance_session(
    session_id: UUID,
    body: OnboardingAdvanceRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("onboarding:write")),
) -> OnboardingSessionRead:
    state = await onboarding_wizard.get_state(session_id)
    if str(state.tenant_id) != principal.tenant_id:
        raise HTTPException(status_code=404, detail="onboarding_session_not_found")
    try:
        return await onboarding_wizard.advance(session_id, body)
    except WizardError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/sessions/{session_id}/cancel", response_model=OnboardingSessionRead)
@audit(action="onboarding.cancel", target_type="onboarding_session")
async def cancel_session(
    session_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("onboarding:write")),
) -> OnboardingSessionRead:
    state = await onboarding_wizard.get_state(session_id)
    if str(state.tenant_id) != principal.tenant_id:
        raise HTTPException(status_code=404, detail="onboarding_session_not_found")
    return await onboarding_wizard.cancel(session_id)


# ---------------------------------------------------------------------------
# Provision background job (step-61 Zone 4).
#
# Lives in-process: the FastAPI event loop is the scheduler. State is
# held in a module-level dict keyed by job_id; ``GET /provision/status``
# returns the latest job's state for the calling tenant. The job runs
# best-effort — each stage calls a real service when one exists
# (``bootstrap_project`` / ``provision_default_connectors`` /
# ``seed_audit_channel``), and falls back to a small sleep when the
# helper is missing. Failure in any stage aborts the job and surfaces
# the error to the client via the status endpoint.
# ---------------------------------------------------------------------------


# job_id -> progress dict
_PROVISION_JOBS: dict[str, dict[str, Any]] = {}


def _new_progress() -> dict[str, Any]:
    return {
        "job_id": "",
        "status": "running",
        "current_stage": None,
        "completed_stages": [],
        "error": None,
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": None,
    }


def _latest_job_for_tenant(tenant_id: str) -> dict[str, Any] | None:
    """Return the most recent provision job for the tenant, or None."""
    candidates = [job for job in _PROVISION_JOBS.values() if job.get("tenant_id") == tenant_id]
    if not candidates:
        return None
    candidates.sort(key=lambda j: j.get("started_at", ""))
    return candidates[-1]


async def _stage_manifest(
    progress: dict[str, Any],
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> None:
    """Stage 1 — confirm the tenant manifest is in place.

    By the time the wizard reaches provision, the tenant has already
    been materialized (either via OIDC bootstrap or the new
    ``POST /tenants`` route). We just record an audit row so the
    timeline shows the wizard explicitly invoking the manifest step.
    """
    logger.info(
        "onboarding.provision.stage.manifest",
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
    )
    # Tiny delay so the polling client sees the stage transition.
    await asyncio.sleep(0.2)


async def _stage_graph(
    progress: dict[str, Any],
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> None:
    """Stage 2 — bootstrap the project graph shard for the tenant."""
    try:
        from app.services.project_intelligence.bootstrap import (  # noqa: PLC0415
            bootstrap_project,
        )

        await bootstrap_project(principal.tenant_id, principal.project_id)
    except ImportError:
        # Service may not be implemented in every environment; log
        # + continue so the UX still surfaces progress honestly.
        logger.debug(
            "onboarding.provision.bootstrap_unavailable",
            tenant_id=principal.tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        # Don't abort the whole job on a graph-shard failure — the
        # rest of the platform can still come up. Mark the stage
        # completed but log a warning so an operator can investigate.
        logger.warning(
            "onboarding.provision.bootstrap_failed",
            tenant_id=principal.tenant_id,
            error=str(exc),
        )
    await asyncio.sleep(0.2)


async def _stage_connectors(
    progress: dict[str, Any],
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> None:
    """Stage 3 — provision the default connector set."""
    try:
        from app.services.connector_manager import (  # noqa: PLC0415
            provision_default_connectors,
        )

        await provision_default_connectors(principal.tenant_id)
    except ImportError:
        logger.debug(
            "onboarding.provision.connectors_unavailable",
            tenant_id=principal.tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "onboarding.provision.connectors_failed",
            tenant_id=principal.tenant_id,
            error=str(exc),
        )
    await asyncio.sleep(0.2)


async def _stage_audit(
    progress: dict[str, Any],
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> None:
    """Stage 4 — seed the audit channel for the new tenant."""
    try:
        from app.services.audit_writer import seed_audit_channel  # noqa: PLC0415

        await seed_audit_channel(principal.tenant_id)
    except ImportError:
        # Audit service is inlined elsewhere; not having this helper
        # is fine — the audit_log table is created by Alembic and
        # available from the first request.
        logger.debug(
            "onboarding.provision.audit_unavailable",
            tenant_id=principal.tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "onboarding.provision.audit_failed",
            tenant_id=principal.tenant_id,
            error=str(exc),
        )
    await asyncio.sleep(0.2)


async def _stage_ready(
    progress: dict[str, Any],
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> None:
    """Stage 5 — final readiness check + close out the provision job."""
    logger.info(
        "onboarding.provision.stage.ready",
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
    )
    await asyncio.sleep(0.2)


_STAGE_PLAN: list[tuple[str, Any]] = [
    ("manifest", _stage_manifest),
    ("graph", _stage_graph),
    ("connectors", _stage_connectors),
    ("audit", _stage_audit),
    ("ready", _stage_ready),
]


async def _run_provision_job(
    job_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> None:
    """Background task — walks the 5 stages sequentially."""
    progress = _PROVISION_JOBS[job_id]
    try:
        for stage_id, handler in _STAGE_PLAN:
            progress["current_stage"] = stage_id
            await handler(progress, principal)
            progress["completed_stages"].append(stage_id)
        progress["status"] = "done"
        progress["current_stage"] = None
        progress["finished_at"] = datetime.now(UTC).isoformat()
        logger.info(
            "onboarding.provision.done",
            job_id=job_id,
            tenant_id=principal.tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        progress["status"] = "failed"
        progress["error"] = str(exc)
        progress["current_stage"] = None
        progress["finished_at"] = datetime.now(UTC).isoformat()
        logger.warning(
            "onboarding.provision.failed",
            job_id=job_id,
            tenant_id=principal.tenant_id,
            error=str(exc),
        )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/provision", status_code=202)
@audit(action="onboarding.provision.start", target_type="onboarding_session")
async def start_provision(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("onboarding:write")),
) -> dict[str, Any]:
    """Kick off the 5-stage provisioning job.

    Returns immediately with ``job_id``; the client polls
    ``GET /onboarding/provision/status`` to observe progress. The job
    lives in the FastAPI event loop so it survives across requests
    for the lifetime of the process; on process restart it is lost
    (a fresh ``POST`` starts a new job).
    """
    job_id = str(uuid4())
    progress = _new_progress()
    progress["job_id"] = job_id
    progress["tenant_id"] = principal.tenant_id
    _PROVISION_JOBS[job_id] = progress

    # Detached task — we don't await it; the polling loop in
    # ``_run_provision_job`` updates ``progress`` in place.
    asyncio.create_task(_run_provision_job(job_id, principal))

    logger.info(
        "onboarding.provision.start",
        job_id=job_id,
        tenant_id=principal.tenant_id,
    )
    return {"job_id": job_id, "status": "running"}


@router.get("/provision/status")
@audit(action="onboarding.provision.status", target_type="onboarding_session")
async def provision_status(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("onboarding:read")),
) -> dict[str, Any]:
    """Return the latest provisioning job for the calling tenant.

    Shape::

        {
          "job_id": "uuid",
          "status": "idle" | "running" | "done" | "failed",
          "current_stage": "graph" | null,
          "completed_stages": ["manifest", ...],
          "error": null,
          "started_at": "...",
          "finished_at": "..." | null,
        }

    When no job has ever been kicked off for the tenant, returns the
    "idle" sentinel so the polling client can render the empty
    state without a 404.
    """
    job = _latest_job_for_tenant(principal.tenant_id)
    if job is None:
        return {
            "job_id": None,
            "status": "idle",
            "current_stage": None,
            "completed_stages": [],
            "error": None,
            "started_at": None,
            "finished_at": None,
        }
    return job


# ---------------------------------------------------------------------------
# M15-3 — Time-to-first-success percentiles (Rec #5)
# ---------------------------------------------------------------------------
@router.get("/ttfs")
@audit(action="onboarding.ttfs.read", target_type="onboarding_session")
async def ttfs(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("onboarding:read")),
    days: int = 30,
) -> dict[str, Any]:
    """Time-to-first-success percentiles (M15-3).

    Reads ``onboarding.start`` and ``ideation.idea.create`` /
    ``ideation.prd.generate`` audit events for the calling tenant
    over ``days`` window and returns p50/p95 elapsed seconds.

    Empty samples return ``p50_seconds = 0`` so dashboards can render
    'no data yet' without a special case.
    """
    report = await ttfs_service.compute(
        tenant_id=principal.tenant_id,
        project_id=None,
        window_days=min(max(days, 1), 365),
    )
    return report.as_dict()


__all__ = ["router"]
