#!/usr/bin/env python3
"""Seed real user stories for the acme-corp tenant.

Step-58-v2 Zone 2 — inserts ~30 stories with a realistic status
distribution (BACKLOG / IN_PROGRESS / IN_REVIEW / DONE / BLOCKED /
ACCEPTED) so the kanban board shows a sprint in motion. Stories are
spread across the three seeded projects (Acme Platform, Connector
Migration, Workflow Editor V2) and reference the seeded epics and
sprints where appropriate.

Run with:
    docker compose exec backend python -m scripts.seed_stories
"""
from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from app.db.models.tenant import Tenant
from app.db.models.project import Project
from app.db.models.story import (
    Epic,
    Sprint,
    Story,
    StoryEstimate,
    StoryPriority,
    StorySource,
    StoryStatus,
)
from app.db.models.user import User
from app.db.session import get_session_factory

from scripts._seed_helpers import ACME_TENANT_ID

logger = logging.getLogger("seed_stories")
logging.basicConfig(level=logging.INFO, format="%(message)s")

# acme-corp is the dev tenant seeded by `day_one_bootstrap`. Its UUID
# is stable across re-seeds because the bootstrap uses an idempotent
# insert.

# Must match the project IDs in seed_projects.py — the dependency is
# unidirectional (stories require projects) so re-running projects then
# stories is safe.
ACME_PLATFORM_PROJECT_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
CONNECTOR_MIGRATION_PROJECT_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
WORKFLOW_EDITOR_PROJECT_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")

# Seeded by day_one_bootstrap; default placeholder if the user hasn't
# been mirrored into the local users table yet.
DEFAULT_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000999")


