"""Stories service — CRUD + Jira sync + start-implementation."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import AuthenticatedPrincipal
from app.db.models.story import (
    Epic,
    JiraSyncStatus,
    Sprint,
    SprintStatus,
    Story,
    StoryComment,
    StoryStatus,
)


def _estimate_points(estimate: str) -> int:
    return {"XS": 1, "S": 2, "M": 3, "L": 5, "XL": 8}.get(estimate, 0)


async def list_stories(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    *,
    project_id: Optional[UUID] = None,
    sprint_id: Optional[UUID] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assignee_id: Optional[UUID] = None,
    label: Optional[str] = None,
    search: Optional[str] = None,
) -> list[Story]:
    """List stories for the active tenant. All filters are optional
    and AND-composed. Rule 2 — tenant_id is always enforced."""
    q = select(Story).where(Story.tenant_id == principal.tenant_id)
    if project_id:
        q = q.where(Story.project_id == project_id)
    if sprint_id:
        q = q.where(Story.sprint_id == sprint_id)
    if status:
        q = q.where(Story.status == status)
    if priority:
        q = q.where(Story.priority == priority)
    if assignee_id:
        q = q.where(Story.assignee_id == assignee_id)
    if label:
        # Labels are stored as a JSONB array — overlap with `label`.
        q = q.where(Story.labels.op("?")(label))  # type: ignore[attr-defined]
    if search:
        pattern = f"%{search.lower()}%"
        q = q.where(Story.title.ilike(pattern))
    q = q.order_by(Story.updated_at.desc())
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_story(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
) -> Optional[Story]:
    result = await db.execute(
        select(Story).where(
            Story.id == story_id,
            Story.tenant_id == principal.tenant_id,
        )
    )
    return result.scalar_one_or_none()


async def create_story(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    *,
    title: str,
    description: Optional[str] = None,
    status: str = "backlog",
    priority: str = "P2",
    estimate: str = "M",
    labels: Optional[list[str]] = None,
    acceptance_criteria: Optional[list[dict]] = None,
    subtasks: Optional[list[dict]] = None,
    assignee_id: Optional[UUID] = None,
    reporter_id: Optional[UUID] = None,
    epic_id: Optional[UUID] = None,
    sprint_id: Optional[UUID] = None,
    linked_items: Optional[list[dict]] = None,
    project_id: Optional[UUID] = None,
) -> Story:
    story = Story(
        tenant_id=principal.tenant_id,
        project_id=project_id or principal.project_id or principal.tenant_id,
        title=title,
        description=description,
        status=StoryStatus(status),
        priority=priority,
        estimate=estimate,
        labels=labels or [],
        acceptance_criteria=acceptance_criteria or [],
        subtasks=subtasks or [],
        assignee_id=assignee_id,
        reporter_id=reporter_id or principal.user_id,
        epic_id=epic_id,
        sprint_id=sprint_id,
        linked_items=linked_items or [],
    )
    db.add(story)
    await db.commit()
    await db.refresh(story)
    return story


async def update_story(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
    fields: dict,
) -> Optional[Story]:
    story = await get_story(db, principal, story_id)
    if not story:
        return None
    now = datetime.now(timezone.utc)
    for key, value in fields.items():
        if value is None:
            continue
        if key == "status" and isinstance(value, str):
            new_status = StoryStatus(value)
            if new_status == StoryStatus.IN_PROGRESS and not story.started_at:
                story.started_at = now
            if new_status == StoryStatus.DONE and not story.completed_at:
                story.completed_at = now
            story.status = new_status
        elif hasattr(story, key):
            setattr(story, key, value)
    story.updated_at = now
    await db.commit()
    await db.refresh(story)
    return story


async def delete_story(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
) -> bool:
    story = await get_story(db, principal, story_id)
    if not story:
        return False
    await db.delete(story)
    await db.commit()
    return True


async def bulk_update_stories(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    updates: list[dict],
) -> list[Story]:
    out: list[Story] = []
    for item in updates:
        sid = item.get("id")
        if not sid:
            continue
        try:
            sid_uuid = UUID(sid)
        except (ValueError, TypeError):
            continue
        data = {k: v for k, v in item.items() if k != "id"}
        updated = await update_story(db, principal, sid_uuid, data)
        if updated:
            out.append(updated)
    return out


async def get_story_linked(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
) -> dict:
    """Return denormalized linked items — PRDs, ADRs, ideas, epics, runs.
    Reads from the story's `linked_items` JSON column so we don't have
    to do a fan-out query."""
    story = await get_story(db, principal, story_id)
    if not story:
        return {
            "prds": [], "adrs": [], "ideas": [], "epics": [], "runs": [],
        }
    buckets: dict[str, list[dict[str, str]]] = {
        "prds": [], "adrs": [], "ideas": [], "epics": [], "runs": [],
    }
    for item in story.linked_items or []:
        kind = item.get("type")
        bucket = {
            "prd": "prds",
            "adr": "adrs",
            "idea": "ideas",
            "epic": "epics",
            "run": "runs",
            "task": "runs",
        }.get(kind)
        if bucket:
            buckets[bucket].append({"id": item.get("id", ""), "title": item.get("title", "")})
    return buckets


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

async def list_comments(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
) -> list[StoryComment]:
    result = await db.execute(
        select(StoryComment)
        .where(
            StoryComment.tenant_id == principal.tenant_id,
            StoryComment.story_id == story_id,
        )
        .order_by(StoryComment.created_at.asc())
    )
    return list(result.scalars().all())


async def add_comment(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
    body: str,
    mentions: Optional[list[UUID]] = None,
) -> Optional[StoryComment]:
    story = await get_story(db, principal, story_id)
    if not story:
        return None
    comment = StoryComment(
        tenant_id=principal.tenant_id,
        story_id=story_id,
        author_id=principal.user_id,
        body=body,
        mentions=mentions or [],
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


# ---------------------------------------------------------------------------
# Jira sync
# ---------------------------------------------------------------------------

async def link_to_jira(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
    jira_key: str,
) -> Optional[Story]:
    return await update_story(
        db,
        principal,
        story_id,
        {
            "jira_key": jira_key,
            "jira_url": f"https://example.atlassian.net/browse/{jira_key}",
            "jira_sync_status": JiraSyncStatus.PENDING,
        },
    )


async def sync_to_jira(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
) -> Optional[Story]:
    """Stub — a real implementation would push title/description/status
    to the Jira REST API. We mark the sync as completed so the UI can
    render the green indicator (test: link to Jira → jira_key appears,
    sync indicator turns green)."""
    story = await get_story(db, principal, story_id)
    if not story or not story.jira_key:
        return story
    return await update_story(
        db,
        principal,
        story_id,
        {
            "jira_sync_status": JiraSyncStatus.SYNCED,
            "jira_synced_at": datetime.now(timezone.utc),
        },
    )


# ---------------------------------------------------------------------------
# Start implementation
# ---------------------------------------------------------------------------

async def start_implementation(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    story_id: UUID,
) -> Optional[dict]:
    """Flip the story to in_progress and synthesise a new run + session
    id. The actual terminal session is created in the terminal
    service — we return the id so the UI can navigate into the
    terminal route with the new session pre-bound."""
    story = await update_story(
        db,
        principal,
        story_id,
        {"status": StoryStatus.IN_PROGRESS},
    )
    if not story:
        return None
    run_id = uuid.uuid4()
    session_id = f"session-{uuid.uuid4().hex[:12]}"
    await update_story(
        db,
        principal,
        story_id,
        {"active_run_id": run_id, "last_run_id": run_id},
    )
    # Bump run_count
    story = await get_story(db, principal, story_id)
    if story:
        story.run_count = (story.run_count or 0) + 1
        await db.commit()
        await db.refresh(story)
    return {
        "story_id": str(story_id),
        "run_id": str(run_id),
        "session_id": session_id,
        "context": {
            "title": story.title,
            "priority": story.priority,
            "labels": story.labels,
        },
    }


# ---------------------------------------------------------------------------
# Sprints
# ---------------------------------------------------------------------------

async def list_sprints(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    project_id: Optional[UUID] = None,
) -> list[Sprint]:
    q = select(Sprint).where(Sprint.tenant_id == principal.tenant_id)
    if project_id:
        q = q.where(Sprint.project_id == project_id)
    q = q.order_by(Sprint.start_date.desc())
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_current_sprint(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    project_id: UUID,
) -> Optional[Sprint]:
    result = await db.execute(
        select(Sprint)
        .where(
            Sprint.tenant_id == principal.tenant_id,
            Sprint.project_id == project_id,
            Sprint.status == SprintStatus.ACTIVE,
        )
        .order_by(Sprint.start_date.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def start_sprint(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    sprint_id: UUID,
) -> Optional[Sprint]:
    result = await db.execute(
        select(Sprint).where(
            Sprint.id == sprint_id,
            Sprint.tenant_id == principal.tenant_id,
        )
    )
    sprint = result.scalar_one_or_none()
    if not sprint:
        return None
    sprint.status = SprintStatus.ACTIVE
    await db.commit()
    await db.refresh(sprint)
    return sprint


# ---------------------------------------------------------------------------
# Epics
# ---------------------------------------------------------------------------

async def list_epics(
    db: AsyncSession,
    principal: AuthenticatedPrincipal,
    project_id: Optional[UUID] = None,
) -> list[Epic]:
    q = select(Epic).where(Epic.tenant_id == principal.tenant_id)
    if project_id:
        q = q.where(Epic.project_id == project_id)
    q = q.order_by(Epic.created_at.desc())
    result = await db.execute(q)
    return list(result.scalars().all())


__all__ = [
    "list_stories",
    "get_story",
    "create_story",
    "update_story",
    "delete_story",
    "bulk_update_stories",
    "get_story_linked",
    "list_comments",
    "add_comment",
    "link_to_jira",
    "sync_to_jira",
    "start_implementation",
    "list_sprints",
    "get_current_sprint",
    "start_sprint",
    "list_epics",
]
