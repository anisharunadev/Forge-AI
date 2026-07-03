"""F-829 — Governance Center core surface (Step-72).

Steward-facing endpoints backing the orchestrator-stub responses for
``/v1/governance/{policies, approvals, rbac-roles, board-confirmations}``.
The stub stays for dev; production traffic flows here.

* ``GET    /api/v1/governance/policies``             — list compliance policies
* ``POST   /api/v1/governance/policies/{id}/accept`` — record acceptance
* ``GET    /api/v1/governance/approvals``            — list approval requests
* ``POST   /api/v1/governance/approvals/{id}/accept`` — grant
* ``POST   /api/v1/governance/approvals/{id}/decline`` — deny
* ``GET    /api/v1/governance/rbac-roles``           — list roles
* ``GET    /api/v1/governance/board-confirmations``  — list board acks
* ``POST   /api/v1/governance/board-confirmations``  — record board ack

Every endpoint is tenant-scoped (Rule 2), permission-gated
(Rule 3 — ``governance:read`` / ``governance:manage``), and emits an
``audit.event`` (Rule 6). Mutation endpoints also persist an
``AuditEvent`` row so the Audit Center can render them.

ponytail: the policy/role data sources are existing models with
different shapes than the stub; we project them in the handler with a
short adapter. Add per-tenant policy CRUD when the authoring surface
ships.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession, get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.approval import ApprovalRequest, ApprovalStatus
from app.db.models.audit import AuditEvent
from app.db.models.board_confirmation import (
    BoardConfirmation,
    BoardConfirmationOutcome,
)
from app.db.models.policy import Policy
from app.db.models.policy import PolicySeverity as DBPolicySeverity
from app.db.models.role import Role
from app.schemas.governance import (
    ApprovalDecisionRequest,
    ApprovalKind,
    ApprovalRead,
    ApprovalState,
    BoardConfirmationAck,
    BoardConfirmationRead,
    PolicyAcceptRequest,
    PolicyCategory,
    PolicyRead,
    PolicySeverity,
    PolicyStatus,
    RbacPermission,
    RbacRoleRead,
)
from app.schemas.governance import (
    BoardConfirmationOutcome as SchemaOutcome,
)
from app.services.rbac import (
    GOVERNANCE_PERMISSION_MANAGE,
    GOVERNANCE_PERMISSION_READ,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/governance", tags=["governance"])


# ---------------------------------------------------------------------------
# Adapters (DB row → stub-shaped response)
# ---------------------------------------------------------------------------


def _derive_policy_category(name: str, description: str | None) -> PolicyCategory:
    """ponytail: naive keyword match; the authoring surface will pick
    a category explicitly. Upgrade when compliance authoring ships.
    """
    text = f"{name} {description or ''}".lower()
    if any(k in text for k in ("pii", "privacy", "gdpr", "data")):
        return PolicyCategory.PRIVACY
    if any(k in text for k in ("cost", "budget", "spend")):
        return PolicyCategory.COST
    if any(k in text for k in ("compliance", "audit", "sox")):
        return PolicyCategory.COMPLIANCE
    return PolicyCategory.SECURITY


def _severity_to_schema(severity: DBPolicySeverity) -> PolicySeverity:
    return {
        DBPolicySeverity.INFO: PolicySeverity.LOW,
        DBPolicySeverity.WARN: PolicySeverity.MEDIUM,
        DBPolicySeverity.BLOCK: PolicySeverity.HIGH,
    }[severity]


def _state_to_schema(status: ApprovalStatus) -> ApprovalState:
    return {
        ApprovalStatus.PENDING: ApprovalState.PENDING,
        ApprovalStatus.GRANTED: ApprovalState.ACCEPTED,
        ApprovalStatus.DENIED: ApprovalState.DECLINED,
        ApprovalStatus.EXPIRED: ApprovalState.EXPIRED,
        ApprovalStatus.CANCELLED: ApprovalState.DECLINED,
    }[status]


def _split_permission(raw: str) -> RbacPermission:
    """`<resource>:<action>` → nested object. Wildcards land on actions=["*"]."""
    if ":" in raw:
        resource, action = raw.split(":", 1)
        actions = ["*"] if action == "*" else [action]
    else:
        resource, actions = raw, ["*"]
    return RbacPermission(resource=resource, actions=actions)


def _actor_blob(actor_id: str | None) -> dict[str, Any] | None:
    if not actor_id:
        return None
    return {"id": actor_id, "displayName": actor_id}


def _audit_event(
    *,
    db: Any,
    principal: AuthenticatedPrincipal,
    action: str,
    target_type: str,
    target_id: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Persist an AuditEvent row (Rule 6). Decorator only logs structlog;
    we still want the Audit Center to render these mutations.
    """
    event = AuditEvent(
        tenant_id=UUID(principal.tenant_id),
        project_id=UUID(principal.project_id)
        if principal.project_id
        else uuid4(),
        actor_id=UUID(principal.user_id) if principal.user_id else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        payload=payload or {},
        occurred_at=datetime.now(UTC),
    )
    db.add(event)


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------


