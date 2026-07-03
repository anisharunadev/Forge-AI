"""F-002-LESSON — Service (Step-64 Sub-step B).

Three jobs:

* subscribe to failure signals on the event bus and mint
  ``LessonCandidate`` rows (PENDING)
* expose approve / reject for the Steward; approval copies the body
  into a :class:`Template` (F-002) and links the candidate
* roll up the month's PENDING set into a :class:`MonthlyDigest` for
  email delivery

The class is intentionally synchronous-as-SQLAlchemy-already-allows;
the heavy I/O is the event-bus callback, and we keep that short-lived.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.lesson import LessonCandidate, LessonSource, LessonStatus
from app.db.models.template import Template
from app.schemas.lesson import (
    LessonCandidateWire,
    LessonDecisionResult,
    LessonEvidenceRef,
    MonthlyDigest,
)
from app.services.event_bus import Event, EventBus, EventType
from app.services.event_bus import bus as default_bus

logger = logging.getLogger(__name__)


# EventType → LessonSource wiring. Keeps the closed set honest:
# we never accept a source string that wasn't first promoted into
# the EventType enum.
EVENT_TO_SOURCE: dict[EventType, LessonSource] = {
    EventType.RUN_ROLLOBACK: LessonSource.ROLLBACK,
    EventType.DEPLOYMENT_REVERTED: LessonSource.DEPLOYMENT_ALERT,
    EventType.METRIC_DEGRADED: LessonSource.METRIC_DEGRADE,
    EventType.RUN_BAD_OUTCOME: LessonSource.BAD_OUTCOME_TAG,
    EventType.AGENT_RUN_FAILED: LessonSource.RUN_FAILED,
    EventType.WORKFLOW_RUN_FAILED: LessonSource.WORKFLOW_FAILED,
}


# --- Subscriber handlers (one per EventType) -------------------------------
#
# Each handler builds a candidate row + an audit row. The body is
# generated from the event payload so the steward has context to act
# on without having to dig into audit rows.
# ---------------------------------------------------------------------------


def _derive_title(event: Event) -> str:
    payload = event.payload or {}
    runs = payload.get("run_id") or payload.get("deployment_id") or "unknown"
    reason = (
        payload.get("error_type")
        or payload.get("reason")
        or payload.get("metric")
        or event.event_type.value
    )
    return f"{event.event_type.value} on run {runs}: {str(reason)[:80]}"


def _derive_body(event: Event) -> str:
    payload = event.payload or {}
    # Stable markdown rendering — the steward can edit before approving.
    parts: list[str] = [
        f"### {event.event_type.value}",
        f"Occurred at: `{event.occurred_at.isoformat()}`",
        f"Tenant: `{event.tenant_id}`",
    ]
    if event.project_id is not None:
        parts.append(f"Project: `{event.project_id}`")
    if payload:
        # Drop giant payloads — the audit row carries them.
        trimmed = {k: payload[k] for k in list(payload.keys())[:6]}
        parts.append("Payload (truncated):")
        parts.append("```json")
        parts.append(json.dumps(trimmed, indent=2, default=str))
        parts.append("```")
    return "\n".join(parts)


class LessonService:
    """Stateless service — the bus and DB are passed in, no globals."""

    def __init__(self, session_factory: Any | None = None) -> None:
        self._factory = session_factory

    # ------------------------------------------------------------------
    # Public API — Steward-driven (called from API routes)
    # ------------------------------------------------------------------

    async def list_candidates(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        status: LessonStatus | None = None,
        limit: int = 100,
    ) -> list[LessonCandidate]:
        stmt = select(LessonCandidate).where(LessonCandidate.tenant_id == tenant_id)
        if status is not None:
            stmt = stmt.where(LessonCandidate.status == status)
        stmt = stmt.order_by(LessonCandidate.created_at.desc()).limit(limit)
        return list((await db.execute(stmt)).scalars().all())

    async def count_by_status(
        self, db: AsyncSession, *, tenant_id: UUID
    ) -> dict[str, int]:
        rows = list(
            (await db.execute(select(LessonCandidate).where(LessonCandidate.tenant_id == tenant_id)))
            .scalars()
            .all()
        )
        counts = Counter(r.status.value for r in rows)
        return {
            "pending": counts.get(LessonStatus.PENDING.value, 0),
            "approved": counts.get(LessonStatus.APPROVED.value, 0),
            "rejected": counts.get(LessonStatus.REJECTED.value, 0),
        }

    async def decide(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        candidate_id: UUID,
        decision: LessonStatus,
        editor_id: UUID,
        review_notes: str = "",
        title_override: str | None = None,
        body_override: str | None = None,
        proposed_skill_name_override: str | None = None,
    ) -> LessonDecisionResult:
        if decision not in (LessonStatus.APPROVED, LessonStatus.REJECTED):
            raise ValueError("decision must be approved or rejected")

        cand = await db.get(LessonCandidate, candidate_id)
        if cand is None or cand.tenant_id != tenant_id:
            raise LookupError("lesson_not_found")
        if cand.status != LessonStatus.PENDING:
            raise ValueError(f"already_decided:{cand.status.value}")

        # Apply overrides before promoting. Approval copies the body
        # into a Template — the steward always wins.
        cand.title = title_override or cand.title
        cand.body = body_override or cand.body
        cand.proposed_skill_name = (
            proposed_skill_name_override or cand.proposed_skill_name
        )
        cand.status = decision
        cand.decided_by = editor_id
        cand.decided_at = datetime.now(timezone.utc)
        cand.review_notes = review_notes

        promoted_template_id: UUID | None = None
        promoted_skill_name: str | None = None
        if decision == LessonStatus.APPROVED:
            template = Template(
                tenant_id=tenant_id,
                project_id=cand.project_id,
                # Templates are typed; lessons ride as ADR by default.
                # The Steward overrides type via proposed_skill_name for skills.
                type="adr",
                name=cand.proposed_skill_name or cand.title[:200],
                content={
                    "lesson_id": str(cand.id),
                    "title": cand.title,
                    "body": cand.body,
                    "source_event": cand.source_event,
                    "evidence": cand.evidence,
                },
                variables=[],
                version=1,
            )
            db.add(template)
            await db.flush()
            promoted_template_id = template.id
            cand.promoted_template_id = template.id
            promoted_skill_name = cand.proposed_skill_name

        await db.commit()
        await db.refresh(cand)
        return LessonDecisionResult(
            candidate=_to_wire(cand),
            promoted_template_id=promoted_template_id,
            promoted_skill_name=promoted_skill_name,
        )

    async def build_monthly_digest(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        period_start: datetime | None = None,
        period_end: datetime | None = None,
        auto_promote_threshold: int = 3,
    ) -> MonthlyDigest:
        end = period_end or datetime.now(timezone.utc)
        start = period_start or (end - timedelta(days=30))
        stmt = (
            select(LessonCandidate)
            .where(
                LessonCandidate.tenant_id == tenant_id,
                LessonCandidate.created_at >= start,
                LessonCandidate.created_at < end,
            )
            .order_by(LessonCandidate.created_at.asc())
        )
        rows = list((await db.execute(stmt)).scalars().all())
        pending = [r for r in rows if r.status == LessonStatus.PENDING]
        approved = [r for r in rows if r.status == LessonStatus.APPROVED]
        rejected = [r for r in rows if r.status == LessonStatus.REJECTED]

        # If ≥3 PENDING share the same source_event, flag as auto-promotable
        # into a forge-core skill rewrite (the spec's "rewrite forge-core skill"
        # path).
        source_counts = Counter(r.source_event for r in pending)
        auto_promote: str | None = None
        for src, cnt in source_counts.items():
            if cnt >= auto_promote_threshold:
                auto_promote = src
                break

        return MonthlyDigest(
            tenant_id=tenant_id,
            period_start=start,
            period_end=end,
            pending=[_to_wire(r) for r in pending],
            approved=[_to_wire(r) for r in approved],
            rejected=[_to_wire(r) for r in rejected],
            by_source=dict(source_counts),
            auto_promotable_skill=auto_promote,
            notes=(
                "Approve a candidate to promote it into an F-002 template. "
                "When the same source_event hits the threshold, treat it as a "
                "signal that an existing forge-core skill needs a rewrite."
            ),
        )

    # ------------------------------------------------------------------
    # Subscriber entry point — invoked from event-bus handlers.
    # ------------------------------------------------------------------

    async def record_from_event(self, event: Event) -> LessonCandidate | None:
        """Build a PENDING candidate from an event (or return None if the
        event lacks the minimum signals to teach us anything)."""

        source = EVENT_TO_SOURCE.get(event.event_type)
        if source is None:
            return None
        if event.tenant_id is None:
            return None

        # Build evidence from the payload — surface the links, not the values.
        evidence: list[dict[str, Any]] = []
        payload = event.payload or {}
        for ref in payload.get("evidence") or []:
            if isinstance(ref, dict):
                evidence.append(ref)
        if not evidence and payload:
            # Last resort: serialize a tiny summary so the steward has a trail.
            evidence.append(
                {
                    "ref_type": "audit_event",
                    "ref_id": str(event.event_id),
                    "summary": event.event_type.value,
                }
            )

        candidate = LessonCandidate(
            tenant_id=UUID(str(event.tenant_id)),
            project_id=(
                UUID(str(event.project_id))
                if event.project_id is not None
                else None
            ),
            run_id=(
                UUID(str(payload.get("run_id")))
                if payload.get("run_id")
                else None
            ),
            source_event=source.value,
            status=LessonStatus.PENDING,
            title=_derive_title(event),
            body=_derive_body(event),
            proposed_skill_name=payload.get("proposed_skill_name"),
            evidence={"links": evidence},
            created_at=datetime.now(timezone.utc),
        )
        factory = self._factory
        if factory is None:
            from app.db.session import get_session_factory

            factory = get_session_factory()
        async with factory() as session:
            session.add(candidate)
            await session.commit()
            await session.refresh(candidate)
        logger.info(
            "lesson.candidate.recorded",
            candidate_id=str(candidate.id),
            source=source.value,
            tenant_id=str(candidate.tenant_id),
        )
        return candidate


def _to_wire(row: LessonCandidate) -> LessonCandidateWire:
    return LessonCandidateWire(
        id=row.id,
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        run_id=row.run_id,
        source_event=row.source_event,  # type: ignore[arg-type]
        title=row.title,
        body=row.body,
        proposed_skill_name=row.proposed_skill_name,
        evidence=[
            LessonEvidenceRef(
                ref_type=ref.get("ref_type", "audit_event"),  # type: ignore[arg-type]
                ref_id=str(ref.get("ref_id", "")),
                summary=str(ref.get("summary", "")),
            )
            for ref in (row.evidence or {}).get("links", [])
            if isinstance(ref, dict)
        ],
        status=row.status.value,  # type: ignore[arg-type]
        promoted_template_id=row.promoted_template_id,
        decided_by=row.decided_by,
        decided_at=row.decided_at,
        review_notes=row.review_notes,
        created_at=row.created_at,
    )


# --- Subscriber registry --------------------------------------------------- #


async def _make_candidate_from_event(event: Event) -> None:
    svc = LessonService()
    try:
        await svc.record_from_event(event)
    except Exception as exc:  # noqa: BLE001
        # Subscriber must never bring down the bus; log and move on.
        logger.warning("lesson.subscriber_error", error=str(exc), event=event.event_type.value)


def register(bus: EventBus | None = None) -> None:
    """Attach lesson subscribers to the bus. Idempotent only at the
    process level — caller responsibility (matches alerts.py)."""

    target = bus or default_bus
    target.subscribe(EventType.RUN_ROLLOBACK, _make_candidate_from_event)
    target.subscribe(EventType.DEPLOYMENT_REVERTED, _make_candidate_from_event)
    target.subscribe(EventType.METRIC_DEGRADED, _make_candidate_from_event)
    target.subscribe(EventType.RUN_BAD_OUTCOME, _make_candidate_from_event)
    target.subscribe(EventType.AGENT_RUN_FAILED, _make_candidate_from_event)
    target.subscribe(EventType.WORKFLOW_RUN_FAILED, _make_candidate_from_event)
    logger.info("lesson_service.registered")


__all__ = ["LessonService", "register"]
