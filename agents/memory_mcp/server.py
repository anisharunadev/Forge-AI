#!/usr/bin/env python3
"""
Memory MCP server (FORA-32, FORA-12).

The Knowledge-Layer-backed memory service every FORA sub-agent retrieves
from. The full design is in
[docs/architecture/adr-0002-memory-store.md](../../docs/architecture/adr-0002-memory-store.md);
this server is the v1 dev implementation against SQLite + sqlite-vec.

The single-writer contract (ADR-0002 §4.1) is preserved: only the
`write` and `curate` paths touch `memory_fact`; every other operation
is read-only or audit-only. Every `memory.*` call mirrors a row to
`memory_audit` and to a JSONL audit log (Audit system 0.5's wire-level
mirror).

Tools (the issue's acceptance tests map directly):

    propose          -> memory.propose(...)      curate a fact (the ADR entry point)
    write            -> memory.write(...)        direct write (the issue's literal test)
    recall           -> memory.retrieve(...)     hybrid lexical+vector (the issue's literal test)
    inject_for_stage -> the per-stage injection table from workspace/README.md §2
    seed_workspace   -> load the seed corpus
    promote          -> cross-namespace promotion (ADR §4.3)
    forget           -> GDPR / manual (ADR §6.3)
    stats            -> store health
    read_audit       -> recent audit rows
    injection_table  -> the raw injection table for the Master Orchestrator

Auth model:
    The Memory service is internal. Per-tenant isolation is enforced in
    the SQL filter (`namespace='memory'` is global; everything else is
    gated by `tenant_id`). The MCP tool calls take an explicit
    `tenant_id` argument; the caller is responsible for resolving it
    from the request context (ADR-0001 §5).

Env:
    FORA_MEMORY_DB      path to the SQLite file (default: ./var/memory.db)
    FORA_MEMORY_AUDIT   path to the JSONL audit log (default: ./var/memory-audit.jsonl)
    FORA_WORKSPACE_ROOT path to the workspace/ root (default: ./workspace)
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict, List, Optional

# Allow `python -m agents.memory_mcp.server` from the project root.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents._shared.jsonrpc import (  # noqa: E402
    INVALID_PARAMS,
    JsonRpcError,
    StdioJsonRpcServer,
    tool,
)

from .audit import JsonlAuditMirror  # noqa: E402
from .injection import get_stage, list_stages  # noqa: E402
from .seed import (  # noqa: E402
    SeedChunk,
    chunk_markdown_file,
    scan_workspace,
    seed_workspace,
)
from .store import Fact, MemoryError, MemoryStore  # noqa: E402

DEFAULT_DB = os.environ.get("FORA_MEMORY_DB", os.path.join(ROOT, "var", "memory.db"))
DEFAULT_AUDIT = os.environ.get(
    "FORA_MEMORY_AUDIT", os.path.join(ROOT, "var", "memory-audit.jsonl")
)
DEFAULT_WORKSPACE = os.environ.get("FORA_WORKSPACE_ROOT", os.path.join(ROOT, "workspace"))


# ---------------------------------------------------------------------------
# Server factory
# ---------------------------------------------------------------------------


def make_server(
    db_path: Optional[str] = None,
    audit_path: Optional[str] = None,
    workspace_root: Optional[str] = None,
) -> StdioJsonRpcServer:
    """Build a fresh server. Tests use this to drive the tools directly."""
    db_path = db_path or DEFAULT_DB
    audit_path = audit_path or DEFAULT_AUDIT
    workspace_root = workspace_root or DEFAULT_WORKSPACE
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    store = MemoryStore(db_path=db_path)
    mirror = JsonlAuditMirror(audit_path)
    server = StdioJsonRpcServer(name="memory-mcp", version="0.1.0")

    # ------------------------------------------------------------------
    # write  ->  memory.write({scope, content, ...})
    # ------------------------------------------------------------------
    @tool(
        name="write",
        description=(
            "Write one fact to the memory store. Mirrors to the audit log "
            "in the same transaction. `namespace` is one of "
            "{memory, customer, project, codebase, execution}; non-memory "
            "namespaces require a `tenant_id` so the tenant boundary holds."
        ),
        input_schema={
            "type": "object",
            "required": ["namespace", "content"],
            "properties": {
                "namespace": {"type": "string",
                              "enum": ["memory", "customer", "project",
                                       "codebase", "execution"]},
                "scope": {"type": "string"},
                "tenant_id": {"type": "string"},
                "kind": {"type": "string",
                         "enum": ["rule", "pattern", "gotcha",
                                  "reference", "decision", "fact"]},
                "content": {"type": "string"},
                "content_ref": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "source": {"type": "object"},
                "provenance": {"type": "object"},
                "ttl_policy": {"type": "string",
                               "enum": ["static", "sliding", "epoch"]},
                "half_life_days": {"type": "integer"},
                "redaction_class": {"type": "string",
                                    "enum": ["none", "customer", "secret"]},
                "fact_id": {"type": "string"},
                "actor": {"type": "object"},
            },
        },
    )
    def write(arguments: Dict[str, Any]) -> Any:
        try:
            fact = store.write(
                namespace=arguments["namespace"],
                scope=arguments.get("scope") or _default_scope(arguments),
                tenant_id=arguments.get("tenant_id"),
                kind=arguments.get("kind") or "fact",
                content=arguments["content"],
                content_ref=arguments.get("content_ref"),
                tags=arguments.get("tags"),
                source=arguments.get("source"),
                provenance=arguments.get("provenance"),
                ttl_policy=arguments.get("ttl_policy") or "sliding",
                half_life_days=arguments.get("half_life_days"),
                redaction_class=arguments.get("redaction_class") or "none",
                fact_id=arguments.get("fact_id"),
                written_by=arguments.get("actor", {}).get("agentId", "memory-mcp"),
                actor=arguments.get("actor"),
            )
        except MemoryError as exc:
            raise JsonRpcError(INVALID_PARAMS, str(exc))
        mirror.record(
            actor=arguments.get("actor") or {"agentId": "memory-mcp"},
            operation="write",
            target={"factId": fact.id, "namespace": fact.namespace, "scope": fact.scope},
            result="ok",
            tokens_in=len(fact.content.split()),
            tokens_out=len(fact.content),
        )
        return fact.to_dict()

    # ------------------------------------------------------------------
    # propose  ->  memory.propose(...)
    # ------------------------------------------------------------------
    @tool(
        name="propose",
        description=(
            "Propose a fact for curation. The Memory agent dedupes, embeds, "
            "and assigns a TTL. Same shape as `write` but explicitly flags "
            "the call as a propose -> curate transaction."
        ),
        input_schema=write._input_schema,  # type: ignore[attr-defined]
    )
    def propose(arguments: Dict[str, Any]) -> Any:
        # v1 dev: propose is the same code path as write; the curator
        # would normally run extra dedup/redaction on a separate worker.
        arguments = dict(arguments)
        arguments.setdefault("provenance", {"stage": "propose"})
        result = write(arguments)
        # Tag the audit mirror with a 'propose' op (the write path already
        # audited the same row as 'write'; the mirror is best-effort).
        mirror.record(
            actor=arguments.get("actor") or {"agentId": "memory-mcp"},
            operation="propose",
            target={"factId": result["id"], "namespace": result["namespace"]},
            result="ok",
        )
        return result

    # ------------------------------------------------------------------
    # recall  ->  memory.retrieve(...)
    # ------------------------------------------------------------------
    @tool(
        name="recall",
        description=(
            "Hybrid lexical + vector recall over the memory store. The "
            "tenant boundary is enforced in SQL: `memory` is global; "
            "everything else is filtered by `tenant_id`. Returns at most "
            "`k` facts, ranked by 0.7*vec + 0.3*lex (ADR-0002 §3.3)."
        ),
        input_schema={
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string"},
                "tenant_id": {"type": "string"},
                "namespace": {"type": "array", "items": {"type": "string"}},
                "scope": {"type": "array", "items": {"type": "string"}},
                "kind": {"type": "array", "items": {"type": "string"}},
                "stage": {"type": "string"},
                "k": {"type": "integer", "default": 5, "minimum": 1, "maximum": 50},
                "max_tokens": {"type": "integer", "default": 3000, "minimum": 100},
            },
        },
    )
    def recall(arguments: Dict[str, Any]) -> Any:
        query = arguments.get("query")
        if not isinstance(query, str) or not query.strip():
            raise JsonRpcError(INVALID_PARAMS, "query is required")
        try:
            results = store.recall(
                query=query,
                tenant_id=arguments.get("tenant_id"),
                namespace=arguments.get("namespace"),
                scope=arguments.get("scope"),
                kind=arguments.get("kind"),
                stage=arguments.get("stage"),
                k=int(arguments.get("k") or 5),
                max_tokens=int(arguments.get("max_tokens") or 3000),
                actor=arguments.get("actor"),
            )
        except MemoryError as exc:
            raise JsonRpcError(INVALID_PARAMS, str(exc))
        return {
            "query": query,
            "tenant_id": arguments.get("tenant_id"),
            "facts": [_scrub_fact(f) for f in results],
            "count": len(results),
        }

    # ------------------------------------------------------------------
    # retrieve  ->  exact synonym for recall (the issue uses retrieve)
    # ------------------------------------------------------------------
    @tool(
        name="retrieve",
        description=(
            "Alias for `recall`. Provided because the FORA-32 issue "
            "specifies `memory.retrieve({...})` as the acceptance shape."
        ),
        input_schema=recall._input_schema,  # type: ignore[attr-defined]
    )
    def retrieve(arguments: Dict[str, Any]) -> Any:
        return recall(arguments)

    # ------------------------------------------------------------------
    # inject_for_stage
    # ------------------------------------------------------------------
    @tool(
        name="inject_for_stage",
        description=(
            "Resolve the per-stage injection table for *stage* and recall "
            "the facts the Master Orchestrator should inject into that "
            "stage's prompt window. Honors ADR-0002 §5.2 defaults and "
            "the `memoryContext` block in the Handoff Contract when "
            "supplied."
        ),
        input_schema={
            "type": "object",
            "required": ["stage"],
            "properties": {
                "stage": {"type": "string"},
                "tenant_id": {"type": "string"},
                "k": {"type": "integer"},
                "max_tokens": {"type": "integer"},
                "deny_kinds": {"type": "array", "items": {"type": "string"}},
                "memoryContext": {"type": "object"},
                "actor": {"type": "object"},
            },
        },
    )
    def inject_for_stage(arguments: Dict[str, Any]) -> Any:
        stage = arguments.get("stage")
        if not stage:
            raise JsonRpcError(INVALID_PARAMS, "stage is required")
        defaults = get_stage(stage)
        ctx = arguments.get("memoryContext") or {}
        k = int(ctx.get("maxRecalls") or arguments.get("k") or defaults["default_k"])
        max_tokens = int(ctx.get("maxTokens") or arguments.get("max_tokens")
                         or defaults["default_max_tokens"])
        deny = set(ctx.get("denyKinds") or arguments.get("deny_kinds")
                   or defaults["default_deny_kinds"])
        namespaces = ctx.get("namespaces") or defaults["default_namespaces"]
        # Build a query that is the union of every file's basename. The
        # goal is a recall that surfaces all the files the injection
        # table wants to load; lexical + vector both contribute.
        files = defaults["files"]
        if not files:
            # Permissive stage: no file constraints, just recall top-k.
            results = store.recall(
                query=f"stage:{stage}",
                tenant_id=arguments.get("tenant_id"),
                namespace=namespaces,
                kind=None,
                stage=stage,
                k=k,
                max_tokens=max_tokens,
                actor=arguments.get("actor"),
            )
        else:
            # Issue a recall per file so the table is the upper bound.
            results = []
            seen: set[str] = set()
            per_k = max(1, k // max(1, len(files)))
            for f in files:
                facts = store.recall(
                    query=f,
                    tenant_id=arguments.get("tenant_id"),
                    namespace=namespaces,
                    kind=None,
                    stage=stage,
                    k=per_k,
                    max_tokens=max_tokens // max(1, len(files)),
                    actor=arguments.get("actor"),
                )
                for fact in facts:
                    if fact["id"] in seen:
                        continue
                    seen.add(fact["id"])
                    results.append(fact)
            results = results[:k]
        # Apply deny_kinds as a post-filter.
        if deny:
            results = [f for f in results if f.get("kind") not in deny]
        # Audit.
        mirror.record(
            actor=arguments.get("actor") or {"agentId": "memory-mcp"},
            operation="inject",
            target={"stage": stage, "files": files, "k": k, "maxTokens": max_tokens},
            result="ok",
            tokens_out=sum(len((f.get("content") or "").split()) for f in results),
        )
        return {
            "stage": stage,
            "tenant_id": arguments.get("tenant_id"),
            "defaults": defaults,
            "applied": {
                "namespaces": namespaces,
                "k": k,
                "max_tokens": max_tokens,
                "deny_kinds": sorted(deny),
            },
            "facts": [_scrub_fact(f) for f in results],
            "count": len(results),
        }

    # ------------------------------------------------------------------
    # seed_workspace
    # ------------------------------------------------------------------
    @tool(
        name="seed_workspace",
        description=(
            "Scan workspace/memory/*.md, workspace/customer/*.md, and "
            "workspace/project/*.md and materialize one fact per H2 "
            "heading. Idempotent: re-seeding the same corpus produces "
            "the same fact ids and updates content in place."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "tenant_id": {"type": "string"},
                "refit_idf": {"type": "boolean", "default": True},
                "actor": {"type": "object"},
            },
        },
    )
    def seed_workspace_tool(arguments: Dict[str, Any]) -> Any:
        tenant_id = arguments.get("tenant_id")
        actor = arguments.get("actor") or {"agentId": "seed"}
        chunks = seed_workspace(workspace_root, tenant_id=tenant_id)
        written = 0
        updated = 0
        for ch in chunks:
            existing = store.get_fact(ch.fact_id, tenant_id=tenant_id)
            if existing is None:
                store.write(
                    namespace=ch.namespace, scope=ch.scope, tenant_id=tenant_id,
                    kind=ch.kind, content=ch.content, content_ref=ch.file_path,
                    tags=ch.tags, source=ch.source, provenance={"actor": actor},
                    ttl_policy=ch.ttl_policy, half_life_days=ch.half_life_days,
                    redaction_class=ch.redaction_class, fact_id=ch.fact_id,
                    written_by=actor.get("agentId", "seed"), actor=actor,
                )
                written += 1
            else:
                # Idempotent re-seed: update content in place. Skip if
                # the content is byte-identical (cheap, no audit noise).
                if existing.content != ch.content:
                    store._conn.execute(  # noqa: SLF001 - internal idempotent path
                        "UPDATE memory_fact SET content = ?, written_at = ?, "
                        "written_by = ? WHERE id = ?",
                        (ch.content, _now_iso(), actor.get("agentId", "seed"),
                         ch.fact_id),
                    )
                    updated += 1
        if arguments.get("refit_idf", True):
            store.fit_corpus_idf()
        mirror.record(
            actor=actor, operation="seed",
            target={"workspace_root": workspace_root, "tenant_id": tenant_id,
                    "chunks": len(chunks), "written": written, "updated": updated},
            result="ok",
        )
        return {
            "workspace_root": workspace_root,
            "tenant_id": tenant_id,
            "chunks": len(chunks),
            "written": written,
            "updated": updated,
            "files": [c.file_path for c in chunks[:50]],
        }

    # ------------------------------------------------------------------
    # promote
    # ------------------------------------------------------------------
    @tool(
        name="promote",
        description=(
            "Promote a fact across namespaces (ADR-0002 §4.3). Source "
            "fact moves to state='summary'; a new active fact is created "
            "in the target namespace."
        ),
        input_schema={
            "type": "object",
            "required": ["fact_id", "target_namespace", "reason"],
            "properties": {
                "fact_id": {"type": "string"},
                "target_namespace": {"type": "string",
                                    "enum": ["memory", "customer", "project"]},
                "target_scope": {"type": "string"},
                "reason": {"type": "string"},
                "tenant_id": {"type": "string"},
                "actor": {"type": "object"},
            },
        },
    )
    def promote(arguments: Dict[str, Any]) -> Any:
        try:
            new_fact = store.promote(
                fact_id=arguments["fact_id"],
                target_namespace=arguments["target_namespace"],
                target_scope=arguments.get("target_scope") or "global",
                reason=arguments["reason"],
                actor=arguments.get("actor") or {"agentId": "memory-mcp"},
                tenant_id=arguments.get("tenant_id"),
            )
        except MemoryError as exc:
            raise JsonRpcError(INVALID_PARAMS, str(exc))
        if new_fact is None:
            mirror.record(
                actor=arguments.get("actor") or {"agentId": "memory-mcp"},
                operation="promote",
                target={"factId": arguments["fact_id"],
                        "targetNamespace": arguments["target_namespace"]},
                result="denied",
            )
            return {"promoted": False, "reason": "fact not found or not promotable"}
        mirror.record(
            actor=arguments.get("actor") or {"agentId": "memory-mcp"},
            operation="promote",
            target={"factId": new_fact.id, "fromFactId": arguments["fact_id"],
                    "reason": arguments["reason"]},
            result="ok",
        )
        return {"promoted": True, "fact": _scrub_fact(new_fact.to_dict())}

    # ------------------------------------------------------------------
    # forget
    # ------------------------------------------------------------------
    @tool(
        name="forget",
        description=(
            "Mark a fact forgotten (ADR-0002 §6.3). The vector row is "
            "deleted; the fact row keeps state='forgotten' and an empty "
            "content for 7 years of compliance. The forget reason is "
            "audited."
        ),
        input_schema={
            "type": "object",
            "required": ["fact_id", "reason"],
            "properties": {
                "fact_id": {"type": "string"},
                "reason": {"type": "string"},
                "tenant_id": {"type": "string"},
                "actor": {"type": "object"},
            },
        },
    )
    def forget(arguments: Dict[str, Any]) -> Any:
        ok = store.forget(
            fact_id=arguments["fact_id"],
            reason=arguments["reason"],
            actor=arguments.get("actor") or {"agentId": "memory-mcp"},
            tenant_id=arguments.get("tenant_id"),
        )
        mirror.record(
            actor=arguments.get("actor") or {"agentId": "memory-mcp"},
            operation="forget",
            target={"factId": arguments["fact_id"], "reason": arguments["reason"]},
            result="ok" if ok else "denied",
        )
        return {"forgotten": ok}

    # ------------------------------------------------------------------
    # stats
    # ------------------------------------------------------------------
    @tool(
        name="stats",
        description="Return store health: fact counts by namespace, audit rows, embedding dim.",
        input_schema={"type": "object", "properties": {}},
    )
    def stats(arguments: Dict[str, Any]) -> Any:
        return store.stats()

    # ------------------------------------------------------------------
    # read_audit
    # ------------------------------------------------------------------
    @tool(
        name="read_audit",
        description=(
            "Return the most recent audit rows. Used by the Audit system "
            "0.5 to subscribe to memory events."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "operation": {"type": "string"},
                "actor_id": {"type": "string"},
                "since": {"type": "string"},
                "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 500},
            },
        },
    )
    def read_audit(arguments: Dict[str, Any]) -> Any:
        rows = store.read_audit(
            operation=arguments.get("operation"),
            actor_id=arguments.get("actor_id"),
            since=arguments.get("since"),
            limit=int(arguments.get("limit") or 50),
        )
        return {"audit": rows, "count": len(rows)}

    # ------------------------------------------------------------------
    # injection_table
    # ------------------------------------------------------------------
    @tool(
        name="injection_table",
        description="Return the per-stage injection table from workspace/README.md §2.",
        input_schema={
            "type": "object",
            "properties": {"stage": {"type": "string"}},
        },
    )
    def injection_table(arguments: Dict[str, Any]) -> Any:
        s = arguments.get("stage")
        if s:
            return {"stage": s, "entry": get_stage(s)}
        return {"stages": list_stages()}

    for name, fn in [
        ("write", write), ("propose", propose), ("recall", recall),
        ("retrieve", retrieve), ("inject_for_stage", inject_for_stage),
        ("seed_workspace", seed_workspace_tool), ("promote", promote),
        ("forget", forget), ("stats", stats), ("read_audit", read_audit),
        ("injection_table", injection_table),
    ]:
        server.register(name, fn)
    return server


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _scrub_fact(f: Dict[str, Any]) -> Dict[str, Any]:
    """Drop internal-only fields from a fact before sending to the wire."""
    f = dict(f)
    f.pop("_tokens", None)
    return f


def _default_scope(arguments: Dict[str, Any]) -> str:
    ns = arguments.get("namespace")
    tid = arguments.get("tenant_id")
    if ns == "memory":
        return "global"
    if tid:
        return tid
    return "global"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    server = make_server()
    server.serve_forever()


if __name__ == "__main__":
    main()
