"""Project members + invitations (Settings → Members tab)."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, Principal
from app.core.audit import audit
from app.db.models.project_invitation import ProjectInvitation
from app.db.models.project_member import ProjectMember
from app.db.models.role import Role
from app.db.models.user import User

router = APIRouter(prefix="/projects/{project_id}/members", tags=["members"])


# Local email pattern — we avoid the `email-validator` extra dep since
# its only job here is light validation on the invite endpoint.
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class MemberRead(BaseModel):
    id: UUID
    project_id: UUID
    user_id: UUID
    email: str
    display_name: str | None = None
    role_id: UUID
    role_name: str
    status: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class InvitationRead(BaseModel):
    id: UUID
    project_id: UUID
    email: str
    role_id: UUID
    role_name: str
    invited_by: UUID
    status: str
    expires_at: datetime
    created_at: datetime
    token: str | None = None

    model_config = {"from_attributes": True}


class InviteCreate(BaseModel):
    email: str = Field(..., pattern=EMAIL_PATTERN, max_length=320)
    role_id: UUID


class RoleUpdate(BaseModel):
    role_id: UUID


class MemberListResponse(BaseModel):
    members: list[MemberRead]
    invitations: list[InvitationRead]


@router.get("", response_model=MemberListResponse)
@audit(action="members.list", target_type="project")
async def list_members(
    project_id: UUID,
    principal: Principal,
    db: DbSession,
) -> MemberListResponse:
    """List active members and pending invitations for a project."""
    members_q = await db.execute(
        select(ProjectMember, User, Role)
        .join(User, User.id == ProjectMember.user_id)
        .join(Role, Role.id == ProjectMember.role_id)
        .where(ProjectMember.project_id == project_id)
        .where(ProjectMember.status == "active")
        .order_by(ProjectMember.created_at.asc())
    )
    members: list[MemberRead] = []
    for pm, user, role in members_q.all():
        members.append(
            MemberRead(
                id=pm.id,
                project_id=pm.project_id,
                user_id=user.id,
                email=user.email,
                display_name=user.display_name,
                role_id=role.id,
                role_name=role.name,
                status=pm.status,
                joined_at=pm.created_at,
            )
        )

    invites_q = await db.execute(
        select(ProjectInvitation, Role)
        .join(Role, Role.id == ProjectInvitation.role_id)
        .where(ProjectInvitation.project_id == project_id)
        .where(ProjectInvitation.status == "pending")
        .order_by(ProjectInvitation.created_at.desc())
    )
    invitations: list[InvitationRead] = []
    for inv, role in invites_q.all():
        invitations.append(
            InvitationRead(
                id=inv.id,
                project_id=inv.project_id,
                email=inv.email,
                role_id=inv.role_id,
                role_name=role.name,
                invited_by=inv.invited_by,
                status=inv.status,
                expires_at=inv.expires_at,
                created_at=inv.created_at,
            )
        )

    return MemberListResponse(members=members, invitations=invitations)


@router.post("/invite", response_model=InvitationRead, status_code=201)
@audit(action="members.invite", target_type="project")
async def invite_member(
    project_id: UUID,
    body: InviteCreate,
    principal: Principal,
    db: DbSession,
) -> InvitationRead:
    """Invite an email to join the project with a given role."""
    role = (
        await db.execute(select(Role).where(Role.id == body.role_id))
    ).scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=404, detail="role_not_found")

    existing_user = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    if existing_user is not None:
        already = (
            await db.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == existing_user.id,
                )
            )
        ).scalar_one_or_none()
        if already is not None:
            raise HTTPException(status_code=409, detail="already_a_member")

    token = secrets.token_urlsafe(32)
    invitation = ProjectInvitation(
        id=uuid4(),
        project_id=project_id,
        email=body.email,
        role_id=body.role_id,
        invited_by=UUID(principal.user_id) if principal.user_id else uuid4(),
        status="pending",
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    return InvitationRead(
        id=invitation.id,
        project_id=invitation.project_id,
        email=invitation.email,
        role_id=invitation.role_id,
        role_name=role.name,
        invited_by=invitation.invited_by,
        status=invitation.status,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        token=token,
    )


@router.patch("/{member_id}", response_model=MemberRead)
@audit(action="members.update_role", target_type="project")
async def update_member_role(
    project_id: UUID,
    member_id: UUID,
    body: RoleUpdate,
    principal: Principal,
    db: DbSession,
) -> MemberRead:
    """Change a member's role on this project."""
    pm = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.id == member_id,
                ProjectMember.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if pm is None:
        raise HTTPException(status_code=404, detail="member_not_found")

    role = (
        await db.execute(select(Role).where(Role.id == body.role_id))
    ).scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=404, detail="role_not_found")

    pm.role_id = body.role_id
    await db.commit()
    await db.refresh(pm)

    user = (
        await db.execute(select(User).where(User.id == pm.user_id))
    ).scalar_one()

    return MemberRead(
        id=pm.id,
        project_id=pm.project_id,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        role_id=role.id,
        role_name=role.name,
        status=pm.status,
        joined_at=pm.created_at,
    )


@router.delete("/{member_id}", status_code=204)
@audit(action="members.remove", target_type="project")
async def remove_member(
    project_id: UUID,
    member_id: UUID,
    principal: Principal,
    db: DbSession,
) -> None:
    """Remove a member from this project."""
    pm = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.id == member_id,
                ProjectMember.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if pm is None:
        raise HTTPException(status_code=404, detail="member_not_found")

    await db.delete(pm)
    await db.commit()
    return None


__all__ = ["router", "MemberRead", "InvitationRead", "InviteCreate", "RoleUpdate", "MemberListResponse"]
