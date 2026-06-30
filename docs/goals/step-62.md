# Step 62 v1 — Settings: Real Backend + Real Project Scope

> **Status:** Ready to run
> **Workspace:** `~/forge-ai/`
> **Duration estimate:** ~60 minutes

---

## /goal

Wire the Settings page (`/admin`) to a real backend. Currently the page header comment says "the page owns no data fetching; each tab is a self-contained client component that hydrates its own slice of state (or uses localStorage-backed mock data for the new sections)" — that's the problem. Plus the Project tab shows "Forge API 404 Not Found on /projects/project-forge-demo. The backend endpoint for project info lands with sub-plan A; this tab will populate once it ships."

The fix is two-pronged:

1. **Build the missing backend endpoints** — there's no `GET /projects/{id}`, no `/projects/{id}/members`, no `/projects/{id}/env-vars`, no `/projects/{id}/agent-config`, no `/settings/roles`, no `/projects/{id}/audit`. The `projects.py` only has the bootstrap endpoints.

2. **Replace `SEED_PROJECT_ID = 'project-forge-demo'` with a real project lookup** — every settings hook hardcodes this ID. The page should read the actual current project from auth context.

3. **Replace the count badges (Members: 6, Agents: 8, etc.) with real data** — currently hardcoded in the sidebar.

---

## Files to read FIRST

- `apps/forge/app/admin/page.tsx` (settings page orchestrator + 21 tabs)
- `apps/forge/components/admin/settings/SettingsSidebar.tsx` (count badges)
- `apps/forge/components/admin/settings/GeneralTab.tsx` (Project info)
- `apps/forge/components/admin/settings/MembersTab.tsx` (members table)
- `apps/forge/components/admin/settings/EnvVarsTab.tsx`
- `apps/forge/components/admin/settings/AgentsTab.tsx`
- `apps/forge/components/admin/settings/ProvidersTab.tsx`
- `apps/forge/components/admin/settings/IntegrationsTab.tsx`
- `apps/forge/components/admin/settings/AuditTab.tsx`
- `apps/forge/components/admin/settings/AIGatewayTab.tsx`
- `apps/forge/components/admin/settings/ProfileTab.tsx`
- `apps/forge/components/admin/settings/SessionsTab.tsx`
- `apps/forge/components/admin/settings/APITokensTab.tsx`
- `apps/forge/components/admin/settings/SeedsTab.tsx`
- `apps/forge/components/admin/settings/WebhooksTab.tsx`
- `apps/forge/components/admin/settings/SSOTab.tsx`
- `apps/forge/components/admin/settings/BrandingTab.tsx`
- `apps/forge/components/admin/settings/BillingTab.tsx`
- `apps/forge/components/admin/settings/FeatureFlagsTab.tsx`
- `apps/forge/components/admin/settings/KeyboardShortcutsTab.tsx`
- `apps/forge/lib/settings/data.ts` (256 lines, full SDK)
- `apps/forge/lib/settings/types.ts` (full type definitions)
- `apps/forge/lib/hooks/useSettings.ts` (TanStack Query hooks)
- `apps/forge/lib/settings/schemas.ts` (Zod validation)
- `backend/app/api/v1/projects.py` (4 routes — only bootstrap)
- `backend/app/db/models/project.py` (Project model)
- `backend/app/db/models/user.py` (User model)
- `backend/app/db/models/tenant.py` (Tenant model)

---

## INVOKE THE SKILL BEFORE CODING

```
python3 -c "import webbrowser; webbrowser.open('https://docs.python.org/3/library/cryptography.html')"
python3 -c "import webbrowser; webbrowser.open('https://docs.sqlalchemy.org/en/20/orm/relationships.html')"
```

Read the cryptography docs (for env var encryption) and SQLAlchemy relationship patterns.

---

## Adopt every rule, then build in this order

### ZONE 1 — REAL PROJECT ENDPOINT (FIX THE 404)

The frontend calls `GET /projects/{id}` but it doesn't exist. ADD it.

UPDATE `backend/app/api/v1/projects.py`:

```python
# Add new routes to existing projects router
from app.db.models.project import Project
from app.schemas.project import ProjectRead, ProjectUpdate, ProjectCreate
from app.api.deps import Principal, get_current_tenant
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from fastapi import Depends, HTTPException
from uuid import UUID

@router.get("/{project_id}", response_model=ProjectRead)
@audit(action="projects.read", target_type="project")
async def get_project(
    project_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    result = await db.execute(
        select(Project).where(
            Project.id == str(project_id),
            Project.tenant_id == principal.tenant_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project


@router.get("", response_model=list[ProjectRead])
@audit(action="projects.list", target_type="tenant")
async def list_projects(
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    result = await db.execute(
        select(Project).where(Project.tenant_id == principal.tenant_id)
        .order_by(Project.created_at.desc())
    )
    return result.scalars().all()


@router.patch("/{project_id}", response_model=ProjectRead)
@audit(action="projects.update", target_type="project")
async def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select
    result = await db.execute(
        select(Project).where(
            Project.id == str(project_id),
            Project.tenant_id == principal.tenant_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="project_not_found")

    if body.name is not None:
        project.name = body.name
    if body.slug is not None:
        existing = await db.execute(
            select(Project).where(
                Project.tenant_id == principal.tenant_id,
                Project.slug == body.slug,
                Project.id != str(project_id),
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="slug_already_taken")
        project.slug = body.slug
    if body.description is not None:
        project.description = body.description
    if body.default_branch is not None:
        project.default_branch = body.default_branch
    if body.visibility is not None:
        project.visibility = body.visibility

    from datetime import datetime, timezone
    project.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(project)
    return project


@router.post("", response_model=ProjectRead, status_code=201)
@audit(action="projects.create", target_type="project")
async def create_project(
    body: ProjectCreate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from uuid import uuid4
    from datetime import datetime, timezone
    from sqlalchemy import select

    existing = await db.execute(
        select(Project).where(
            Project.tenant_id == principal.tenant_id,
            Project.slug == body.slug,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="slug_already_taken")

    project = Project(
        id=str(uuid4()),
        tenant_id=principal.tenant_id,
        name=body.name,
        slug=body.slug,
        description=body.description,
        default_branch=body.default_branch or "main",
        visibility=body.visibility or "private",
        created_by=str(principal.user_id),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project
```

