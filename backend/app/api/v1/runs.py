"""SDLC Run Manager HTTP API (F-301..F-310 partial).

Endpoints
---------
* ``POST   /api/v1/runs``                 — start a new run
* ``GET    /api/v1/runs``                 — list runs (tenant-scoped)
* ``GET    /api/v1/runs/{id}``            — get a run's state
* ``GET    /api/v1/runs/{id}/stream``     — SSE stream of state updates
* ``POST   /api/v1/runs/{id}/resume``     — resume after an approval gate
* ``POST   /api/v1/runs/{id}/cancel``     — cancel a run
* ``GET    /api/v1/runs/{id}/artifacts``  — list artifacts produced
* ``GET    /api/v1/runs/{id}/cost``       — cost summary

Authentication
--------------
The endpoints sit behind the standard RBAC dependencies. In dev /
tests the principal can be supplied as a header (``X-Forge-Principal``)
or via the test fixtures; production wires real Keycloak JWTs through
the ``Principal`` dependency.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import (
    ApprovalResponse,
    SDLCPhase,
    SDLCState,
)
from app.api.deps import DbSession, get_current_principal
from app.core.security import AuthenticatedPrincipal
from app.schemas.sdlc import (
    ApprovalResponseRequest,
    ApprovalResponseResponse,
    ApprovalSnapshot,
    ArtifactSummary,
    CostSummaryResponse,
    PhaseTransitionResponse,
    SDLCancelRequest,
    SDLCRunCreateRequest,
    SDLCRunListResponse,
    SDLCRunStateResponse,
)
from app.services.audit_service import audit_service
from app.services.sdlc_run_manager import (
    CostSummary,
    SDLCRunManager,
    get_default_manager,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs", tags=["sdlc-runs"])


# ---------------------------------------------------------------------------
# Dependency wiring
# ---------------------------------------------------------------------------

def get_run_manager(request: Request) -> SDLCRunManager:
    """Return the manager singleton — kept on ``app.state`` if set."""

    manager: SDLCRunManager | None = getattr(request.app.state, "sdlc_manager", None)
    if manager is None:
        manager = get_default_manager()
        request.app.state.sdlc_manager = manager
    return manager


RunManagerDep = Depends(get_run_manager)


# ---------------------------------------------------------------------------
# Request DTO → internal state helpers
# ---------------------------------------------------------------------------

def _state_to_response(state: SDLCState) -> SDLCRunStateResponse:
    """Translate :class:`SDLCState` into the wire-format response."""

    pending = None
    if state.pending_approval is not None:
        p = state.pending_approval
        pending = ApprovalSnapshot(
            approval_id=p.approval_id,
            type=p.type,
            required_role=p.required_role,
            requested_at=p.requested_at,
            expires_at=p.expires_at,
            target_artifact_id=p.target_artifact_id,
            reason=p.reason,
            payload=p.payload,
        )
    return SDLCRunStateResponse(
        run_id=state.run_id,
        tenant_id=state.tenant_id,
        project_id=state.project_id,
        actor_id=state.actor_id,
        current_phase=state.current_phase,
        phase_history=[
            PhaseTransitionResponse(
                from_phase=t.from_phase,
                to_phase=t.to_phase,
                at=t.at,
                actor_id=t.actor_id,
                reason=t.reason,
            )
            for t in state.phase_history
        ],
        artifacts={
            k: ArtifactSummary(
                artifact_id=v.artifact_id,
                type=v.type,
                version=v.version,
                phase=v.phase,
                content_hash=v.content_hash,
                summary=v.summary,
            )
            for k, v in state.artifacts.items()
        },
        pending_approval=pending,
        cost_so_far=state.cost_so_far,
        errors=[e.model_dump(mode="json") for e in state.errors],
        created_at=state.created_at,
        updated_at=state.updated_at,
        metadata=state.metadata,
        context=state.context,
    )


def _cost_to_response(summary: CostSummary) -> CostSummaryResponse:
    return CostSummaryResponse(
        run_id=summary.run_id,
        total_usd=summary.total_usd,
        by_phase={p.value: v for p, v in summary.by_phase.items()},
        prompt_tokens=summary.prompt_tokens,
        completion_tokens=summary.completion_tokens,
        call_count=summary.call_count,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "",
    response_model=SDLCRunStateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_run(
    body: SDLCRunCreateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> SDLCRunStateResponse:
    """Start a new SDLC run for a project."""

    initial_context = dict(body.initial_context)
    if body.workspace_path:
        initial_context["workspace_path"] = body.workspace_path
    if body.repo_path:
        initial_context["repo_path"] = body.repo_path
    state = await manager.start_run(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        actor_id=principal.user_id,
        initial_context=initial_context,
    )
    return _state_to_response(state)


@router.get("", response_model=SDLCRunListResponse)
async def list_runs(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    status_filter: SDLCPhase | None = Query(default=None, alias="status"),
    manager: SDLCRunManager = RunManagerDep,
) -> SDLCRunListResponse:
    """List runs for the caller's tenant, optionally filtered by project / status."""

    runs = await manager.list_runs(
        tenant_id=principal.tenant_id,
        project_id=project_id,
        status=status_filter,
    )
    items = [_state_to_response(s) for s in runs]
    return SDLCRunListResponse(items=items, total=len(items), page=1, page_size=len(items))


