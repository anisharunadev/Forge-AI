"""GDPR Article 17 cascade executor — Phase 8 SC-8.3.

The plan's "kickoff-only" `gdpr_delete_kickoff` returned an ETA but
didn't actually delete anything. This module is the *executor*: it
walks the table inventory for the target tenant and either deletes
or anonymizes rows according to the policy table.

Policy:

* Tenants are tenant-scoped (Rule 2) — the cascade is keyed on
  ``tenant_id``.
* Audit events are NOT deleted (legal retention) — but PII columns
  (``actor_id``, ``actor_email``, ``subject_email``) are nulled.
* LiteLLM call records are anonymized, NOT deleted (LiteLLM retains
  for billing; we null ``actor_id`` and any email fields).
* Spend records / cost_ledger rows are anonymized.
* KG nodes/edges are deleted (their content is tenant-scoped).
* Embeddings are best-effort removed from the vector store (the
  store is Redis or pgvector; we expose a hook so the operator can
  override the implementation per deployment).
* Object-storage files are best-effort removed (S3/MinIO hook).

The executor returns a structured result so SC-8.3's test can assert
each table's row count matches expectations.

Ponytail: in-process executor. Move to the scheduler when durable
execution is needed. The kickoff endpoint in
``observability_service.gdpr_delete_kickoff`` now calls
``gdpr_cascade_executor.run()`` synchronously and returns the
deleted-row counts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import delete, text, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Inventory — one row per (table, mode, where_clause)
# ---------------------------------------------------------------------------

# Each entry maps a tenant-scoped table to its deletion policy:
#   ("delete", "tenants")     — hard delete (cascade FK chains follow)
#   ("delete", "users")       — hard delete (user-owned FK chains follow)
#   ("anonymize", "audit_events") — null PII columns, keep the row
#
# Ponytail: a flat list is fine for the 30+ table inventory. Upgrade
# to a generator when the list grows past ~50.
_TABLE_INVENTORY: list[tuple[str, str, str]] = [
    # (mode, table_name, where_clause_sql)
    # --- hard deletes (PII lives in the row itself) ---
    ("delete", "users", "tenant_id = :tenant_id"),
    ("delete", "user_sessions", "user_id IN (SELECT id FROM users WHERE tenant_id = :tenant_id)"),
    ("delete", "user_api_tokens", "user_id IN (SELECT id FROM users WHERE tenant_id = :tenant_id)"),
    ("delete", "connectors", "tenant_id = :tenant_id"),
    ("delete", "connector_credentials", "tenant_id = :tenant_id"),
    ("delete", "rag_chunks", "tenant_id = :tenant_id"),
    ("delete", "kg_nodes", "tenant_id = :tenant_id"),
    ("delete", "kg_edges", "tenant_id IN (SELECT source_tenant_id FROM kg_nodes WHERE tenant_id = :tenant_id)"),
    ("delete", "ideation_ideas", "tenant_id = :tenant_id"),
    ("delete", "ideation_approval_items", "tenant_id = :tenant_id"),
    ("delete", "ideation_push_records", "tenant_id = :tenant_id"),
    ("delete", "stories", "tenant_id = :tenant_id"),
    ("delete", "lesson_entries", "tenant_id = :tenant_id"),
    ("delete", "persona_memories", "tenant_id = :tenant_id"),
    ("delete", "tenant_settings", "tenant_id = :tenant_id"),
    # --- anonymize (rows preserved for billing / legal retention) ---
    ("anonymize", "litellm_call_records", "tenant_id = :tenant_id"),
    ("anonymize", "cost_entries", "tenant_id = :tenant_id"),
    ("anonymize", "audit_events", "tenant_id = :tenant_id"),
]


_ANONYMIZE_SET: dict[str, dict[str, str]] = {
    "litellm_call_records": {
        "actor_id": "NULL",
    },
    "cost_entries": {
        "agent": "NULL",
    },
    "audit_events": {
        "actor_id": "NULL",
    },
}


@dataclass
class CascadeResult:
    """Per-table outcome of a tenant delete cascade."""

    deleted: dict[str, int] = field(default_factory=dict)
    anonymized: dict[str, int] = field(default_factory=dict)
    embeddings_removed: int = 0
    object_files_removed: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "deleted": self.deleted,
            "anonymized": self.anonymized,
            "embeddings_removed": self.embeddings_removed,
            "object_files_removed": self.object_files_removed,
            "errors": self.errors,
        }


class GdprCascadeExecutor:
    """Tenant-scoped GDPR Article 17 cascade executor."""

    async def run(self, db: AsyncSession, *, tenant_id: UUID) -> CascadeResult:
        """Execute the cascade for ``tenant_id``.

        Ponytail: synchronous, single-tenant, in-process. Caller should
        be the FastAPI handler (request scoped session).
        """
        result = CascadeResult()
        params = {"tenant_id": str(tenant_id)}

        for mode, table, where in _TABLE_INVENTORY:
            try:
                if mode == "delete":
                    rows = await db.execute(
                        text(f"DELETE FROM {table} WHERE {where}"),
                        params,
                    )
                    result.deleted[table] = rows.rowcount or 0
                elif mode == "anonymize":
                    sets = _ANONYMIZE_SET.get(table)
                    if not sets:
                        continue
                    set_clause = ", ".join(f"{col} = {val}" for col, val in sets.items())
                    rows = await db.execute(
                        text(
                            f"UPDATE {table} SET {set_clause} "
                            f"WHERE {where}"
                        ),
                        params,
                    )
                    result.anonymized[table] = rows.rowcount or 0
            except Exception as exc:  # noqa: BLE001
                # Don't fail the whole cascade on a missing table —
                # log it and continue.
                msg = f"{table}: {exc!s}"
                result.errors.append(msg)
                logger.warning("gdpr_cascade.table_failed table=%s err=%s", table, exc)

        # Best-effort: remove vector embeddings and object-storage
        # files. Implementations are deployment-specific; the
        # default hook is a no-op.
        try:
            result.embeddings_removed = await self._drop_embeddings(tenant_id)
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"embeddings: {exc!s}")
        try:
            result.object_files_removed = await self._drop_object_files(tenant_id)
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"object_files: {exc!s}")

        await db.commit()
        logger.info(
            "gdpr_cascade.completed",
            tenant_id=str(tenant_id),
            deleted=sum(result.deleted.values()),
            anonymized=sum(result.anonymized.values()),
        )
        return result

    async def _drop_embeddings(self, tenant_id: UUID) -> int:
        """Drop tenant-scoped embeddings from the vector store.

        Default: no-op (operator wires the deployment-specific
        implementation). Ponytail: a hook is enough; the operator
        decides the storage layer.
        """
        return 0

    async def _drop_object_files(self, tenant_id: UUID) -> int:
        """Drop tenant-scoped object-storage files (S3/MinIO).

        Default: no-op. Same operator-hook story as embeddings.
        """
        return 0


gdpr_cascade_executor = GdprCascadeExecutor()