def story_seeds() -> list[tuple[str, str | None, str | None, str, StoryStatus, StoryPriority, StoryEstimate]]:
    """Return the canonical ~30-story seed list.

    Tuples are (project_slug, sprint_name, epic_title, title, status,
    priority, estimate). Missing sprint/epic are allowed and become
    None on the row.
    """
    return [
        # ===== ACTIVE SPRINT (Sprint 25.13) =====
        ("acme-platform", "Sprint 25.13", "Multi-tenant query isolation",
         "Add tenant_id guard to /projects routes", StoryStatus.IN_PROGRESS, StoryPriority.P1, StoryEstimate.M),
        ("acme-platform", "Sprint 25.13", "Multi-tenant query isolation",
         "Add tenant_id guard to /stories routes", StoryStatus.IN_REVIEW, StoryPriority.P1, StoryEstimate.S),
        ("acme-platform", "Sprint 25.13", "LiteLLM proxy integration",
         "Configure LiteLLM with Anthropic + OpenAI keys", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.M),
        ("acme-platform", "Sprint 25.13", "LiteLLM proxy integration",
         "Wire Co-pilot to call LiteLLM proxy", StoryStatus.IN_PROGRESS, StoryPriority.P0, StoryEstimate.L),
        ("acme-platform", "Sprint 25.13", None,
         "Audit timeline drawer renders correctly", StoryStatus.IN_PROGRESS, StoryPriority.P2, StoryEstimate.M),
        ("acme-platform", "Sprint 25.13", None,
         "Story detail drawer shows linked Jira ticket", StoryStatus.BLOCKED, StoryPriority.P2, StoryEstimate.S),

        # ===== PLANNED SPRINT (Sprint 25.14) =====
        ("acme-platform", "Sprint 25.14", "Multi-tenant query isolation",
         "Audit log shows every tenant-scoped query", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.M),
        ("acme-platform", "Sprint 25.14", None,
         "Connector Center wired to real API", StoryStatus.BACKLOG, StoryPriority.P0, StoryEstimate.L),

        # ===== DONE / ACCEPTED (Sprint 25.12) =====
        ("acme-platform", None, None,
         "Set up Keycloak realm for forge-tenancy", StoryStatus.ACCEPTED, StoryPriority.P0, StoryEstimate.S),
        ("acme-platform", None, None,
         "Wire forge-pi package as a workspace", StoryStatus.ACCEPTED, StoryPriority.P1, StoryEstimate.S),
        ("acme-platform", None, None,
         "Add forge-pi-bootstrap command", StoryStatus.DONE, StoryPriority.P2, StoryEstimate.S),

        # ===== CONNECTOR MIGRATION =====
        ("connector-migration", "Sprint C-04", "Jira typed events",
         "Implement Jira connector.event.observed handler", StoryStatus.IN_PROGRESS, StoryPriority.P0, StoryEstimate.L),
        ("connector-migration", "Sprint C-04", "Jira typed events",
         "Add unit tests for Jira event ingestion", StoryStatus.IN_PROGRESS, StoryPriority.P1, StoryEstimate.M),
        ("connector-migration", "Sprint C-04", None,
         "Migrate GitHub connector to typed events", StoryStatus.IN_REVIEW, StoryPriority.P1, StoryEstimate.L),
        ("connector-migration", "Sprint C-04", None,
         "Migrate Slack connector to typed events", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.M),
        ("connector-migration", "Sprint C-04", None,
         "Connector idempotency keys for retry safety", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.S),

        # ===== WORKFLOW EDITOR V2 =====
        ("workflow-editor-v2", None, "Version control for workflows",
         "Design versioned workflow model", StoryStatus.BACKLOG, StoryPriority.P1, StoryEstimate.L),
        ("workflow-editor-v2", None, "Version control for workflows",
         "Implement diff view between two workflow versions", StoryStatus.BACKLOG, StoryPriority.P1, StoryEstimate.L),
        ("workflow-editor-v2", None, "Real-time collaborative editing",
         "Evaluate CRDT libraries (Yjs vs Automerge)", StoryStatus.BLOCKED, StoryPriority.P2, StoryEstimate.M),
        ("workflow-editor-v2", None, "Real-time collaborative editing",
         "Set up Yjs presence layer", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.L),

        # ===== Misc backlogs =====
        ("acme-platform", None, None,
         "Add Cost ceiling policy to all workflows", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.S),
        ("acme-platform", None, None,
         "Document approval gates in /docs/architecture", StoryStatus.BACKLOG, StoryPriority.P3, StoryEstimate.XS),
        ("acme-platform", None, None,
         "Add governance violation UI for failed audits", StoryStatus.BLOCKED, StoryPriority.P2, StoryEstimate.M),

        # ===== Done/Accepted =====
        ("acme-platform", None, None,
         "Implement OIDC callback handler", StoryStatus.ACCEPTED, StoryPriority.P0, StoryEstimate.M),
        ("acme-platform", None, None,
         "Set up TanStack Query provider", StoryStatus.ACCEPTED, StoryPriority.P1, StoryEstimate.S),
        ("acme-platform", None, None,
         "Add audit log writer decorator", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.S),
        ("acme-platform", None, None,
         "Wire forge-core canonical skills loader", StoryStatus.DONE, StoryPriority.P1, StoryEstimate.M),
        ("connector-migration", None, None,
         "Connector registry schema migration", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.M),
        ("workflow-editor-v2", None, None,
         "Workflow editor accessibility audit (axe)", StoryStatus.IN_REVIEW, StoryPriority.P3, StoryEstimate.S),
    ]


# Per-project label sets — extra "blocked" / "urgent" labels are added at
# insert time based on status / priority.
LABELS_BY_PROJECT: dict[str, list[str]] = {
    "acme-platform": ["platform", "core"],
    "connector-migration": ["connectors", "migration"],
    "workflow-editor-v2": ["editor", "ux"],
}


def _build_acceptance(title: str, status: StoryStatus) -> list[dict[str, Any]]:
    """Per the spec: `met` is true if status is DONE or ACCEPTED."""
    return [
        {
            "id": str(uuid.uuid4()),
            "description": f"Given the system, when {title.lower()}, then expected outcome",
            "met": status in (StoryStatus.DONE, StoryStatus.ACCEPTED),
        },
        {
            "id": str(uuid.uuid4()),
            "description": "Verify with unit tests",
            "met": status == StoryStatus.ACCEPTED,
        },
    ]


