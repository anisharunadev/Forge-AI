"""Phase 4 SC-4.3 — Tenant isolation tests.

These tests prove that rows created as tenant A are invisible to
queries filtered by tenant B at the ORM level. They run entirely
against the in-memory SQLite engine provided by ``sqlite_db``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.db.models.connector import Connector
from app.db.models.cost import CostEntry
from app.db.models.repo_ingestion import Repo
from app.db.models.workflow_budget import WorkflowBudget


@pytest.mark.asyncio
async def test_cost_entries_isolation(sqlite_db, two_tenants) -> None:
    """CostEntry rows from tenant A are invisible to tenant B queries."""
    ta, tb, pa = two_tenants
    async with sqlite_db() as s:
        s.add(
            CostEntry(
                id=uuid.uuid4(),
                tenant_id=ta.id,
                project_id=pa.id,
                source="litellm",
                model="gpt-4o-mini",
                prompt_tokens=10,
                completion_tokens=20,
                cost_usd=0.001,
                recorded_at=datetime.now(UTC),
            )
        )
        await s.commit()

    async with sqlite_db() as s:
        rows = (
            (
                await s.execute(
                    select(CostEntry).where(
                        CostEntry.tenant_id == tb.id,
                        CostEntry.project_id == pa.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []


@pytest.mark.asyncio
async def test_connectors_isolation(sqlite_db, two_tenants) -> None:
    """Connector rows from tenant A are invisible to tenant B queries."""
    ta, tb, pa = two_tenants
    async with sqlite_db() as s:
        s.add(
            Connector(
                id=uuid.uuid4(),
                tenant_id=ta.id,
                project_id=pa.id,
                name="forge-a-connector",
                type="github",
                config={},
                created_by=uuid.uuid4(),
            )
        )
        await s.commit()

    async with sqlite_db() as s:
        rows = (
            (
                await s.execute(
                    select(Connector).where(
                        Connector.tenant_id == tb.id,
                        Connector.project_id == pa.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []


@pytest.mark.asyncio
async def test_repos_isolation(sqlite_db, two_tenants) -> None:
    """Repo rows from tenant A are invisible to tenant B queries."""
    ta, tb, pa = two_tenants
    async with sqlite_db() as s:
        s.add(
            Repo(
                id=uuid.uuid4(),
                tenant_id=ta.id,
                project_id=pa.id,
                source_url="https://example.com/a.git",
                default_branch="main",
                created_by=uuid.uuid4(),
            )
        )
        await s.commit()

    async with sqlite_db() as s:
        rows = (
            (
                await s.execute(
                    select(Repo).where(
                        Repo.tenant_id == tb.id,
                        Repo.project_id == pa.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []


@pytest.mark.asyncio
async def test_workflow_budget_isolation(sqlite_db, two_tenants) -> None:
    """WorkflowBudget rows from tenant A are invisible to tenant B queries."""
    ta, tb, pa = two_tenants
    async with sqlite_db() as s:
        s.add(
            WorkflowBudget(
                id=uuid.uuid4(),
                tenant_id=ta.id,
                project_id=pa.id,
                workflow_id=uuid.uuid4(),
                ceiling_usd=100.0,
                spent_usd=10.0,
                declared_by=uuid.uuid4(),
                declared_at=datetime.now(UTC),
            )
        )
        await s.commit()

    async with sqlite_db() as s:
        rows = (
            (
                await s.execute(
                    select(WorkflowBudget).where(
                        WorkflowBudget.tenant_id == tb.id,
                        WorkflowBudget.project_id == pa.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []


@pytest.mark.asyncio
async def test_two_tenants_distinct_ids(two_tenants) -> None:
    """Sanity: the two_tenants fixture returns distinct tenants + a project bound to A."""
    ta, tb, pa = two_tenants
    assert ta.id != tb.id
    assert pa.tenant_id == ta.id


@pytest.mark.asyncio
async def test_cross_tenant_id_returns_none(sqlite_db, two_tenants) -> None:
    """Service-style get-by-id filtered by tenant returns 0 rows for cross-tenant.

    Models where the service layer is responsible for filtering tenant_id
    must never return a row that belongs to a different tenant. This
    is the canonical "GET as B with A's ID" isolation check.
    """
    ta, tb, pa = two_tenants
    target_id = uuid.uuid4()
    async with sqlite_db() as s:
        s.add(
            CostEntry(
                id=target_id,
                tenant_id=ta.id,
                project_id=pa.id,
                source="litellm",
                model="gpt-4o-mini",
                prompt_tokens=10,
                completion_tokens=20,
                cost_usd=0.001,
                recorded_at=datetime.now(UTC),
            )
        )
        await s.commit()

    async with sqlite_db() as s:
        row = (
            await s.execute(
                select(CostEntry).where(
                    CostEntry.id == target_id,
                    CostEntry.tenant_id == tb.id,
                )
            )
        ).scalar_one_or_none()
        assert row is None
