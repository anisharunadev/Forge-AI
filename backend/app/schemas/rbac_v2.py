"""F12 RBAC — Pydantic schemas for the org/team/user/project/customer surface.

Phase 3 Feature 12. The role enum below is the source of truth for the
hierarchical role names used in the ``team_members.role`` column
(``app.db.models.team_member.TeamMember.role``) and for the role
inheritance logic in ``app.services.rbac_v2_service``.

Role inheritance rules (step-78 §"RBAC model" / §"Inheritance"):
  - super_admin inherits everything; no overrides needed.
  - org_admin inherits team_admin, project_admin, member, viewer.
  - team_admin inherits project_admin, member, viewer.
  - project_admin inherits member, viewer.
  - member inherits viewer.
  - customer_admin is an orthogonal axis for white-label customers.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel


class RoleEnum(str, Enum):
    """Hierarchical role names from step-78 §"RBAC model"."""

    SUPER_ADMIN = "super_admin"
    ORG_ADMIN = "org_admin"
    TEAM_ADMIN = "team_admin"
    PROJECT_ADMIN = "project_admin"
    MEMBER = "member"
    VIEWER = "viewer"
    CUSTOMER_ADMIN = "customer_admin"


# Role inheritance: each role inherits the permissions of the roles below it.
ROLE_HIERARCHY: dict[RoleEnum, set[RoleEnum]] = {
    RoleEnum.SUPER_ADMIN: {
        RoleEnum.SUPER_ADMIN,
        RoleEnum.ORG_ADMIN,
        RoleEnum.TEAM_ADMIN,
        RoleEnum.PROJECT_ADMIN,
        RoleEnum.MEMBER,
        RoleEnum.VIEWER,
    },
    RoleEnum.ORG_ADMIN: {
        RoleEnum.ORG_ADMIN,
        RoleEnum.TEAM_ADMIN,
        RoleEnum.PROJECT_ADMIN,
        RoleEnum.MEMBER,
        RoleEnum.VIEWER,
    },
    RoleEnum.TEAM_ADMIN: {
        RoleEnum.TEAM_ADMIN,
        RoleEnum.PROJECT_ADMIN,
        RoleEnum.MEMBER,
        RoleEnum.VIEWER,
    },
    RoleEnum.PROJECT_ADMIN: {
        RoleEnum.PROJECT_ADMIN,
        RoleEnum.MEMBER,
        RoleEnum.VIEWER,
    },
    RoleEnum.MEMBER: {RoleEnum.MEMBER, RoleEnum.VIEWER},
    RoleEnum.VIEWER: {RoleEnum.VIEWER},
    RoleEnum.CUSTOMER_ADMIN: {RoleEnum.CUSTOMER_ADMIN, RoleEnum.MEMBER, RoleEnum.VIEWER},
}


def role_grants(actual: RoleEnum, required: RoleEnum) -> bool:
    """Return True iff `actual` role grants `required` (via inheritance)."""
    return required in ROLE_HIERARCHY.get(actual, set())


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------


class OrganizationBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    brand: dict[str, Any] = Field(default_factory=dict)
    billing_ref: str | None = None


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationRead(OrganizationBase, TenantScopedModel):
    id: UUID


# ---------------------------------------------------------------------------
# Team
# ---------------------------------------------------------------------------


class TeamBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    model_allowlist: list[str] = Field(default_factory=list)
    default_agent_config: dict[str, Any] = Field(default_factory=dict)
    org_id: UUID


class TeamCreate(TeamBase):
    pass


class TeamRead(TeamBase, TenantScopedModel):
    id: UUID
    blocked: bool


# ---------------------------------------------------------------------------
# TeamMember
# ---------------------------------------------------------------------------


class TeamMemberCreate(ForgeBaseModel):
    user_id: UUID
    role: RoleEnum = RoleEnum.MEMBER


class TeamMemberUpdate(ForgeBaseModel):
    role: RoleEnum


class TeamMemberRead(ForgeBaseModel):
    id: UUID
    team_id: UUID
    user_id: UUID
    email: str | None = None
    display_name: str | None = None
    role: RoleEnum
    status: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Customer
# ---------------------------------------------------------------------------


class CustomerBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    org_id: UUID
    billing_ref: str | None = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(ForgeBaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    billing_ref: str | None = None


class CustomerRead(CustomerBase, TenantScopedModel):
    id: UUID
    blocked: bool


# ---------------------------------------------------------------------------
# Project (step-78 F12 — entities of the org → team → project hierarchy)
# ---------------------------------------------------------------------------


class ProjectBase(ForgeBaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    slug: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    default_branch: str = "main"
    visibility: str = "private"
    team_id: UUID


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(ForgeBaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    slug: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$")
    description: str | None = None
    default_branch: str | None = None
    visibility: str | None = None


class ProjectRead(ProjectBase, TenantScopedModel):
    id: UUID
    status: str = "active"
    created_by: UUID | None = None


# ---------------------------------------------------------------------------
# Bulk team members (step-78 F12 acceptance #3 — 100 users per call)
# ---------------------------------------------------------------------------


class BulkTeamMemberAddRequest(ForgeBaseModel):
    members: list[TeamMemberCreate] = Field(..., min_length=1, max_length=500)
    atomic: bool = False  # when True, all-or-nothing; when False, per-row results


class BulkTeamMemberResult(ForgeBaseModel):
    user_id: UUID
    role: RoleEnum
    status: str  # "added" | "skipped" | "error"
    detail: str | None = None


class BulkTeamMemberAddResponse(ForgeBaseModel):
    team_id: UUID
    added: int
    skipped: int
    errors: int
    results: list[BulkTeamMemberResult]


# ---------------------------------------------------------------------------
# Daily rollups (step-78 F12 §"Daily activity endpoints")
# ---------------------------------------------------------------------------


class DailyRollup(ForgeBaseModel):
    entity_id: UUID
    entity_type: str  # team | user | organization | customer
    spend_usd: float = 0.0
    request_count: int = 0
    error_count: int = 0
    p50_latency_ms: float = 0.0
    p95_latency_ms: float = 0.0
    window: str = "24h"


# ---------------------------------------------------------------------------
# Team model allowlist (step-78 F12 §"Tag-based access" / team/model)
# ---------------------------------------------------------------------------


class TeamModelAllowlistRequest(ForgeBaseModel):
    model: str = Field(..., min_length=1, max_length=200)


class TeamModelAllowlistResponse(ForgeBaseModel):
    team_id: UUID
    model_allowlist: list[str]


# ---------------------------------------------------------------------------
# Permission overrides (step-78 F12 §"RBAC inheritance" overrides)
# ---------------------------------------------------------------------------


class TeamPermissionOverride(ForgeBaseModel):
    user_id: UUID
    granted: list[str] = Field(default_factory=list)  # permission strings added
    revoked: list[str] = Field(default_factory=list)  # permission strings removed


class TeamPermissionsList(ForgeBaseModel):
    team_id: UUID
    base_permissions: list[str]
    overrides: list[TeamPermissionOverride]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class PermissionDenied(ForgeBaseModel):
    """403 — required role vs current role."""

    error: str = "permission_denied"
    required_role: RoleEnum
    current_role: RoleEnum | None
    detail: str | None = None


class TeamBlocked(ForgeBaseModel):
    """403 — team is blocked; no chat completions / key usage allowed."""

    error: str = "team_blocked"
    team_id: UUID
    detail: str | None = None


__all__ = [
    "RoleEnum",
    "ROLE_HIERARCHY",
    "role_grants",
    "OrganizationBase",
    "OrganizationCreate",
    "OrganizationRead",
    "TeamBase",
    "TeamCreate",
    "TeamRead",
    "TeamMemberCreate",
    "TeamMemberUpdate",
    "TeamMemberRead",
    "CustomerBase",
    "CustomerCreate",
    "CustomerUpdate",
    "CustomerRead",
    "ProjectBase",
    "ProjectCreate",
    "ProjectUpdate",
    "ProjectRead",
    "BulkTeamMemberAddRequest",
    "BulkTeamMemberResult",
    "BulkTeamMemberAddResponse",
    "DailyRollup",
    "TeamModelAllowlistRequest",
    "TeamModelAllowlistResponse",
    "TeamPermissionOverride",
    "TeamPermissionsList",
    "PermissionDenied",
    "TeamBlocked",
]
