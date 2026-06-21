"""Terminal Knowledge Context (F-414).

Surfaces inline context items relevant to a running terminal session
— ADRs, API contracts, recent commits, risk registers, recent files,
open tasks. The dashboard polls this every few seconds and shows the
top 10 in a side panel.

Source mix
----------
- :mod:`app.services.artifact_registry` for ADRs / contracts / risks
  (typed artifacts).
- :mod:`app.db.models.audit` for recent commits / PRs that flowed
  through the audit stream (target_type = "commit" | "pr").
- Project intelligence (recent files) — modeled as Artifact type
  ``recent_file`` so we don't add a new table.

Semantic ranking
----------------
We embed the most-recent terminal output chunk + the session's
``pre_seed`` text via LiteLLMClient.embed, then cosine-rank against
pre-computed embeddings of each candidate context item. Embeddings
are cached on the candidate row's payload (``embedding`` field of
Artifact.payload when present) so we don't re-embed the entire corpus
on every poll.

Cache
-----
Per-session LRU keyed by session_id; invalidates after 5 minutes
or when :meth:`refresh_context` is called explicitly.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.artifact import Artifact, ArtifactStatus
from app.db.models.audit import AuditEvent
from app.db.session import get_session_factory
from app.services.artifact_registry import artifact_registry
from app.services.litellm_client import LiteLLMClient
from app.services.terminal.command_integration import command_integration

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

CONTEXT_TYPES: tuple[str, ...] = (
    "adr",
    "api_contract",
    "risk_register",
    "task",
    "commit",
    "pr",
    "recent_file",
)


@dataclass(frozen=True)
class ContextItem:
    """A single inline context card."""

    id: str
    type: str
    title: str
    summary: str
    relevance_score: float
    deep_link: str
    source_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "title": self.title,
            "summary": self.summary,
            "relevance_score": round(self.relevance_score, 4),
            "deep_link": self.deep_link,
            "source_id": self.source_id,
            "extra": dict(self.extra),
        }


@dataclass
class _CacheEntry:
    items: list[ContextItem]
    expires_at: datetime
    query_hash: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cosine(a: list[float], b: list[float]) -> float:
    """Standard cosine similarity with a 1e-12 floor to avoid 0/0."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na < 1e-12 or nb < 1e-12:
        return 0.0
    return dot / (na * nb)


async def _embed(text: str, *, tenant_id: UUID | str, project_id: UUID | str | None) -> list[float]:
    """Wrap LiteLLMClient.embed in a single-text shim."""
    async with LiteLLMClient() as client:
        try:
            vectors = await client.embed(
                texts=[text],
                tenant_id=tenant_id,
                project_id=project_id,
            )
            if vectors:
                return vectors[0]
        except Exception as exc:  # noqa: BLE001 — embedding failures must not break context
            logger.warning("terminal.context.embed_failed", error=str(exc))
    return []


