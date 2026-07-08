#!/usr/bin/env python3
"""Seed real workflows for the dev tenant.

Inserts 4 published + 2 draft workflows with realistic node/edge
graphs (trigger → command → approval → script chains), plus 3 runs in
different states (running, succeeded, failed). Run:

    docker compose exec backend python -m scripts.seed_workflows

Idempotent — re-running the seeder on an already-seeded tenant is a no-op.

This seeder also performs an in-place schema patch: it adds a
``status`` column to the ``workflows`` table when the column is missing.
That keeps the seeder usable on environments that predate the
``workflow.status`` addition (e.g. local DBs initialised against an
older revision). The column is then mirrored on the SQLAlchemy model
via ``server_default`` so ORM inserts work without a migration file.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_factory

_session_factory = get_session_factory()
from app.db.models.tenant import Tenant  # noqa: E402
from app.db.models.user import User  # noqa: E402
from app.db.models.workflow import Workflow, WorkflowRun  # noqa: E402

SEED_WORKFLOWS = [
    {
        "name": "PR Review Pipeline",
        "description": "Auto-review every PR for style, tests, security. Approve before merge.",
        "status": "published",
        "definition": {
            "nodes": [
                {
                    "id": "t1",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "trigger", "label": "PR opened"},
                },
                {
                    "id": "c1",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "type": "command",
                        "command_name": "forge.code-review",
                        "args": {"strictness": "high"},
                    },
                },
                {
                    "id": "c2",
                    "position": {"x": 400, "y": 0},
                    "data": {"type": "command", "command_name": "forge.test-runner"},
                },
                {
                    "id": "a1",
                    "position": {"x": 600, "y": 0},
                    "data": {
                        "type": "approval",
                        "label": "Tech lead review",
                        "approver_role": "tech_lead",
                        "timeout_hours": 24,
                    },
                },
                {
                    "id": "s1",
                    "position": {"x": 800, "y": 0},
                    "data": {
                        "type": "script",
                        "language": "python",
                        "source": "print('merge approved')",
                    },
                },
            ],
            "edges": [
                {"id": "e1", "source": "t1", "target": "c1"},
                {"id": "e2", "source": "c1", "target": "c2"},
                {"id": "e3", "source": "c2", "target": "a1"},
                {"id": "e4", "source": "a1", "target": "s1"},
            ],
            "settings": {"cost_ceiling_usd": 5.0, "timeout_seconds": 600},
        },
    },
    {
        "name": "Idea → Story → Jira Sync",
        "description": "Capture ideas, push to Jira as stories, notify Slack.",
        "status": "published",
        "definition": {
            "nodes": [
                {
                    "id": "t1",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "trigger", "label": "Idea submitted"},
                },
                {
                    "id": "c1",
                    "position": {"x": 200, "y": 0},
                    "data": {"type": "command", "command_name": "forge.enhance-idea"},
                },
                {
                    "id": "a1",
                    "position": {"x": 400, "y": 0},
                    "data": {"type": "approval", "label": "PM review"},
                },
                {
                    "id": "c2",
                    "position": {"x": 600, "y": 0},
                    "data": {"type": "command", "command_name": "jira.create-story"},
                },
                {
                    "id": "c3",
                    "position": {"x": 800, "y": 0},
                    "data": {"type": "command", "command_name": "slack.notify"},
                },
            ],
            "edges": [
                {"id": "e1", "source": "t1", "target": "c1"},
                {"id": "e2", "source": "c1", "target": "a1"},
                {"id": "e3", "source": "a1", "target": "c2"},
                {"id": "e4", "source": "c2", "target": "c3"},
            ],
            "settings": {},
        },
    },
    {
        "name": "Nightly Security Scan",
        "description": "Scan the repo nightly for vulnerabilities, alert on findings.",
        "status": "published",
        "definition": {
            "nodes": [
                {
                    "id": "t1",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "trigger", "label": "Cron 02:00 UTC"},
                },
                {
                    "id": "c1",
                    "position": {"x": 200, "y": 0},
                    "data": {"type": "command", "command_name": "forge.security-scan"},
                },
                {
                    "id": "a1",
                    "position": {"x": 400, "y": 0},
                    "data": {"type": "approval", "label": "Security team"},
                },
                {
                    "id": "s1",
                    "position": {"x": 600, "y": 0},
                    "data": {
                        "type": "script",
                        "language": "python",
                        "source": "import json; print(json.dumps(report))",
                    },
                },
            ],
            "edges": [
                {"id": "e1", "source": "t1", "target": "c1"},
                {"id": "e2", "source": "c1", "target": "a1"},
                {"id": "e3", "source": "a1", "target": "s1"},
            ],
            "settings": {"cost_ceiling_usd": 10.0},
        },
    },
    {
        "name": "Deploy to Production",
        "description": "Build, test, deploy, smoke-test. Approval required.",
        "status": "published",
        "definition": {
            "nodes": [
                {
                    "id": "t1",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "trigger", "label": "Tag pushed"},
                },
                {
                    "id": "c1",
                    "position": {"x": 200, "y": 0},
                    "data": {"type": "command", "command_name": "forge.build"},
                },
                {
                    "id": "c2",
                    "position": {"x": 400, "y": 0},
                    "data": {"type": "command", "command_name": "forge.deploy"},
                },
                {
                    "id": "a1",
                    "position": {"x": 600, "y": 0},
                    "data": {"type": "approval", "label": "SRE sign-off"},
                },
                {
                    "id": "s1",
                    "position": {"x": 800, "y": 0},
                    "data": {
                        "type": "script",
                        "language": "bash",
                        "source": "curl -f $HEALTHCHECK_URL",
                    },
                },
            ],
            "edges": [
                {"id": "e1", "source": "t1", "target": "c1"},
                {"id": "e2", "source": "c1", "target": "c2"},
                {"id": "e3", "source": "c2", "target": "a1"},
                {"id": "e4", "source": "a1", "target": "s1"},
            ],
            "settings": {"cost_ceiling_usd": 20.0, "timeout_seconds": 1800},
        },
    },
    {
        "name": "Story Refinement Workshop",
        "description": "DRAFT — refine user stories with AI before sprint planning.",
        "status": "draft",
        "definition": {
            "nodes": [
                {
                    "id": "t1",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "trigger", "label": "Story added"},
                },
                {
                    "id": "c1",
                    "position": {"x": 200, "y": 0},
                    "data": {"type": "command", "command_name": "forge.refine-story"},
                },
            ],
            "edges": [
                {"id": "e1", "source": "t1", "target": "c1"},
            ],
            "settings": {},
        },
    },
    {
        "name": "Architecture Review",
        "description": "DRAFT — review architecture decisions before approval.",
        "status": "draft",
        "definition": {
            "nodes": [
                {
                    "id": "t1",
                    "position": {"x": 0, "y": 0},
                    "data": {"type": "trigger", "label": "RFC submitted"},
                },
                {
                    "id": "c1",
                    "position": {"x": 200, "y": 0},
                    "data": {"type": "command", "command_name": "forge.architecture-review"},
                },
                {
                    "id": "a1",
                    "position": {"x": 400, "y": 0},
                    "data": {"type": "approval", "label": "Architect sign-off"},
                },
            ],
            "edges": [
                {"id": "e1", "source": "t1", "target": "c1"},
                {"id": "e2", "source": "c1", "target": "a1"},
            ],
            "settings": {},
        },
    },
]


async def _ensure_status_column(session: AsyncSession) -> None:
    """In-place patch: add ``status`` to ``workflows`` if missing.

    Older databases initialised against the pre-step-56 model lack the
    column. Idempotent — re-running on a fresh DB is a no-op.
    """
    result = await session.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'workflows' AND column_name = 'status'
            """
        )
    )
    if result.first() is not None:
        return
    await session.execute(
        text("ALTER TABLE workflows ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'draft'")
    )
    await session.commit()
    print("✓ Added workflows.status column (in-place migration)")


