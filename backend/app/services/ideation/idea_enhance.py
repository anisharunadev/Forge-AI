"""PM ``Enhance`` service (Pillar 1 — Phase 2).

The PM-driven Enhance flow lets a product manager add free-form
feedback to an idea's analysis, then re-run the LLM with that note
folded into the prompt. The flow is:

1. Look up the idea (tenant-scoped).
2. Find the latest ``IdeaAnalysis`` for the idea. If none exists,
   ``IdeaAnalysisService.analyze_idea(force=True)`` will create a
   fresh one.
3. Stamp the editor_note on the analysis BEFORE re-running (we pass
   the note through ``analyze_idea(..., editor_note=...)`` and the
   service writes it on the new row).
4. Set ``Idea.status = IdeaStatus.ANALYZING`` so the UI reflects the
   in-progress state.
5. Call the existing analysis service to re-run the LLM.
6. Record ``AuditService.record(action="ideation.enhance", ...)``
   with editor_note length + the model that actually ran (Rule 6).

The service is intentionally a thin orchestrator on top of
``idea_analysis_service``. It does NOT register event subscribers —
status updates post back to Jira via the in-process bus subscribers
in ``jira_status_subscribers.py`` (wired in ``app.main.lifespan``).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db.models.ideation import Idea, IdeaAnalysis, IdeaStatus
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.ideation.idea_analysis import idea_analysis_service

logger = get_logger(__name__)


# Cap to match ``IdeaEnhanceRequest.editor_note`` max_length. We double-
# check here so a misconfigured caller cannot bloat the DB or the LLM
# prompt. The schema already enforces this for HTTP callers; services
# that build their own request bypass the schema.
_EDITOR_NOTE_MAX = 2000
_EDITOR_NOTE_MIN = 1


class IdeaEnhanceService:
    """PM-driven re-analysis of an Idea with editor feedback."""

    async def enhance(
        self,
        *,
        idea_id: UUID | str,
        tenant_id: UUID | str,
        editor_note: str,
        actor_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> IdeaAnalysis:
        """Stamp ``editor_note`` + re-run analysis on the idea.

        Returns the freshly-persisted ``IdeaAnalysis`` so the endpoint
        can return it as ``IdeaAnalysisRead``.
        """
        # Defensive validation — schema enforces this for HTTP callers
        # but services may invoke us directly.
        if editor_note is None or len(editor_note.strip()) < _EDITOR_NOTE_MIN:
            raise ValueError("editor_note_too_short")
        if len(editor_note) > _EDITOR_NOTE_MAX:
            raise ValueError(f"editor_note_too_long:>{_EDITOR_NOTE_MAX}")

        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id

        # Mark the idea as ANALYZING immediately so the UI shows
        # in-progress state. We persist this BEFORE re-running the LLM
        # so a slow re-analysis doesn't leave the row in its old status.
        await self._transition_idea_status(
            idea.id, IdeaStatus.ANALYZING, tenant_id=tenant_id
        )

        # ``analyze_idea(force=True)`` creates a fresh row when one
        # doesn't exist, and re-runs when it does. We pass the
        # ``editor_note`` through so it is folded into the prompt AND
        # stamped on the resulting ``IdeaAnalysis.editor_note`` column.
        analysis = await idea_analysis_service.analyze_idea(
            idea.id,
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
            force=True,
            editor_note=editor_note,
        )

        await audit_service.record(
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
            action="ideation.enhance",
            target_type="idea",
            target_id=str(idea.id),
            payload={
                "editor_note_length": len(editor_note),
                "model_used": analysis.model_used,
                "analysis_id": str(analysis.id),
                "cost_usd": analysis.cost_usd,
            },
            occurred_at=datetime.now(timezone.utc),
        )

        logger.info(
            "ideation.idea_enhanced",
            idea_id=str(idea.id),
            analysis_id=str(analysis.id),
            editor_note_length=len(editor_note),
            model=analysis.model_used,
        )
        return analysis

    # -- internals --------------------------------------------------------

    async def _load_idea(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea

    async def _transition_idea_status(
        self,
        idea_id: UUID | str,
        status: IdeaStatus,
        *,
        tenant_id: UUID | str,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None or str(idea.tenant_id) != str(tenant_id):
                return
            idea.status = status
            await session.commit()


idea_enhance_service = IdeaEnhanceService()


__all__ = ["IdeaEnhanceService", "idea_enhance_service"]