@router.get("/policies", response_model=list[PolicyRead])
@audit(action="governance.policies.list", target_type="policy")
async def list_policies(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_READ)),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[PolicyRead]:
    """List compliance policies (projected from the rule table)."""
    stmt = select(Policy).where(Policy.tenant_id == UUID(principal.tenant_id))
    rows = (await db.execute(stmt)).scalars().all()
    out: list[PolicyRead] = []
    for r in rows:
        category = _derive_policy_category(r.name, r.description)
        out.append(
            PolicyRead(
                id=str(r.id),
                title=r.name,
                summary=r.description or "",
                status=PolicyStatus.ACTIVE if r.enabled else PolicyStatus.ARCHIVED,
                severity=_severity_to_schema(r.severity),
                category=category,
                version="1.0.0",
                updatedAt=r.updated_at,
                updatedBy={"id": "system", "displayName": "Forge"},
            )
        )
    return out


@router.post("/policies/{policy_id}/accept", response_model=PolicyRead)
@audit(action="governance.policy.accept", target_type="policy")
async def accept_policy(
    policy_id: UUID,
    body: PolicyAcceptRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_MANAGE)),
    db: DbSession = None,  # type: ignore[assignment]
) -> PolicyRead:
    policy = await db.get(Policy, policy_id)
    if policy is None or policy.tenant_id != UUID(principal.tenant_id):
        raise HTTPException(status_code=404, detail="policy_not_found")
    policy.enabled = True
    await db.commit()
    await db.refresh(policy)
    _audit_event(
        db=db,
        principal=principal,
        action="governance.policy.accept",
        target_type="policy",
        target_id=str(policy.id),
        payload={"actor_id": body.actor_id},
    )
    await db.commit()
    return PolicyRead(
        id=str(policy.id),
        title=policy.name,
        summary=policy.description or "",
        status=PolicyStatus.ACTIVE,
        severity=_severity_to_schema(policy.severity),
        category=_derive_policy_category(policy.name, policy.description),
        version="1.0.0",
        updatedAt=policy.updated_at,
        updatedBy={"id": body.actor_id or principal.user_id, "displayName": body.actor_id or principal.user_id},
    )


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------


@router.get("/approvals", response_model=list[ApprovalRead])
@audit(action="governance.approvals.list", target_type="approval")
async def list_approvals(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_READ)),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[ApprovalRead]:
    stmt = select(ApprovalRequest).where(
        ApprovalRequest.tenant_id == UUID(principal.tenant_id)
    )
    rows = (await db.execute(stmt)).scalars().all()
    out: list[ApprovalRead] = []
    for r in rows:
        out.append(
            ApprovalRead(
                id=str(r.id),
                kind=ApprovalKind.REQUEST_CONFIRMATION,
                title=r.type,
                prompt=(r.payload or {}).get("prompt", ""),
                state=_state_to_schema(r.status),
                createdAt=r.created_at,
                idempotencyKey=(r.payload or {}).get("idempotency_key", str(r.id)),
                decider=_actor_blob(str(r.decided_by)) if r.decided_by else None,
                decidedAt=r.decided_at,
                reason=r.reason,
            )
        )
    return out


async def _decide_approval(
    *,
    approval_id: UUID,
    body: ApprovalDecisionRequest,
    principal: AuthenticatedPrincipal,
    db: Any,
    decision: ApprovalStatus,
    state: ApprovalState,
    action: str,
) -> ApprovalRead:
    approval = await db.get(ApprovalRequest, approval_id)
    if approval is None or approval.tenant_id != UUID(principal.tenant_id):
        raise HTTPException(status_code=404, detail="approval_not_found")
    if approval.status != ApprovalStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="approval_already_decided",
        )
    approval.status = decision
    approval.decided_by = UUID(principal.user_id)
    approval.decided_at = datetime.now(UTC)
    approval.reason = body.reason
    _audit_event(
        db=db,
        principal=principal,
        action=action,
        target_type="approval",
        target_id=str(approval.id),
        payload={"reason": body.reason, "actor_id": body.actor_id},
    )
    await db.commit()
    await db.refresh(approval)
    return ApprovalRead(
        id=str(approval.id),
        kind=ApprovalKind.REQUEST_CONFIRMATION,
        title=approval.type,
        prompt=(approval.payload or {}).get("prompt", ""),
        state=state,
        createdAt=approval.created_at,
        idempotencyKey=(approval.payload or {}).get("idempotency_key", str(approval.id)),
        decider=_actor_blob(str(approval.decided_by)),
        decidedAt=approval.decided_at,
        reason=approval.reason,
    )


@router.post("/approvals/{approval_id}/accept", response_model=ApprovalRead)
@audit(action="governance.approval.accept", target_type="approval")
async def accept_approval(
    approval_id: UUID,
    body: ApprovalDecisionRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_MANAGE)),
    db: DbSession = None,  # type: ignore[assignment]
) -> ApprovalRead:
    return await _decide_approval(
        approval_id=approval_id,
        body=body,
        principal=principal,
        db=db,
        decision=ApprovalStatus.GRANTED,
        state=ApprovalState.ACCEPTED,
        action="governance.approval.accept",
    )


