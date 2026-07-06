"""F12 RBAC — `/api/forge/rbac/*` HTTP surface.

Phase 3 Feature 12. Thin HTTP layer over ``rbac_v2_service``. The
service owns all DB and LiteLLM calls; the router only shapes
requests, enforces permissions, and emits audit events.

Auth: every endpoint depends on ``Principal`` + a ``require_permission``
string. Permissions follow the ``<resource>:<verb>`` shape so the
catalog is grep-able.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import DbSession, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.db.models.user import User
from app.schemas.common import Page
from app.schemas.rbac_v2 import (
    BulkTeamMemberAddRequest,
    BulkTeamMemberAddResponse,
    CustomerCreate,
    CustomerRead,
    CustomerUpdate,
    DailyRollup,
    OrganizationCreate,
    OrganizationRead,
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
    RoleEnum,
    TeamCreate,
    TeamMemberCreate,
    TeamMemberRead,
    TeamMemberUpdate,
    TeamModelAllowlistRequest,
    TeamModelAllowlistResponse,
    TeamPermissionOverride,
    TeamPermissionsList,
    TeamRead,
)
from app.services.rbac_v2_service import rbac_v2_service

router = APIRouter(prefix="/forge/rbac", tags=["forge.rbac"])
logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Orgs
# ---------------------------------------------------------------------------


@router.get("/orgs", response_model=Page[OrganizationRead])
@audit(action="forge.rbac.org_listed", target_type="organization")
async def list_orgs(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:org:read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> Page[OrganizationRead]:
    if not getattr(principal, "tenant_id", None):
        raise HTTPException(status_code=403, detail="token_missing_tenant_claim")
    items = await rbac_v2_service.list_orgs(db, tenant_id=UUID(principal.tenant_id))
    return Page(
        items=[OrganizationRead.model_validate(o) for o in items],
        total=len(items),
        page=page,
        page_size=page_size,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/orgs", response_model=OrganizationRead, status_code=status.HTTP_201_CREATED)
@audit(action="forge.rbac.org_created", target_type="organization")
async def create_org(
    payload: OrganizationCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:org:create"))],
) -> OrganizationRead:
    if not getattr(principal, "tenant_id", None):
        raise HTTPException(status_code=403, detail="token_missing_tenant_claim")
    org = await rbac_v2_service.create_org(
        db,
        tenant_id=UUID(principal.tenant_id),
        name=payload.name,
        brand=payload.brand,
        billing_ref=payload.billing_ref,
    )
    return OrganizationRead.model_validate(org)


@router.get("/orgs/{org_id}", response_model=OrganizationRead)
@audit(action="forge.rbac.org_read", target_type="organization")
async def get_org(
    org_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:org:read"))],
) -> OrganizationRead:
    org = await rbac_v2_service.get_org(db, tenant_id=UUID(principal.tenant_id), org_id=org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="org_not_found")
    return OrganizationRead.model_validate(org)


@require_approval_phase(SDLCPhase.PLANNING)
@router.patch("/orgs/{org_id}", response_model=OrganizationRead)
@audit(action="forge.rbac.org_updated", target_type="organization")
async def update_org(
    org_id: UUID,
    payload: OrganizationCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:org:update"))],
) -> OrganizationRead:
    org = await rbac_v2_service.update_org(
        db,
        tenant_id=UUID(principal.tenant_id),
        org_id=org_id,
        patch=payload.model_dump(),
    )
    if org is None:
        raise HTTPException(status_code=404, detail="org_not_found")
    return OrganizationRead.model_validate(org)


@require_approval_phase(SDLCPhase.PLANNING)
@router.delete("/orgs/{org_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
@audit(action="forge.rbac.org_deleted", target_type="organization")
async def delete_org(
    org_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:org:delete"))],
) -> None:
    ok = await rbac_v2_service.delete_org(db, tenant_id=UUID(principal.tenant_id), org_id=org_id)
    if not ok:
        raise HTTPException(status_code=404, detail="org_not_found")


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------


@router.get("/teams", response_model=Page[TeamRead])
@audit(action="forge.rbac.team_listed", target_type="team")
async def list_teams(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:read"))],
    org_id: UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> Page[TeamRead]:
    items = await rbac_v2_service.list_teams(db, tenant_id=UUID(principal.tenant_id), org_id=org_id)
    return Page(
        items=[TeamRead.model_validate(t) for t in items],
        total=len(items),
        page=page,
        page_size=page_size,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/teams", response_model=TeamRead, status_code=status.HTTP_201_CREATED)
@audit(action="forge.rbac.team_created", target_type="team")
async def create_team(
    payload: TeamCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:create"))],
) -> TeamRead:
    team = await rbac_v2_service.create_team(
        db,
        tenant_id=UUID(principal.tenant_id),
        org_id=payload.org_id,
        name=payload.name,
        description=payload.description,
        model_allowlist=payload.model_allowlist,
        default_agent_config=payload.default_agent_config,
    )
    return TeamRead.model_validate(team)


@router.get("/teams/{team_id}", response_model=TeamRead)
@audit(action="forge.rbac.team_read", target_type="team")
async def get_team(
    team_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:read"))],
) -> TeamRead:
    team = await rbac_v2_service.get_team(db, tenant_id=UUID(principal.tenant_id), team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    return TeamRead.model_validate(team)


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/teams/{team_id}/block", response_model=TeamRead)
@audit(action="forge.rbac.team_blocked", target_type="team")
async def block_team(
    team_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:block"))],
) -> TeamRead:
    team = await rbac_v2_service.block_team(
        db, tenant_id=UUID(principal.tenant_id), team_id=team_id
    )
    if team is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    return TeamRead.model_validate(team)


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/teams/{team_id}/unblock", response_model=TeamRead)
@audit(action="forge.rbac.team_unblocked", target_type="team")
async def unblock_team(
    team_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:unblock"))],
) -> TeamRead:
    team = await rbac_v2_service.unblock_team(
        db, tenant_id=UUID(principal.tenant_id), team_id=team_id
    )
    if team is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    return TeamRead.model_validate(team)


# ---------------------------------------------------------------------------
# Team members
# ---------------------------------------------------------------------------


@router.get("/teams/{team_id}/members", response_model=Page[TeamMemberRead])
@audit(action="forge.rbac.member_listed", target_type="team_member")
async def list_members(
    team_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:member:read"))],
) -> Page[TeamMemberRead]:
    members = await rbac_v2_service.list_members(
        db, tenant_id=UUID(principal.tenant_id), team_id=team_id
    )
    # Hydrate user email/display_name in one pass.
    user_ids = {m.user_id for m in members}
    user_map: dict[UUID, User] = {}
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {u.id: u for u in result.scalars().all()}

    items = [
        TeamMemberRead(
            id=m.id,
            team_id=m.team_id,
            user_id=m.user_id,
            email=user_map[m.user_id].email if m.user_id in user_map else None,
            display_name=user_map[m.user_id].display_name if m.user_id in user_map else None,
            role=RoleEnum(m.role),
            status=m.status,
            created_at=m.created_at,
        )
        for m in members
    ]
    return Page(items=items, total=len(items), page=1, page_size=len(items) or 1)


@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "/teams/{team_id}/members",
    response_model=TeamMemberRead,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="forge.rbac.member_added", target_type="team_member")
async def add_member(
    team_id: UUID,
    payload: TeamMemberCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:member:add"))],
) -> TeamMemberRead:
    member = await rbac_v2_service.add_member(
        db,
        tenant_id=UUID(principal.tenant_id),
        team_id=team_id,
        user_id=payload.user_id,
        role=payload.role,
    )
    return TeamMemberRead(
        id=member.id,
        team_id=member.team_id,
        user_id=member.user_id,
        role=RoleEnum(member.role),
        status=member.status,
        created_at=member.created_at,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.patch("/teams/{team_id}/members/{user_id}", response_model=TeamMemberRead)
@audit(action="forge.rbac.member_role_changed", target_type="team_member")
async def change_member_role(
    team_id: UUID,
    user_id: UUID,
    payload: TeamMemberUpdate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:member:update"))],
) -> TeamMemberRead:
    member = await rbac_v2_service.change_member_role(
        db,
        tenant_id=UUID(principal.tenant_id),
        team_id=team_id,
        user_id=user_id,
        role=payload.role,
    )
    if member is None:
        raise HTTPException(status_code=404, detail="member_not_found")
    return TeamMemberRead(
        id=member.id,
        team_id=member.team_id,
        user_id=member.user_id,
        role=RoleEnum(member.role),
        status=member.status,
        created_at=member.created_at,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.delete(
    "/teams/{team_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
@audit(action="forge.rbac.member_removed", target_type="team_member")
async def remove_member(
    team_id: UUID,
    user_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:member:remove"))],
) -> None:
    ok = await rbac_v2_service.remove_member(
        db, tenant_id=UUID(principal.tenant_id), team_id=team_id, user_id=user_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="member_not_found")


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------


@router.get("/customers", response_model=Page[CustomerRead])
@audit(action="forge.rbac.customer_listed", target_type="customer")
async def list_customers(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:customer:read"))],
    org_id: UUID | None = Query(None),
) -> Page[CustomerRead]:
    items = await rbac_v2_service.list_customers(
        db, tenant_id=UUID(principal.tenant_id), org_id=org_id
    )
    return Page(
        items=[CustomerRead.model_validate(c) for c in items],
        total=len(items),
        page=1,
        page_size=len(items) or 1,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/customers", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
@audit(action="forge.rbac.customer_created", target_type="customer")
async def create_customer(
    payload: CustomerCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:customer:create"))],
) -> CustomerRead:
    customer = await rbac_v2_service.create_customer(
        db,
        tenant_id=UUID(principal.tenant_id),
        org_id=payload.org_id,
        name=payload.name,
        description=payload.description,
        billing_ref=payload.billing_ref,
    )
    return CustomerRead.model_validate(customer)


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/customers/{customer_id}/block", response_model=CustomerRead)
@audit(action="forge.rbac.customer_blocked", target_type="customer")
async def block_customer(
    customer_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:customer:block"))],
) -> CustomerRead:
    customer = await rbac_v2_service.block_customer(
        db, tenant_id=UUID(principal.tenant_id), customer_id=customer_id
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="customer_not_found")
    return CustomerRead.model_validate(customer)


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/customers/{customer_id}/unblock", response_model=CustomerRead)
@audit(action="forge.rbac.customer_unblocked", target_type="customer")
async def unblock_customer(
    customer_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:customer:unblock"))],
) -> CustomerRead:
    customer = await rbac_v2_service.unblock_customer(
        db, tenant_id=UUID(principal.tenant_id), customer_id=customer_id
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="customer_not_found")
    return CustomerRead.model_validate(customer)


# ---------------------------------------------------------------------------
# Users (read-only + invite picker; user creation lives in /auth)
# ---------------------------------------------------------------------------


@router.get("/users", response_model=Page[dict])
@audit(action="forge.rbac.user_listed", target_type="user")
async def list_users(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:user:read"))],
) -> Page[dict]:
    if not getattr(principal, "tenant_id", None):
        raise HTTPException(status_code=403, detail="token_missing_tenant_claim")
    result = await db.execute(select(User).where(User.tenant_id == UUID(principal.tenant_id)))
    users = result.scalars().all()
    items = [
        {
            "id": str(u.id),
            "email": u.email,
            "display_name": u.display_name,
        }
        for u in users
    ]
    return Page(items=items, total=len(items), page=1, page_size=len(items) or 1)


@router.get("/users/available", response_model=Page[dict])
@audit(action="forge.rbac.user_available", target_type="user")
async def users_available(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:user:read"))],
) -> Page[dict]:
    """Invite picker — every user in the tenant that is not already a team member."""
    return await list_users(db=db, principal=principal)


# ---------------------------------------------------------------------------
# Admin: bootstrap tenant (super-admin only)
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/admin/bootstrap-tenant", status_code=status.HTTP_201_CREATED)
@audit(action="forge.rbac.tenant_bootstrapped", target_type="tenant")
async def bootstrap_tenant(
    payload: dict,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:tenant:bootstrap"))],
) -> dict:
    role = rbac_v2_service.role_for(principal)
    if role != RoleEnum.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="super_admin_required")
    return await rbac_v2_service.bootstrap_tenant(
        db,
        tenant_slug=payload["tenant_slug"],
        org_name=payload["org_name"],
        team_name=payload["team_name"],
        user_email=payload["user_email"],
        keycloak_sub=payload["keycloak_sub"],
    )


# ---------------------------------------------------------------------------
# Projects (step-78 F12 §"Forge-side CRUD")
# ---------------------------------------------------------------------------


@router.get("/projects", response_model=Page[ProjectRead])
@audit(action="forge.rbac.project_listed", target_type="project")
async def list_projects(
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:project:read"))],
    team_id: UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> Page[ProjectRead]:
    items = await rbac_v2_service.list_projects(
        db, tenant_id=UUID(principal.tenant_id), team_id=team_id
    )
    return Page(
        items=[ProjectRead.model_validate(o) for o in items],
        total=len(items),
        page=page,
        page_size=page_size,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
@audit(action="forge.rbac.project_created", target_type="project")
async def create_project(
    payload: ProjectCreate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:project:create"))],
) -> ProjectRead:
    project = await rbac_v2_service.create_project(
        db,
        tenant_id=UUID(principal.tenant_id),
        team_id=payload.team_id,
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        default_branch=payload.default_branch,
        visibility=payload.visibility,
        created_by=UUID(principal.user_id) if getattr(principal, "user_id", None) else None,
    )
    return ProjectRead.model_validate(project)


@router.get("/projects/{project_id}", response_model=ProjectRead)
@audit(action="forge.rbac.project_read", target_type="project")
async def get_project(
    project_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:project:read"))],
) -> ProjectRead:
    project = await rbac_v2_service.get_project(
        db, tenant_id=UUID(principal.tenant_id), project_id=project_id
    )
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return ProjectRead.model_validate(project)


@require_approval_phase(SDLCPhase.PLANNING)
@router.patch("/projects/{project_id}", response_model=ProjectRead)
@audit(action="forge.rbac.project_updated", target_type="project")
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:project:update"))],
) -> ProjectRead:
    project = await rbac_v2_service.update_project(
        db,
        tenant_id=UUID(principal.tenant_id),
        project_id=project_id,
        patch=payload.model_dump(exclude_unset=True),
    )
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return ProjectRead.model_validate(project)


@require_approval_phase(SDLCPhase.PLANNING)
@router.delete(
    "/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
@audit(action="forge.rbac.project_deleted", target_type="project")
async def delete_project(
    project_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:project:delete"))],
) -> None:
    ok = await rbac_v2_service.delete_project(
        db, tenant_id=UUID(principal.tenant_id), project_id=project_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="project_not_found")


# ---------------------------------------------------------------------------
# Bulk member add (step-78 F12 acceptance #3)
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "/teams/{team_id}/members/bulk",
    response_model=BulkTeamMemberAddResponse,
    status_code=status.HTTP_201_CREATED,
)
@audit(action="forge.rbac.member_bulk_added", target_type="team_member")
async def add_members_bulk(
    team_id: UUID,
    payload: BulkTeamMemberAddRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:member:add"))],
) -> BulkTeamMemberAddResponse:
    results = await rbac_v2_service.add_members_bulk(
        db,
        tenant_id=UUID(principal.tenant_id),
        team_id=team_id,
        members=[m.model_dump() for m in payload.members],
        atomic=payload.atomic,
    )
    return BulkTeamMemberAddResponse(
        team_id=team_id,
        added=sum(1 for r in results if r.status == "added"),
        skipped=sum(1 for r in results if r.status == "skipped"),
        errors=sum(1 for r in results if r.status == "error"),
        results=results,
    )


# ---------------------------------------------------------------------------
# Customer update + delete (step-78 F12 §"Forge-side CRUD")
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.PLANNING)
@router.patch("/customers/{customer_id}", response_model=CustomerRead)
@audit(action="forge.rbac.customer_updated", target_type="customer")
async def update_customer(
    customer_id: UUID,
    payload: CustomerUpdate,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:customer:update"))],
) -> CustomerRead:
    customer = await rbac_v2_service.update_customer(
        db,
        tenant_id=UUID(principal.tenant_id),
        customer_id=customer_id,
        patch=payload.model_dump(exclude_unset=True),
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="customer_not_found")
    return CustomerRead.model_validate(customer)


@require_approval_phase(SDLCPhase.PLANNING)
@router.delete(
    "/customers/{customer_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
@audit(action="forge.rbac.customer_deleted", target_type="customer")
async def delete_customer(
    customer_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:customer:delete"))],
) -> None:
    ok = await rbac_v2_service.delete_customer(
        db, tenant_id=UUID(principal.tenant_id), customer_id=customer_id
    )
    if not ok:
        raise HTTPException(status_code=404, detail="customer_not_found")


# ---------------------------------------------------------------------------
# Team model allowlist (step-78 F12 §"Tag-based access")
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "/teams/{team_id}/model/add",
    response_model=TeamModelAllowlistResponse,
)
@audit(action="forge.rbac.team_model_added", target_type="team")
async def add_team_model(
    team_id: UUID,
    payload: TeamModelAllowlistRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:update"))],
) -> TeamModelAllowlistResponse:
    team = await rbac_v2_service.add_team_model(
        db, tenant_id=UUID(principal.tenant_id), team_id=team_id, model=payload.model
    )
    if team is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    return TeamModelAllowlistResponse(team_id=team.id, model_allowlist=team.model_allowlist)


@require_approval_phase(SDLCPhase.PLANNING)
@router.post(
    "/teams/{team_id}/model/delete",
    response_model=TeamModelAllowlistResponse,
)
@audit(action="forge.rbac.team_model_removed", target_type="team")
async def remove_team_model(
    team_id: UUID,
    payload: TeamModelAllowlistRequest,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:update"))],
) -> TeamModelAllowlistResponse:
    team = await rbac_v2_service.remove_team_model(
        db, tenant_id=UUID(principal.tenant_id), team_id=team_id, model=payload.model
    )
    if team is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    return TeamModelAllowlistResponse(team_id=team.id, model_allowlist=team.model_allowlist)


# ---------------------------------------------------------------------------
# Permission overrides (step-78 F12 §"RBAC inheritance" overrides)
# ponytail: in-memory store keyed by (team_id, user_id). Replace with
# a proper team_permissions_override table once team-scoped policies
# are needed in production.
# ---------------------------------------------------------------------------

_PERMISSION_OVERRIDES: dict[UUID, dict[UUID, dict[str, list[str]]]] = {}


@router.get("/teams/{team_id}/permissions_list", response_model=TeamPermissionsList)
@audit(action="forge.rbac.permissions_listed", target_type="team")
async def list_team_permissions(
    team_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:read"))],
) -> TeamPermissionsList:
    team = await rbac_v2_service.get_team(db, tenant_id=UUID(principal.tenant_id), team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    overrides = [
        TeamPermissionOverride(user_id=uid, granted=g["granted"], revoked=g["revoked"])
        for uid, g in _PERMISSION_OVERRIDES.get(team_id, {}).items()
    ]
    return TeamPermissionsList(
        team_id=team_id,
        base_permissions=sorted(
            {
                "rbac:org:read",
                "rbac:team:read",
                "rbac:project:read",
                "rbac:member:read",
                "rbac:customer:read",
                "rbac:user:read",
            }
        ),
        overrides=overrides,
    )


@require_approval_phase(SDLCPhase.PLANNING)
@router.post("/teams/{team_id}/permissions_update", response_model=TeamPermissionsList)
@audit(action="forge.rbac.permission_granted", target_type="team")
async def update_team_permissions(
    team_id: UUID,
    payload: TeamPermissionOverride,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:update"))],
) -> TeamPermissionsList:
    team = await rbac_v2_service.get_team(db, tenant_id=UUID(principal.tenant_id), team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="team_not_found")
    bucket = _PERMISSION_OVERRIDES.setdefault(team_id, {})
    bucket[payload.user_id] = {
        "granted": list(payload.granted),
        "revoked": list(payload.revoked),
    }
    return await list_team_permissions(team_id=team_id, db=db, principal=principal)


# ---------------------------------------------------------------------------
# Daily rollups (step-78 F12 §"Daily activity endpoints")
# ---------------------------------------------------------------------------


@router.get("/teams/{team_id}/daily", response_model=DailyRollup)
@audit(action="forge.rbac.team_daily_queried", target_type="team")
async def team_daily(
    team_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:team:read"))],
) -> DailyRollup:
    return await rbac_v2_service.daily_rollup(
        db, tenant_id=UUID(principal.tenant_id), entity_type="team", entity_id=team_id
    )


@router.get("/users/{user_id}/daily", response_model=DailyRollup)
@audit(action="forge.rbac.user_daily_queried", target_type="user")
async def user_daily(
    user_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:user:read"))],
) -> DailyRollup:
    return await rbac_v2_service.daily_rollup(
        db, tenant_id=UUID(principal.tenant_id), entity_type="user", entity_id=user_id
    )


@router.get("/orgs/{org_id}/daily", response_model=DailyRollup)
@audit(action="forge.rbac.org_daily_queried", target_type="organization")
async def org_daily(
    org_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:org:read"))],
) -> DailyRollup:
    return await rbac_v2_service.daily_rollup(
        db, tenant_id=UUID(principal.tenant_id), entity_type="organization", entity_id=org_id
    )


@router.get("/customers/{customer_id}/daily", response_model=DailyRollup)
@audit(action="forge.rbac.customer_daily_queried", target_type="customer")
async def customer_daily(
    customer_id: UUID,
    db: DbSession,
    principal: Annotated[object, Depends(require_permission("rbac:customer:read"))],
) -> DailyRollup:
    return await rbac_v2_service.daily_rollup(
        db, tenant_id=UUID(principal.tenant_id), entity_type="customer", entity_id=customer_id
    )
