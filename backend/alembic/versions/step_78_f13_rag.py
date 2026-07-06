"""step-78 F13 — VectorStore + RagChunk tables.

Adds two multi-tenant tables backing the F13 RAG surface:
  * ``vector_stores`` — per-project LiteLLM vector store registry.
  * ``rag_chunks`` — denormalised chunk ledger (text + JSONB embedding).

Embedding column is JSONB on purpose (ponytail: portable across SQLite
test runs + Postgres). When the target env installs ``pgvector`` we
will add a follow-up migration that swaps ``embedding`` to ``Vector(1536)``
and creates an ``ivfflat`` / ``hnsw`` ANN index — see
``app/db/models/rag.py`` module docstring for the upgrade path.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "step_78_f13_rag"
down_revision = "step_78_f14_async"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # vector_stores
    # ------------------------------------------------------------------
    op.create_table(
        "vector_stores",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "metadata",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "ix_vector_stores_tenant_project",
        "vector_stores",
        ["tenant_id", "project_id"],
        unique=False,
    )
    op.create_index(
        "ix_vector_stores_external_id",
        "vector_stores",
        ["external_id"],
        unique=False,
    )
    op.create_index(
        "ix_vector_stores_status",
        "vector_stores",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_vector_stores_tenant_project_external",
        "vector_stores",
        ["tenant_id", "project_id", "external_id"],
        unique=False,
    )

    # ------------------------------------------------------------------
    # rag_chunks
    # ------------------------------------------------------------------
    op.create_table(
        "rag_chunks",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "vector_store_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vector_stores.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("file_id", sa.String(length=128), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        # ponytail: JSONB list of floats; upgrade to pgvector ``Vector(1536)``
        # once the extension is provisioned in the target environment.
        sa.Column("embedding", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "ix_rag_chunks_tenant_project",
        "rag_chunks",
        ["tenant_id", "project_id"],
        unique=False,
    )
    op.create_index(
        "ix_rag_chunks_vector_store_id",
        "rag_chunks",
        ["vector_store_id"],
        unique=False,
    )
    op.create_index(
        "ix_rag_chunks_file_id",
        "rag_chunks",
        ["file_id"],
        unique=False,
    )
    op.create_index(
        "ix_rag_chunks_store_tenant_project",
        "rag_chunks",
        ["tenant_id", "project_id", "vector_store_id"],
        unique=False,
    )
    op.create_index(
        "ix_rag_chunks_store_file",
        "rag_chunks",
        ["vector_store_id", "file_id", "chunk_index"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_rag_chunks_store_file", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_store_tenant_project", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_file_id", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_vector_store_id", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_tenant_project", table_name="rag_chunks")
    op.drop_table("rag_chunks")

    op.drop_index("ix_vector_stores_tenant_project_external", table_name="vector_stores")
    op.drop_index("ix_vector_stores_status", table_name="vector_stores")
    op.drop_index("ix_vector_stores_external_id", table_name="vector_stores")
    op.drop_index("ix_vector_stores_tenant_project", table_name="vector_stores")
    op.drop_table("vector_stores")
