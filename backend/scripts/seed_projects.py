#!/usr/bin/env python3
"""Seed real projects + epics + sprints for the acme-corp tenant.

Step-58-v2 Zone 1 — inserts 3 projects (Acme Platform, Connector
Migration, Workflow Editor V2) with 5 epics and 3 sprints so the
Project Intelligence page, Stories Center, and Architecture Center all
have data to render against the real backend.

Run with:
    docker compose exec backend python -m scripts.seed_projects
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from app.db.models.tenant import Tenant
from app.db.models.project import Project
from app.db.models.story import Epic, EpicStatus, Sprint, SprintStatus
from app.db.session import get_session_factory

logger = logging.getLogger("seed_projects")
logging.basicConfig(level=logging.INFO, format="%(message)s")

# acme-corp is the dev tenant seeded by `day_one_bootstrap`. Its UUID
# is stable across re-seeds because the bootstrap uses an idempotent
# insert.
ACME_TENANT_ID = uuid.UUID("a6500631-1930-5afa-9d38-24de9bedcb37")


# ---------------------------------------------------------------------------
# Stable UUIDs — every project, epic, and sprint is given a fixed UUID so a
# re-run of the script is fully idempotent (existing rows are detected by
# id, not by slug+name). ACME_PROJECT_ID matches the conventional
# "22222222-..." placeholder used across the codebase.
# ---------------------------------------------------------------------------

ACME_PLATFORM_PROJECT_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
CONNECTOR_MIGRATION_PROJECT_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
WORKFLOW_EDITOR_PROJECT_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")

SEED_PROJECTS: list[dict[str, Any]] = [
    {
        "id": ACME_PLATFORM_PROJECT_ID,
        "name": "Acme Platform",
        "slug": "acme-platform",
        "status": "active",
        "settings": {
            "description": "Core SDLC agent orchestration platform for Acme Corp",
            "jira_project_key": "ACM",
        },
    },
    {
        "id": CONNECTOR_MIGRATION_PROJECT_ID,
        "name": "Connector Migration",
        "slug": "connector-migration",
        "status": "active",
        "settings": {
            "description": "Migrate legacy Forge connectors to the new typed-event model",
            "jira_project_key": "CON",
        },
    },
    {
        "id": WORKFLOW_EDITOR_PROJECT_ID,
        "name": "Workflow Editor V2",
        "slug": "workflow-editor-v2",
        "status": "active",
        "settings": {
            "description": "Modern canvas editor with version control + collaboration",
            "jira_project_key": "WFE",
        },
    },
]

SEED_EPICS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("e0000001-0000-4000-8000-000000000001"),
        "project_id": ACME_PLATFORM_PROJECT_ID,
        "title": "Multi-tenant query isolation",
        "description": "Every query carries tenant_id + project_id (Rule 2)",
        "status": EpicStatus.IN_PROGRESS,
        "progress": 60.0,
        "story_count": 4,
        "completed_story_count": 1,
    },
    {
        "id": uuid.UUID("e0000002-0000-4000-8000-000000000002"),
        "project_id": ACME_PLATFORM_PROJECT_ID,
        "title": "LiteLLM proxy integration",
        "description": "All LLM traffic routes through LiteLLM (Rule 1)",
        "status": EpicStatus.COMPLETED,
        "progress": 100.0,
        "story_count": 2,
        "completed_story_count": 2,
    },
    {
        "id": uuid.UUID("e0000003-0000-4000-8000-000000000003"),
        "project_id": CONNECTOR_MIGRATION_PROJECT_ID,
        "title": "Jira typed events",
        "description": "Migrate Jira webhook ingestion to connector.events.observed",
        "status": EpicStatus.IN_PROGRESS,
        "progress": 40.0,
        "story_count": 3,
        "completed_story_count": 1,
    },
    {
        "id": uuid.UUID("e0000004-0000-4000-8000-000000000004"),
        "project_id": WORKFLOW_EDITOR_PROJECT_ID,
        "title": "Version control for workflows",
        "description": "git-style branching + diff + rollback for workflow definitions",
        "status": EpicStatus.PLANNING,
        "progress": 0.0,
        "story_count": 2,
        "completed_story_count": 0,
    },
    {
        "id": uuid.UUID("e0000005-0000-4000-8000-000000000005"),
        "project_id": WORKFLOW_EDITOR_PROJECT_ID,
        "title": "Real-time collaborative editing",
        "description": "Multi-user canvas editing via CRDT",
        "status": EpicStatus.PLANNING,
        "progress": 0.0,
        "story_count": 2,
        "completed_story_count": 0,
    },
]


def _sprint_window(start_offset_days: int, end_offset_days: int) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    return (
        now + timedelta(days=start_offset_days),
        now + timedelta(days=end_offset_days),
    )


SEED_SPRINTS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("c0000001-0000-4000-8000-000000000001"),
        "project_id": ACME_PLATFORM_PROJECT_ID,
        "name": "Sprint 25.13",
        "goal": "Ship Stories Center + draw audit timeline",
        "start_offset_days": -7,
        "end_offset_days": 7,
        "status": SprintStatus.ACTIVE,
    },
    {
        "id": uuid.UUID("c0000002-0000-4000-8000-000000000002"),
        "project_id": ACME_PLATFORM_PROJECT_ID,
        "name": "Sprint 25.14",
        "goal": "Connector Center live data + Jira sync",
        "start_offset_days": 7,
        "end_offset_days": 21,
        "status": SprintStatus.PLANNING,
    },
    {
        "id": uuid.UUID("c0000003-0000-4000-8000-000000000003"),
        "project_id": CONNECTOR_MIGRATION_PROJECT_ID,
        "name": "Sprint C-04",
        "goal": "Migrate 3 connectors (GitHub, Jira, Slack)",
        "start_offset_days": -3,
        "end_offset_days": 11,
        "status": SprintStatus.ACTIVE,
    },
]


async def seed() -> None:
    """Insert seed rows for the acme-corp tenant. Idempotent."""
    sf = get_session_factory()

    async with sf() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.id == ACME_TENANT_ID))
        ).scalar_one_or_none()
        if tenant is None:
            raise RuntimeError(
                f"acme-corp tenant {ACME_TENANT_ID} not found. "
                "Run the day_one_bootstrap service first."
            )
        logger.info("tenant: %s (%s)", tenant.slug, tenant.name)

        # -----------------------------------------------------------------
        # Projects
        # -----------------------------------------------------------------
        projects_created = 0
        for row in SEED_PROJECTS:
            existing = (
                await session.execute(
                    select(Project).where(
                        Project.id == row["id"],
                        Project.tenant_id == tenant.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("  ↻ project exists: %s", row["name"])
                continue
            session.add(Project(tenant_id=tenant.id, **row))
            projects_created += 1
            logger.info("  ✓ project created: %s", row["name"])

        # Flush so the projects exist before epics/sprints reference them.
        await session.flush()

        # -----------------------------------------------------------------
        # Epics
        # -----------------------------------------------------------------
        epics_created = 0
        for row in SEED_EPICS:
            existing = (
                await session.execute(
                    select(Epic).where(
                        Epic.id == row["id"],
                        Epic.tenant_id == tenant.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("  ↻ epic exists: %s", row["title"])
                continue
            epics_created += 1
            logger.info(
                "  ✓ epic created: %s (%s)", row["title"], row["status"].value
            )
            session.add(Epic(tenant_id=tenant.id, **row))

        # -----------------------------------------------------------------
        # Sprints
        # -----------------------------------------------------------------
        sprints_created = 0
        for row in SEED_SPRINTS:
            existing = (
                await session.execute(
                    select(Sprint).where(
                        Sprint.id == row["id"],
                        Sprint.tenant_id == tenant.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("  ↻ sprint exists: %s", row["name"])
                continue
            start, end = _sprint_window(
                row.pop("start_offset_days"), row.pop("end_offset_days")
            )
            session.add(
                Sprint(
                    tenant_id=tenant.id,
                    start_date=start,
                    end_date=end,
                    **row,
                )
            )
            sprints_created += 1
            logger.info(
                "  ✓ sprint created: %s (%s)", row["name"], row["status"].value
            )

        await session.commit()

        logger.info("")
        logger.info("✅ Seed complete!")
        logger.info(
            "   - %d projects created (%d total)",
            projects_created,
            len(SEED_PROJECTS),
        )
        logger.info(
            "   - %d epics created (%d total)",
            epics_created,
            len(SEED_EPICS),
        )
        logger.info(
            "   - %d sprints created (%d total)",
            sprints_created,
            len(SEED_SPRINTS),
        )


if __name__ == "__main__":
    asyncio.run(seed())
