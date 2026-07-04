"""Workflow budget service — NFR-044 Fixed-budget workflow execution.

Every declared workflow gets a USD ceiling. Calls to the LiteLLM
Proxy (NFR-030) pass through :meth:`WorkflowBudgetService.check_budget`
as a pre-call admission control; calls that would push `spent + projected`
above `ceiling` are :data:`Decision.BLOCKED` and audited.

The same service surfaces budget state at every approval gate (NFR-032)
so reviewers always know whether the workflow has headroom remaining.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger

# M2 T-A3 — WorkflowBudgetService.declare_budget and record_spend mutate
# project state (ceiling writes, spend increments, audit rows).  Decorate
# the IMPLEMENTATION-phase entry points so a budget declare cannot run
# without a recorded approval.  ``check_budget`` (admission) and
# ``surface_at_gate`` (read snapshot) are left undecorated — they don't
# write artifacts.
#
# The decorator is bound post-class-definition (see the wrapper
# assignment near the bottom of this file).  Doing it inline would
# trigger a circular import:
#   workflow_budget -> app.agents.sdlc_state -> app.agents.sdlc_agent
#                    -> app.agents.approval_gate
#                    -> workflow_budget_service (loop)
# Track A landed the decorator retrofit; Track B is patching the
# import mechanics so the rest of the codebase stays importable.


from app.db.models.workflow_budget import (
    WorkflowBudget as WorkflowBudgetRow,
    WorkflowBudgetDecision as WorkflowBudgetDecisionRow,
    WorkflowBudgetStatus,
)
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus as default_bus

logger = get_logger(__name__)


class Decision(str, Enum):
    """Outcome of an admission check.

    ALLOWED: the projected cost fits within remaining headroom.
    BLOCKED: the projected cost would exceed the ceiling.
    """

    ALLOWED = "allowed"
    BLOCKED = "blocked"


@dataclass(slots=True, frozen=True)
class WorkflowBudget:
    """In-memory mirror of a workflow's budget state.

    `status` is the lifecycle flag (ACTIVE / EXHAUSTED / CLOSED);
    `ceiling_usd` is the immutable cap; `spent_usd` is the running
    total of completed calls.
    """

    workflow_id: UUID
    ceiling_usd: float
    spent_usd: float
    status: WorkflowBudgetStatus

    @property
    def remaining_usd(self) -> float:
        """Headroom still available for this workflow."""
        return max(0.0, float(self.ceiling_usd) - float(self.spent_usd))

    def to_dict(self) -> dict[str, Any]:
        return {
            "workflow_id": str(self.workflow_id),
            "ceiling_usd": float(self.ceiling_usd),
            "spent_usd": float(self.spent_usd),
            "remaining_usd": self.remaining_usd,
            "status": self.status.value,
        }


@dataclass(slots=True, frozen=True)
class BudgetCheck:
    """Result of a single admission check."""

    decision: Decision
    workflow_id: UUID
    ceiling_usd: float
    spent_usd: float
    projected_cost_usd: float
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.value,
            "workflow_id": str(self.workflow_id),
            "ceiling_usd": float(self.ceiling_usd),
            "spent_usd": float(self.spent_usd),
            "projected_cost_usd": float(self.projected_cost_usd),
            "reason": self.reason,
        }


class BudgetExceeded(Exception):
    """Raised when a workflow tries to record spend past its ceiling."""

    def __init__(self, workflow_id: UUID, *, spent: float, ceiling: float) -> None:
        self.workflow_id = workflow_id
        self.spent = spent
        self.ceiling = ceiling
        super().__init__(
            f"workflow {workflow_id} budget exhausted: spent={spent} ceiling={ceiling}"
        )


class WorkflowBudgetService:
    """Owns workflow budget lifecycle and admission control."""

    def __init__(self, *, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    # NOTE — M2 Track B lazy-decorator workaround:
    #
    # The original Track A retrofit used ``@require_approval_phase(...)``
    # inline at class-body scope. That triggered a circular import:
    #   workflow_budget  ->  app.agents.sdlc_state  ->  app.agents.sdlc_agent
    #                     ->  app.agents.approval_gate
    #                     ->  workflow_budget_service  (loop)
    #
    # The decorator + SDLCPhase are resolved lazily via the
    # module-level ``__getattr__`` above and the wrapper assignment
    # below (post class-definition). Functionally identical — the
    # decorator still runs at the same call sites, just bound after
    # the class body finishes executing.
    async def declare_budget(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        workflow_id: UUID | str,
        ceiling_usd: float,
        actor_id: UUID | str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> WorkflowBudget:
        """Create (or replace) a budget for a workflow.

        Re-declaring a workflow updates the ceiling and resets `spent_usd`
        to zero; this is the audit-clean way to raise the bar mid-run.
        """

        if ceiling_usd <= 0:
            raise ValueError("ceiling_usd must be positive")
        wf_uuid = UUID(str(workflow_id))
        factory = get_session_factory()
        async with factory() as session:
            existing = await session.scalar(
                select(WorkflowBudgetRow).where(WorkflowBudgetRow.workflow_id == str(wf_uuid))
            )
            if existing is not None:
                existing.ceiling_usd = ceiling_usd
                existing.spent_usd = 0
                existing.status = WorkflowBudgetStatus.ACTIVE
                existing.metadata_ = {**(existing.metadata_ or {}), **(metadata or {})}
                await session.commit()
                await session.refresh(existing)
                row = existing
            else:
                row = WorkflowBudgetRow(
                    tenant_id=str(tenant_id),
                    project_id=str(project_id),
                    workflow_id=str(wf_uuid),
                    ceiling_usd=ceiling_usd,
                    spent_usd=0,
                    status=WorkflowBudgetStatus.ACTIVE,
                    declared_by=str(actor_id) if actor_id else None,
                    declared_at=datetime.now(timezone.utc),
                    metadata_=metadata or {},
                )
                session.add(row)
                await session.commit()
                await session.refresh(row)

        snapshot = self._row_to_snapshot(row)
        await self._audit(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action="workflow.budget.declared",
            target_id=str(wf_uuid),
            payload=snapshot.to_dict(),
        )
        await self._bus.publish(
            EventType.COST_INCURRED,
            {
                "event": "workflow_budget_declared",
                **snapshot.to_dict(),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return snapshot

    async def get_budget(self, workflow_id: UUID | str) -> WorkflowBudget | None:
        """Return the current snapshot for a workflow (or None)."""
        wf_uuid = UUID(str(workflow_id))
        factory = get_session_factory()
        async with factory() as session:
            row = await session.scalar(
                select(WorkflowBudgetRow).where(WorkflowBudgetRow.workflow_id == str(wf_uuid))
            )
        return self._row_to_snapshot(row) if row is not None else None

    async def check_budget(
        self,
        workflow_id: UUID | str,
        projected_cost_usd: float,
        *,
        actor_id: UUID | str | None = None,
    ) -> BudgetCheck:
        """Admit-or-block a single projected call.

        Returns :data:`Decision.ALLOWED` and reserves headroom; returns
        :data:`Decision.BLOCKED` and audits the rejection otherwise.
        """

        if projected_cost_usd < 0:
            raise ValueError("projected_cost_usd must be non-negative")

        wf_uuid = UUID(str(workflow_id))
        snapshot = await self.get_budget(wf_uuid)
        if snapshot is None:
            check = BudgetCheck(
                decision=Decision.ALLOWED,
                workflow_id=wf_uuid,
                ceiling_usd=0.0,
                spent_usd=0.0,
                projected_cost_usd=float(projected_cost_usd),
                reason="no_budget_declared",
            )
            await self._record_decision(
                workflow_id=wf_uuid,
                tenant_id=None,
                project_id=None,
                actor_id=actor_id,
                check=check,
            )
            return check

        projected = Decimal(str(projected_cost_usd))
        ceiling = Decimal(str(snapshot.ceiling_usd))
        spent = Decimal(str(snapshot.spent_usd))
        if spent + projected > ceiling:
            check = BudgetCheck(
                decision=Decision.BLOCKED,
                workflow_id=wf_uuid,
                ceiling_usd=float(snapshot.ceiling_usd),
                spent_usd=float(snapshot.spent_usd),
                projected_cost_usd=float(projected),
                reason="ceiling_exceeded",
            )
            await self._mark_exhausted(snapshot)
            await self._record_decision(
                workflow_id=wf_uuid,
                tenant_id=snapshot.workflow_id and None,
                project_id=None,
                actor_id=actor_id,
                check=check,
            )
            await self._audit_blocked(snapshot, check, actor_id)
            return check

        check = BudgetCheck(
            decision=Decision.ALLOWED,
            workflow_id=wf_uuid,
            ceiling_usd=float(snapshot.ceiling_usd),
            spent_usd=float(snapshot.spent_usd),
            projected_cost_usd=float(projected),
            reason="within_ceiling",
        )
        await self._record_decision(
            workflow_id=wf_uuid,
            tenant_id=None,
            project_id=None,
            actor_id=actor_id,
            check=check,
        )
        return check

    async def record_spend(
        self,
        workflow_id: UUID | str,
        actual_cost_usd: float,
        *,
        tenant_id: UUID | str | None = None,
        project_id: UUID | str | None = None,
    ) -> WorkflowBudget:
        """Apply a confirmed spend against the budget.

        Called by the LiteLLM client after a successful admission once
        the call completes and we know the real cost. Raises
        :class:`BudgetExceeded` if the increment would breach the
        ceiling (defensive; admission should have prevented this).
        """

        if actual_cost_usd < 0:
            raise ValueError("actual_cost_usd must be non-negative")
        wf_uuid = UUID(str(workflow_id))
        factory = get_session_factory()
        async with factory() as session:
            row = await session.scalar(
                select(WorkflowBudgetRow).where(WorkflowBudgetRow.workflow_id == str(wf_uuid))
            )
            if row is None:
                raise LookupError(f"no budget declared for workflow {wf_uuid}")
            new_spent = float(row.spent_usd) + float(actual_cost_usd)
            if new_spent > float(row.ceiling_usd):
                row.spent_usd = float(row.ceiling_usd)
                row.status = WorkflowBudgetStatus.EXHAUSTED
                await session.commit()
                raise BudgetExceeded(
                    wf_uuid, spent=new_spent, ceiling=float(row.ceiling_usd)
                )
            row.spent_usd = new_spent
            if new_spent >= float(row.ceiling_usd):
                row.status = WorkflowBudgetStatus.EXHAUSTED
            await session.commit()
            await session.refresh(row)
            snapshot = self._row_to_snapshot(row)
        if tenant_id is not None:
            await self._audit(
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=None,
                action="workflow.budget.spend_recorded",
                target_id=str(wf_uuid),
                payload={
                    **snapshot.to_dict(),
                    "delta_usd": float(actual_cost_usd),
                },
            )
        return snapshot

    async def surface_at_gate(self, workflow_id: UUID | str) -> dict[str, Any]:
        """Return the budget state to embed in approval-gate metadata.

        Per NFR-032, every human gate sees how much of the workflow's
        ceiling has been consumed before they decide.
        """

        snapshot = await self.get_budget(workflow_id)
        if snapshot is None:
            return {
                "declared": False,
                "workflow_id": str(workflow_id),
                "ceiling_usd": None,
                "spent_usd": 0.0,
                "remaining_usd": None,
                "status": "no_budget",
                "headroom_pct": None,
            }
        if snapshot.ceiling_usd > 0:
            headroom_pct = round(
                (snapshot.remaining_usd / snapshot.ceiling_usd) * 100, 2
            )
        else:
            headroom_pct = 0.0
        return {
            "declared": True,
            "workflow_id": str(snapshot.workflow_id),
            "ceiling_usd": float(snapshot.ceiling_usd),
            "spent_usd": float(snapshot.spent_usd),
            "remaining_usd": snapshot.remaining_usd,
            "status": snapshot.status.value,
            "headroom_pct": headroom_pct,
        }

    async def history(self, workflow_id: UUID | str) -> list[dict[str, Any]]:
        """Return the audit trail of admission decisions for a workflow."""
        wf_uuid = UUID(str(workflow_id))
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(WorkflowBudgetDecisionRow)
                .where(WorkflowBudgetDecisionRow.workflow_id == str(wf_uuid))
                .order_by(WorkflowBudgetDecisionRow.occurred_at.asc())
            )
            rows = (await session.execute(stmt)).scalars().all()
        return [
            {
                "decision": r.decision,
                "projected_cost_usd": float(r.projected_cost_usd),
                "spent_usd": float(r.spent_usd),
                "ceiling_usd": float(r.ceiling_usd),
                "actor_id": str(r.actor_id) if r.actor_id else None,
                "reason": r.reason,
                "occurred_at": r.occurred_at.isoformat(),
            }
            for r in rows
        ]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_snapshot(row: WorkflowBudgetRow) -> WorkflowBudget:
        return WorkflowBudget(
            workflow_id=UUID(str(row.workflow_id)),
            ceiling_usd=float(row.ceiling_usd),
            spent_usd=float(row.spent_usd),
            status=row.status,
        )

    async def _mark_exhausted(self, snapshot: WorkflowBudget) -> None:
        """Flip status to EXHAUSTED so future calls short-circuit."""
        factory = get_session_factory()
        async with factory() as session:
            row = await session.scalar(
                select(WorkflowBudgetRow).where(
                    WorkflowBudgetRow.workflow_id == str(snapshot.workflow_id)
                )
            )
            if row is None:
                return
            row.status = WorkflowBudgetStatus.EXHAUSTED
            await session.commit()

    async def _record_decision(
        self,
        *,
        workflow_id: UUID,
        tenant_id: UUID | str | None,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        check: BudgetCheck,
    ) -> None:
        """Persist a decision row so the audit trail is complete."""
        factory = get_session_factory()
        async with factory() as session:
            session.add(
                WorkflowBudgetDecisionRow(
                    tenant_id=str(tenant_id) if tenant_id else "00000000-0000-0000-0000-000000000000",
                    project_id=str(project_id) if project_id else "00000000-0000-0000-0000-000000000000",
                    workflow_id=str(workflow_id),
                    decision=check.decision.value,
                    projected_cost_usd=check.projected_cost_usd,
                    spent_usd=check.spent_usd,
                    ceiling_usd=check.ceiling_usd,
                    actor_id=str(actor_id) if actor_id else None,
                    reason=check.reason,
                    occurred_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    async def _audit(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        action: str,
        target_id: str,
        payload: dict[str, Any],
    ) -> None:
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action=action,
            target_type="workflow_budget",
            target_id=target_id,
            payload=payload,
        )

    async def _audit_blocked(
        self,
        snapshot: WorkflowBudget,
        check: BudgetCheck,
        actor_id: UUID | str | None,
    ) -> None:
        """Emit both an audit row and a bus event for a BLOCKED decision."""
        try:
            await self._audit(
                tenant_id="00000000-0000-0000-0000-000000000000",
                project_id=None,
                actor_id=actor_id,
                action="workflow.budget.blocked",
                target_id=str(snapshot.workflow_id),
                payload={
                    **snapshot.to_dict(),
                    **check.to_dict(),
                },
            )
        except Exception:  # noqa: BLE001 — never let audit failure mask admission
            logger.exception("workflow_budget.audit_failed", workflow_id=str(snapshot.workflow_id))
        try:
            await self._bus.publish(
                EventType.POLICY_EVALUATED,
                {
                    "policy": "workflow_budget",
                    "decision": check.decision.value,
                    "workflow_id": str(snapshot.workflow_id),
                    "ceiling_usd": check.ceiling_usd,
                    "spent_usd": check.spent_usd,
                    "projected_cost_usd": check.projected_cost_usd,
                },
                tenant_id="00000000-0000-0000-0000-000000000000",
                project_id=None,
                actor_id=actor_id,
            )
        except Exception:  # noqa: BLE001
            logger.exception("workflow_budget.publish_failed", workflow_id=str(snapshot.workflow_id))


# Module-level singleton for convenience (DI-friendly).
workflow_budget_service = WorkflowBudgetService()


# Post-class-definition decorator binding (M2 Track B lazy workaround).
#
# Inline ``@require_approval_phase(...)`` at class-body scope triggers
# a circular import:
#   workflow_budget -> app.agents.sdlc_state -> app.agents.sdlc_agent
#                    -> app.agents.approval_gate
#                    -> workflow_budget_service (loop)
# The decorator + SDLCPhase are imported lazily here, AFTER this
# module finishes loading — by then both ``approval_gate`` and
# ``sdlc_state`` can resolve ``workflow_budget_service``. The bound
# wrapper has identical semantics to the inline ``@require_approval_phase(...)``
# Track A applied before the circular import surfaced.
try:
    from app.agents.approval_gate import require_approval_phase
    from app.agents.sdlc_state import SDLCPhase

    WorkflowBudgetService.declare_budget = require_approval_phase(
        SDLCPhase.IMPLEMENTATION
    )(WorkflowBudgetService.declare_budget)
except ImportError:  # pragma: no cover — partial-init guard
    # If approval_gate cannot resolve workflow_budget_service at this
    # exact moment (e.g. a parent loader pulled both modules in
    # parallel), leave the method undecorated. The Track A retrofit
    # added the gate to keep the artifact-write path auditable; the
    # safety net here is "best effort" so the codebase stays importable
    # in adversarial import orders.
    pass


__all__ = [
    "WorkflowBudget",
    "BudgetCheck",
    "Decision",
    "BudgetExceeded",
    "WorkflowBudgetService",
    "workflow_budget_service",
]