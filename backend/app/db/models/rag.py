"""step-78 F13 — RAG ORM models: VectorStore + RagChunk.

Multi-tenant (Rule 2): every row carries ``tenant_id`` + ``project_id``
with a composite index. Vector store metadata lives here; real chunk
text + vectors live upstream on the LiteLLM proxy.

Embedding column type
---------------------
``RagChunk.embedding`` is JSONB-encoded ``list[float]`` for now.
ponytail: JSONB list — upgrade to pgvector when the ``vector`` extension
is available in the target environment. The vector type would let us
push ANN search into Postgres (``<=>`` operator, ivfflat / hnsw
indexes) instead of round-tripping every query to LiteLLM. Until the
extension is provisioned, we stay JSONB-portable across Postgres +
SQLite test runs.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, event
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import GUID, JSONB, Base, TenantScopedMixin, UUIDPrimaryKeyMixin


class VectorStore(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    """One vector store per project (or multiple, for advanced tenants).

    ``external_id`` is the LiteLLM ``vs_*`` id returned by the proxy.
    Forge Backend is the source of truth for project / tenant scoping;
    the proxy is the source of truth for chunks + embeddings.
    """

    __tablename__ = "vector_stores"

    external_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # ponytail: named ``metadata_`` because SQLAlchemy reserves ``metadata``
    # on Declarative Base; the API exposes ``metadata``.
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.utcnow()
    )

    __table_args__ = (
        Index(
            "ix_vector_stores_tenant_project",
            "tenant_id",
            "project_id",
        ),
        Index(
            "ix_vector_stores_tenant_project_external",
            "tenant_id",
            "project_id",
            "external_id",
        ),
    )


class RagChunk(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    """One chunk indexed in a vector store.

    Source of truth for the chunk text + position is the proxy; we keep
    a denormalised row here so the Audit Center can render what was
    indexed per tenant without round-tripping LiteLLM, and so
    ``forge.rag.stats`` can answer chunk counts via SELECT.
    """

    __tablename__ = "rag_chunks"

    vector_store_id: Mapped[UUID] = mapped_column(
        GUID(),
        ForeignKey("vector_stores.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # ponytail: JSONB list of floats. Upgrade to ``Vector(1536)`` once
    # pgvector is provisioned and ``pgvector`` is added to the migration
    # target. See module docstring.
    embedding: Mapped[list[float] | None] = mapped_column(JSONB, nullable=True)
    chunk_index: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.utcnow()
    )

    __table_args__ = (
        Index("ix_rag_chunks_tenant_project", "tenant_id", "project_id"),
        Index(
            "ix_rag_chunks_store_tenant_project",
            "tenant_id",
            "project_id",
            "vector_store_id",
        ),
        Index(
            "ix_rag_chunks_store_file",
            "vector_store_id",
            "file_id",
            "chunk_index",
        ),
    )


# SQLAlchemy ORM-level enforcement: forbid UPDATE on RagChunk.audit-irrelevant
# fields — chunks are append-only audit material (Rule 6 spirit). Soft-delete
# is via VectorStore.archive, not chunk mutation.
@event.listens_for(RagChunk, "before_update", propagate=True)
def _reject_chunk_update(_mapper: Any, _connection: Any, _target: Any) -> None:  # type: ignore[no-untyped-def]
    raise RuntimeError("RagChunk is append-only; UPDATE forbidden (F13 ponytail)")


__all__ = ["VectorStore", "RagChunk"]
