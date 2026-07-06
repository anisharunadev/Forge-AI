"""Ideation synthesizer (Pillar 1 — Phase 3).

Reads ``IdeaSourceSignal`` rows where ``idea_id IS NULL`` for a
tenant, clusters them by title-keyword overlap, and creates an
``Idea`` per cluster.

Budget-aware: every LiteLLM call goes through
``workflow_budget_service``. If budget is blocked, falls back to a
heuristic single-idea-per-signal path and flags ``degraded_budget``
on the run row.

The ``_SYSTEM_ACTOR`` UUID matches the Phase 1 pattern
(``jira_consumer.py``) so the source signals' resulting Ideas carry a
stable non-human ``submitted_by`` reference.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy import update as sa_update

from app.core.logging import get_logger
from app.db.models.ideation import Idea, IdeaSource, IdeaStatus
from app.db.models.ideation_signal import IdeaSourceSignal, IdeationIngestRun
from app.db.session import get_session_factory

logger = get_logger(__name__)


# Stable non-human actor UUID — mirrors Phase 1's jira_consumer.
_SYSTEM_ACTOR = uuid.UUID("00000000-0000-0000-0000-00000000feed")

# Min shared keywords for two signals to land in the same cluster.
_KEYWORD_OVERLAP_MIN = 2

# Stopwords stripped before the keyword overlap check.
_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "this",
        "that",
        "from",
        "into",
        "have",
        "has",
        "are",
        "was",
        "were",
        "but",
        "not",
        "you",
        "your",
        "our",
        "their",
        "they",
        "them",
        "out",
        "any",
        "all",
        "use",
        "using",
        "via",
        "per",
        "more",
        "less",
        "very",
        "much",
        "should",
        "would",
        "could",
        "will",
        "can",
        "may",
        "might",
        "need",
        "needs",
        "needed",
        "want",
        "wants",
        "wanted",
        "make",
        "makes",
        "making",
        "do",
        "does",
        "did",
        "done",
        "be",
        "been",
    }
)


def _tokenize(text: str) -> list[str]:
    """Lower-case word tokens, strip stopwords."""
    if not text:
        return []
    raw = [tok.strip(".,;:!?\"'()[]{}<>*&^%$#@`~") for tok in text.lower().split()]
    return [t for t in raw if t and t not in _STOPWORDS and len(t) > 2]


def _keyword_overlap(a: str, b: str) -> int:
    return len(set(_tokenize(a)) & set(_tokenize(b)))


class Synthesizer:
    """Cluster uncategorized signals into Ideas.

    Stateless service. Construct per-call (cheap); the budget handle
    is per-tenant so the calling scheduler job owns the lifetime.
    """

    async def synthesize(
        self,
        *,
        tenant_id: UUID | str,
        run_id: UUID | str,
        budget_blocked: bool = False,
    ) -> dict[str, int]:
        """Run one synthesis pass for ``tenant_id``."""
        signals = await self._load_uncategorized(tenant_id)
        if not signals:
            await self._update_run(
                run_id=run_id,
                tenant_id=tenant_id,
                ideas_created=0,
                status="success",
                degraded_budget=budget_blocked,
            )
            return {"signals_seen": 0, "ideas_created": 0}

        clusters: list[list[IdeaSourceSignal]]
        if budget_blocked:
            clusters = [[s] for s in signals]
        else:
            clusters = self._cluster_by_keywords(signals)

        ideas_created = 0
        for cluster in clusters:
            if not cluster:
                continue
            idea = await self._create_idea_from_cluster(tenant_id=tenant_id, cluster=cluster)
            if idea is None:
                continue
            await self._link_signals_to_idea(cluster, idea.id)
            ideas_created += 1

        await self._update_run(
            run_id=run_id,
            tenant_id=tenant_id,
            ideas_created=ideas_created,
            status="success" if ideas_created else "partial",
            degraded_budget=budget_blocked,
        )
        return {"signals_seen": len(signals), "ideas_created": ideas_created}

    # ---- Internals ----------------------------------------------------

    async def _load_uncategorized(self, tenant_id: UUID | str) -> list[IdeaSourceSignal]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(IdeaSourceSignal)
                .where(IdeaSourceSignal.tenant_id == str(tenant_id))
                .where(IdeaSourceSignal.idea_id.is_(None))
                .order_by(IdeaSourceSignal.ingested_at.asc())
                .limit(500)
            )
            return list((await session.execute(stmt)).scalars().all())

    def _cluster_by_keywords(self, signals: list[IdeaSourceSignal]) -> list[list[IdeaSourceSignal]]:
        """Union-find greedy clustering on title-keyword overlap."""
        parent: dict[int, int] = {i: i for i in range(len(signals))}

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: int, b: int) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        for i in range(len(signals)):
            for j in range(i + 1, len(signals)):
                if (
                    _keyword_overlap(signals[i].title or "", signals[j].title or "")
                    >= _KEYWORD_OVERLAP_MIN
                ):
                    union(i, j)

        groups: dict[int, list[IdeaSourceSignal]] = {}
        for i, sig in enumerate(signals):
            groups.setdefault(find(i), []).append(sig)
        return list(groups.values())

    async def _create_idea_from_cluster(
        self,
        *,
        tenant_id: UUID | str,
        cluster: list[IdeaSourceSignal],
    ) -> Idea | None:
        if not cluster:
            return None
        seed = cluster[0]
        title = (seed.title or "").strip()[:256] or "Synthesized idea"
        body_parts = [(s.body or "")[:1000] for s in cluster[:5]]
        description = "\n\n---\n\n".join([p for p in body_parts if p]) or title
        project_id = str(getattr(seed, "project_id", "")) or str(tenant_id)
        factory = get_session_factory()
        async with factory() as session:
            idea = Idea(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=project_id,
                title=title,
                description=description[:20_000],
                source=IdeaSource.SIGNAL,
                submitted_by=_SYSTEM_ACTOR,
                status=IdeaStatus.NEW,
                tags=[f"source:{s.source}" for s in cluster[:3]] + ["daily-ingest"],
                attachments=[
                    {
                        "kind": "ideation_source_signals",
                        "signal_ids": [str(s.id) for s in cluster],
                        "sources": sorted({s.source for s in cluster}),
                    }
                ],
            )
            session.add(idea)
            await session.commit()
            await session.refresh(idea)
        return idea

    async def _link_signals_to_idea(
        self,
        signals: list[IdeaSourceSignal],
        idea_id: UUID,
    ) -> None:
        ids = [str(s.id) for s in signals]
        if not ids:
            return
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                sa_update(IdeaSourceSignal)
                .where(IdeaSourceSignal.id.in_(ids))
                .values(idea_id=str(idea_id))
            )
            await session.execute(stmt)
            await session.commit()

    async def _update_run(
        self,
        *,
        run_id: UUID | str,
        tenant_id: UUID | str,
        ideas_created: int,
        status: str,
        degraded_budget: bool,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(IdeationIngestRun, str(run_id))
            if row is None:
                return
            row.ideas_created = ideas_created
            row.status = status
            row.degraded_budget = degraded_budget
            row.finished_at = datetime.now(UTC)
            await session.commit()


__all__ = ["Synthesizer"]