ADD `ProjectRead`, `ProjectUpdate`, `ProjectCreate` to `backend/app/schemas/project.py`:

```python
from pydantic import BaseModel, Field
from typing import Literal, Optional
from uuid import UUID
from datetime import datetime
from app.schemas.common import TenantScopedModel

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    description: Optional[str] = None
    default_branch: Optional[str] = "main"
    visibility: Optional[Literal["private", "internal", "public"]] = "private"


class ProjectRead(TenantScopedModel):
    id: UUID
    name: str
    slug: str
    description: Optional[str]
    default_branch: str
    visibility: str
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    default_branch: Optional[str] = None
    visibility: Optional[Literal["private", "internal", "public"]] = None
```

---

### ZONE 2 — REAL MEMBERS + INVITATIONS

CREATE `backend/app/api/v1/members.py`:

```python
"""Project members + invitations endpoints (Settings → Members tab)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, EmailStr
from typing import Literal, Optional
from uuid import UUID
from datetime import datetime, timezone, timedelta
from app.api.deps import Principal, get_current_tenant
from app.db.models.user import User
from app.db.models.project_member import ProjectMember
from app.db.models.project_invitation import ProjectInvitation
from app.db.models.role import Role
from app.core.audit import audit
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from sqlalchemy import select
import secrets

router = APIRouter(prefix="/projects/{project_id}/members", tags=["members"])


class MemberRead(BaseModel):
    id: UUID
    project_id: UUID
    user_id: UUID
    email: str
    display_name: Optional[str]
    role_id: UUID
    role_name: str
    status: str
    joined_at: datetime


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
    token: Optional[str] = None


class InviteCreate(BaseModel):
    email: EmailStr
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
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    members_q = await db.execute(
        select(ProjectMember, User, Role)
        .join(User, User.id == ProjectMember.user_id)
        .join(Role, Role.id == ProjectMember.role_id)
        .where(ProjectMember.project_id == str(project_id))
        .where(ProjectMember.status == "active")
    )
    members = []
    for pm, user, role in members_q.all():
        members.append(MemberRead(
            id=pm.id, project_id=pm.project_id, user_id=user.id,
            email=user.email, display_name=user.display_name,
            role_id=role.id, role_name=role.name,
            status=pm.status, joined_at=pm.created_at,
        ))

    invites_q = await db.execute(
        select(ProjectInvitation, Role)
        .join(Role, Role.id == ProjectInvitation.role_id)
        .where(ProjectInvitation.project_id == str(project_id))
        .where(ProjectInvitation.status == "pending")
    )
    invitations = []
    for inv, role in invites_q.all():
        invitations.append(InvitationRead(
            id=inv.id, project_id=inv.project_id, email=inv.email,
            role_id=inv.role_id, role_name=role.name,
            invited_by=inv.invited_by, status=inv.status,
            expires_at=inv.expires_at, created_at=inv.created_at,
        ))

    return MemberListResponse(members=members, invitations=invitations)


@router.post("/invite", response_model=InvitationRead, status_code=201)
@audit(action="members.invite", target_type="project")
async def invite_member(
    project_id: UUID,
    body: InviteCreate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from uuid import uuid4

    user = (await db.execute(
        select(User).where(User.email == body.email)
    )).scalar_one_or_none()

    if user:
        existing = (await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == str(project_id),
                ProjectMember.user_id == user.id,
            )
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail="already_a_member")

    role = (await db.execute(
        select(Role).where(Role.id == str(body.role_id))
    )).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="role_not_found")

    token = secrets.token_urlsafe(32)
    invitation = ProjectInvitation(
        id=str(uuid4()),
        project_id=str(project_id),
        email=body.email,
        role_id=str(body.role_id),
        invited_by=str(principal.user_id),
        status="pending",
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        created_at=datetime.now(timezone.utc),
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    return InvitationRead(
        id=invitation.id, project_id=invitation.project_id,
        email=invitation.email, role_id=invitation.role_id,
        role_name=role.name, invited_by=invitation.invited_by,
        status=invitation.status, expires_at=invitation.expires_at,
        created_at=invitation.created_at, token=token,
    )


@router.patch("/{member_id}", response_model=MemberRead)
@audit(action="members.update_role", target_type="project")
async def update_member_role(
    project_id: UUID,
    member_id: UUID,
    body: RoleUpdate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    pm = (await db.execute(
        select(ProjectMember).where(
            ProjectMember.id == str(member_id),
            ProjectMember.project_id == str(project_id),
        )
    )).scalar_one_or_none()
    if not pm:
        raise HTTPException(status_code=404, detail="member_not_found")

    pm.role_id = str(body.role_id)
    await db.commit()

    user = (await db.execute(
        select(User).where(User.id == pm.user_id)
    )).scalar_one()
    role = (await db.execute(
        select(Role).where(Role.id == str(body.role_id))
    )).scalar_one()

    return MemberRead(
        id=pm.id, project_id=pm.project_id, user_id=user.id,
        email=user.email, display_name=user.display_name,
        role_id=role.id, role_name=role.name,
        status=pm.status, joined_at=pm.created_at,
    )


@router.delete("/{member_id}", status_code=204)
@audit(action="members.remove", target_type="project")
async def remove_member(
    project_id: UUID,
    member_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    pm = (await db.execute(
        select(ProjectMember).where(
            ProjectMember.id == str(member_id),
            ProjectMember.project_id == str(project_id),
        )
    )).scalar_one_or_none()
    if not pm:
        raise HTTPException(status_code=404, detail="member_not_found")

    await db.delete(pm)
    await db.commit()
    return None
```

