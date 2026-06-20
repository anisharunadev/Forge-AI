"""SQLite + sqlite-vec memory store for the v1 dev implementation.

Schema mirrors ADR-0002 §3.2 (memory_fact + memory_audit) so a future
swap to Postgres+pgvector only needs a new backend. The dev substrate
keeps the same row shape, the same single-writer contract, the same
TTL classes, and the same audit-mirror-in-the-same-transaction rule.

The hybrid query in ADR-0002 §3.3 is implemented as:

    vec  ->  SELECT rowid, distance FROM fact_vec
             WHERE embedding MATCH ? ORDER BY distance LIMIT k_vec
    lex  ->  token-set overlap scored by BM25 (embed.lexical_score)
    blend -> 0.7 * (1 - normalized_distance) + 0.3 * lex

The dev path normalizes the L2 distance into a 0..1 similarity by
``1 / (1 + distance)`` because vec0's distance is L2 (not cosine);
the L2-normalized vectors in `embed.embed` mean the ranking is the
same as cosine.
"""

from __future__ import annotations

import json
import os
import sqlite3
import struct
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import sqlite_vec

from .embed import (EMBED_DIM, embed, fit_idf, hybrid_score, lexical_score,
                    tokenize)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

NAMESPACES = ("memory", "customer", "project", "codebase", "execution")
KINDS = ("rule", "pattern", "gotcha", "reference", "decision", "fact")
TTL_POLICIES = ("static", "sliding", "epoch")
STATES = ("pending", "active", "summary", "archived", "forgotten")
REDACTION_CLASSES = ("none", "customer", "secret")


class MemoryError(ValueError):
    """Raised on invalid input or a failed invariant (e.g. write without audit)."""


def _validate_namespace(ns: str) -> str:
    if ns not in NAMESPACES:
        raise MemoryError(f"namespace must be one of {NAMESPACES}, got {ns!r}")
    return ns


def _validate_kind(k: str) -> str:
    if k not in KINDS:
        raise MemoryError(f"kind must be one of {KINDS}, got {k!r}")
    return k


def _validate_state(s: str) -> str:
    if s not in STATES:
        raise MemoryError(f"state must be one of {STATES}, got {s!r}")
    return s


def _validate_ttl(t: str) -> str:
    if t not in TTL_POLICIES:
        raise MemoryError(f"ttl_policy must be one of {TTL_POLICIES}, got {t!r}")
    return t


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

# vec0 virtual table for the embedding index. One row per fact's
# embedding; the fact's UUID is mirrored as `fact_id` text.
_SCHEMA_SQL = f"""
CREATE TABLE IF NOT EXISTS memory_fact (
  id              TEXT PRIMARY KEY,
  namespace       TEXT NOT NULL CHECK (namespace IN ('memory','customer','project','codebase','execution')),
  scope           TEXT NOT NULL,
  tenant_id       TEXT,
  kind            TEXT NOT NULL CHECK (kind IN ('rule','pattern','gotcha','reference','decision','fact')),
  content         TEXT NOT NULL,
  content_ref     TEXT,
  lex_tokens      TEXT NOT NULL,            -- JSON list of tokens (cheap; not a true tsvector)
  tags            TEXT NOT NULL DEFAULT '[]',
  source          TEXT NOT NULL,            -- JSON
  provenance      TEXT NOT NULL,            -- JSON
  ttl_policy      TEXT NOT NULL CHECK (ttl_policy IN ('static','sliding','epoch')),
  expires_at      TEXT,
  half_life_days  INTEGER,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  state           TEXT NOT NULL CHECK (state IN ('pending','active','summary','archived','forgotten')),
  promoted_from   TEXT REFERENCES memory_fact(id),
  redaction_class TEXT NOT NULL DEFAULT 'none' CHECK (redaction_class IN ('none','customer','secret')),
  written_at      TEXT NOT NULL,
  written_by      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_fact_ns_scope_state
  ON memory_fact(namespace, scope, state);
CREATE INDEX IF NOT EXISTS idx_memory_fact_tenant
  ON memory_fact(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_fact_expires
  ON memory_fact(expires_at) WHERE ttl_policy = 'static' AND state = 'active';

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fact_vec USING vec0(
  embedding float[{EMBED_DIM}],
  fact_id TEXT
);

CREATE TABLE IF NOT EXISTS memory_audit (
  id           TEXT PRIMARY KEY,
  ts           TEXT NOT NULL,
  actor        TEXT NOT NULL,        -- JSON
  operation    TEXT NOT NULL CHECK (operation IN
                ('propose','curate','write','recall','promote','demote','forget','summarize','reconcile','redact','seed','inject','deny','error')),
  target       TEXT NOT NULL,        -- JSON
  result       TEXT NOT NULL CHECK (result IN ('ok','denied','redacted','capped','budget_exceeded','error')),
  tokens_in    INTEGER NOT NULL DEFAULT 0,
  tokens_out   INTEGER NOT NULL DEFAULT 0,
  cost_cents   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memory_audit_ts ON memory_audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_memory_audit_actor ON memory_audit(actor);

CREATE TABLE IF NOT EXISTS memory_idf (
  bucket INTEGER PRIMARY KEY,
  scale  REAL NOT NULL
);
"""


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------


