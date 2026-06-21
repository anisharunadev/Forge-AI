"""F-507 — Day-One Bootstrap project endpoints.

Three thin routes for the bootstrap lifecycle:
- POST   /api/v1/projects/{project_id}/bootstrap         — trigger bootstrap
- GET    /api/v1/projects/{project_id}/bootstrap/status  — current state
- POST   /api/v1/projects/{project_id}/bootstrap/rerun   — idempotent rerun

The bootstrap is the gate that lets the wizard mark a project active
(F-021 final step). The endpoints are tenant-scoped and project-scoped
via the standard ``Principal`` dependency; the service enforces
multi-tenancy (Rule 2).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.api.deps import Principal, require_permission
from app.core.audit import audit
from app.schemas.day_one_bootstrap import BootstrapResult, BootstrapStatusRead
from app.services.day_one_bootstrap import day_one_bootstrap

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post(
    "/{project_id}/bootstrap",
    response_model=BootstrapResult,
    status_code=202,
)
@audit(action="day_one_bootstrap.trigger", target_type="project")
async def trigger_bootstrap(
    project_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("projects:bootstrap"),
) -> BootstrapResult:
    """Trigger the Day-One Bootstrap for a project.

    Returns ``202 Accepted`` semantics via FastAPI's 202 status code.
    Idempotent — calling repeatedly with no overlay change is a no-op.
    """
    project_metadata = (principal.context or {}).get("project_metadata") if hasattr(principal, "context") else None
    return await day_one_bootstrap.load_baseline(
        project_id=project_id,
        tenant_id=principal.tenant_id,
        actor_id=principal.user_id,
        project_metadata=project_metadata,
    )


@router.get(
    "/{project_id}/bootstrap/status",
    response_model=BootstrapStatusRead,
)
@audit(action="day_one_bootstrap.status", target_type="project")
async def bootstrap_status(
    project_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("projects:read"),
) -> BootstrapStatusRead:
    """Return the current bootstrap state for a project."""
    return await day_one_bootstrap.status_read(
        project_id=project_id, tenant_id=principal.tenant_id
    )


@router.post(
    "/{project_id}/bootstrap/rerun",
    response_model=BootstrapResult,
    status_code=202,
)
@audit(action="day_one_bootstrap.rerun", target_type="project")
async def rerun_bootstrap(
    project_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("projects:bootstrap"),
) -> BootstrapResult:
    """Idempotent rerun of the Day-One Bootstrap.

    A rerun with the same overlay produces an identical result and
    does not duplicate references. A rerun with a different overlay
    replaces the prior references in-place.
    """
    project_metadata = (principal.context or {}).get("project_metadata") if hasattr(principal, "context") else None
    return await day_one_bootstrap.rerun(
        project_id=project_id,
        tenant_id=principal.tenant_id,
        actor_id=principal.user_id,
        project_metadata=project_metadata,
    )


@router.get(
    "/{project_id}/bootstrap",
    response_model=BootstrapResult,
)
@audit(action="day_one_bootstrap.read", target_type="project")
async def get_bootstrap(
    project_id: UUID,
    principal: Principal,
    _perm: Principal = require_permission("projects:read"),
) -> BootstrapResult:
    """Return the full bootstrap result (resolved standards, templates, policies, steering rules)."""
    try:
        return await day_one_bootstrap.get_status(
            project_id=project_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


__all__ = ["router"]
