"""Stories / Sprints / Epics API endpoints (step-58 — Phase 7)."""

# NOTE: ``from __future__ import annotations`` is deliberately OFF for this
# module — FastAPI 0.116 + Pydantic 2.13 cannot resolve the ``Principal``
# and ``DbSession`` module-level ``Annotated[...]`` aliases under PEP 563.
# Without ``from __future__ import annotations`` the type annotations stay
# as live objects so FastAPI can read the Depends from them.

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, Principal, require_permission
from app.core.audit import audit
from app.schemas.stories import (
    CommentCreate,
    CommentRead,
    EpicRead,
    LinkToJiraInput,
    SprintCreate,
    SprintRead,
    StartImplementationResponse,
    StoryBulkUpdate,
    StoryCreate,
    StoryLinkedRead,
    StoryRead,
    StoryUpdate,
)
from app.services import stories as stories_svc
from app.services.users import get_user_by_id

# Three routers — one per resource. They all live under `/api/v1/`.
router = APIRouter(tags=["stories"])
sprints_router = APIRouter(prefix="/sprints", tags=["sprints"])
epics_router = APIRouter(prefix="/epics", tags=["epics"])


# ---------------------------------------------------------------------------
# Stories CRUD
# ---------------------------------------------------------------------------

@router.get("/stories", response_model=list[StoryRead])
@audit(action="stories.list", target_type="story")
async def list_stories(
    principal: Principal,
    db: DbSession,
    project_id: UUID | None = Query(default=None),
    sprint_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    assignee_id: UUID | None = Query(default=None),
    label: str | None = Query(default=None),
    search: str | None = Query(default=None),
    _perm = Depends(require_permission("stories:read")),
) -> list[StoryRead]:
    stories = await stories_svc.list_stories(
        db, principal,
        project_id=project_id, sprint_id=sprint_id, status=status,
        priority=priority, assignee_id=assignee_id, label=label, search=search,
    )
    return [StoryRead.model_validate(s) for s in stories]


