"""F-006 — Approvals (Rule 3 — human gates)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.db.models.approval import ApprovalRequest, ApprovalStatus
from app.schemas.approvals import ApprovalCreate, ApprovalDecision, ApprovalRead
from app.services.event_bus import EventType, bus
from sqlalchemy import select

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("", response_model=list[ApprovalRead])
@audit(action="approvals.list", target_type="approval")
async def list_approvals(
    principal: Principal,
    _perm: Principal = require_permission("approvals:read"),
    db: DbSession = None,  # type: ignore[assignment]
) -> list[ApprovalRead]:
    stmt = select(ApprovalRequest).where(ApprovalRequest.tenant_id == principal.tenant_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [ApprovalRead.model_validate(r) for r in rows]


@router.post("", response_model=ApprovalRead, status_code=status.HTTP_201_CREATED)
@audit(action="approvals.request", target_type="approval")
async def request_approval(
    body: ApprovalCreate,
    principal: Principal,
    _perm: Principal = require_permission("approvals:request"),
    db: DbSession = None,  # type: ignore[assignment]
) -> ApprovalRead:
    approval = ApprovalRequest(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id or body.payload.get("project_id"),
        type=body.type,
        target_artifact_id=body.target_artifact_id,
        requested_by=principal.user_id,
        status=ApprovalStatus.PENDING,
        payload=body.payload,
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)
    await bus.publish(
        EventType.APPROVAL_REQUESTED,
        {"approval_id": str(approval.id), "type": approval.type},
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
    )
    return ApprovalRead.model_validate(approval)


@router.post("/{approval_id}/decide", response_model=ApprovalRead)
@audit(action="approvals.decide", target_type="approval")
async def decide_approval(
    approval_id: UUID,
    body: ApprovalDecision,
    principal: Principal,
    _perm: Principal = require_permission("approvals:decide"),
    db: DbSession = None,  # type: ignore[assignment]
) -> ApprovalRead:
    approval = await db.get(ApprovalRequest, approval_id)
    if approval is None or approval.tenant_id != principal.tenant_id:
        raise HTTPException(status_code=404, detail="approval_not_found")
    if approval.status != ApprovalStatus.PENDING:
        raise HTTPException(status_code=409, detail="approval_already_decided")

    approval.status = body.status
    approval.decided_by = principal.user_id
    approval.decided_at = datetime.now(timezone.utc)
    approval.reason = body.reason
    await db.commit()
    await db.refresh(approval)

    event = (
        EventType.APPROVAL_GRANTED
        if body.status == ApprovalStatus.GRANTED
        else EventType.APPROVAL_DENIED
    )
    await bus.publish(
        event,
        {"approval_id": str(approval.id), "reason": body.reason},
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
    )

    # F-018: when the approval was raised by the workflow executor,
    # resume the paused run. The executor is idempotent — a no-op if
    # the run is already terminal or not in WAITING_APPROVAL.
    payload = approval.payload or {}
    if payload.get("kind") == "workflow":
        run_id = payload.get("run_id")
        if run_id:
            try:
                from app.services.workflow_executor import get_executor

                await get_executor().resume(
                    db,
                    tenant_id=principal.tenant_id,
                    run_id=UUID(run_id),
                    approval_id=approval.id,
                    decision=body.status.value,
                )
            except Exception as exc:  # noqa: BLE001 — never break the approval write
                logger.warning(
                    "workflow_executor.resume_failed",
                    run_id=run_id,
                    approval_id=str(approval.id),
                    error=str(exc),
                )

    return ApprovalRead.model_validate(approval)


__all__ = ["router"]