def _build_labels(proj_slug: str, status: StoryStatus, priority: StoryPriority) -> list[str]:
    base = list(LABELS_BY_PROJECT.get(proj_slug, []))
    if status == StoryStatus.BLOCKED:
        base.append("blocked")
    if priority == StoryPriority.P0:
        base.append("urgent")
    return base


async def seed() -> None:
    """Insert seed story rows for the acme-corp tenant. Idempotent."""
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

        # Short-circuit if any story already exists.
        existing = (
            await session.execute(
                select(Story.id).where(Story.tenant_id == tenant.id).limit(1)
            )
        ).first()
        if existing is not None:
            logger.info("  ↻ stories already seeded; skipping")
            return

        # Lookup projects (must have been seeded first).
        projects = (
            await session.execute(
                select(Project).where(Project.tenant_id == tenant.id)
            )
        ).scalars().all()
        projects_by_slug: dict[str, Project] = {p.slug: p for p in projects}
        if not projects_by_slug:
            raise RuntimeError(
                "No projects found. Run scripts.seed_projects first."
            )

        # Lookup epics and sprints for the join columns.
        epics = (
            await session.execute(select(Epic).where(Epic.tenant_id == tenant.id))
        ).scalars().all()
        epics_by_title: dict[str, Epic] = {e.title: e for e in epics}

        sprints = (
            await session.execute(select(Sprint).where(Sprint.tenant_id == tenant.id))
        ).scalars().all()
        sprints_by_name: dict[str, Sprint] = {s.name: s for s in sprints}

        # Reporter / assignees — use the first mirrored user, falling back
        # to the placeholder if no users exist yet.
        users = (
            await session.execute(
                select(User).where(User.tenant_id == tenant.id)
            )
        ).scalars().all()
        if users:
            reporter_id = next(
                (u.id for u in users if u.email == "arun@acme-corp.com"),
                users[0].id,
            )
            assignees = [u.id for u in users]
        else:
            reporter_id = DEFAULT_USER_ID
            assignees = [DEFAULT_USER_ID]

        random.seed(20260629)  # deterministic re-runs for create_at offsets

        created = 0
        for proj_slug, sprint_name, epic_title, title, status, priority, estimate in story_seeds():
            project = projects_by_slug.get(proj_slug)
            if project is None:
                logger.warning("  ! skipping (no project %s): %s", proj_slug, title)
                continue

            sprint = sprints_by_name.get(sprint_name) if sprint_name else None
            epic = epics_by_title.get(epic_title) if epic_title else None

            created_at = datetime.now(timezone.utc) - timedelta(
                days=random.randint(1, 30)
            )
            started_at = (
                created_at + timedelta(days=random.randint(0, 3))
                if status in (StoryStatus.IN_PROGRESS, StoryStatus.IN_REVIEW, StoryStatus.DONE, StoryStatus.ACCEPTED)
                else None
            )
            completed_at = (
                started_at + timedelta(days=random.randint(1, 5))
                if started_at and status in (StoryStatus.DONE, StoryStatus.ACCEPTED)
                else None
            )

            session.add(
                Story(
                    id=uuid.uuid4(),
                    tenant_id=tenant.id,
                    project_id=project.id,
                    epic_id=epic.id if epic else None,
                    sprint_id=sprint.id if sprint else None,
                    title=title,
                    description=f"Detailed description for: {title}",
                    acceptance_criteria=_build_acceptance(title, status),
                    subtasks=[],
                    status=status,
                    priority=priority,
                    estimate=estimate,
                    labels=_build_labels(proj_slug, status, priority),
                    assignee_id=random.choice(assignees),
                    reporter_id=reporter_id,
                    source=StorySource.MANUAL,
                    jira_sync_status="DISCONNECTED",
                    run_count=0,
                    created_at=created_at,
                    started_at=started_at,
                    completed_at=completed_at,
                    linked_items=[],
                )
            )
            created += 1

        await session.commit()

        logger.info("")
        logger.info("✅ Seed complete!")
        logger.info("   - %d stories created (target ~%d)",
                    created, len(story_seeds()))


if __name__ == "__main__":
    asyncio.run(seed())