def _blob(vec_bytes: bytes) -> bytes:
    """sqlite-vec expects the raw float32 BLOB. This is a no-op pass-through
    for clarity at the call site."""
    if len(vec_bytes) != EMBED_DIM * 4:
        raise MemoryError(
            f"embedding blob wrong size: got {len(vec_bytes)} bytes, want {EMBED_DIM * 4}"
        )
    return vec_bytes


def _open(db_path: str) -> sqlite3.Connection:
    """Open a connection, enable sqlite-vec, ensure schema."""
    is_new = not os.path.exists(db_path)
    conn = sqlite3.connect(db_path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    conn.load_extension(sqlite_vec.loadable_path())
    conn.executescript(_SCHEMA_SQL)
    return conn


# ---------------------------------------------------------------------------
# Domain objects
# ---------------------------------------------------------------------------


@dataclass
class Fact:
    id: str
    namespace: str
    scope: str
    tenant_id: Optional[str]
    kind: str
    content: str
    content_ref: Optional[str]
    tags: List[str]
    source: Dict[str, Any]
    provenance: Dict[str, Any]
    ttl_policy: str
    expires_at: Optional[str]
    half_life_days: Optional[int]
    state: str
    promoted_from: Optional[str]
    redaction_class: str
    written_at: str
    written_by: str
    lex_tokens: List[str] = field(default_factory=list)
    access_count: int = 0
    last_accessed_at: Optional[str] = None

    def to_dict(self, include_lex: bool = False) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "namespace": self.namespace,
            "scope": self.scope,
            "tenant_id": self.tenant_id,
            "kind": self.kind,
            "content": self.content,
            "content_ref": self.content_ref,
            "tags": list(self.tags),
            "source": dict(self.source),
            "provenance": dict(self.provenance),
            "ttl_policy": self.ttl_policy,
            "expires_at": self.expires_at,
            "half_life_days": self.half_life_days,
            "state": self.state,
            "promoted_from": self.promoted_from,
            "redaction_class": self.redaction_class,
            "written_at": self.written_at,
            "written_by": self.written_by,
            "access_count": self.access_count,
            "last_accessed_at": self.last_accessed_at,
        }
        if include_lex:
            d["lex_tokens"] = list(self.lex_tokens)
        return d


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class MemoryStore:
    """SQLite + sqlite-vec memory store.

    The single-writer contract (ADR-0002 §4.1) is enforced at the public
    method level: only ``write`` and ``curate`` touch ``memory_fact``;
    everything else is read-only or audit-only.
    """

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._conn = _open(db_path)
        # Estimate tokens at recall: 1 token ~= 4 chars; cost is in cents.
        self._token_cost_cents = 0  # disabled by default; a real pricing model is out-of-scope.

    # -- write path --------------------------------------------------------

    def write(
        self,
        *,
        namespace: str,
        scope: str,
        kind: str,
        content: str,
        written_by: str,
        tenant_id: Optional[str] = None,
        content_ref: Optional[str] = None,
        tags: Optional[Sequence[str]] = None,
        source: Optional[Dict[str, Any]] = None,
        provenance: Optional[Dict[str, Any]] = None,
        ttl_policy: str = "sliding",
        half_life_days: Optional[int] = 30,
        state: str = "active",
        redaction_class: str = "none",
        fact_id: Optional[str] = None,
        actor: Optional[Dict[str, Any]] = None,
    ) -> Fact:
        """Write one fact, mirroring to the audit log in the same transaction.

        The single-writer contract (ADR-0002 §4.1) is enforced by routing
        every fact mutation through this method.
        """
        _validate_namespace(namespace)
        _validate_kind(kind)
        _validate_state(state)
        _validate_ttl(ttl_policy)
        if redaction_class not in REDACTION_CLASSES:
            raise MemoryError(f"redaction_class must be one of {REDACTION_CLASSES}")
        if not content or not content.strip():
            raise MemoryError("content is required")
        if namespace in ("customer", "project", "codebase", "execution") and not tenant_id:
            raise MemoryError(f"namespace={namespace} requires a tenant_id (tenant boundary)")
        if namespace == "memory" and tenant_id:
            # Org-wide facts are global; we accept and ignore a passed tenant_id.
            tenant_id = None

        fact_id = fact_id or str(uuid.uuid4())
        written_at = _now_iso()
        tags = list(tags or [])
        source = dict(source or {})
        provenance = dict(provenance or {})
        tokens = tokenize(f"{content} {' '.join(tags)}")
        # Re-embed with the corpus IDF table (cheap; recomputed at seed time).
        idf_table = self._read_idf_table()
        vec = embed(tokens, idf=idf_table)

        actor = dict(actor or {"agentId": written_by, "runId": None, "contractId": None})

        self._conn.execute("BEGIN")
        try:
            self._conn.execute(
                """
                INSERT INTO memory_fact
                  (id, namespace, scope, tenant_id, kind, content, content_ref,
                   lex_tokens, tags, source, provenance, ttl_policy, expires_at,
                   half_life_days, state, promoted_from, redaction_class,
                   written_at, written_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    fact_id, namespace, scope, tenant_id, kind, content, content_ref,
                    json.dumps(tokens), json.dumps(tags), json.dumps(source),
                    json.dumps(provenance), ttl_policy, None, half_life_days, state,
                    None, redaction_class, written_at, written_by,
                ),
            )
            self._conn.execute(
                "INSERT INTO memory_fact_vec (rowid, embedding, fact_id) VALUES (?, ?, ?)",
                (self._rowid_for_fact_id(fact_id), _blob(vec), fact_id),
            )
            # Mirror to audit (ADR-0002 §7 invariant 1: write without audit is a bug).
            self._audit(
                actor=actor,
                operation="write",
                target={"factId": fact_id, "namespace": namespace, "scope": scope},
                result="ok",
                tokens_in=len(tokens),
                tokens_out=len(content),
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

        # Pass tenant_id so the freshly-written fact passes _tenant_ok
        # on the read-back; non-memory namespaces would otherwise be
        # denied when no tenant_id is in scope.
        return self.get_fact(fact_id, tenant_id=tenant_id)  # type: ignore[return-value]

    def _rowid_for_fact_id(self, fact_id: str) -> int:
        """Stable rowid for the vec0 table.

        We derive a non-negative integer from the UUID's first 63 bits.
        SQLite rowids are signed 64-bit, so we mask to a positive int.
        """
        h = int(uuid.UUID(fact_id).int & ((1 << 63) - 1))
        return h

    # -- read path ---------------------------------------------------------

    def get_fact(self, fact_id: str, tenant_id: Optional[str] = None) -> Optional[Fact]:
        row = self._conn.execute(
            "SELECT * FROM memory_fact WHERE id = ?", (fact_id,)
        ).fetchone()
        if row is None:
            return None
        fact = self._row_to_fact(row)
        if not _tenant_ok(fact, tenant_id):
            return None
        return fact

    def list_facts(
        self,
        *,
        namespace: Optional[str] = None,
        scope: Optional[str] = None,
        tenant_id: Optional[str] = None,
        kind: Optional[str] = None,
        state: str = "active",
        limit: int = 100,
    ) -> List[Fact]:
        clauses = ["state = ?"]
        args: List[Any] = [state]
        if namespace:
            clauses.append("namespace = ?")
            args.append(namespace)
        if scope:
            clauses.append("scope = ?")
            args.append(scope)
        if tenant_id:
            clauses.append("(namespace = 'memory' OR tenant_id = ?)")
            args.append(tenant_id)
        if kind:
            clauses.append("kind = ?")
            args.append(kind)
        sql = (
            "SELECT * FROM memory_fact WHERE " + " AND ".join(clauses)
            + " ORDER BY written_at DESC LIMIT ?"
        )
        args.append(int(limit))
        rows = self._conn.execute(sql, args).fetchall()
        out: List[Fact] = []
        for r in rows:
            f = self._row_to_fact(r)
            if _tenant_ok(f, tenant_id):
                out.append(f)
        return out

    def recall(
        self,
        *,
        query: str,
        tenant_id: Optional[str] = None,
        namespace: Optional[Sequence[str]] = None,
        scope: Optional[Sequence[str]] = None,
        kind: Optional[Sequence[str]] = None,
        stage: Optional[str] = None,
        k: int = 5,
        max_tokens: int = 3000,
        actor: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Hybrid lexical + vector recall (ADR-0002 §3.3).

        Tenant boundary is enforced in the SQL: ``memory`` namespace is
        global; everything else is filtered by ``tenant_id`` or denied.
        """
        k_vec = max(50, k * 10)  # over-fetch from the vector side, blend, then trim.
        q_tokens = tokenize(query)
        if not q_tokens:
            return []
        idf_table = self._read_idf_table()
        q_vec = embed(q_tokens, idf=idf_table)

        # Build the SQL filter clauses once. The same filter is applied
        # to the vec table and the lex scan so the final blend is fair.
        ns_clause, ns_args = _ns_clause(namespace)
        scope_clause, scope_args = _seq_clause("scope", scope)
        kind_clause, kind_args = _seq_clause("kind", kind)
        tenant_clause, tenant_args = _tenant_clause(tenant_id)
        state_clause = "state IN ('active','summary')"

        # 1) Vector candidates.
        vec_sql = f"""
            SELECT fact_id, distance
            FROM memory_fact_vec
            WHERE embedding MATCH ?
              AND fact_id IN (
                SELECT id FROM memory_fact
                WHERE {state_clause}
                  {ns_clause} {scope_clause} {kind_clause} {tenant_clause}
              )
            ORDER BY distance
            LIMIT ?
        """
        try:
            vec_rows = self._conn.execute(
                vec_sql, [_blob(q_vec), *ns_args, *scope_args, *kind_args, *tenant_args, k_vec]
            ).fetchall()
        except sqlite3.OperationalError:
            # Empty vec table on a fresh seed returns no rows; that's fine.
            vec_rows = []
        vec_scores: Dict[str, float] = {}
        for r in vec_rows:
            fid = r["fact_id"]
            d = float(r["distance"])
            # L2 -> 0..1 similarity. L2-normalized vectors => d in [0, 2].
            sim = 1.0 / (1.0 + d)
            vec_scores[fid] = sim

        # 2) Lexical candidates. Pull active facts matching the same
        #    filters and score them with BM25.
        lex_sql = f"""
            SELECT id, lex_tokens
            FROM memory_fact
            WHERE {state_clause}
              {ns_clause} {scope_clause} {kind_clause} {tenant_clause}
            ORDER BY written_at DESC
            LIMIT ?
        """
        lex_rows = self._conn.execute(
            lex_sql, [*ns_args, *scope_args, *kind_args, *tenant_args, max(50, k * 4)]
        ).fetchall()
        lex_scores: Dict[str, float] = {}
        candidates: Dict[str, None] = {}
        for r in lex_rows:
            fid = r["id"]
            toks = json.loads(r["lex_tokens"])
            score = lexical_score(q_tokens, toks)
            if score > 0.0:
                lex_scores[fid] = score
            candidates[fid] = None
        for fid in vec_scores:
            candidates[fid] = None

        # 3) Blend and rank. ADR-0002 §3.3: 0.7 vec + 0.3 lex.
        scored: List[Tuple[float, str]] = []
        for fid in candidates:
            v = vec_scores.get(fid, 0.0)
            l = lex_scores.get(fid, 0.0)
            s = hybrid_score(v, l)
            scored.append((s, fid))
        scored.sort(key=lambda x: x[0], reverse=True)

        # 4) Hydrate, cap by max_tokens, refresh last_accessed_at.
        budget = int(max_tokens)
        out: List[Dict[str, Any]] = []
        actor = dict(actor or {"agentId": "memory-mcp", "runId": None, "contractId": None})
        for score, fid in scored:
            if not out and budget <= 0:
                break
            f = self.get_fact(fid, tenant_id=tenant_id)
            if f is None:
                continue
            tokens_approx = max(1, len(f.content) // 4)
            if sum(x.get("_tokens", 0) for x in out) + tokens_approx > budget and out:
                break
            self._conn.execute(
                "UPDATE memory_fact SET access_count = access_count + 1, "
                "last_accessed_at = ? WHERE id = ?",
                (_now_iso(), fid),
            )
            d = f.to_dict()
            d["score"] = round(score, 4)
            d["_tokens"] = tokens_approx
            out.append(d)
            budget -= tokens_approx

        # 5) Audit the recall (ADR-0002 §7).
        self._audit(
            actor=actor,
            operation="recall",
            target={
                "query": query,
                "queryHash": _qhash(query),
                "namespace": list(namespace) if namespace else None,
                "scope": list(scope) if scope else None,
                "kind": list(kind) if kind else None,
                "tenantId": tenant_id,
                "stage": stage,
                "k": k,
            },
            result="ok" if out else "ok",
            tokens_in=len(q_tokens),
            tokens_out=sum(x["_tokens"] for x in out),
        )
        return out

    # -- mutations that ADR-0002 reserves for the Memory agent ------------

    def forget(
        self,
        *,
        fact_id: str,
        reason: str,
        actor: Dict[str, Any],
        tenant_id: Optional[str] = None,
    ) -> bool:
        """Mark a fact forgotten. GDPR / manual correction (ADR-0002 §6.3)."""
        f = self.get_fact(fact_id, tenant_id=tenant_id)
        if f is None:
            return False
        self._conn.execute("BEGIN")
        try:
            self._conn.execute(
                "UPDATE memory_fact SET state = 'forgotten', content = '' WHERE id = ?",
                (fact_id,),
            )
            # Drop the vector row so it never resurfaces from a search.
            self._conn.execute("DELETE FROM memory_fact_vec WHERE fact_id = ?", (fact_id,))
            self._audit(
                actor=actor,
                operation="forget",
                target={"factId": fact_id, "reason": reason},
                result="ok",
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        return True

    def promote(
        self,
        *,
        fact_id: str,
        target_namespace: str,
        reason: str,
        actor: Dict[str, Any],
        target_scope: str = "global",
        tenant_id: Optional[str] = None,
    ) -> Optional[Fact]:
        """Promote a fact across namespaces (ADR-0002 §4.3)."""
        _validate_namespace(target_namespace)
        f = self.get_fact(fact_id, tenant_id=tenant_id)
        if f is None:
            return None
        if f.state in ("archived", "forgotten"):
            return None
        # Non-destructive: source fact moves to 'summary', new fact in target namespace.
        new_id = str(uuid.uuid4())
        written_at = _now_iso()
        # Carry content, tags, source; reset scope & tenant per the target namespace.
        new_tenant = None if target_namespace == "memory" else (tenant_id or f.tenant_id)
        if target_namespace == "memory":
            new_scope = "global"
        elif target_namespace == "customer":
            new_scope = target_scope  # caller passes the customer_id
        else:
            new_scope = target_scope
        # Embed the new fact with current tokens.
        tokens = tokenize(f"{f.content} {' '.join(f.tags)}")
        idf_table = self._read_idf_table()
        vec = embed(tokens, idf=idf_table)
        self._conn.execute("BEGIN")
        try:
            self._conn.execute(
                "UPDATE memory_fact SET state = 'summary' WHERE id = ?", (fact_id,)
            )
            self._conn.execute(
                """
                INSERT INTO memory_fact
                  (id, namespace, scope, tenant_id, kind, content, content_ref,
                   lex_tokens, tags, source, provenance, ttl_policy, expires_at,
                   half_life_days, state, promoted_from, redaction_class,
                   written_at, written_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id, target_namespace, new_scope, new_tenant, f.kind, f.content, f.content_ref,
                    json.dumps(tokens), json.dumps(f.tags), json.dumps(f.source),
                    json.dumps(f.provenance), f.ttl_policy, None, f.half_life_days, "active",
                    fact_id, f.redaction_class, written_at, actor.get("agentId", "memory-mcp"),
                ),
            )
            self._conn.execute(
                "INSERT INTO memory_fact_vec (rowid, embedding, fact_id) VALUES (?, ?, ?)",
                (self._rowid_for_fact_id(new_id), _blob(vec), new_id),
            )
            self._audit(
                actor=actor,
                operation="promote",
                target={"factId": new_id, "fromFactId": fact_id,
                        "fromNamespace": f.namespace, "toNamespace": target_namespace,
                        "reason": reason},
                result="ok",
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        return self.get_fact(new_id)

    # -- reconciliation & seed -------------------------------------------

    def fit_corpus_idf(self) -> None:
        """Recompute and persist the corpus IDF table (ADR-0002 §3.3)."""
        rows = self._conn.execute(
            "SELECT lex_tokens FROM memory_fact WHERE state IN ('active','summary')"
        ).fetchall()
        docs = [json.loads(r["lex_tokens"]) for r in rows]
        if not docs:
            # Default flat IDF so the first write still embeds sanely.
            table = [0.0, 1.0]
        else:
            table = fit_idf(docs)
        self._conn.execute("BEGIN")
        try:
            self._conn.execute("DELETE FROM memory_idf")
            self._conn.executemany(
                "INSERT INTO memory_idf (bucket, scale) VALUES (?, ?)",
                [(i, float(v)) for i, v in enumerate(table)],
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    def _read_idf_table(self) -> List[float]:
        rows = self._conn.execute(
            "SELECT bucket, scale FROM memory_idf ORDER BY bucket"
        ).fetchall()
        if not rows:
            return [0.0, 1.0]
        out = [0.0] * (max(r["bucket"] for r in rows) + 1)
        for r in rows:
            out[r["bucket"]] = float(r["scale"])
        return out

    # -- audit ------------------------------------------------------------

    def _audit(
        self,
        *,
        actor: Dict[str, Any],
        operation: str,
        target: Dict[str, Any],
        result: str,
        tokens_in: int = 0,
        tokens_out: int = 0,
    ) -> None:
        self._conn.execute(
            "INSERT INTO memory_audit "
            "(id, ts, actor, operation, target, result, tokens_in, tokens_out, cost_cents) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(uuid.uuid4()), _now_iso(), json.dumps(actor), operation,
                json.dumps(target, default=str), result,
                int(tokens_in), int(tokens_out), 0,
            ),
        )

    def read_audit(
        self,
        *,
        operation: Optional[str] = None,
        actor_id: Optional[str] = None,
        since: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        clauses: List[str] = []
        args: List[Any] = []
        if operation:
            clauses.append("operation = ?")
            args.append(operation)
        if actor_id:
            clauses.append("json_extract(actor, '$.agentId') = ?")
            args.append(actor_id)
        if since:
            clauses.append("ts >= ?")
            args.append(since)
        sql = "SELECT * FROM memory_audit"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY ts DESC LIMIT ?"
        args.append(int(limit))
        rows = self._conn.execute(sql, args).fetchall()
        return [dict(r) for r in rows]

    # -- helpers ---------------------------------------------------------

    def stats(self) -> Dict[str, Any]:
        total = self._conn.execute("SELECT COUNT(*) AS n FROM memory_fact").fetchone()["n"]
        active = self._conn.execute(
            "SELECT COUNT(*) AS n FROM memory_fact WHERE state = 'active'"
        ).fetchone()["n"]
        by_ns = self._conn.execute(
            "SELECT namespace, COUNT(*) AS n FROM memory_fact "
            "WHERE state = 'active' GROUP BY namespace"
        ).fetchall()
        audit_n = self._conn.execute("SELECT COUNT(*) AS n FROM memory_audit").fetchone()["n"]
        return {
            "facts_total": total,
            "facts_active": active,
            "facts_by_namespace": {r["namespace"]: r["n"] for r in by_ns},
            "audit_rows": audit_n,
            "embedding_dim": EMBED_DIM,
            "store": "sqlite-vec",
        }

    def _row_to_fact(self, row: sqlite3.Row) -> Fact:
        return Fact(
            id=row["id"],
            namespace=row["namespace"],
            scope=row["scope"],
            tenant_id=row["tenant_id"],
            kind=row["kind"],
            content=row["content"],
            content_ref=row["content_ref"],
            lex_tokens=json.loads(row["lex_tokens"] or "[]"),
            tags=json.loads(row["tags"] or "[]"),
            source=json.loads(row["source"] or "{}"),
            provenance=json.loads(row["provenance"] or "{}"),
            ttl_policy=row["ttl_policy"],
            expires_at=row["expires_at"],
            half_life_days=row["half_life_days"],
            access_count=row["access_count"],
            last_accessed_at=row["last_accessed_at"],
            state=row["state"],
            promoted_from=row["promoted_from"],
            redaction_class=row["redaction_class"],
            written_at=row["written_at"],
            written_by=row["written_by"],
        )

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def _qhash(query: str) -> str:
    import hashlib
    return hashlib.sha256((query or "").encode("utf-8")).hexdigest()[:16]


def _tenant_ok(fact: Fact, tenant_id: Optional[str]) -> bool:
    if fact.namespace == "memory":
        return True
    if tenant_id is None:
        # The caller did not scope to a tenant; deny non-memory facts.
        return False
    return fact.tenant_id == tenant_id


def _ns_clause(namespace: Optional[Sequence[str]]) -> Tuple[str, List[Any]]:
    if not namespace:
        return "", []
    placeholders = ",".join("?" for _ in namespace)
    return f" AND namespace IN ({placeholders})", list(namespace)


def _seq_clause(col: str, values: Optional[Sequence[str]]) -> Tuple[str, List[Any]]:
    if not values:
        return "", []
    placeholders = ",".join("?" for _ in values)
    return f" AND {col} IN ({placeholders})", list(values)


def _tenant_clause(tenant_id: Optional[str]) -> Tuple[str, List[Any]]:
    if tenant_id is None:
        # Restrict to org-wide (memory) when no tenant is provided.
        return " AND namespace = 'memory'", []
    return " AND (namespace = 'memory' OR tenant_id = ?)", [tenant_id]