@router.post("/approvals/{approval_id}/decline", response_model=ApprovalRead)
@audit(action="governance.approval.decline", target_type="approval")
async def decline_approval(
    approval_id: UUID,
    body: ApprovalDecisionRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_MANAGE)),
    db: DbSession = None,  # type: ignore[assignment]
) -> ApprovalRead:
    return await _decide_approval(
        approval_id=approval_id,
        body=body,
        principal=principal,
        db=db,
        decision=ApprovalStatus.DENIED,
        state=ApprovalState.DECLINED,
        action="governance.approval.decline",
    )


# ---------------------------------------------------------------------------
# RBAC roles
# ---------------------------------------------------------------------------


@router.get("/rbac-roles", response_model=list[RbacRoleRead])
@audit(action="governance.rbac.list", target_type="role")
async def list_rbac_roles(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_READ)),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[RbacRoleRead]:
    """List RBAC roles for the caller's tenant.

    `permissions` strings (`<resource>:<action>`) are split into the
    stub's nested shape. `memberCount` is left at 0 — ponytail: we
    don't yet have a project_members.role_id join path; once that
    ships, populate it.
    """
    stmt = select(Role).where(Role.tenant_id == UUID(principal.tenant_id))
    rows = (await db.execute(stmt)).scalars().all()
    out: list[RbacRoleRead] = []
    for r in rows:
        permissions = [_split_permission(p) for p in (r.permissions or [])]
        system = bool(r.permissions) and "*" in (r.permissions or [])
        out.append(
            RbacRoleRead(
                id=str(r.id),
                name=r.name,
                description=r.description,
                permissions=permissions,
                memberCount=0,
                system=system,
                updatedAt=r.updated_at,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Board confirmations
# ---------------------------------------------------------------------------


@router.get("/board-confirmations", response_model=list[BoardConfirmationRead])
@audit(action="governance.board.list", target_type="board_confirmation")
async def list_board_confirmations(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_READ)),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[BoardConfirmationRead]:
    stmt = select(BoardConfirmation).where(
        BoardConfirmation.tenant_id == UUID(principal.tenant_id)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        BoardConfirmationRead(
            id=r.id,
            subject={"id": r.subject_id, "identifier": r.subject_id},
            planRev=r.plan_rev,
            outcome=SchemaOutcome(r.outcome.value),
            decider=_actor_blob(str(r.decider_id)) if r.decider_id else None,
            decidedAt=r.decided_at,
            idempotencyKey=r.idempotency_key,
            prompt=r.prompt or "",
        )
        for r in rows
    ]


@router.post("/board-confirmations", response_model=BoardConfirmationRead)
@audit(action="governance.board.ack", target_type="board_confirmation")
async def ack_board_confirmation(
    body: BoardConfirmationAck,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission(GOVERNANCE_PERMISSION_MANAGE)),
    db: DbSession = None,  # type: ignore[assignment]
) -> BoardConfirmationRead:
    project_id = UUID(principal.project_id) if principal.project_id else uuid4()
    idempotency_key = body.idempotency_key or f"conf:{body.subject_id}:plan:{body.plan_rev}"

    existing = (
        await db.execute(
            select(BoardConfirmation).where(
                BoardConfirmation.tenant_id == UUID(principal.tenant_id),
                BoardConfirmation.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return BoardConfirmationRead(
            id=existing.id,
            subject={"id": existing.subject_id, "identifier": existing.subject_id},
            planRev=existing.plan_rev,
            outcome=SchemaOutcome(existing.outcome.value),
            decider=_actor_blob(str(existing.decider_id)) if existing.decider_id else None,
            decidedAt=existing.decided_at,
            idempotencyKey=existing.idempotency_key,
            prompt=existing.prompt or "",
        )

    row = BoardConfirmation(
        tenant_id=UUID(principal.tenant_id),
        project_id=project_id,
        subject_id=body.subject_id,
        plan_rev=body.plan_rev,
        outcome=BoardConfirmationOutcome(body.outcome.value),
        decider_id=UUID(principal.user_id) if principal.user_id else None,
        decided_at=datetime.now(UTC),
        idempotency_key=idempotency_key,
        prompt=body.prompt,
    )
    db.add(row)
    _audit_event(
        db=db,
        principal=principal,
        action="governance.board.ack",
        target_type="board_confirmation",
        target_id=body.subject_id,
        payload={
            "plan_rev": body.plan_rev,
            "outcome": body.outcome.value,
            "idempotency_key": idempotency_key,
        },
    )
    await db.commit()
    await db.refresh(row)
    return BoardConfirmationRead(
        id=row.id,
        subject={"id": row.subject_id, "identifier": row.subject_id},
        planRev=row.plan_rev,
        outcome=SchemaOutcome(row.outcome.value),
        decider=_actor_blob(str(row.decider_id)) if row.decider_id else None,
        decidedAt=row.decided_at,
        idempotencyKey=row.idempotency_key,
        prompt=row.prompt or "",
    )


__all__ = ["router"]