def _hash_query(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class KnowledgeContextService:
    """Pulls and ranks context for a terminal session."""

    CACHE_TTL_SECONDS = 300  # 5 minutes
    TOP_N = 10
    MAX_CANDIDATES = 200

    def __init__(self) -> None:
        self._cache: dict[str, _CacheEntry] = {}
        self._lock = asyncio.Lock()

    # -- public surface ---------------------------------------------------

    async def get_context_for_session(
        self, session_id: str
    ) -> list[ContextItem]:
        """Top-N context items for a session, with cache.

        The cache key is the session_id; the value is invalidated
        every 5 minutes or on :meth:`refresh_context`.
        """
        async with self._lock:
            entry = self._cache.get(session_id)
            if entry is not None and entry.expires_at > datetime.now(timezone.utc):
                return entry.items

        session = await command_integration._buffer_for(session_id)  # type: ignore[attr-defined]
        # We don't need the buffer itself, just want to confirm session exists.
        # The CommandIntegration holds session metadata via session_manager; pull from there.
        from app.terminal.session_manager import session_manager

        sess = await session_manager.get_session(session_id)
        if sess is None:
            return []

        query_text = await self._build_query_text(sess.metadata.get("pre_seed", ""), session_id)
        items = await self._rank(query_text, sess.tenant_id, sess.project_id)
        async with self._lock:
            self._cache[session_id] = _CacheEntry(
                items=items,
                expires_at=datetime.now(timezone.utc) + timedelta(seconds=self.CACHE_TTL_SECONDS),
                query_hash=_hash_query(query_text),
            )
        return items

    async def refresh_context(self, session_id: str) -> list[ContextItem]:
        """Drop cache and re-rank."""
        async with self._lock:
            self._cache.pop(session_id, None)
        return await self.get_context_for_session(session_id)

    async def get_context_item(
        self, session_id: str, item_id: str
    ) -> ContextItem | None:
        """Find a specific context item (full form) by id."""
        for item in await self.get_context_for_session(session_id):
            if item.id == item_id:
                return item
        return None

    # -- query construction ----------------------------------------------

    async def _build_query_text(self, pre_seed: str, session_id: str) -> str:
        """Combine pre-seed text with the last few output chunks."""
        from app.services.terminal.command_integration import command_integration

        buf = command_integration._buffers.get(session_id)
        recent_output = ""
        if buf is not None:
            tail = list(buf.chunks)[-3:]
            recent_output = "\n".join(c.data.decode("utf-8", errors="replace") for c in tail)
        bits = [pre_seed.strip(), recent_output.strip()]
        return "\n".join(b for b in bits if b)

    # -- ranking ----------------------------------------------------------

    async def _rank(
        self,
        query_text: str,
        tenant_id: str,
        project_id: str,
    ) -> list[ContextItem]:
        """Build candidate set, embed, cosine-rank, return top N."""
        candidates = await self._gather_candidates(tenant_id, project_id)
        if not candidates:
            return []
        if not query_text.strip():
            # Without a query, surface the most recent items in stable order.
            return candidates[: self.TOP_N]

        query_vec = await _embed(
            query_text, tenant_id=tenant_id, project_id=project_id
        )
        scored: list[ContextItem] = []
        for item in candidates:
            vec = item.extra.get("embedding") if isinstance(item.extra, dict) else None
            score = item.relevance_score
            if query_vec and isinstance(vec, list) and vec:
                score = _cosine(query_vec, vec)
            scored.append(
                ContextItem(
                    id=item.id,
                    type=item.type,
                    title=item.title,
                    summary=item.summary,
                    relevance_score=max(0.0, min(1.0, score)),
                    deep_link=item.deep_link,
                    source_id=item.source_id,
                    extra={k: v for k, v in item.extra.items() if k != "embedding"}
                    if isinstance(item.extra, dict)
                    else item.extra,
                )
            )
        scored.sort(key=lambda i: i.relevance_score, reverse=True)
        return scored[: self.TOP_N]

    # -- candidate gathering ----------------------------------------------

    async def _gather_candidates(
        self, tenant_id: str, project_id: str
    ) -> list[ContextItem]:
        """Combine Artifact rows (ADRs, contracts, risks) + audit-stream
        commits/PRs + any project-intelligence artifacts into one list."""
        items: list[ContextItem] = []

        # Artifact-typed items
        artifact_types = ("adr", "api_contract", "risk_register", "task", "recent_file")
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(Artifact)
                .where(
                    Artifact.tenant_id == tenant_id,
                    Artifact.project_id == project_id,
                    Artifact.type.in_(artifact_types),
                    Artifact.status == ArtifactStatus.ACTIVE,
                )
                .order_by(Artifact.created_at.desc())
                .limit(self.MAX_CANDIDATES)
            )
            rows = list((await session.execute(stmt)).scalars().all())

        for art in rows:
            payload = dict(art.payload or {})
            items.append(
                ContextItem(
                    id=f"artifact:{art.id}",
                    type=art.type,
                    title=str(payload.get("title") or art.type.upper()),
                    summary=str(payload.get("summary") or payload.get("description") or ""),
                    relevance_score=float(payload.get("relevance", 0.5)),
                    deep_link=payload.get("deep_link") or f"/artifacts/{art.id}",
                    source_id=str(art.id),
                    extra={**payload, "embedding": payload.get("embedding")},
                )
            )

        # Audit-stream commits / PRs — last 50 of each, regardless of artifact status.
        async with factory() as session:
            stmt = (
                select(AuditEvent)
                .where(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.project_id == project_id,
                    AuditEvent.target_type.in_(("commit", "pr")),
                )
                .order_by(AuditEvent.occurred_at.desc())
                .limit(50)
            )
            events = list((await session.execute(stmt)).scalars().all())
        for ev in events:
            payload = dict(ev.payload or {})
            kind = ev.target_type
            title = str(
                payload.get("title")
                or payload.get("message")
                or f"{kind}:{ev.target_id}"
            )
            items.append(
                ContextItem(
                    id=f"{kind}:{ev.id}",
                    type=kind,
                    title=title,
                    summary=str(payload.get("summary") or payload.get("body") or ""),
                    relevance_score=float(payload.get("relevance", 0.4)),
                    deep_link=payload.get("deep_link") or f"/{kind}s/{ev.target_id}",
                    source_id=str(ev.target_id),
                    extra=dict(payload),
                )
            )
        return items


knowledge_context = KnowledgeContextService()


__all__ = [
    "KnowledgeContextService",
    "ContextItem",
    "CONTEXT_TYPES",
    "knowledge_context",
]