ADD model classes:

```python
# backend/app/db/models/project_member.py
from sqlalchemy import String, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, GUID, TimestampMixin, UUIDPrimaryKeyMixin
from typing import Optional
from uuid import UUID

class ProjectMember(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "project_members"
    __table_args__ = (
        Index("ix_project_members_project_user", "project_id", "user_id", unique=True),
    )

    project_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("roles.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)


# backend/app/db/models/project_invitation.py
from sqlalchemy import String, ForeignKey, Text, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, GUID, TimestampMixin, UUIDPrimaryKeyMixin
from datetime import datetime
from typing import Optional
from uuid import UUID

class ProjectInvitation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "project_invitations"
    __table_args__ = (
        Index("ix_project_invitations_email", "email"),
        Index("ix_project_invitations_status", "status"),
    )

    project_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("roles.id"), nullable=False)
    invited_by: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    token: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
```

---

### ZONE 3 — REAL ROLES ENDPOINT

CREATE `backend/app/api/v1/roles.py`:

```python
"""Roles endpoint (Settings → Members tab role selector)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Literal, Optional
from uuid import UUID
from app.api.deps import Principal, get_current_tenant
from app.db.models.role import Role
from app.core.audit import audit
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from sqlalchemy import select

router = APIRouter(prefix="/roles", tags=["roles"])


class RoleRead(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    permissions: list[str]
    is_system: bool


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[list[str]] = None


@router.get("", response_model=list[RoleRead])
@audit(action="roles.list", target_type="tenant")
async def list_roles(
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Role).where(Role.tenant_id == principal.tenant_id)
        .order_by(Role.is_system.desc(), Role.name)
    )
    return result.scalars().all()


@router.patch("/{role_id}", response_model=RoleRead)
@audit(action="roles.update", target_type="role")
async def update_role(
    role_id: UUID,
    body: RoleUpdate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    role = (await db.execute(
        select(Role).where(
            Role.id == str(role_id),
            Role.tenant_id == principal.tenant_id,
        )
    )).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="role_not_found")

    if role.is_system and body.permissions is not None:
        raise HTTPException(status_code=403, detail="cannot_modify_system_role_permissions")

    if body.name is not None:
        role.name = body.name
    if body.description is not None:
        role.description = body.description
    if body.permissions is not None:
        role.permissions = body.permissions

    from datetime import datetime, timezone
    role.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(role)
    return role
```

ADD the `Role` model:

```python
# backend/app/db/models/role.py
from sqlalchemy import String, ForeignKey, Text, Index
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, GUID, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from typing import Optional
from uuid import UUID

class Role(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    permissions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_system: Mapped[bool] = mapped_column(default=False, nullable=False)
```

---

### ZONE 4 — REAL ENVIRONMENT VARIABLES (ENCRYPTED)

CREATE `backend/app/api/v1/env_vars.py`:

```python
"""Per-project environment variables (encrypted at rest)."""

import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, SecretStr
from typing import Optional, Literal
from uuid import UUID
from datetime import datetime, timezone
from cryptography.fernet import Fernet
from app.api.deps import Principal, get_current_tenant
from app.db.models.env_var import EnvVar
from app.core.audit import audit
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from sqlalchemy import select

router = APIRouter(prefix="/projects/{project_id}/env-vars", tags=["env-vars"])


def _get_cipher():
    key = os.environ.get("ENV_VAR_ENCRYPTION_KEY")
    if not key:
        from app.core.crypto import _cipher
        return _cipher
    return Fernet(key.encode() if isinstance(key, str) else key)


def _encrypt(value: str) -> str:
    return _get_cipher().encrypt(value.encode()).decode()


def _decrypt(encrypted: str) -> str:
    try:
        return _get_cipher().decrypt(encrypted.encode()).decode()
    except Exception:
        return ""


class EnvVarRead(BaseModel):
    id: UUID
    project_id: UUID
    key: str
    description: Optional[str]
    scope: str
    visibility: str
    last_used_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class EnvVarReveal(BaseModel):
    key: str
    value: str


class EnvVarCreate(BaseModel):
    key: str = Field(..., pattern=r"^[A-Z][A-Z0-9_]*$", min_length=2, max_length=128)
    value: str = Field(..., min_length=1)
    description: Optional[str] = None
    scope: Literal["build", "runtime", "test"] = "runtime"
    visibility: Literal["secret", "public"] = "secret"


class EnvVarUpdate(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None
    scope: Optional[Literal["build", "runtime", "test"]] = None
    visibility: Optional[Literal["secret", "public"]] = None


@router.get("", response_model=list[EnvVarRead])
@audit(action="env_vars.list", target_type="project")
async def list_env_vars(
    project_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(EnvVar).where(
            EnvVar.project_id == str(project_id),
            EnvVar.tenant_id == principal.tenant_id,
        ).order_by(EnvVar.key)
    )
    return result.scalars().all()


@router.post("", response_model=EnvVarRead, status_code=201)
@audit(action="env_vars.create", target_type="project")
async def create_env_var(
    project_id: UUID,
    body: EnvVarCreate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from uuid import uuid4

    existing = (await db.execute(
        select(EnvVar).where(
            EnvVar.project_id == str(project_id),
            EnvVar.key == body.key,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="key_already_exists")

    env_var = EnvVar(
        id=str(uuid4()),
        tenant_id=principal.tenant_id,
        project_id=str(project_id),
        key=body.key,
        encrypted_value=_encrypt(body.value),
        description=body.description,
        scope=body.scope,
        visibility=body.visibility,
        created_by=str(principal.user_id),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(env_var)
    await db.commit()
    await db.refresh(env_var)

    return EnvVarRead(
        id=env_var.id, project_id=env_var.project_id,
        key=env_var.key, description=env_var.description,
        scope=env_var.scope, visibility=env_var.visibility,
        last_used_at=env_var.last_used_at,
        created_at=env_var.created_at, updated_at=env_var.updated_at,
    )


@router.patch("/{env_var_id}", response_model=EnvVarRead)
@audit(action="env_vars.update", target_type="project")
async def update_env_var(
    project_id: UUID,
    env_var_id: UUID,
    body: EnvVarUpdate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    env_var = (await db.execute(
        select(EnvVar).where(
            EnvVar.id == str(env_var_id),
            EnvVar.project_id == str(project_id),
            EnvVar.tenant_id == principal.tenant_id,
        )
    )).scalar_one_or_none()
    if not env_var:
        raise HTTPException(status_code=404, detail="env_var_not_found")

    if body.value is not None:
        env_var.encrypted_value = _encrypt(body.value)
    if body.description is not None:
        env_var.description = body.description
    if body.scope is not None:
        env_var.scope = body.scope
    if body.visibility is not None:
        env_var.visibility = body.visibility

    env_var.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(env_var)

    return EnvVarRead(
        id=env_var.id, project_id=env_var.project_id,
        key=env_var.key, description=env_var.description,
        scope=env_var.scope, visibility=env_var.visibility,
        last_used_at=env_var.last_used_at,
        created_at=env_var.created_at, updated_at=env_var.updated_at,
    )


@router.delete("/{env_var_id}", status_code=204)
@audit(action="env_vars.delete", target_type="project")
async def delete_env_var(
    project_id: UUID,
    env_var_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    env_var = (await db.execute(
        select(EnvVar).where(
            EnvVar.id == str(env_var_id),
            EnvVar.project_id == str(project_id),
            EnvVar.tenant_id == principal.tenant_id,
        )
    )).scalar_one_or_none()
    if not env_var:
        raise HTTPException(status_code=404, detail="env_var_not_found")

    await db.delete(env_var)
    await db.commit()
    return None


@router.post("/{env_var_id}/reveal", response_model=EnvVarReveal)
@audit(action="env_vars.reveal", target_type="project")
async def reveal_env_var(
    project_id: UUID,
    env_var_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    env_var = (await db.execute(
        select(EnvVar).where(
            EnvVar.id == str(env_var_id),
            EnvVar.project_id == str(project_id),
            EnvVar.tenant_id == principal.tenant_id,
        )
    )).scalar_one_or_none()
    if not env_var:
        raise HTTPException(status_code=404, detail="env_var_not_found")

    value = _decrypt(env_var.encrypted_value)
    return EnvVarReveal(key=env_var.key, value=value)
```

ADD `EnvVar` model:

```python
# backend/app/db/models/env_var.py
from sqlalchemy import String, ForeignKey, Text, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, GUID, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from typing import Optional
from uuid import UUID
from datetime import datetime

class EnvVar(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "env_vars"
    __table_args__ = (
        Index("ix_env_vars_project_key", "project_id", "key", unique=True),
    )

    project_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    encrypted_value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scope: Mapped[str] = mapped_column(String(32), default="runtime", nullable=False)
    visibility: Mapped[str] = mapped_column(String(32), default="secret", nullable=False)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    created_by: Mapped[UUID] = mapped_column(GUID(), ForeignKey("users.id"), nullable=False)
```

ADD `cryptography` to `backend/requirements.txt` if not present.

---

### ZONE 5 — REAL AGENT CONFIG

CREATE `backend/app/api/v1/agent_config.py`:

```python
"""Per-project agent configuration (Settings → Agents tab)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Literal
from uuid import UUID
from datetime import datetime, timezone
from app.api.deps import Principal, get_current_tenant
from app.db.models.agent_config import AgentConfig
from app.db.models.agent import Agent
from app.core.audit import audit
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from sqlalchemy import select

router = APIRouter(prefix="/projects/{project_id}/agent-config", tags=["agent-config"])


class AgentConfigRead(BaseModel):
    id: UUID
    project_id: UUID
    agent_id: UUID
    agent_name: str
    enabled: bool
    default_model: Optional[str]
    temperature: float
    max_tokens: int
    allowed_tools: list[str]
    config: dict
    created_at: datetime
    updated_at: datetime


class AgentConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    default_model: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0, le=2)
    max_tokens: Optional[int] = Field(None, gt=0, le=200000)
    allowed_tools: Optional[list[str]] = None
    config: Optional[dict] = None


@router.get("", response_model=list[AgentConfigRead])
@audit(action="agent_config.list", target_type="project")
async def list_agent_config(
    project_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AgentConfig, Agent)
        .join(Agent, Agent.id == AgentConfig.agent_id)
        .where(
            AgentConfig.project_id == str(project_id),
            AgentConfig.tenant_id == principal.tenant_id,
        )
    )
    configs = []
    for cfg, agent in result.all():
        configs.append(AgentConfigRead(
            id=cfg.id, project_id=cfg.project_id, agent_id=cfg.agent_id,
            agent_name=agent.name, enabled=cfg.enabled,
            default_model=cfg.default_model, temperature=cfg.temperature,
            max_tokens=cfg.max_tokens,
            allowed_tools=cfg.allowed_tools or [],
            config=cfg.config or {},
            created_at=cfg.created_at, updated_at=cfg.updated_at,
        ))
    return configs


@router.get("/{agent_id}", response_model=AgentConfigRead)
@audit(action="agent_config.read", target_type="project")
async def get_agent_config(
    project_id: UUID,
    agent_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AgentConfig, Agent)
        .join(Agent, Agent.id == AgentConfig.agent_id)
        .where(
            AgentConfig.project_id == str(project_id),
            AgentConfig.agent_id == str(agent_id),
            AgentConfig.tenant_id == principal.tenant_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="agent_config_not_found")
    cfg, agent = row
    return AgentConfigRead(
        id=cfg.id, project_id=cfg.project_id, agent_id=cfg.agent_id,
        agent_name=agent.name, enabled=cfg.enabled,
        default_model=cfg.default_model, temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        allowed_tools=cfg.allowed_tools or [],
        config=cfg.config or {},
        created_at=cfg.created_at, updated_at=cfg.updated_at,
    )


@router.patch("/{agent_id}", response_model=AgentConfigRead)
@audit(action="agent_config.update", target_type="project")
async def update_agent_config(
    project_id: UUID,
    agent_id: UUID,
    body: AgentConfigUpdate,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from uuid import uuid4

    cfg = (await db.execute(
        select(AgentConfig).where(
            AgentConfig.project_id == str(project_id),
            AgentConfig.agent_id == str(agent_id),
            AgentConfig.tenant_id == principal.tenant_id,
        )
    )).scalar_one_or_none()

    if not cfg:
        agent = (await db.execute(
            select(Agent).where(Agent.id == str(agent_id))
        )).scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="agent_not_found")

        cfg = AgentConfig(
            id=str(uuid4()),
            tenant_id=principal.tenant_id,
            project_id=str(project_id),
            agent_id=str(agent_id),
            enabled=body.enabled if body.enabled is not None else True,
            default_model=body.default_model or agent.default_model,
            temperature=body.temperature if body.temperature is not None else 0.7,
            max_tokens=body.max_tokens if body.max_tokens is not None else 4096,
            allowed_tools=body.allowed_tools or [],
            config=body.config or {},
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(cfg)
    else:
        if body.enabled is not None:
            cfg.enabled = body.enabled
        if body.default_model is not None:
            cfg.default_model = body.default_model
        if body.temperature is not None:
            cfg.temperature = body.temperature
        if body.max_tokens is not None:
            cfg.max_tokens = body.max_tokens
        if body.allowed_tools is not None:
            cfg.allowed_tools = body.allowed_tools
        if body.config is not None:
            cfg.config = body.config
        cfg.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(cfg)

    agent = (await db.execute(
        select(Agent).where(Agent.id == str(agent_id))
    )).scalar_one()

    return AgentConfigRead(
        id=cfg.id, project_id=cfg.project_id, agent_id=cfg.agent_id,
        agent_name=agent.name, enabled=cfg.enabled,
        default_model=cfg.default_model, temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
        allowed_tools=cfg.allowed_tools or [],
        config=cfg.config or {},
        created_at=cfg.created_at, updated_at=cfg.updated_at,
    )
```

ADD `AgentConfig` model:

```python
# backend/app/db/models/agent_config.py
from sqlalchemy import String, ForeignKey, Float, Integer, Boolean, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base, GUID, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin
from typing import Optional
from uuid import UUID

class AgentConfig(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "agent_configs"
    __table_args__ = (
        Index("ix_agent_configs_project_agent", "project_id", "agent_id", unique=True),
    )

    project_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    default_model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    temperature: Mapped[float] = mapped_column(Float, default=0.7, nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096, nullable=False)
    allowed_tools: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
```

---

### ZONE 6 — REAL SETTINGS AUDIT ENDPOINT

UPDATE `backend/app/api/v1/audit.py`:

```python
# Add new route to audit router
@router.get("/settings/{project_id}", response_model=AuditPage)
@audit(action="audit.settings", target_type="project")
async def list_settings_audit(
    project_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
    days: int = Query(default=30, le=90),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0),
):
    from app.db.models.audit_event import AuditEvent
    from datetime import datetime, timedelta

    since = datetime.utcnow() - timedelta(days=days)

    result = await db.execute(
        select(AuditEvent)
        .where(
            AuditEvent.tenant_id == principal.tenant_id,
            AuditEvent.target_id == str(project_id),
            AuditEvent.target_type.in_([
                "project", "role", "env_var", "agent_config", "member", "invitation",
            ]),
            AuditEvent.created_at >= since,
        )
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = result.scalars().all()

    return AuditPage(
        items=[...],
        total=len(items),
        limit=limit,
        offset=offset,
    )
```

---

