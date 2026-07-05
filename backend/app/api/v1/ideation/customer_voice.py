"""Customer Voice REST endpoints (F-262, M4-G3).

REST surface over the customer-voice cluster projection. The Customer
Voice tab groups ``ideation_source_signals`` rows by NLP topic and
surfaces one cluster per topic with sentiment + frequency aggregates.

The cluster computation is intentionally simple for M4: we use the
synthesizer's keyword-overlap grouping (``_cluster_by_keywords``)
over the tenant's signals and aggregate a sentiment score as the mean
of a per-row sentiment approximation (1.0 for signals with the
``pain`` tag, -1.0 for ``love`` tag, 0.0 otherwise — heuristic only).

A more sophisticated clustering (embeddings + k-means) lands in M12.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.ideation_signal import IdeaSourceSignal
from app.db.session import get_session_factory
from app.schemas.customer_voice import CustomerClusterRead

logger = get_logger(__name__)

router = APIRouter(prefix="/ideation/customer-voice", tags=["ideation"])


# ---------------------------------------------------------------------------
# Clustering helper
# ---------------------------------------------------------------------------


# Per-signal sentiment approximation. Real sentiment scoring is M12;
# we use these tag cues so the wire shape is meaningful today.
def _sentiment_for(tags: list[str] | None) -> float:
    if not tags:
        return 0.0
    sentiment = 0.0
    for tag in tags:
        t = str(tag).lower()
        if t in {"pain", "frustrated", "angry", "complaint", "bug"}:
            sentiment -= 1.0
        elif t in {"love", "praise", "happy", "win", "delight"}:
            sentiment += 1.0
    # Normalize to [-1, 1].
    if sentiment == 0.0:
        return 0.0
    return max(-1.0, min(1.0, sentiment / max(1, abs(sentiment))))


def _cluster_signals(
    signals: list[IdeaSourceSignal],
) -> list[CustomerClusterRead]:
    """Cluster signals by title-keyword overlap (mirrors the synthesizer)."""
    if not signals:
        return []

    # Import the synthesizer's helpers — they're the canonical
    # clustering primitive and we want the two surfaces to agree.
    from app.services.ideation.sources.synthesizer import (  # noqa: PLC0415
        _KEYWORD_OVERLAP_MIN,
        _keyword_overlap,
    )

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
            if _keyword_overlap(
                signals[i].title or "", signals[j].title or ""
            ) >= _KEYWORD_OVERLAP_MIN:
                union(i, j)

    groups: dict[int, list[IdeaSourceSignal]] = defaultdict(list)
    for i, sig in enumerate(signals):
        groups[find(i)].append(sig)

    clusters: list[CustomerClusterRead] = []
    tenant_id = str(signals[0].tenant_id)
    project_id = signals[0].project_id
    for grp in groups.values():
        if not grp:
            continue
        # Topic = the most common non-trivial keyword across titles.
        from collections import Counter  # noqa: PLC0415

        word_counts: Counter[str] = Counter()
        for s in grp:
            for word in (s.title or "").lower().split():
                w = word.strip(".,;:!?\"'()[]{}<>*&^%$#@`~")
                if len(w) > 3 and w not in {
                    "the", "and", "for", "with", "this", "that", "from",
                    "into", "have", "are", "was", "were", "but", "not",
                }:
                    word_counts[w] += 1
        if word_counts:
            topic = word_counts.most_common(1)[0][0]
        else:
            topic = (grp[0].title or "").split(" ", 1)[0] or "general"

        # Sentiment = mean of per-signal sentiment approximations.
        sentiments = [_sentiment_for(s.tags) for s in grp]
        mean_sentiment = sum(sentiments) / max(1, len(sentiments))
        rep_signals = [s.id for s in grp[:5]]
        last_updated_at = max(
            (s.ingested_at for s in grp if s.ingested_at is not None),
            default=datetime.now(UTC),
        )
        clusters.append(
            CustomerClusterRead(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                topic=topic,
                sentiment=round(mean_sentiment, 3),
                frequency=len(grp),
                representative_signals=rep_signals,
                last_updated_at=last_updated_at,
                created_at=last_updated_at,
                updated_at=last_updated_at,
            )
        )

    # Stable ordering: most-frequent clusters first.
    clusters.sort(key=lambda c: c.frequency, reverse=True)
    return clusters


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=list[CustomerClusterRead])
@audit(action="ideation.customer_voice.list", target_type="customer_voice")
async def list_customer_clusters(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read")),
) -> list[CustomerClusterRead]:
    """List customer-voice clusters for the tenant.

    Pulls every ``IdeaSourceSignal`` for the tenant+project, groups by
    title-keyword overlap, and returns one cluster per group with
    sentiment + frequency + representative signal ids.
    """
    factory = get_session_factory()
    async with factory() as session:
        stmt = (
            select(IdeaSourceSignal)
            .where(IdeaSourceSignal.tenant_id == str(principal.tenant_id))
            .order_by(IdeaSourceSignal.ingested_at.desc())
            .limit(500)  # hard cap to keep the clusterer bounded
        )
        if project_id is not None:
            stmt = stmt.where(IdeaSourceSignal.project_id == str(project_id))
        else:
            stmt = stmt.where(IdeaSourceSignal.project_id == str(principal.project_id))
        rows = list((await session.execute(stmt)).scalars().all())

    if not rows:
        return []

    clusters = _cluster_signals(rows)
    return clusters[:limit]


__all__ = ["router"]