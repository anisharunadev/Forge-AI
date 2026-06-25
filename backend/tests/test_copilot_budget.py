"""F-800 Plan 0.4 — Synthetic per-conversation budget tests.

Covers:
1. ``copilot_synthetic_workflow_id`` is deterministic (same conversation_id
   in → same workflow_id out, across processes).
2. ``ensure_conversation_budget`` creates a row on first call.
3. ``ensure_conversation_budget`` is idempotent (second call returns the
   same row, no duplicate).
4. Default ceiling matches ``settings.copilot_default_budget_usd``.
5. Caller-provided ``ceiling_usd`` overrides the default.
6. WorkflowBudget row carries the conversation's tenant_id, project_id,
   declared_by (so the cost ledger groups correctly).
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.db.models.copilot import CopilotConversation
from app.db.models.workflow_budget import WorkflowBudget, WorkflowBudgetStatus
from app.services.copilot_budget import (
    COPILOT_WORKFLOW_NAMESPACE,
    copilot_synthetic_workflow_id,
    ensure_conversation_budget,
)


def test_synthetic_workflow_id_is_deterministic():
    """Same conversation_id produces the same workflow_id every time."""
    conversation_id = uuid.uuid4()
    a = copilot_synthetic_workflow_id(conversation_id)
    b = copilot_synthetic_workflow_id(conversation_id)
    assert a == b
    # Different conversation_id → different workflow_id.
    other = copilot_synthetic_workflow_id(uuid.uuid4())
    assert other != a
    # Namespace is well-formed.
    assert COPILOT_WORKFLOW_NAMESPACE.version == 5


@pytest.mark.asyncio
async def test_ensure_creates_budget_on_first_call(sqlite_db):
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async with sqlite_db() as session:
        conv = CopilotConversation(
            tenant_id=tenant_id, project_id=project_id, user_id=user_id,
        )
        session.add(conv)
        await session.flush()

        row = await ensure_conversation_budget(session, conv)
        assert row.workflow_id == copilot_synthetic_workflow_id(conv.id)
        assert row.tenant_id == tenant_id
        assert row.project_id == project_id
        # WorkflowBudget stores actor as ``declared_by``; map conversation.user_id there.
        assert row.declared_by == user_id
        assert row.status == WorkflowBudgetStatus.ACTIVE
        assert row.spent_usd == Decimal("0")
        # Default ceiling comes from settings.copilot_default_budget_usd.
        from app.core.config import settings
        assert row.ceiling_usd == Decimal(str(settings.copilot_default_budget_usd))
        # Reason is recorded in metadata_ for self-describing cost ledger entries.
        assert row.metadata_["source"] == "copilot"
        assert row.metadata_["conversation_id"] == str(conv.id)
        assert row.metadata_["reason"].startswith("copilot_conversation:")


@pytest.mark.asyncio
async def test_ensure_is_idempotent(sqlite_db):
    """Second call returns the same row, no duplicate."""
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async with sqlite_db() as session:
        conv = CopilotConversation(
            tenant_id=tenant_id, project_id=project_id, user_id=user_id,
        )
        session.add(conv)
        await session.flush()

        first = await ensure_conversation_budget(session, conv)
        await session.commit()

        # Second call on a fresh session fetch — must return the same row.
        second = await ensure_conversation_budget(session, conv)
        assert second.workflow_id == first.workflow_id
        # No duplicate created.
        from sqlalchemy import select, func
        count = (
            await session.execute(
                select(func.count()).select_from(WorkflowBudget).where(
                    WorkflowBudget.workflow_id == first.workflow_id
                )
            )
        ).scalar_one()
        assert count == 1


@pytest.mark.asyncio
async def test_ensure_respects_caller_ceiling_override(sqlite_db):
    """Explicit ceiling_usd overrides the settings default."""
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async with sqlite_db() as session:
        conv = CopilotConversation(
            tenant_id=tenant_id, project_id=project_id, user_id=user_id,
        )
        session.add(conv)
        await session.flush()

        row = await ensure_conversation_budget(session, conv, ceiling_usd=Decimal("2.50"))
        assert row.ceiling_usd == Decimal("2.50")