"""F-800 — Per-conversation synthetic WorkflowBudget admission control.

Co-pilot conversations are ad-hoc; they don't have a parent ``Workflow``.
This module creates a synthetic ``WorkflowBudget`` row per conversation so
the existing ``WorkflowBudgetService.check_budget()`` admission gate works
unchanged for Co-pilot turns.

Why a synthetic row?
- ``WorkflowBudgetService.check_budget(workflow_id, projected_cost_usd)``
  is the single admission gate used by every LLM-routed path. Co-pilot
  must use the same gate so budget alerts, RBAC denial audits, and
  ``BudgetExceeded`` → 429 mapping are consistent.
- We mint a deterministic ``workflow_id`` from the conversation_id (UUIDv5
  in the Co-pilot namespace) so the row is idempotent on retry.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.copilot import CopilotConversation
from app.db.models.workflow_budget import (
    WorkflowBudget,
    WorkflowBudgetStatus,
)

logger = get_logger(__name__)

# UUIDv5 namespace for Co-pilot synthetic workflow_ids. Stable across
# processes so the same conversation_id always maps to the same
# workflow_id (important for idempotency).
COPILOT_WORKFLOW_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-5789-abcd-1234567890ab")

# Zero-UUID sentinel used when a Co-pilot conversation is tenant-wide
# (no project selected). The ``WorkflowBudget`` model requires a
# NOT NULL ``project_id``; the audit_service pattern uses the same
# sentinel for the same reason.
ZERO_PROJECT_SENTINEL = uuid.UUID("00000000-0000-0000-0000-000000000000")


def copilot_synthetic_workflow_id(conversation_id: uuid.UUID) -> uuid.UUID:
    """Derive a deterministic workflow_id for a Co-pilot conversation.

    Stable across processes — the same conversation_id always produces
    the same workflow_id. Lets ``ensure_conversation_budget`` be
    idempotent and lets the cost ledger group Co-pilot spend by
    conversation without an extra lookup.
    """
    return uuid.uuid5(COPILOT_WORKFLOW_NAMESPACE, str(conversation_id))


async def ensure_conversation_budget(
    session: AsyncSession,
    conversation: CopilotConversation,
    *,
    ceiling_usd: Decimal | None = None,
) -> WorkflowBudget:
    """Idempotently create a synthetic ``WorkflowBudget`` for a Co-pilot conversation.

    Called from ``copilot_service.get_or_create_conversation`` on first
    turn. Safe to call repeatedly — checks for existing row before
    creating. Returns the row regardless so callers can pass it to
    ``WorkflowBudgetService.check_budget`` without an extra fetch.

    Args:
        session: DB session (caller's).
        conversation: The ``CopilotConversation`` to budget for.
        ceiling_usd: Optional override. Defaults to
            ``settings.copilot_default_budget_usd``.

    Returns:
        The existing or newly-created ``WorkflowBudget`` row.
    """
    if ceiling_usd is None:
        ceiling_usd = Decimal(str(settings.copilot_default_budget_usd))

    workflow_id = copilot_synthetic_workflow_id(conversation.id)

    existing = await session.execute(
        select(WorkflowBudget).where(WorkflowBudget.workflow_id == workflow_id)
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        return row

    # Synthetic workflow — ``declared_by`` is the conversation owner
    # (no separate "actor" notion for synthetic budgets). The ``reason``
    # tag goes into ``metadata_`` so the cost ledger can self-describe
    # the spend without joining to copilot_conversations.
    reason = f"copilot_conversation:{conversation.id}"
    # Co-pilot conversations are nullable on ``project_id`` (some
    # threads are tenant-wide), but ``workflow_budgets.project_id`` is
    # NOT NULL — substitute the zero-UUID sentinel so the row inserts.
    budget_project_id = conversation.project_id or ZERO_PROJECT_SENTINEL
    row = WorkflowBudget(
        workflow_id=workflow_id,
        tenant_id=conversation.tenant_id,
        project_id=budget_project_id,
        ceiling_usd=ceiling_usd,
        spent_usd=Decimal("0"),
        status=WorkflowBudgetStatus.ACTIVE,
        declared_by=conversation.user_id,
        declared_at=datetime.now(UTC),
        metadata_={
            "source": "copilot",
            "reason": reason,
            "conversation_id": str(conversation.id),
        },
    )
    session.add(row)
    await session.flush()
    logger.info(
        "copilot.budget.created",
        conversation_id=str(conversation.id),
        workflow_id=str(workflow_id),
        ceiling_usd=str(ceiling_usd),
    )
    return row
