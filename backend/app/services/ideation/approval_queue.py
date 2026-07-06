"""Approval Queue service (F-212).

Human-in-the-loop queue for ideation workflows. Decisions are
approve / deny / request_changes / delegate. Each transition emits an
event so the rest of the system (delivery push, roadmaps, …) can react.

Queue rows live alongside the standard ApprovalRequest system; this
service exists because ideation has its own item types and we want to
keep the existing approvals API untouched.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import (
    ApprovalDecision,
    ApprovalItem,
    ApprovalItemStatus,
    ApprovalItemType,
    Idea,
)
from app.db.session import get_session_factory
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)


@dataclass
class QueueQuery:
    tenant_id: UUID | str
    user_id: UUID | str | None = None
    status: ApprovalItemStatus | None = None
    request_type: ApprovalItemType | None = None
    limit: int = 100


class ApprovalQueueService:
    """Tenant-scoped approval queue for ideation workflows."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def enqueue(
        self,
        idea_id: UUID | str,
        request_type: str | ApprovalItemType,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str,
        subject_id: UUID | str | None = None,
        payload: dict[str, Any] | None = None,
        reviewer_id: UUID | str | None = None,
    ) -> ApprovalItem:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id

        try:
            rtype = ApprovalItemType(request_type)
        except ValueError as exc:
            raise ValueError(f"unknown_approval_request_type:{request_type}") from exc

        factory = get_session_factory()
        async with factory() as session:
            row = ApprovalItem(
                tenant_id=str(tenant_id),
                project_id=str(effective_project_id),
                idea_id=idea.id,
                request_type=rtype,
                subject_id=str(subject_id) if subject_id else None,
                payload=dict(payload or {}),
                status=ApprovalItemStatus.PENDING,
                requested_by=str(actor_id),
                reviewer_id=str(reviewer_id) if reviewer_id else None,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)

        await self._bus.publish(
            EventType.APPROVAL_REQUESTED,
            {
                "domain": "ideation",
                "approval_id": str(row.id),
                "idea_id": str(idea.id),
                "request_type": rtype.value,
                "subject_id": row.subject_id,
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
        )
        return row

    async def get_queue(
        self,
        tenant_id: UUID | str,
        user_id: UUID | str | None = None,
        *,
        status: ApprovalItemStatus | str | None = None,
        request_type: ApprovalItemType | str | None = None,
        limit: int = 100,
    ) -> list[ApprovalItem]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(ApprovalItem).where(ApprovalItem.tenant_id == str(tenant_id))
            if user_id is not None:
                # Match reviewer_id exactly OR unassigned (anyone with
                # the right role can pick it up).
                stmt = stmt.where(
                    (ApprovalItem.reviewer_id == str(user_id))
                    | (ApprovalItem.reviewer_id.is_(None))
                )
            if status is not None:
                try:
                    stmt = stmt.where(ApprovalItem.status == ApprovalItemStatus(status))
                except ValueError:
                    pass
            if request_type is not None:
                try:
                    stmt = stmt.where(ApprovalItem.request_type == ApprovalItemType(request_type))
                except ValueError:
                    pass
            stmt = stmt.order_by(ApprovalItem.created_at.desc()).limit(max(1, min(limit, 500)))
            return list((await session.execute(stmt)).scalars().all())

    async def assign(
        self,
        approval_id: UUID | str,
        reviewer_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str,
    ) -> ApprovalItem:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(ApprovalItem, str(approval_id))
            if row is None:
                raise LookupError(f"approval {approval_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("approval_not_in_tenant")
            if row.status not in (ApprovalItemStatus.PENDING, ApprovalItemStatus.REQUEST_CHANGES):
                raise ValueError(f"cannot_assign_in_status:{row.status}")
            row.reviewer_id = str(reviewer_id)
            await session.commit()
            await session.refresh(row)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "approval_item",
                "approval_id": str(row.id),
                "assigned_to": str(reviewer_id),
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    async def decide(
        self,
        approval_id: UUID | str,
        decision: str | ApprovalDecision,
        reason: str | None,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str,
    ) -> ApprovalItem:
        try:
            decision_enum = ApprovalDecision(decision)
        except ValueError as exc:
            raise ValueError(f"unknown_decision:{decision}") from exc

        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(ApprovalItem, str(approval_id))
            if row is None:
                raise LookupError(f"approval {approval_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("approval_not_in_tenant")
            if row.status not in (ApprovalItemStatus.PENDING, ApprovalItemStatus.REQUEST_CHANGES):
                raise ValueError(f"cannot_decide_in_status:{row.status}")

            now = datetime.now(UTC)
            # Phase 8 SC-8.2 - reject decisions on expired items.
            # Postgres returns tz-aware datetimes; SQLite strips tz. Compare
            # both sides as UTC-aware so the test suite (sqlite) and prod
            # (postgres) agree.
            if row.expires_at is not None:
                expires = (
                    row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=UTC)
                )
                if now > expires:
                    raise ValueError(f"approval_expired:expires_at={row.expires_at}")
            row.decided_by = str(actor_id)
            row.decided_at = now
            row.reason = reason
            if decision_enum == ApprovalDecision.APPROVE:
                row.status = ApprovalItemStatus.APPROVED
            elif decision_enum == ApprovalDecision.DENY:
                row.status = ApprovalItemStatus.DENIED
            elif decision_enum == ApprovalDecision.REQUEST_CHANGES:
                row.status = ApprovalItemStatus.REQUEST_CHANGES
            await session.commit()
            await session.refresh(row)

        if decision_enum == ApprovalDecision.APPROVE:
            event_type = EventType.APPROVAL_GRANTED
        elif decision_enum == ApprovalDecision.DENY:
            event_type = EventType.APPROVAL_DENIED
        else:
            event_type = EventType.ARTIFACT_UPDATED

        await self._bus.publish(
            event_type,
            {
                "domain": "ideation",
                "approval_id": str(row.id),
                "decision": decision_enum.value,
                "reason": reason,
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    async def delegate(
        self,
        approval_id: UUID | str,
        new_reviewer_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str,
    ) -> ApprovalItem:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(ApprovalItem, str(approval_id))
            if row is None:
                raise LookupError(f"approval {approval_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("approval_not_in_tenant")
            row.reviewer_id = str(new_reviewer_id)
            row.status = ApprovalItemStatus.DELEGATED
            await session.commit()
            await session.refresh(row)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "approval_id": str(row.id),
                "delegated_to": str(new_reviewer_id),
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    # -- internals --------------------------------------------------------

    async def _load_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea


approval_queue_service = ApprovalQueueService()


__all__ = ["ApprovalQueueService", "QueueQuery", "approval_queue_service"]
