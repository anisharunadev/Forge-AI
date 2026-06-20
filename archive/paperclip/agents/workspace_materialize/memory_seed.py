"""Batched memory-index seed path for the materializer (FORA-409).

The public ``agents.memory_mcp.store.MemoryStore.write`` does one
``BEGIN ... COMMIT`` per fact. For a 50-file seed (~65 chunks) that
is ~65 fsyncs and 65 ``memory_fact_vec`` (vec0) index updates; on
the dev machine we measured ~3s per fact (~200s for a 50-file
seed), which blows the FORA-409 acceptance bar of <60s.

The materialize path is a *one-shot seed*: idempotent, single
actor, never running concurrently with the runtime recall path.
That lets us batch the whole seed in a single transaction. The
public ``MemoryStore.write`` invariant (write always audited) is
preserved — we still write one audit row per fact — but the
``BEGIN ... INSERT-fact, INSERT-vec, INSERT-audit ... COMMIT`` loop
is collapsed into a single transaction.

The implementation uses ``MemoryStore._conn`` directly because:

  * The ``MemoryStore.write`` API explicitly does its own
    ``BEGIN`` / ``COMMIT`` and there is no public bulk path. Adding
    a ``bulk_write`` method to MemoryStore is a one-way door that
    belongs with the memory-mcp owner (0.4).
  * The contract this module relies on is the *table layout* (the
    four tables ``memory_fact``, ``memory_fact_vec``, ``memory_audit``,
    ``memory_idf``) which is documented in ADR-0002 §4 and frozen
    by ``agents/memory_mcp/schema.sql``. As long as that schema is
    stable, this seed path is stable.

If the schema ever changes shape, ``bulk_seed`` will fail loudly
on the first INSERT, which is the desired failure mode.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from .materialize import MemorySeed, _chunk_markdown_file, SEED_SUBDIRS


def _rowid_for_fact_id(fact_id: str) -> int:
    """Stable rowid derived from a UUID's first 63 bits.

    Mirrors ``MemoryStore._rowid_for_fact_id`` so vec0 lookups
    resolve to the same row as the runtime write path.
    """
    return int(uuid.UUID(fact_id).int & ((1 << 63) - 1))


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def bulk_seed(
    *,
    tenant_workspace: str,
    slug: str,
    memory_db_path: str,
    store: Any,  # MemoryStore; we duck-type to avoid a hard import
    refit_idf: bool = True,
) -> MemorySeed:
    """Seed the 0.4 memory index for *slug* in a single transaction.

    Walks the freshly-materialized tenant workspace (memory/,
    customer/, project/), chunks every markdown file the same way
    ``MemoryStore.seed_workspace`` does, and INSERTs every fact +
    embedding + audit row inside one BEGIN/COMMIT pair.

    Returns a :class:`MemorySeed` summary. On any DB error the
    transaction is rolled back and the exception propagates — the
    materialize CLI surfaces it as a MaterializeError.
    """
    t0 = time.monotonic()

    # 1. Chunk the tenant workspace into facts (deterministic fact_id
    #    per file+anchor; re-running the seed is a no-op for facts
    #    that are already there — we skip them).
    chunks: List[Dict[str, Any]] = []
    for sub in SEED_SUBDIRS:
        d = os.path.join(tenant_workspace, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".md"):
                continue
            chunks.extend(
                _chunk_markdown_file(os.path.join(d, name), tenant_workspace, slug)
            )

    # 2. Open the store's connection (the caller already opened it
    #    via ``MemoryStore(db_path=memory_db_path)``). We access
    #    ``store._conn`` directly to drive the bulk INSERTs.
    conn = store._conn
    idf_table = store._read_idf_table()

    # Lazy import of the embedder so the materialize module stays
    # import-clean even if the memory_mcp side is not built.
    from agents.memory_mcp.embed import embed, fit_idf, tokenize  # type: ignore

    written = 0
    updated = 0
    conn.execute("BEGIN")
    try:
        for ch in chunks:
            fact_id = ch["fact_id"]
            tokens = tokenize(f"{ch['content']} {' '.join(ch['tags'])}")
            vec = embed(tokens, idf=idf_table)

            existing = conn.execute(
                "SELECT 1 FROM memory_fact WHERE id = ?", (fact_id,)
            ).fetchone()
            if existing is not None:
                updated += 1
                continue

            conn.execute(
                """
                INSERT INTO memory_fact
                  (id, namespace, scope, tenant_id, kind, content, content_ref,
                   lex_tokens, tags, source, provenance, ttl_policy, expires_at,
                   half_life_days, state, promoted_from, redaction_class,
                   written_at, written_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    fact_id,
                    ch["namespace"],
                    ch["scope"],
                    slug,
                    ch["kind"],
                    ch["content"],
                    ch["file_path"],
                    json.dumps(tokens),
                    json.dumps(ch["tags"]),
                    json.dumps(ch["source"]),
                    json.dumps(ch["provenance"]),
                    ch["ttl_policy"],
                    None,
                    ch["half_life_days"],
                    "active",
                    None,
                    ch["redaction_class"],
                    _now_iso(),
                    "workspace-materializer",
                ),
            )
            conn.execute(
                "INSERT INTO memory_fact_vec (rowid, embedding, fact_id) "
                "VALUES (?, ?, ?)",
                (_rowid_for_fact_id(fact_id), _blob(vec), fact_id),
            )
            conn.execute(
                "INSERT INTO memory_audit "
                "(id, ts, actor, operation, target, result, "
                "tokens_in, tokens_out, cost_cents) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    _now_iso(),
                    json.dumps(
                        {
                            "agentId": "workspace-materializer",
                            "runId": None,
                            "contractId": f"materialize:{slug}",
                        }
                    ),
                    "write",
                    json.dumps(
                        {
                            "factId": fact_id,
                            "namespace": ch["namespace"],
                            "scope": ch["scope"],
                        }
                    ),
                    "ok",
                    len(tokens),
                    len(ch["content"]),
                    0,
                ),
            )
            written += 1

        if refit_idf and written > 0:
            # Refit the IDF table once over the now-full tenant
            # corpus. ``fit_corpus_idf`` reads the existing rows
            # back out and rebuilds ``memory_idf``; cheap compared
            # to the per-write BEGIN/COMMIT it replaces.
            docs = [
                json.loads(r["lex_tokens"] or "[]")
                for r in conn.execute(
                    "SELECT lex_tokens FROM memory_fact "
                    "WHERE state = 'active' AND (namespace = 'memory' "
                    "OR tenant_id = ?)",
                    (slug,),
                ).fetchall()
            ]
            if docs:
                table = fit_idf(docs)
                conn.execute("DELETE FROM memory_idf")
                for bucket, scale in enumerate(table):
                    conn.execute(
                        "INSERT INTO memory_idf (bucket, scale) VALUES (?, ?)",
                        (bucket, float(scale)),
                    )

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise

    return MemorySeed(
        written=written,
        updated=updated,
        chunks=len(chunks),
        db_path=memory_db_path,
        duration_ms=(time.monotonic() - t0) * 1000.0,
    )


def _blob(vec: bytes) -> bytes:
    """Pass-through; the vec0 column accepts the bytes embed() returns."""
    return vec