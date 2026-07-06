"""Q&A service backed by RAG over the knowledge graph (F-108).

Pipeline:
    question → vector search (KG embeddings) + cypher matches →
    context block → LiteLLM chat → answer + sources + confidence.

Conversation state lives in memory for Phase 6; persistence lands in
the next iteration (the API still returns a stable `session_id` so
clients can poll).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.services.cost_ledger import cost_ledger
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus
from app.services.knowledge_graph import Node, knowledge_graph_service
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


@dataclass
class QASource:
    kind: str
    reference: str
    snippet: str | None
    score: float | None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Answer:
    answer: str
    sources: list[QASource]
    confidence: float
    follow_ups: list[str]
    session_id: UUID
    model: str | None


@dataclass
class Message:
    id: UUID
    role: str  # user | assistant
    content: str
    sources: list[QASource]
    created_at: datetime


class QAService:
    """Tenant-scoped RAG over the knowledge graph."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus
        self._kg = knowledge_graph_service
        self._sessions: dict[UUID, list[Message]] = {}

    async def answer_question(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        question: str,
        session_id: UUID | None = None,
        context_filters: dict[str, Any] | None = None,
        actor_id: UUID | str | None = None,
    ) -> Answer:
        session_id = session_id or uuid.uuid4()
        history = self._sessions.setdefault(session_id, [])

        # 1. Vector search over the KG.
        embedding = await self._embed_question(
            question=question,
            tenant_id=tenant_id,
            project_id=project_id,
        )
        nodes = await self._kg.vector_search(
            embedding=embedding,
            top_k=5,
            tenant_id=tenant_id,
            project_id=project_id,
            node_type=context_filters.get("node_type") if context_filters else None,
        )

        # 2. Simple cypher-over-SQL fallback for keyword recall.
        keyword_rows = await self._kg.query_sql(
            "SELECT id, name, node_type, properties FROM kg_nodes "
            "WHERE LOWER(name) LIKE :q LIMIT 25",
            {"q": f"%{question.lower()[:64]}%"},
        )

        sources = self._build_sources(nodes, keyword_rows)
        context_block = self._build_context_block(nodes, keyword_rows)

        # 3. Ask the LLM (graceful fallback when proxy is offline).
        answer_text, model_used = await self._ask_llm(
            question=question,
            context=context_block,
            history=history,
            tenant_id=tenant_id,
            project_id=project_id,
            session_id=session_id,
            actor_id=actor_id,
        )
        confidence = self._estimate_confidence(nodes, keyword_rows, answer_text)
        follow_ups = self._suggest_follow_ups(question, nodes)

        answer = Answer(
            answer=answer_text,
            sources=sources,
            confidence=confidence,
            follow_ups=follow_ups,
            session_id=session_id,
            model=model_used,
        )

        history.append(
            Message(
                id=uuid.uuid4(),
                role="user",
                content=question,
                sources=[],
                created_at=datetime.now(UTC),
            )
        )
        history.append(
            Message(
                id=uuid.uuid4(),
                role="assistant",
                content=answer_text,
                sources=sources,
                created_at=datetime.now(UTC),
            )
        )
        return answer

    def get_conversation_history(self, session_id: UUID | str) -> list[Message]:
        return list(self._sessions.get(UUID(str(session_id)), []))

    def clear_conversation(self, session_id: UUID | str) -> None:
        self._sessions.pop(UUID(str(session_id)), None)

    # -- helpers ----------------------------------------------------------

    async def _embed_question(
        self,
        *,
        question: str,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[float]:
        """Embed via LiteLLM with deterministic fallback for offline mode."""
        try:
            async with LiteLLMClient() as client:
                vectors = await client.embed(
                    [question],
                    tenant_id=tenant_id,
                    project_id=project_id,
                )
                if vectors:
                    return vectors[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("qa.embed_failed", error=str(exc))
        return _deterministic_vector(question, dim=64)

    async def _ask_llm(
        self,
        *,
        question: str,
        context: str,
        history: list[Message],
        tenant_id: UUID | str,
        project_id: UUID | str,
        session_id: UUID,
        actor_id: UUID | str | None,
    ) -> tuple[str, str | None]:
        messages: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": (
                    "You are the Forge Project Intelligence assistant. "
                    "Use the provided knowledge-graph context to answer. "
                    "If the answer is not in the context, say so explicitly."
                ),
            }
        ]
        for m in history[-6:]:
            messages.append({"role": m.role, "content": m.content})
        messages.append(
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {question}",
            }
        )

        try:
            async with LiteLLMClient() as client:
                response = await client.chat(
                    messages,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=actor_id,
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("qa.chat_failed", error=str(exc))
            return _fallback_answer(question, context), None

        model = response.get("model") if isinstance(response, dict) else None
        try:
            text = response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            text = ""
        # Ensure cost is recorded even when the proxy doesn't echo it.
        await cost_ledger.record(
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=session_id,
            model=model or "unknown",
            prompt_tokens=0,
            completion_tokens=0,
            cost_usd=0.0,
            source="qa",
            metadata={"question_len": len(question), "context_len": len(context)},
        )
        await self._bus.publish(
            EventType.AGENT_RUN_COMPLETED,
            {"qa": True, "session_id": str(session_id), "model": model},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return text or _fallback_answer(question, context), model

    def _build_sources(
        self,
        nodes: list[Node],
        keyword_rows: list[dict[str, Any]],
    ) -> list[QASource]:
        sources: list[QASource] = []
        for n in nodes:
            sources.append(
                QASource(
                    kind="node",
                    reference=str(n.id),
                    snippet=n.name,
                    score=None,
                    metadata={"node_type": n.node_type, "properties": n.properties},
                )
            )
        for row in keyword_rows[:5]:
            sources.append(
                QASource(
                    kind="citation",
                    reference=str(row.get("id") or row.get("name") or ""),
                    snippet=str(row.get("name") or row.get("node_type") or ""),
                    score=None,
                    metadata={"node_type": row.get("node_type")},
                )
            )
        return sources[:10]

    def _build_context_block(
        self,
        nodes: list[Node],
        keyword_rows: list[dict[str, Any]],
    ) -> str:
        chunks: list[str] = []
        for n in nodes:
            chunks.append(
                f"[{n.node_type}] {n.name} :: {json.dumps(n.properties, default=str)[:300]}"
            )
        for row in keyword_rows[:10]:
            chunks.append(
                f"[{row.get('node_type', 'node')}] {row.get('name')} :: "
                f"{json.dumps(row.get('properties', {}), default=str)[:200]}"
            )
        return "\n".join(chunks) if chunks else "(no context)"

    def _estimate_confidence(
        self,
        nodes: list[Node],
        keyword_rows: list[dict[str, Any]],
        answer_text: str,
    ) -> float:
        if not nodes and not keyword_rows:
            return 0.1
        if "I don't know" in answer_text or "not in the context" in answer_text.lower():
            return 0.25
        base = min(1.0, 0.4 + 0.1 * len(nodes) + 0.05 * len(keyword_rows))
        return round(base, 2)

    def _suggest_follow_ups(self, question: str, nodes: list[Node]) -> list[str]:
        seeds = [
            "Which services depend on this?",
            "What's the blast radius of changing this?",
            "Are there tests covering it?",
            "Which teams own the surrounding modules?",
        ]
        if nodes:
            return seeds[:3]
        return seeds[:2]


def _fallback_answer(question: str, context: str) -> str:
    return (
        "I couldn't reach the language model, but here is what the knowledge graph "
        f"tells us about: {question!r}. Context: {context[:600]}"
    )


def _deterministic_vector(text: str, dim: int = 64) -> list[float]:
    """Generate a stable pseudo-embedding for offline / unit-test mode."""
    import hashlib
    import math

    digest = hashlib.sha512(text.encode("utf-8")).digest()
    out: list[float] = []
    for i in range(dim):
        byte = digest[i % len(digest)]
        out.append((byte / 255.0) * 2.0 - 1.0)
    norm = math.sqrt(sum(x * x for x in out)) or 1.0
    return [x / norm for x in out]


qa_service = QAService()


__all__ = [
    "QAService",
    "Answer",
    "QASource",
    "Message",
    "qa_service",
]
