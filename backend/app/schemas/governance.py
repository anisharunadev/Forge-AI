"""Governance Center schemas (Step-72).

CamelCase wire format — the orchestrator-stub surface (apps/forge/bin/
orchestrator-stub.py make_governance()) is the contract these models
match. Pydantic v2 + ``by_alias=True`` at the route produces camelCase
on the wire (R4 — typed artifacts, no free-form dicts).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import ConfigDict, Field

from app.schemas.common import ForgeBaseModel


class _CamelModel(ForgeBaseModel):
    """Base that emits camelCase field names on serialization."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------


class PolicyStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    DRAFT = "draft"


class PolicySeverity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class PolicyCategory(StrEnum):
    SECURITY = "security"
    COMPLIANCE = "compliance"
    COST = "cost"
    PRIVACY = "privacy"


class PolicyRead(_CamelModel):
    id: str
    title: str
    summary: str
    status: PolicyStatus
    severity: PolicySeverity
    category: PolicyCategory
    version: str
    updated_at: datetime = Field(..., alias="updatedAt")
    updated_by: dict[str, Any] = Field(..., alias="updatedBy")


class PolicyAcceptRequest(_CamelModel):
    actor_id: str | None = Field(default=None, alias="actorId")


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------


class ApprovalState(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"


class ApprovalKind(StrEnum):
    REQUEST_CONFIRMATION = "request_confirmation"
    REQUEST_CHECKBOX_CONFIRMATION = "request_checkbox_confirmation"
    ASK_USER_QUESTIONS = "ask_user_questions"
    SUGGEST_TASKS = "suggest_tasks"


class ApprovalRead(_CamelModel):
    id: str
    kind: ApprovalKind
    title: str
    prompt: str
    state: ApprovalState
    created_at: datetime = Field(..., alias="createdAt")
    idempotency_key: str = Field(..., alias="idempotencyKey")
    decider: dict[str, Any] | None = None
    decided_at: datetime | None = Field(default=None, alias="decidedAt")
    reason: str | None = None


class ApprovalDecisionRequest(_CamelModel):
    actor_id: str | None = Field(default=None, alias="actorId")
    reason: str | None = None


# ---------------------------------------------------------------------------
# RBAC roles
# ---------------------------------------------------------------------------


class RbacPermission(_CamelModel):
    resource: str
    actions: list[str]


class RbacRoleRead(_CamelModel):
    id: str
    name: str
    description: str | None = None
    permissions: list[RbacPermission]
    member_count: int = Field(default=0, alias="memberCount")
    system: bool = False
    updated_at: datetime = Field(..., alias="updatedAt")


# ---------------------------------------------------------------------------
# Board confirmations
# ---------------------------------------------------------------------------


class BoardConfirmationOutcome(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"


class BoardConfirmationRead(_CamelModel):
    id: UUID
    subject: dict[str, Any]
    plan_rev: str = Field(..., alias="planRev")
    outcome: BoardConfirmationOutcome
    decider: dict[str, Any] | None = None
    decided_at: datetime | None = Field(default=None, alias="decidedAt")
    idempotency_key: str = Field(..., alias="idempotencyKey")
    prompt: str


class BoardConfirmationAck(_CamelModel):
    """POST /board-confirmations body — board ack."""

    subject_id: str = Field(..., alias="subjectId")
    plan_rev: str = Field(..., alias="planRev")
    outcome: BoardConfirmationOutcome
    prompt: str | None = None
    idempotency_key: str | None = Field(default=None, alias="idempotencyKey")


__all__ = [
    "ApprovalDecisionRequest",
    "ApprovalKind",
    "ApprovalRead",
    "ApprovalState",
    "BoardConfirmationAck",
    "BoardConfirmationOutcome",
    "BoardConfirmationRead",
    "PolicyAcceptRequest",
    "PolicyCategory",
    "PolicyRead",
    "PolicySeverity",
    "PolicyStatus",
    "RbacPermission",
    "RbacRoleRead",
]