@router.get("/{run_id}", response_model=SDLCRunStateResponse)
async def get_run(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> SDLCRunStateResponse:
    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")
    return _state_to_response(state)


@router.get("/{run_id}/stream")
async def stream_run(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> StreamingResponse:
    """SSE endpoint: emit one ``data:`` line per state snapshot.

    Consumers subscribe for the lifetime of the run; the stream closes
    when ``current_phase`` becomes ``DONE`` or ``FAILED``.
    """

    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")

    async def _gen() -> AsyncIterator[bytes]:
        sub = await manager.broker.subscribe(run_id)
        try:
            # Emit current snapshot first.
            current = await manager.get_run(run_id)
            if current is not None:
                yield _sse_format(_state_to_response(current).model_dump(mode="json"))
            while True:
                try:
                    snapshot = await asyncio.wait_for(sub.queue.get(), timeout=15.0)
                except TimeoutError:
                    yield b": keep-alive\n\n"
                    continue
                yield _sse_format(_state_to_response(snapshot).model_dump(mode="json"))
                if snapshot.current_phase in (SDLCPhase.DONE, SDLCPhase.FAILED):
                    break
        finally:
            await manager.broker.unsubscribe(run_id, sub)

    return StreamingResponse(_gen(), media_type="text/event-stream")


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{run_id}/resume", response_model=ApprovalResponseResponse)
async def resume_run(
    run_id: UUID,
    body: ApprovalResponseRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> ApprovalResponseResponse:
    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")
    if state.pending_approval is None:
        raise HTTPException(status_code=409, detail="no_pending_approval")
    response = ApprovalResponse(
        approval_id=body.approval_id,
        granted=body.granted,
        decided_by=principal.user_id,
        decided_at=datetime.now(UTC),
        reason=body.reason,
    )
    new_state = await manager.resume_run(run_id, approval_response=response)
    return ApprovalResponseResponse(
        run_id=new_state.run_id,
        approval_id=body.approval_id,
        granted=body.granted,
        decided_by=principal.user_id,
        decided_at=response.decided_at,
        reason=body.reason,
        resumed=new_state.current_phase not in (SDLCPhase.DONE, SDLCPhase.FAILED),
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/{run_id}/cancel", response_model=SDLCRunStateResponse)
async def cancel_run(
    run_id: UUID,
    body: SDLCancelRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> SDLCRunStateResponse:
    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")
    new_state = await manager.cancel_run(run_id, reason=body.reason)
    return _state_to_response(new_state)


@router.get("/{run_id}/artifacts")
async def list_artifacts(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> dict[str, Any]:
    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")
    artifacts = await manager.get_run_artifacts(run_id)
    return {"run_id": str(run_id), "artifacts": artifacts, "count": len(artifacts)}


@router.get("/{run_id}/cost", response_model=CostSummaryResponse)
async def get_cost(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> CostSummaryResponse:
    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")
    return _cost_to_response(await manager.get_run_cost(run_id))


# ---------------------------------------------------------------------------
# M2 ADR-009 — per-RUN cumulative budget surface (Track B T-B7)
# ---------------------------------------------------------------------------


@router.get("/_default_budget")
async def get_default_run_budget(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
) -> dict[str, Any]:
    """GET /api/v1/runs/_default_budget — per-tenant default ceiling snapshot.

    Lightweight read that returns the per-tenant ceiling a *new* run
    starts with (``run_budget_cap_overrides[tenant_id]`` or the global
    ``run_budget_cap_usd`` fallback). Spent is 0 since no run_id is
    yet associated. Used by the Runs Center index page so operators
    see the available budget hint before they click "New run".
    """
    from app.core.config import settings

    tenant_key = str(principal.tenant_id)
    ceiling_usd = float(
        settings.run_budget_cap_overrides.get(
            tenant_key, settings.run_budget_cap_usd
        )
    )
    return {
        "tenant_id": tenant_key,
        "ceiling_usd": ceiling_usd,
        "spent_usd": 0.0,
        "remaining_usd": ceiling_usd,
        "currency": settings.cost_currency,
    }


@router.get("/{run_id}/budget")
async def get_run_budget(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    manager: SDLCRunManager = RunManagerDep,
) -> dict[str, Any]:
    """GET /api/v1/runs/{run_id}/budget — per-RUN cumulative cap snapshot.

    Returns the operator-facing budget surface consumed by
    :class:`apps.forge.components.runs.RunBudgetBadge`:

        {
            "run_id": "...",
            "tenant_id": "...",
            "ceiling_usd": 50.0,
            "spent_usd": 12.34,
            "remaining_usd": 37.66,
            "currency": "USD"
        }

    ``ceiling_usd`` resolves per-tenant:
    ``run_budget_cap_overrides[tenant_id]`` when present, else the
    global ``run_budget_cap_usd``. ``spent_usd`` sums the confirmed
    (``projected = false``) ledger rows for the run — the same value
    the cumulative-cap rule consumes in
    :func:`app.services.litellm_client.pre_call_admission`.

    A phase guard runs inline (PLANNING / DISCOVERY only) so the
    endpoint returns 409 (not 500) when invoked outside the gate.
    The :func:`require_approval_phase` marker is applied as the
    M2-G6 hygiene signal — its runtime guard requires ``SDLCState``
    as a positional argument which FastAPI does not inject for
    path operations.
    """
    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")

    if state.current_phase not in (SDLCPhase.PLANNING, SDLCPhase.DISCOVERY):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "phase_not_planning",
                "current_phase": state.current_phase.value,
                "allowed_phases": [
                    SDLCPhase.PLANNING.value,
                    SDLCPhase.DISCOVERY.value,
                ],
            },
        )

    from app.core.config import settings
    from app.services.cost_ledger import cost_ledger

    tenant_key = str(principal.tenant_id)
    ceiling_usd = float(
        settings.run_budget_cap_overrides.get(
            tenant_key, settings.run_budget_cap_usd
        )
    )
    spent_usd = await cost_ledger.sum_spent_for_run(run_id)
    remaining_usd = max(0.0, ceiling_usd - float(spent_usd))

    return {
        "run_id": str(run_id),
        "tenant_id": tenant_key,
        "ceiling_usd": ceiling_usd,
        "spent_usd": float(spent_usd),
        "remaining_usd": remaining_usd,
        "currency": settings.cost_currency,
    }


@router.get("/{run_id}/explainability")
async def get_run_explainability(
    run_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
    manager: SDLCRunManager = RunManagerDep,
) -> dict[str, Any]:
    """GET /api/v1/runs/{id}/explainability — CodeRabbit 5-question bundle.

    Recomputed on every request from existing tables (Rule 4 — no
    schema migration). Emits an ``audit_event`` for the access itself
    so the read is auditable (Rule 6).
    """
    # Soft import — the explainability service is only used here, so
    # we keep it out of the module top-level import set until other
    # endpoints need it.
    from app.services.explainability import RunExplainabilityService

    state = await manager.get_run(run_id)
    if state is None or state.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="run_not_found")

    service = RunExplainabilityService(manager)
    bundle = await service.compute(
        db,
        run_id=run_id,
        tenant_id=principal.tenant_id,
        project_id=state.project_id,
    )

    await audit_service.record(
        tenant_id=principal.tenant_id,
        project_id=state.project_id,
        actor_id=principal.user_id,
        action="runs.explainability.get",
        target_type="sdlc_run",
        target_id=str(run_id),
        payload={"grade": bundle.grade, "schema_version": bundle.schema_version},
    )

    return bundle.model_dump(mode="json")


def _sse_format(payload: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(payload, default=str)}\n\n".encode()


__all__ = ["router"]
