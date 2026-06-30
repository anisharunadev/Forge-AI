"""Projects API — CRUD + bootstrap + settings counts.

Settings → General tab is wired to GET/PATCH /projects/{id}.
Day-One Bootstrap (F-021) keeps its own sub-routes.
The settings/counts endpoint drives the SettingsSidebar badges.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.db.models.agent_config import AgentConfig
from app.db.models.audit import AuditEvent
from app.db.models.connector import Connector
from app.db.models.env_var import EnvVar
from app.db.models.project import Project
from app.db.models.project_invitation import ProjectInvitation
from app.db.models.project_member import ProjectMember
from app.schemas.day_one_bootstrap import BootstrapResult, BootstrapStatusRead
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from app.services.day_one_bootstrap import day_one_bootstrap

router = APIRouter(prefix="/projects", tags=["projects"])


# ---------------------------------------------------------------------------
# CRUD (Settings → General tab)
# ---------------------------------------------------------------------------


def _project_to_read(project: Project) -> ProjectRead:
    return ProjectRead(
        id=project.id,
        tenant_id=project.tenant_id,
        name=project.name,
        slug=project.slug,
        description=project.description,
        default_branch=project.default_branch,
        visibility=project.visibility,
        status=project.status,
        created_by=project.created_by,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.get("", response_model=list[ProjectRead])
@audit(action="projects.list", target_type="tenant")
async def list_projects(
    principal: Principal,
    db: DbSession,
) -> list[ProjectRead]:
    """List every project in the caller's tenant, newest first."""
    result = await db.execute(
        select(Project)
        .where(Project.tenant_id == UUID(principal.tenant_id))
        .order_by(Project.created_at.desc())
    )
    return [_project_to_read(p) for p in result.scalars().all()]


@router.post("", response_model=ProjectRead, status_code=201)
@audit(action="projects.create", target_type="project")
async def create_project(
    body: ProjectCreate,
    principal: Principal,
    db: DbSession,
) -> ProjectRead:
    """Create a new project in the caller's tenant."""
    tenant_uuid = UUID(principal.tenant_id)

    existing = (
        await db.execute(
            select(Project).where(
                Project.tenant_id == tenant_uuid,
                Project.slug == body.slug,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="slug_already_taken")

    project = Project(
        id=uuid4(),
        tenant_id=tenant_uuid,
        name=body.name,
        slug=body.slug,
        description=body.description,
        default_branch=body.default_branch or "main",
        visibility=body.visibility or "private",
        created_by=UUID(principal.user_id) if principal.user_id else None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return _project_to_read(project)


@router.get("/{project_id}", response_model=ProjectRead)
@audit(action="projects.read", target_type="project")
async def get_project(
    project_id: UUID,
    principal: Principal,
    db: DbSession,
) -> ProjectRead:
    """Read a single project by id (tenant-scoped)."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == UUID(principal.tenant_id),
        )
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return _project_to_read(project)


@router.patch("/{project_id}", response_model=ProjectRead)
@audit(action="projects.update", target_type="project")
async def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    principal: Principal,
    db: DbSession,
) -> ProjectRead:
    """Update a project's editable fields (tenant-scoped)."""
    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == UUID(principal.tenant_id),
        )
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")

    if body.slug is not None and body.slug != project.slug:
        clash = (
            await db.execute(
                select(Project).where(
                    Project.tenant_id == UUID(principal.tenant_id),
                    Project.slug == body.slug,
                    Project.id != project_id,
                )
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="slug_already_taken")
        project.slug = body.slug

    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.default_branch is not None:
        project.default_branch = body.default_branch
    if body.visibility is not None:
        project.visibility = body.visibility

    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)
    return _project_to_read(project)


# ---------------------------------------------------------------------------
# Settings counts (sidebar badges)
# ---------------------------------------------------------------------------


@router.get("/{project_id}/settings/counts")
@audit(action="settings.counts", target_type="project")
async def settings_counts(
    project_id: UUID,
    principal: Principal,
    db: DbSession,
) -> dict:
    """Aggregate counts that drive SettingsSidebar badges."""
    tenant_uuid = UUID(principal.tenant_id)

    members_count = await db.scalar(
        select(func.count())
        .select_from(ProjectMember)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.status == "active",
        )
    )
    invites_count = await db.scalar(
        select(func.count())
        .select_from(ProjectInvitation)
        .where(
            ProjectInvitation.project_id == project_id,
            ProjectInvitation.status == "pending",
        )
    )
    agents_count = await db.scalar(
        select(func.count())
        .select_from(AgentConfig)
        .where(
            AgentConfig.project_id == project_id,
            AgentConfig.enabled.is_(True),
        )
    )
    env_vars_count = await db.scalar(
        select(func.count())
        .select_from(EnvVar)
        .where(EnvVar.project_id == project_id)
    )
    since = datetime.now(timezone.utc) - timedelta(days=30)
    audit_count = await db.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(
            AuditEvent.tenant_id == tenant_uuid,
            AuditEvent.target_id == str(project_id),
            AuditEvent.occurred_at >= since,
        )
    )
    connectors_count = await db.scalar(
        select(func.count())
        .select_from(Connector)
        .where(Connector.tenant_id == tenant_uuid)
    )

    return {
        "members": int(members_count or 0),
        "pending_invitations": int(invites_count or 0),
        "agents": int(agents_count or 0),
        "providers": 4,
        "env_vars": int(env_vars_count or 0),
        "integrations": int(connectors_count or 0),
        "audit_events_30d": int(audit_count or 0),
        "webhooks": 2,
        "connected_apps": 4,
        "feature_flags": 6,
    }


# ---------------------------------------------------------------------------
# Day-One Bootstrap (F-021) — preserved from step-52
# ---------------------------------------------------------------------------


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
    try:
        return await day_one_bootstrap.get_status(
            project_id=project_id, tenant_id=principal.tenant_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


__all__ = ["router"]
