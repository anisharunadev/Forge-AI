"""Jira ingestion service (Pillar 1 — Phase 1 — bidirectional sync).

Subscribes to ``EventType.CONNECTOR_EVENT_OBSERVED`` and upserts
``Idea`` rows keyed by ``external_key`` (= Jira issue key). The service
is the consumer half of the bidirectional contract: pushes go out via
``JiraPushService``; status changes and comments come back in via this
service + ``JiraCommenter``.

Idempotency: the consumer checks ``Idea.external_key`` first and
returns early if a row already exists with the same key. The
``jira.transition.applied`` payload shape updates ``Idea.status``
using a small mapping table; transitions that don't map cleanly fall
back to ``SCORED`` (the closest typed status) and emit a warn log.

Phase 1 deliberately limits subscribers to this single class — the
approval/code-validator/SDLC-agent subscribers that post comments land
in Phase 2 per the Pillar 1 plan.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import Idea, IdeaSource, IdeaStatus
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.event_bus import Event, EventBus, EventType, bus as default_bus

logger = get_logger(__name__)


# Jira workflow names → IdeaStatus enum values. Mirrors the most
# common Atlassian defaults; unknown names fall back to ``SCORED`` so
# the consumer is lossless against unexpected workflow configurations.
_JIRA_STATUS_TO_IDEA: dict[str, IdeaStatus] = {
    "to do": IdeaStatus.NEW,
    "open": IdeaStatus.NEW,
    "backlog": IdeaStatus.NEW,
    "in progress": IdeaStatus.ANALYZING,
    "in review": IdeaStatus.SCORED,
    "review": IdeaStatus.SCORED,
    "done": IdeaStatus.IN_ROADMAP,
    "closed": IdeaStatus.IN_ROADMAP,
    "resolved": IdeaStatus.IN_ROADMAP,
    "blocked": IdeaStatus.SCORED,  # AT_RISK is not in IdeaStatus — fall back
    "rejected": IdeaStatus.REJECTED,
    "cancelled": IdeaStatus.ARCHIVED,
}


def _map_jira_status(name: str) -> IdeaStatus:
    return _JIRA_STATUS_TO_IDEA.get((name or "").strip().lower(), IdeaStatus.SCORED)


class JiraIngestionService:
    """Subscribes to ``CONNECTOR_EVENT_OBSERVED`` and upserts Ideas."""

    def __init__(self, bus: EventBus | None = None) -> None:
        self._bus = bus or default_bus
        self._bus.subscribe(EventType.CONNECTOR_EVENT_OBSERVED, self.handle)

    async def handle(self, event: Event) -> None:
        """Public entry point — also wired as the bus subscriber."""
        if event.event_type != EventType.CONNECTOR_EVENT_OBSERVED:
            return
        payload = event.payload or {}
        kind = payload.get("kind") or payload.get("event") or "issue.observed"
        if kind == "transition.applied":
            await self._handle_transition(event, payload)
            return
        # default: treat as an issue.observed upsert
        await self._handle_issue_observed(event, payload)

    # ---- per-event handlers -------------------------------------------

    async def _handle_issue_observed(self, event: Event, payload: dict[str, Any]) -> None:
        issue = payload.get("issue") or {}
        key = issue.get("key")
        if not key:
            logger.warning("jira_consumer.missing_issue_key", payload=payload)
            return
        fields = issue.get("fields") or {}
        title = fields.get("summary") or issue.get("summary") or key
        description = fields.get("description") or issue.get("description") or ""

        idea = await self._upsert_idea(
            tenant_id=event.tenant_id,
            project_id=event.project_id,
            external_key=str(key),
            title=str(title),
            description=str(description),
        )
        await audit_service.record(
            tenant_id=event.tenant_id,
            project_id=event.project_id,
            actor_id=event.actor_id,
            action="jira.ingest.issue_observed",
            target_type="idea",
            target_id=str(idea.id),
            payload={"external_key": str(key), "kind": kind},
        )

    async def _handle_transition(self, event: Event, payload: dict[str, Any]) -> None:
        issue = payload.get("issue") or {}
        key = issue.get("key")
        if not key:
            return
        new_status_name = (
            (payload.get("to") or {}).get("name")
            or (issue.get("fields") or {}).get("status")
            or payload.get("status")
            or ""
        )
        new_status = _map_jira_status(str(new_status_name))

        idea = await self._update_status_by_key(
            tenant_id=event.tenant_id,
            external_key=str(key),
            new_status=new_status,
        )
        if idea is None:
            # First time we've seen this key — synthesise a minimal row so
            # downstream consumers (comment poster, UI history) have a
            # target. The full ingest path runs the next time
            # ``issue.observed`` arrives.
            idea = await self._upsert_idea(
                tenant_id=event.tenant_id,
                project_id=event.project_id,
                external_key=str(key),
                title=str(key),
                description="",
                default_status=new_status,
            )
        await audit_service.record(
            tenant_id=event.tenant_id,
            project_id=event.project_id,
            actor_id=event.actor_id,
            action="jira.ingest",
            target_type="idea",
            target_id=str(idea.id),
            payload={
                "external_key": str(key),
                "to_status": new_status.value,
                "raw_status": str(new_status_name),
            },
        )

    # ---- DB helpers ----------------------------------------------------

    async def _upsert_idea(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        external_key: str,
        title: str,
        description: str,
        default_status: IdeaStatus = IdeaStatus.NEW,
    ) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Idea).where(
                Idea.tenant_id == str(tenant_id),
                Idea.external_key == external_key,
            )
            existing = (await session.execute(stmt)).scalars().first()
            if existing is not None:
                # Idempotent re-publish — leave the existing row alone.
                return existing

            idea = Idea(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=str(project_id) if project_id else str(tenant_id),
                title=title[:256],
                description=description or "(ingested from Jira)",
                source=IdeaSource.FEEDBACK,
                status=default_status,
                submitted_by=_system_actor_id(),
                tags=["jira", f"external_key:{external_key}"],
                attachments=[],
                external_key=external_key,
            )
            session.add(idea)
            await session.commit()
            await session.refresh(idea)
            return idea

    async def _update_status_by_key(
        self,
        *,
        tenant_id: UUID | str,
        external_key: str,
        new_status: IdeaStatus,
    ) -> Idea | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Idea).where(
                Idea.tenant_id == str(tenant_id),
                Idea.external_key == external_key,
            )
            row = (await session.execute(stmt)).scalars().first()
            if row is None:
                return None
            row.status = new_status
            await session.commit()
            await session.refresh(row)
            return row


# A stable system UUID used as the ``submitted_by`` for connector-ingested
# Ideas (no human actor in the loop for these). Phase 2 will replace
# this with a connector-event-actor resolution path.
_SYSTEM_ACTOR = uuid.UUID("00000000-0000-0000-0000-00000000feed")


def _system_actor_id() -> UUID:
    return _SYSTEM_ACTOR


__all__ = ["JiraIngestionService"]
