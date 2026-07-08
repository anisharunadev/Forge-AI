"""Roadmap Generation service (F-205).

Pulls top-scored ideas from a project, groups them by inferred theme,
and orders by total score. Supports regenerate, add/remove items, and
approve (with event emission).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import (
    Idea,
    IdeaAnalysis,
    IdeaStatus,
    OpportunityScore,
    Roadmap,
    RoadmapHorizon,
    RoadmapStatus,
)
from app.db.session import get_session_factory
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)


@dataclass
class RoadmapItemDraft:
    idea_id: UUID
    theme: str
    total_score: float
    note: str | None = None

    def to_dict(self, position: int) -> dict[str, Any]:
        return {
            "idea_id": str(self.idea_id),
            "position": position,
            "theme": self.theme,
            "total_score": self.total_score,
            "note": self.note,
        }


# ---------------------------------------------------------------------------
# Theme inference
# ---------------------------------------------------------------------------


_THEME_KEYWORDS: dict[str, tuple[str, ...]] = {
    "growth": ("growth", "acquisition", "funnel", "conversion", "retention", "onboard"),
    "reliability": ("reliability", "stability", "uptime", "sla", "resilience", "incident"),
    "platform": ("platform", "infra", "kubernetes", "ci", "build", "deploy", "observability"),
    "ai": ("ai", "llm", "ml", "model", "agent", "rag", "embedding", "neural"),
    "ux": ("ux", "ui", "design", "accessibility", "usability", "interaction"),
    "compliance": ("compliance", "audit", "soc2", "gdpr", "policy", "governance", "security"),
    "monetization": ("pricing", "billing", "revenue", "subscription", "plan", "tier"),
    "integration": ("integration", "connector", "sync", "import", "export", "webhook"),
}


def _infer_theme(idea: Idea, analysis: IdeaAnalysis | None) -> str:
    haystack = ((idea.title or "") + " " + (idea.description or "")).lower()
    if analysis is not None:
        haystack += " " + " ".join(
            analysis.tags_as_text() if hasattr(analysis, "tags_as_text") else []
        )  # noqa: E501
        haystack += " " + (analysis.summary or "").lower()
    best_theme = "general"
    best_score = 0
    for theme, kws in _THEME_KEYWORDS.items():
        score = sum(1 for kw in kws if kw in haystack)
        if score > best_score:
            best_theme = theme
            best_score = score
    return best_theme


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RoadmapGenerator:
    """Tenant-scoped roadmap composition."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def generate_roadmap(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str,
        horizon: str = "now",
        top_n: int = 10,
        name: str | None = None,
        theme: str = "general",
        actor_id: UUID | str,
    ) -> Roadmap:
        try:
            horizon_enum = RoadmapHorizon(horizon)
        except ValueError:
            horizon_enum = RoadmapHorizon.NOW

        drafts = await self._collect_top_ideas(
            tenant_id=tenant_id,
            project_id=project_id,
            top_n=top_n,
        )

        # Group by theme, sort each group by score desc, then flatten.
        by_theme: dict[str, list[RoadmapItemDraft]] = defaultdict(list)
        for d in drafts:
            by_theme[d.theme].append(d)
        for theme_key in sorted(by_theme.keys()):
            by_theme[theme_key].sort(key=lambda x: x.total_score, reverse=True)

        items: list[dict[str, Any]] = []
        position = 0
        # Order themes by the highest-scoring item within each so that
        # the most impactful work appears first regardless of theme label.
        for _theme_key, drafts in sorted(
            by_theme.items(),
            key=lambda kv: max(d.total_score for d in kv[1]),
            reverse=True,
        ):
            for draft in drafts:
                items.append(draft.to_dict(position=position))
                position += 1

        # Default name if not provided.
        if not name:
            stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
            name = f"Roadmap {horizon_enum.value} {stamp}"

        factory = get_session_factory()
        async with factory() as session:
            roadmap = Roadmap(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                name=name,
                horizon=horizon_enum,
                theme=theme,
                status=RoadmapStatus.DRAFT,
                items=items,
                generated_by=str(actor_id),
            )
            session.add(roadmap)
            await session.commit()
            await session.refresh(roadmap)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "roadmap",
                "roadmap_id": str(roadmap.id),
                "items_count": len(items),
                "horizon": horizon_enum.value,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        logger.info(
            "ideation.roadmap_generated",
            roadmap_id=str(roadmap.id),
            items=len(items),
            tenant_id=str(tenant_id),
        )
        return roadmap

    async def regenerate_roadmap(
        self,
        roadmap_id: UUID | str,
        *,
        tenant_id: UUID | str,
        top_n: int | None = None,
        actor_id: UUID | str | None = None,
    ) -> Roadmap:
        existing = await self._load_roadmap(roadmap_id, tenant_id=tenant_id)
        n = top_n or max(1, len(existing.items))
        drafts = await self._collect_top_ideas(
            tenant_id=tenant_id,
            project_id=existing.project_id,
            top_n=n,
        )
        by_theme: dict[str, list[RoadmapItemDraft]] = defaultdict(list)
        for d in drafts:
            by_theme[d.theme].append(d)
        for theme_key in sorted(by_theme.keys()):
            by_theme[theme_key].sort(key=lambda x: x.total_score, reverse=True)
        items: list[dict[str, Any]] = []
        position = 0
        for _theme_key, drafts_in_theme in sorted(
            by_theme.items(),
            key=lambda kv: max(d.total_score for d in kv[1]),
            reverse=True,
        ):
            for draft in drafts_in_theme:
                items.append(draft.to_dict(position=position))
                position += 1

        factory = get_session_factory()
        async with factory() as session:
            roadmap = await session.get(Roadmap, str(roadmap_id))
            if roadmap is None or str(roadmap.tenant_id) != str(tenant_id):
                raise LookupError("roadmap_not_found")
            roadmap.items = items
            roadmap.status = RoadmapStatus.DRAFT
            await session.commit()
            await session.refresh(roadmap)
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "roadmap",
                "roadmap_id": str(roadmap.id),
                "regenerated": True,
                "items_count": len(items),
            },
            tenant_id=tenant_id,
            project_id=roadmap.project_id,
            actor_id=actor_id,
        )
        return roadmap

    async def add_to_roadmap(
        self,
        roadmap_id: UUID | str,
        idea_id: UUID | str,
        position: int | None = None,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
        note: str | None = None,
    ) -> Roadmap:
        roadmap = await self._load_roadmap(roadmap_id, tenant_id=tenant_id)
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        score = await self._latest_score(idea.id)
        analysis = await self._latest_analysis(idea.id)
        theme = _infer_theme(idea, analysis)
        total = score.total_score if score is not None else 0.0

        items = list(roadmap.items or [])
        # Remove any existing entry for the same idea so we can re-insert.
        items = [it for it in items if str(it.get("idea_id")) != str(idea.id)]
        # If a position was specified, clamp it; otherwise append.
        insert_at = position if position is not None else len(items)
        insert_at = max(0, min(insert_at, len(items)))

        new_entry = {
            "idea_id": str(idea.id),
            "position": insert_at,
            "theme": theme,
            "total_score": total,
            "note": note,
        }
        items.insert(insert_at, new_entry)
        # Re-number positions so they stay 0..N-1.
        for idx, entry in enumerate(items):
            entry["position"] = idx

        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Roadmap, str(roadmap_id))
            if row is None or str(row.tenant_id) != str(tenant_id):
                raise LookupError("roadmap_not_found")
            row.items = items
            await session.commit()
            await session.refresh(row)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "roadmap",
                "roadmap_id": str(row.id),
                "added_idea_id": str(idea.id),
                "position": insert_at,
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    async def remove_from_roadmap(
        self,
        roadmap_id: UUID | str,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> Roadmap:
        roadmap = await self._load_roadmap(roadmap_id, tenant_id=tenant_id)
        items = [it for it in (roadmap.items or []) if str(it.get("idea_id")) != str(idea_id)]
        for idx, entry in enumerate(items):
            entry["position"] = idx

        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Roadmap, str(roadmap_id))
            if row is None or str(row.tenant_id) != str(tenant_id):
                raise LookupError("roadmap_not_found")
            row.items = items
            await session.commit()
            await session.refresh(row)
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "roadmap",
                "roadmap_id": str(row.id),
                "removed_idea_id": str(idea_id),
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    async def approve_roadmap(
        self,
        roadmap_id: UUID | str,
        actor_id: UUID | str,
        *,
        tenant_id: UUID | str,
    ) -> Roadmap:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Roadmap, str(roadmap_id))
            if row is None or str(row.tenant_id) != str(tenant_id):
                raise LookupError("roadmap_not_found")
            row.status = RoadmapStatus.APPROVED
            row.approved_by = str(actor_id)
            await session.commit()
            await session.refresh(row)

        # Mark all included ideas as IN_ROADMAP for downstream consumption.
        await self._mark_ideas_in_roadmap(
            idea_ids=[UUID(str(it["idea_id"])) for it in (row.items or []) if it.get("idea_id")],
            tenant_id=tenant_id,
        )

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "domain": "ideation",
                "kind": "roadmap",
                "roadmap_id": str(row.id),
                "status": "approved",
                "approver": str(actor_id),
            },
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    async def list_roadmaps(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        limit: int = 100,
    ) -> list[Roadmap]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Roadmap).where(Roadmap.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(Roadmap.project_id == str(project_id))
            stmt = stmt.order_by(Roadmap.created_at.desc()).limit(max(1, min(limit, 500)))
            return list((await session.execute(stmt)).scalars().all())

    async def get_roadmap(self, roadmap_id: UUID | str, *, tenant_id: UUID | str) -> Roadmap:
        return await self._load_roadmap(roadmap_id, tenant_id=tenant_id)

    async def update_roadmap(
        self,
        roadmap_id: UUID | str,
        *,
        tenant_id: UUID | str,
        name: str | None = None,
        theme: str | None = None,
        items: list[dict[str, Any]] | None = None,
        actor_id: UUID | str | None = None,
    ) -> Roadmap:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Roadmap, str(roadmap_id))
            if row is None or str(row.tenant_id) != str(tenant_id):
                raise LookupError("roadmap_not_found")
            if name is not None:
                row.name = name
            if theme is not None:
                row.theme = theme
            if items is not None:
                # Re-number positions.
                for idx, entry in enumerate(items):
                    entry["position"] = idx
                row.items = items
            await session.commit()
            await session.refresh(row)
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {"domain": "ideation", "kind": "roadmap", "roadmap_id": str(row.id)},
            tenant_id=tenant_id,
            project_id=row.project_id,
            actor_id=actor_id,
        )
        return row

    # -- internals --------------------------------------------------------

    async def _collect_top_ideas(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        top_n: int,
    ) -> list[RoadmapItemDraft]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Idea).where(
                Idea.tenant_id == str(tenant_id),
                Idea.project_id == str(project_id),
            )
            ideas = list((await session.execute(stmt)).scalars().all())

        # Pull latest score and analysis per idea in batch.
        scored: list[tuple[Idea, OpportunityScore | None, IdeaAnalysis | None]] = []
        for idea in ideas:
            score = await self._latest_score(idea.id)
            analysis = await self._latest_analysis(idea.id)
            scored.append((idea, score, analysis))

        # Order by total_score desc; ideas without scores get 0.
        scored.sort(
            key=lambda t: t[1].total_score if t[1] else 0.0,
            reverse=True,
        )

        drafts: list[RoadmapItemDraft] = []
        for idea, score, analysis in scored[: max(1, top_n)]:
            theme = _infer_theme(idea, analysis)
            drafts.append(
                RoadmapItemDraft(
                    idea_id=idea.id,
                    theme=theme,
                    total_score=score.total_score if score else 0.0,
                    note=None,
                )
            )
        return drafts

    async def _load_roadmap(self, roadmap_id: UUID | str, *, tenant_id: UUID | str) -> Roadmap:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Roadmap, str(roadmap_id))
            if row is None:
                raise LookupError(f"roadmap {roadmap_id} not found")
            if str(row.tenant_id) != str(tenant_id):
                raise PermissionError("roadmap_not_in_tenant")
            return row

    async def _load_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea

    async def _latest_score(self, idea_id: UUID | str) -> OpportunityScore | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(OpportunityScore).where(OpportunityScore.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.scored_at, reverse=True)
        return rows[0]

    async def _latest_analysis(self, idea_id: UUID | str) -> IdeaAnalysis | None:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(IdeaAnalysis).where(IdeaAnalysis.idea_id == str(idea_id))
            rows = list((await session.execute(stmt)).scalars().all())
        if not rows:
            return None
        rows.sort(key=lambda r: r.analyzed_at, reverse=True)
        return rows[0]

    async def _mark_ideas_in_roadmap(self, *, idea_ids: list[UUID], tenant_id: UUID | str) -> None:
        if not idea_ids:
            return
        factory = get_session_factory()
        async with factory() as session:
            for raw in idea_ids:
                idea = await session.get(Idea, str(raw))
                if idea is None or str(idea.tenant_id) != str(tenant_id):
                    continue
                idea.status = IdeaStatus.IN_ROADMAP
            await session.commit()


roadmap_generator = RoadmapGenerator()


__all__ = ["RoadmapGenerator", "roadmap_generator"]
