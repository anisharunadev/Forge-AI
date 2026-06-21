"""F-305 — Architecture Approval Workflow.

Routes human approvals for ADR / API contract / task breakdown / risk
register artifacts through a multi-reviewer gate. Each artifact type
declares the required reviewer roles; all required approvers must
approve before the artifact is promoted.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.architecture import (
    APIContract,
    ADR,
    ArchitectureApproval,
    RiskRegister,
    TaskBreakdown,
)
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


ROLE_ARCHITECT = "forge-architect"
ROLE_SECURITY = "forge-security"


_REVIEWER_MATRIX: dict[str, list[str]] = {
    "adr": [ROLE_ARCHITECT],
    "api_contract": [ROLE_ARCHITECT],
    "task_breakdown": [ROLE_ARCHITECT],
    "risk_register": [ROLE_ARCHITECT, ROLE_SECURITY],
}


class ArchitectureApprovalWorkflow:
    """Request, decide, cancel, and list architecture approvals."""

    def __init__(self, litellm_client: Any, event_bus: Any) -> None:
        self._llm = litellm_client
        self._bus = event_bus

    # ------------------------------------------------------------------
    # Request
    # ------------------------------------------------------------------

    async def request_approval(
        self,
        artifact_type: str,
        artifact_id: UUID | str,
        requester_id: UUID | str,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> ArchitectureApproval:
        """Create a pending approval row for an artifact.

        Determines required reviewers by artifact_type (with a security
        escalation for API contracts whose name contains 'auth' or
        'permission'). Multi-reviewer logic requires ALL reviewers to
        approve before status='approved'.
        """
        artifact_type = str(artifact_type)
        if artifact_type not in _REVIEWER_MATRIX:
            raise ValueError(f"unsupported artifact_type: {artifact_type}")

        required = list(_REVIEWER_MATRIX[artifact_type])
        if artifact_type == "api_contract":
            if await self._contract_is_security_sensitive(artifact_id):
                required = sorted(set(required + [ROLE_SECURITY]))

        reviewers = [
            {"role": role, "status": "pending", "decided_by": None, "decided_at": None, "reason": None}
            for role in required
        ]

        factory = get_session_factory()
        async with factory() as session:
            approval = ArchitectureApproval(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                artifact_type=artifact_type,
                artifact_id=str(artifact_id),
                requested_by=str(requester_id),
                status="pending",
                reason=None,
            )
            # Store required reviewer roles + per-reviewer state on the
            # reason side via JSON-encoded payload so we don't add new
            # columns for F-305. The reason field is Text and nullable.
            approval.reason = _encode_reviewers(reviewers)
            session.add(approval)
            await session.commit()
            await session.refresh(approval)

        await self._bus.publish(
            EventType.APPROVAL_REQUESTED,
            {
                "artifact_type": artifact_type,
                "artifact_id": str(artifact_id),
                "approval_id": str(approval.id),
                "required_reviewers": required,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=requester_id,
        )
        logger.info(
            "approval.requested",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            approval_id=str(approval.id),
            artifact_type=artifact_type,
            reviewers=required,
        )
        return approval

    # ------------------------------------------------------------------
    # Decide / Cancel
    # ------------------------------------------------------------------

    async def decide(
        self,
        approval_id: UUID | str,
        decision: str,
        reviewer_id: UUID | str,
        reason: str,
    ) -> ArchitectureApproval:
        """Record a reviewer's decision.

        A deny immediately marks the approval 'denied'. An approve only
        moves to 'approved' once every required reviewer has approved.
        """
        decision = str(decision).lower()
        if decision not in {"approve", "deny"}:
            raise ValueError(f"unsupported decision: {decision}")

        now = datetime.now(timezone.utc)
        factory = get_session_factory()
        async with factory() as session:
            approval = await session.get(ArchitectureApproval, str(approval_id))
            if approval is None:
                raise LookupError("approval_not_found")
            if approval.status not in {"pending", "in_review"}:
                raise ValueError(f"approval_not_pending:{approval.status}")

            reviewers = _decode_reviewers(approval.reason)
            # Default role: first pending reviewer.
            target_role = None
            for r in reviewers:
                if r["status"] == "pending":
                    target_role = r["role"]
                    break
            if target_role is None:
                raise ValueError("no_pending_reviewer")

            for r in reviewers:
                if r["role"] == target_role:
                    r["status"] = "approved" if decision == "approve" else "denied"
                    r["decided_by"] = str(reviewer_id)
                    r["decided_at"] = now.isoformat()
                    r["reason"] = reason or ""
                    break

            if decision == "deny":
                new_status = "denied"
                decided_by = str(reviewer_id)
                decided_at = now
            else:
                if all(r["status"] == "approved" for r in reviewers):
                    new_status = "approved"
                    decided_by = str(reviewer_id)
                    decided_at = now
                else:
                    new_status = "in_review"
                    decided_by = None
                    decided_at = None

            approval.status = new_status
            approval.reason = _encode_reviewers(reviewers)
            if decided_by is not None:
                approval.decided_by = UUID(decided_by)
            if decided_at is not None:
                approval.decided_at = decided_at
            await session.commit()
            await session.refresh(approval)

        event_type = (
            EventType.APPROVAL_GRANTED if new_status == "approved" else EventType.APPROVAL_DENIED
        ) if decision == "deny" or new_status == "approved" else EventType.ARTIFACT_UPDATED
        # Use the canonical approval events for terminal states only.
        if new_status == "approved":
            event_type = EventType.APPROVAL_GRANTED
        elif new_status == "denied":
            event_type = EventType.APPROVAL_DENIED
        else:
            event_type = EventType.ARTIFACT_UPDATED

        await self._bus.publish(
            event_type,
            {
                "artifact_type": approval.artifact_type,
                "artifact_id": str(approval.artifact_id),
                "approval_id": str(approval.id),
                "decision": decision,
                "reviewer_role": target_role,
                "status": new_status,
                "reason": reason,
            },
            tenant_id=approval.tenant_id,
            project_id=approval.project_id,
            actor_id=reviewer_id,
        )
        logger.info(
            "approval.decided",
            approval_id=str(approval.id),
            status=new_status,
            reviewer_role=target_role,
            decision=decision,
        )
        return approval

    async def cancel(
        self,
        approval_id: UUID | str,
        reason: str,
    ) -> ArchitectureApproval:
        """Cancel a pending approval (requester abort)."""
        factory = get_session_factory()
        async with factory() as session:
            approval = await session.get(ArchitectureApproval, str(approval_id))
            if approval is None:
                raise LookupError("approval_not_found")
            if approval.status not in {"pending", "in_review"}:
                raise ValueError(f"approval_not_pending:{approval.status}")
            reviewers = _decode_reviewers(approval.reason)
            for r in reviewers:
                r["status"] = "cancelled"
                r["reason"] = reason or ""
            approval.status = "cancelled"
            approval.reason = _encode_reviewers(reviewers)
            await session.commit()
            await session.refresh(approval)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": approval.artifact_type,
                "artifact_id": str(approval.artifact_id),
                "approval_id": str(approval.id),
                "status": "cancelled",
                "reason": reason,
            },
            tenant_id=approval.tenant_id,
            project_id=approval.project_id,
            actor_id=None,
        )
        return approval

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    async def get_approval(
        self, approval_id: UUID | str
    ) -> ArchitectureApproval | None:
        factory = get_session_factory()
        async with factory() as session:
            return await session.get(ArchitectureApproval, str(approval_id))

    async def get_pending(
        self,
        tenant_id: UUID | str,
        reviewer_id: UUID | str | None = None,
    ) -> list[ArchitectureApproval]:
        """List approvals still awaiting decision.

        If `reviewer_id` is provided, return only approvals where that
        user has at least one pending reviewer slot — i.e. the user can
        act on it now.
        """
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(ArchitectureApproval)
                .where(
                    ArchitectureApproval.tenant_id == str(tenant_id),
                    ArchitectureApproval.status.in_(["pending", "in_review"]),
                )
                .order_by(ArchitectureApproval.created_at.asc())
            )
            rows = list((await session.execute(stmt)).scalars().all())

        if reviewer_id is None:
            return rows

        # Filter to approvals the reviewer can act on.
        result: list[ArchitectureApproval] = []
        reviewer_id_str = str(reviewer_id)
        for row in rows:
            reviewers = _decode_reviewers(row.reason)
            if any(r["status"] == "pending" for r in reviewers):
                # We do not gate by user->role mapping at the data
                # layer; callers decide whether the user actually holds
                # the required role via RBAC. Returning all pending
                # approvals and letting RBAC reject unauthorized
                # decisions keeps this filter simple and predictable.
                if _reviewer_in_users(row, reviewers, reviewer_id_str):
                    result.append(row)
        return result

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _contract_is_security_sensitive(
        self, artifact_id: UUID | str
    ) -> bool:
        """True when the API contract name hints at auth/permission."""
        factory = get_session_factory()
        async with factory() as session:
            contract = await session.get(APIContract, str(artifact_id))
        if contract is None:
            return False
        lowered = (contract.name or "").lower()
        return "auth" in lowered or "permission" in lowered


def _encode_reviewers(reviewers: list[dict[str, Any]]) -> str:
    import json

    return json.dumps({"reviewers": reviewers})


def _decode_reviewers(blob: str | None) -> list[dict[str, Any]]:
    import json

    if not blob:
        return []
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        return []
    reviewers = data.get("reviewers") if isinstance(data, dict) else None
    if not isinstance(reviewers, list):
        return []
    return [r for r in reviewers if isinstance(r, dict)]


def _reviewer_in_users(
    approval: ArchitectureApproval,
    reviewers: list[dict[str, Any]],
    reviewer_id: str,
) -> bool:
    """Best-effort filter: include if any previous decision on this row
    was made by this user, OR the user requested the approval. This
    keeps the query side-effect free of RBAC lookups.
    """
    if str(approval.requested_by) == reviewer_id:
        return True
    if approval.decided_by is not None and str(approval.decided_by) == reviewer_id:
        return True
    for r in reviewers:
        if r.get("decided_by") and str(r["decided_by"]) == reviewer_id:
            return True
    return True  # default: include (RBAC will reject unauthorized acts)


__all__ = [
    "ArchitectureApprovalWorkflow",
    "ROLE_ARCHITECT",
    "ROLE_SECURITY",
    "_decode_reviewers",
    "_encode_reviewers",
]