async def seed() -> None:
    async with _session_factory() as session:
        await _ensure_status_column(session)

        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "acme-corp"))
        ).scalar_one_or_none()
        if not tenant:
            print("✗ Tenant acme-corp not found")
            return

        user = (
            (await session.execute(select(User).where(User.email == "arun@acme-corp.com")))
            .scalars()
            .first()
        )
        user_id = user.id if user else tenant.id

        created = []
        for spec in SEED_WORKFLOWS:
            existing = (
                await session.execute(
                    select(Workflow).where(
                        Workflow.tenant_id == tenant.id,
                        Workflow.name == spec["name"],
                    )
                )
            ).scalar_one_or_none()

            if existing:
                print(f"  → {spec['name']} already exists (id={existing.id})")
                created.append(existing)
                continue

            wf = Workflow(
                id=str(uuid4()),
                tenant_id=tenant.id,
                project_id=tenant.id,
                name=spec["name"],
                description=spec["description"],
                status=spec["status"],
                definition=spec["definition"],
                created_by=str(user_id),
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            session.add(wf)
            await session.flush()
            created.append(wf)
            print(f"✓ Created workflow: {spec['name']} ({spec['status']})")

        # Seed 3 runs against the PR Review Pipeline
        pr_wf = next((w for w in created if w.name == "PR Review Pipeline"), None)
        if pr_wf:
            existing_runs = (
                (
                    await session.execute(
                        select(WorkflowRun).where(WorkflowRun.workflow_id == pr_wf.id)
                    )
                )
                .scalars()
                .all()
            )

            if not existing_runs:
                for status_value, started_offset_min in [
                    ("running", 2),
                    ("succeeded", 1440),
                    ("failed", 60),
                ]:
                    started = datetime.now(UTC).timestamp() - started_offset_min * 60
                    started_dt = datetime.fromtimestamp(started, tz=UTC)
                    finished_dt = datetime.now(UTC) if status_value != "running" else None
                    run = WorkflowRun(
                        id=str(uuid4()),
                        tenant_id=tenant.id,
                        project_id=tenant.id,
                        workflow_id=pr_wf.id,
                        status=status_value,
                        triggered_by=str(user_id),
                        started_at=started_dt,
                        finished_at=finished_dt,
                        current_step_id="c1" if status_value == "running" else None,
                        state={
                            "stepResults": {
                                "t1": {"status": "succeeded", "duration_ms": 120},
                                "c1": {
                                    "status": "succeeded"
                                    if status_value != "failed"
                                    else "running",
                                    "duration_ms": 2340 if status_value != "failed" else None,
                                },
                            },
                            "cost_usd": 0.42 if status_value == "succeeded" else 0.18,
                        },
                    )
                    session.add(run)
                    print(f"✓ Created run: {status_value} (id={run.id})")

        await session.commit()
        print(f"\n✅ Seeded {len(created)} workflows + runs")


if __name__ == "__main__":
    asyncio.run(seed())