@router.post("/stories", response_model=StoryRead, status_code=201)
@audit(action="stories.create", target_type="story")
async def create_story(
    body: StoryCreate,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> StoryRead:
    story = await stories_svc.create_story(
        db, principal,
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        estimate=body.estimate,
        labels=body.labels,
        acceptance_criteria=[c.model_dump() for c in body.acceptance_criteria],
        subtasks=[s.model_dump() for s in body.subtasks],
        assignee_id=body.assignee_id,
        reporter_id=body.reporter_id,
        epic_id=body.epic_id,
        sprint_id=body.sprint_id,
        linked_items=[i.model_dump() for i in body.linked_items],
        project_id=body.project_id,
    )
    return StoryRead.model_validate(story)


@router.get("/stories/{story_id}", response_model=StoryRead)
@audit(action="stories.read", target_type="story")
async def get_story(
    story_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:read")),
) -> StoryRead:
    story = await stories_svc.get_story(db, principal, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return StoryRead.model_validate(story)


@router.patch("/stories/{story_id}", response_model=StoryRead)
@audit(action="stories.update", target_type="story")
async def update_story(
    story_id: UUID,
    body: StoryUpdate,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> StoryRead:
    fields = body.model_dump(exclude_unset=True)
    # Pydantic dumps nested models as dicts; keep them as-is.
    if "acceptance_criteria" in fields:
        fields["acceptance_criteria"] = [
            c if isinstance(c, dict) else c.model_dump() for c in fields["acceptance_criteria"]
        ]
    if "subtasks" in fields:
        fields["subtasks"] = [
            s if isinstance(s, dict) else s.model_dump() for s in fields["subtasks"]
        ]
    story = await stories_svc.update_story(db, principal, story_id, fields)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return StoryRead.model_validate(story)


@router.delete(
    "/stories/{story_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    response_class=Response,
)
@audit(action="stories.delete", target_type="story")
async def delete_story(
    story_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
):
    ok = await stories_svc.delete_story(db, principal, story_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Story not found")
    return Response(status_code=204)


@router.patch("/stories/bulk", response_model=list[StoryRead])
@audit(action="stories.bulk_update", target_type="story")
async def bulk_update_stories(
    body: StoryBulkUpdate,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> list[StoryRead]:
    stories = await stories_svc.bulk_update_stories(db, principal, body.updates)
    return [StoryRead.model_validate(s) for s in stories]


@router.get("/stories/{story_id}/linked", response_model=StoryLinkedRead)
@audit(action="stories.linked", target_type="story")
async def get_story_linked(
    story_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:read")),
) -> StoryLinkedRead:
    return StoryLinkedRead(**await stories_svc.get_story_linked(db, principal, story_id))


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

@router.get("/stories/{story_id}/comments", response_model=list[CommentRead])
@audit(action="story_comments.list", target_type="story")
async def list_comments(
    story_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:read")),
) -> list[CommentRead]:
    rows = await stories_svc.list_comments(db, principal, story_id)
    out: list[CommentRead] = []
    for c in rows:
        profile = await get_user_by_id(db, c.author_id)
        out.append(CommentRead(
            id=c.id,
            tenant_id=c.tenant_id,
            story_id=c.story_id,
            author_id=c.author_id,
            author_name=profile.get("name") if profile else str(c.author_id),
            author_avatar_url=profile.get("avatar_url") if profile else None,
            body=c.body,
            mentions=c.mentions or [],
            created_at=c.created_at,
            edited_at=c.edited_at,
        ))
    return out


@router.post(
    "/stories/{story_id}/comments",
    response_model=CommentRead,
    status_code=201,
)
@audit(action="story_comments.create", target_type="story")
async def add_comment(
    story_id: UUID,
    body: CommentCreate,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> CommentRead:
    c = await stories_svc.add_comment(
        db, principal, story_id, body=body.body, mentions=body.mentions,
    )
    if not c:
        raise HTTPException(status_code=404, detail="Story not found")
    profile = await get_user_by_id(db, c.author_id)
    return CommentRead(
        id=c.id,
        tenant_id=c.tenant_id,
        story_id=c.story_id,
        author_id=c.author_id,
        author_name=profile.get("name") if profile else str(c.author_id),
        author_avatar_url=profile.get("avatar_url") if profile else None,
        body=c.body,
        mentions=c.mentions or [],
        created_at=c.created_at,
        edited_at=c.edited_at,
    )


# ---------------------------------------------------------------------------
# Jira sync
# ---------------------------------------------------------------------------

@router.post("/stories/{story_id}/sync-jira", response_model=StoryRead)
@audit(action="stories.sync_jira", target_type="story")
async def sync_to_jira(
    story_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> StoryRead:
    story = await stories_svc.sync_to_jira(db, principal, story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return StoryRead.model_validate(story)


@router.post("/stories/{story_id}/link-jira", response_model=StoryRead)
@audit(action="stories.link_jira", target_type="story")
async def link_to_jira(
    story_id: UUID,
    body: LinkToJiraInput,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> StoryRead:
    story = await stories_svc.link_to_jira(db, principal, story_id, body.jira_key)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return StoryRead.model_validate(story)


# ---------------------------------------------------------------------------
# Start implementation
# ---------------------------------------------------------------------------

@router.post(
    "/stories/{story_id}/start-implementation",
    response_model=StartImplementationResponse,
)
@audit(action="stories.start_implementation", target_type="story")
async def start_implementation(
    story_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> StartImplementationResponse:
    result = await stories_svc.start_implementation(db, principal, story_id)
    if not result:
        raise HTTPException(status_code=404, detail="Story not found")
    return StartImplementationResponse(**result)


# ---------------------------------------------------------------------------
# Sprints
# ---------------------------------------------------------------------------

@sprints_router.get("", response_model=list[SprintRead])
@audit(action="sprints.list", target_type="sprint")
async def list_sprints(
    principal: Principal,
    db: DbSession,
    project_id: UUID | None = Query(default=None),
    _perm = Depends(require_permission("stories:read")),
) -> list[SprintRead]:
    rows = await stories_svc.list_sprints(db, principal, project_id=project_id)
    return [SprintRead.model_validate(s) for s in rows]


@sprints_router.get("/current", response_model=Optional[SprintRead])
@audit(action="sprints.current", target_type="sprint")
async def current_sprint(
    principal: Principal,
    db: DbSession,
    project_id: UUID = Query(...),
    _perm = Depends(require_permission("stories:read")),
) -> Optional[SprintRead]:
    s = await stories_svc.get_current_sprint(db, principal, project_id)
    return SprintRead.model_validate(s) if s else None


@sprints_router.post("", response_model=SprintRead, status_code=201)
@audit(action="sprints.create", target_type="sprint")
async def create_sprint(
    body: SprintCreate,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> SprintRead:
    from app.db.models.story import Sprint
    s = Sprint(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        name=body.name,
        goal=body.goal,
        start_date=body.start_date,
        end_date=body.end_date,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return SprintRead.model_validate(s)


@sprints_router.post("/{sprint_id}/start", response_model=SprintRead)
@audit(action="sprints.start", target_type="sprint")
async def start_sprint(
    sprint_id: UUID,
    principal: Principal,
    db: DbSession,
    _perm = Depends(require_permission("stories:write")),
) -> SprintRead:
    s = await stories_svc.start_sprint(db, principal, sprint_id)
    if not s:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return SprintRead.model_validate(s)


# ---------------------------------------------------------------------------
# Epics
# ---------------------------------------------------------------------------

@epics_router.get("", response_model=list[EpicRead])
@audit(action="epics.list", target_type="epic")
async def list_epics(
    principal: Principal,
    db: DbSession,
    project_id: UUID | None = Query(default=None),
    _perm = Depends(require_permission("stories:read")),
) -> list[EpicRead]:
    rows = await stories_svc.list_epics(db, principal, project_id=project_id)
    return [EpicRead.model_validate(e) for e in rows]


__all__ = ["router", "sprints_router", "epics_router"]