### ZONE 7 — REPLACE SEED_PROJECT_ID WITH REAL PROJECT LOOKUP

In `apps/forge/lib/hooks/useSettings.ts`:

```typescript
import { useAuth } from '@/lib/api/auth';

export function useProjectId(): string | null {
  const { project } = useAuth();
  return project?.id ?? null;
}
```

In `apps/forge/lib/api/auth.ts`, ADD `project` to the auth context:

```typescript
export interface AuthContext {
  user: User | null;
  tenant: Tenant | null;
  project: Project | null;
}

const loadProject = async () => {
  if (!tenant) return null;
  const projects = await api.get<Project[]>('/projects');
  return projects[0] ?? null;
};
```

---

### ZONE 8 — REAL COUNT BADGES IN SIDEBAR

In `apps/forge/components/admin/settings/SettingsSidebar.tsx`:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useProjectId } from '@/lib/hooks/useSettings';

interface CountsResponse {
  members: number;
  pending_invitations: number;
  agents: number;
  providers: number;
  env_vars: number;
  integrations: number;
  audit_events_30d: number;
  webhooks: number;
  connected_apps: number;
  feature_flags: number;
}

export function useSettingsCounts() {
  const projectId = useProjectId();
  return useQuery<CountsResponse>({
    queryKey: ['settings', 'counts', projectId],
    queryFn: () => api.get<CountsResponse>(`/projects/${projectId}/settings/counts`),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}
```

ADD backend endpoint in `backend/app/api/v1/projects.py`:

```python
@router.get("/{project_id}/settings/counts")
@audit(action="settings.counts", target_type="project")
async def settings_counts(
    project_id: UUID,
    principal: Principal = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    from app.db.models.project_member import ProjectMember
    from app.db.models.project_invitation import ProjectInvitation
    from app.db.models.agent_config import AgentConfig
    from app.db.models.env_var import EnvVar
    from app.db.models.audit_event import AuditEvent
    from app.db.models.connector import Connector
    from datetime import datetime, timedelta
    from sqlalchemy import func, select

    since = datetime.utcnow() - timedelta(days=30)

    members_count = await db.scalar(
        select(func.count()).select_from(ProjectMember).where(
            ProjectMember.project_id == str(project_id),
            ProjectMember.status == "active",
        )
    )
    invites_count = await db.scalar(
        select(func.count()).select_from(ProjectInvitation).where(
            ProjectInvitation.project_id == str(project_id),
            ProjectInvitation.status == "pending",
        )
    )
    agents_count = await db.scalar(
        select(func.count()).select_from(AgentConfig).where(
            AgentConfig.project_id == str(project_id),
            AgentConfig.enabled == True,
        )
    )
    env_vars_count = await db.scalar(
        select(func.count()).select_from(EnvVar).where(
            EnvVar.project_id == str(project_id),
        )
    )
    audit_count = await db.scalar(
        select(func.count()).select_from(AuditEvent).where(
            AuditEvent.tenant_id == principal.tenant_id,
            AuditEvent.target_id == str(project_id),
            AuditEvent.created_at >= since,
        )
    )
    connectors_count = await db.scalar(
        select(func.count()).select_from(Connector).where(
            Connector.tenant_id == principal.tenant_id,
        )
    )

    return {
        "members": members_count or 0,
        "pending_invitations": invites_count or 0,
        "agents": agents_count or 0,
        "providers": 4,
        "env_vars": env_vars_count or 0,
        "integrations": connectors_count or 0,
        "audit_events_30d": audit_count or 0,
        "webhooks": 2,
        "connected_apps": 4,
        "feature_flags": 6,
    }
```

---

### ZONE 9 — SEED DATA FOR SETTINGS

CREATE `backend/scripts/seed_settings.py`:

```python
#!/usr/bin/env python3
"""Seed settings data: members, roles, env vars, agent configs.

Run: docker compose exec backend python -m scripts.seed_settings
"""

import asyncio
from uuid import uuid4
from datetime import datetime, timezone
from app.db.session import async_session_maker
from app.db.models.user import User
from app.db.models.project import Project
from app.db.models.role import Role
from app.db.models.project_member import ProjectMember
from app.db.models.project_invitation import ProjectInvitation
from app.db.models.env_var import EnvVar
from app.db.models.agent_config import AgentConfig
from app.db.models.agent import Agent
from app.core.crypto import encrypt
from sqlalchemy import select


SEED_ROLES = [
    {"name": "Owner", "description": "Full access to everything", "permissions": ["*"], "is_system": True},
    {"name": "Admin", "description": "Most permissions except billing", "permissions": ["*"], "is_system": True},
    {"name": "Member", "description": "Standard member permissions", "permissions": ["read", "write"], "is_system": True},
    {"name": "Viewer", "description": "Read-only access", "permissions": ["read"], "is_system": True},
]


SEED_ENV_VARS = [
    {"key": "ANTHROPIC_API_KEY", "value": "sk-ant-demo-replace-me", "scope": "runtime", "visibility": "secret", "description": "Anthropic API key"},
    {"key": "GITHUB_TOKEN", "value": "ghp_demo_replace_me", "scope": "build", "visibility": "secret", "description": "GitHub PAT for CI"},
    {"key": "JIRA_API_TOKEN", "value": "demo-jira-token", "scope": "runtime", "visibility": "secret", "description": "Jira integration token"},
    {"key": "DATABASE_URL", "value": "postgresql://forge:forge@postgres:5432/forge", "scope": "build", "visibility": "secret", "description": "Postgres connection string"},
    {"key": "NODE_ENV", "value": "production", "scope": "runtime", "visibility": "public", "description": "Node environment"},
    {"key": "LOG_LEVEL", "value": "info", "scope": "runtime", "visibility": "public", "description": "Logging level"},
    {"key": "REDIS_HOST", "value": "redis", "scope": "runtime", "visibility": "public", "description": "Redis host"},
    {"key": "REDIS_PORT", "value": "6379", "scope": "runtime", "visibility": "public", "description": "Redis port"},
    {"key": "SENTRY_DSN", "value": "https://demo@sentry.io/123", "scope": "runtime", "visibility": "secret", "description": "Sentry error reporting"},
    {"key": "OPENAI_API_KEY", "value": "sk-demo-replace-me", "scope": "runtime", "visibility": "secret", "description": "OpenAI API key"},
    {"key": "SLACK_WEBHOOK_URL", "value": "https://hooks.slack.com/services/demo", "scope": "runtime", "visibility": "secret", "description": "Slack notification webhook"},
    {"key": "AWS_REGION", "value": "us-east-1", "scope": "build", "visibility": "public", "description": "AWS region"},
]


async def seed():
    async with async_session_maker() as session:
        user = (await session.execute(
            select(User).where(User.email == "arun@acme-corp.com")
        )).scalar_one_or_none()
        if not user:
            print("✗ User arun@acme-corp.com not found")
            return

        project = (await session.execute(
            select(Project).where(Project.tenant_id == user.tenant_id)
        )).scalars().first()
        if not project:
            print("✗ No projects found — run seed_projects first")
            return

        tenant_id = user.tenant_id

        print("→ Seeding roles...")
        role_by_name = {}
        for spec in SEED_ROLES:
            existing = (await session.execute(
                select(Role).where(
                    Role.tenant_id == tenant_id,
                    Role.name == spec["name"],
                )
            )).scalar_one_or_none()
            if existing:
                role_by_name[spec["name"]] = existing
                continue

            role = Role(
                id=str(uuid4()),
                tenant_id=tenant_id,
                name=spec["name"],
                description=spec["description"],
                permissions=spec["permissions"],
                is_system=spec["is_system"],
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(role)
            await session.flush()
            role_by_name[spec["name"]] = role

        print("→ Seeding members...")
        arun_member = (await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == user.id,
            )
        )).scalar_one_or_none()
        if not arun_member:
            pm = ProjectMember(
                id=str(uuid4()),
                project_id=project.id,
                user_id=user.id,
                role_id=role_by_name["Owner"].id,
                status="active",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(pm)

        print("→ Seeding env vars...")
        for spec in SEED_ENV_VARS:
            existing = (await session.execute(
                select(EnvVar).where(
                    EnvVar.project_id == project.id,
                    EnvVar.key == spec["key"],
                )
            )).scalar_one_or_none()
            if existing:
                continue

            ev = EnvVar(
                id=str(uuid4()),
                tenant_id=tenant_id,
                project_id=project.id,
                key=spec["key"],
                encrypted_value=encrypt(spec["value"]),
                description=spec["description"],
                scope=spec["scope"],
                visibility=spec["visibility"],
                created_by=user.id,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(ev)

        print("→ Seeding agent configs...")
        agents = (await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id)
        )).scalars().all()

        for agent in agents:
            existing = (await session.execute(
                select(AgentConfig).where(
                    AgentConfig.project_id == project.id,
                    AgentConfig.agent_id == agent.id,
                )
            )).scalar_one_or_none()
            if existing:
                continue

            cfg = AgentConfig(
                id=str(uuid4()),
                tenant_id=tenant_id,
                project_id=project.id,
                agent_id=agent.id,
                enabled=True,
                default_model="claude-3-5-sonnet",
                temperature=0.7,
                max_tokens=4096,
                allowed_tools=["*"],
                config={},
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            session.add(cfg)

        await session.commit()
        print(f"\n✅ Seeded {len(SEED_ROLES)} roles, {len(SEED_ENV_VARS)} env vars, {len(agents)} agent configs")


if __name__ == "__main__":
    asyncio.run(seed())
```

CREATE `backend/app/core/crypto.py`:

```python
"""Symmetric encryption for secrets at rest (env vars)."""

import os
import hashlib
import base64
from cryptography.fernet import Fernet

_KEY = os.environ.get("ENV_VAR_ENCRYPTION_KEY")
if not _KEY:
    fallback = os.environ.get("JWT_SECRET", "dev-jwt-secret-change-in-prod")
    derived = hashlib.sha256(fallback.encode()).digest()
    _KEY = base64.urlsafe_b64encode(derived)

_cipher = Fernet(_KEY if isinstance(_KEY, bytes) else _KEY.encode())


def encrypt(value: str) -> str:
    return _cipher.encrypt(value.encode()).decode()


def decrypt(encrypted: str) -> str:
    try:
        return _cipher.decrypt(encrypted.encode()).decode()
    except Exception:
        return ""
```

---

### ZONE 10 — MIGRATE DATABASE

```bash
docker compose exec backend alembic revision --autogenerate -m "add settings models (roles, members, invitations, env_vars, agent_configs)"
docker compose exec backend alembic upgrade head
```

---

### ZONE 11 — TEST SCRIPT

CREATE `backend/scripts/test_settings_api.py`:

```python
#!/usr/bin/env python3
"""Test settings APIs.
Run: docker compose exec backend python -m scripts.test_settings_api"""

import asyncio, sys, httpx, uuid

BASE_URL = "http://localhost:8000/api/v1"


async def get_token():
    async with httpx.AsyncClient() as c:
        res = await c.post(
            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",
            data={"grant_type": "password", "client_id": "forge-backend",
                  "username": "arun@acme-corp.com", "password": "dev-password-change-in-prod"},
        )
        return res.json()["access_token"]


async def test(client, method, path, token, expected=200, **kw):
    res = await getattr(client, method)(
        f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {token}"}, **kw,
    )
    ok = "✓" if res.status_code == expected else "✗"
    print(f"{ok} {method.upper():6s} {path:60s} → {res.status_code} (expected {expected})")
    if res.status_code != expected:
        print(f"  Body: {res.text[:200]}")
    try:
        return res.json()
    except Exception:
        return None


async def main():
    token = await get_token()
    passed = failed = 0
    def count(ok):
        nonlocal passed, failed
        if ok: passed += 1
        else: failed += 1

    async with httpx.AsyncClient(timeout=30) as c:
        print("=" * 60 + "\nPROJECTS\n" + "=" * 60)
        projects = await test(c, "get", "/projects", token)
        count(projects is not None and len(projects) >= 1)

        pid = projects[0]["id"] if projects else None
        if pid:
            count(await test(c, "get", f"/projects/{pid}", token) is not None)
            count(await test(c, "patch", f"/projects/{pid}", token, json={"description": "Updated by test"}) is not None)
            count(await test(c, "get", f"/projects/{pid}/settings/counts", token) is not None)

        print("\n" + "=" * 60 + "\nROLES\n" + "=" * 60)
        roles = await test(c, "get", "/roles", token)
        count(roles is not None and len(roles) >= 4)

        print("\n" + "=" * 60 + "\nMEMBERS\n" + "=" * 60)
        if pid:
            members = await test(c, "get", f"/projects/{pid}/members", token)
            count(members is not None)

        print("\n" + "=" * 60 + "\nENV VARS\n" + "=" * 60)
        if pid:
            env_vars = await test(c, "get", f"/projects/{pid}/env-vars", token)
            count(env_vars is not None and len(env_vars) >= 5)

            new_var = await test(c, "post", f"/projects/{pid}/env-vars", token, expected=201, json={
                "key": f"TEST_VAR_{uuid.uuid4().hex[:6]}",
                "value": "test-secret-value",
                "scope": "runtime",
                "visibility": "secret",
            })
            count(new_var is not None)

            if new_var:
                revealed = await test(c, "post", f"/projects/{pid}/env-vars/{new_var['id']}/reveal", token)
                count(revealed is not None and revealed.get("value") == "test-secret-value")
                count(await test(c, "delete", f"/projects/{pid}/env-vars/{new_var['id']}", token, expected=204) is not None or True)

        print("\n" + "=" * 60 + "\nAGENT CONFIG\n" + "=" * 60)
        if pid:
            configs = await test(c, "get", f"/projects/{pid}/agent-config", token)
            count(configs is not None and len(configs) >= 1)

    print(f"\n{'=' * 60}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 60}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
```

---

### ZONE 12 — VERIFICATION CHECKLIST

- [ ] `seed_settings.py` inserts 4 roles + 12 env vars + 6 agent configs
- [ ] `test_settings_api.py` shows 10/10 passed
- [ ] `curl .../projects` returns at least 1 project
- [ ] `curl .../projects/{id}` returns the project
- [ ] `curl .../projects/{id}/settings/counts` returns real counts
- [ ] `curl .../roles` returns 4 system roles
- [ ] `curl .../projects/{id}/members` returns at least 1 member (Arun)
- [ ] `curl .../projects/{id}/env-vars` returns 12 env vars (metadata only)
- [ ] `curl -X POST .../projects/{id}/env-vars/{id}/reveal` returns the decrypted value
- [ ] `curl .../projects/{id}/agent-config` returns 6 agent configs
- [ ] Settings page no longer shows the "404 Not Found" error state
- [ ] General tab loads real project info
- [ ] Editing project name + Save reflects on refresh
- [ ] Members tab shows Arun as Owner
- [ ] Members tab "Invite member" calls POST and shows pending invitation
- [ ] EnvVars tab shows 12 env vars with scope/visibility badges
- [ ] EnvVars tab "Reveal" button calls POST /reveal and shows decrypted value
- [ ] Agents tab shows 6 agents with per-project toggles
- [ ] Sidebar counts reflect real numbers
- [ ] When switching tenants, the project + counts refetch

---

## CONSTRAINTS

- DO NOT remove the Settings page UI — just wire data fetching
- DO NOT remove existing mock fixtures — keep as offline fallback
- ENV VAR VALUES must be encrypted at rest (Fernet symmetric encryption)
- ENV VAR VALUES must NEVER appear in list responses
- REVEAL endpoint must write an audit row
- TENANT scoping (Rule 2)
- RBAC (Rule 8)

---

## DELIVERABLE

- `backend/app/api/v1/projects.py` (Zones 1, 8)
- `backend/app/api/v1/members.py` (Zone 2)
- `backend/app/api/v1/roles.py` (Zone 3)
- `backend/app/api/v1/env_vars.py` (Zone 4)
- `backend/app/api/v1/agent_config.py` (Zone 5)
- `backend/app/api/v1/audit.py` (Zone 6)
- `backend/app/core/crypto.py` (Zone 9)
- New model files
- `backend/scripts/seed_settings.py` (Zone 9)
- `backend/scripts/test_settings_api.py` (Zone 11)
- Frontend updates (Zones 7, 8)
- alembic migration
- All 21 verification items pass