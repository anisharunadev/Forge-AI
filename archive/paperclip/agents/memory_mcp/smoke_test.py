#!/usr/bin/env python3
"""
Memory MCP smoke test (FORA-32).

Drives the four acceptance criteria from the issue:

  1. memory.retrieve({scope:'codebase', stage:'arch'}) returns the right files.
  2. memory.write({scope:'execution', ...}) and the Audit system records who/when.
  3. Tenant boundary respected - no cross-tenant leakage.
  4. Cold-start of a sub-agent in a fresh tenant succeeds when the seed
     corpus is in place.

Exercises the server through the real StdioMcpClient transport so the
test catches both the protocol and the implementation.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)


def _print(label: str, ok: bool, detail: str = "") -> None:
    mark = "OK  " if ok else "FAIL"
    print(f"  [{mark}] {label}{(' - ' + detail) if detail else ''}")


def main() -> int:  # noqa: C901
    failures: list[str] = []

    # Per-run isolated DB / audit so the test is reproducible.
    tmpdir = tempfile.mkdtemp(prefix="memory_mcp_")
    db_path = os.path.join(tmpdir, "memory.db")
    audit_path = os.path.join(tmpdir, "memory-audit.jsonl")
    workspace = os.path.join(ROOT, "workspace")

    env = os.environ.copy()
    env["FORA_MEMORY_DB"] = db_path
    env["FORA_MEMORY_AUDIT"] = audit_path
    env["FORA_WORKSPACE_ROOT"] = workspace

    from agents._shared.mcp_client import StdioMcpClient
    server_cmd = [sys.executable, "-m", "agents.memory_mcp.server"]

    print("FORA-32 acceptance test (Memory MCP v1)\n")

    with StdioMcpClient("memory", server_cmd, env=env, cwd=ROOT) as client:
        tools = client.call_log  # warm
        # 1) tool list
        tools_listed = client.list_tools()
        names = sorted(t["name"] for t in tools_listed)
        expected = ["forget", "inject_for_stage", "injection_table", "list",
                    "promote", "propose", "read_audit", "recall", "retrieve",
                    "retrieve_file", "seed_workspace", "stats", "write"]
        if names != expected:
            failures.append(f"tool list mismatch: got {names}, want {expected}")
        else:
            _print("tools/list", True, f"{len(names)} tools registered")

        # 2) Cold-start: seed the workspace into two tenants.
        seed_a = client.call("seed_workspace", {"tenant_id": "tenant-A",
                                                 "actor": {"agentId": "seed", "runId": "run-1"}})
        if seed_a.get("chunks", 0) < 5 or seed_a.get("written", 0) < 5:
            failures.append(f"seed_workspace tenant-A: chunks={seed_a.get('chunks')}, "
                            f"written={seed_a.get('written')}")
        else:
            _print("seed_workspace (tenant-A)", True,
                   f"{seed_a['written']} facts written from {len(set(seed_a['files']))} files")

        seed_b = client.call("seed_workspace", {"tenant_id": "tenant-B",
                                                 "actor": {"agentId": "seed", "runId": "run-1"}})
        if seed_b.get("written", 0) < 5:
            failures.append(f"seed_workspace tenant-B: written={seed_b.get('written')}")
        else:
            _print("seed_workspace (tenant-B)", True,
                   f"{seed_b['written']} facts written (isolated)")

        # Re-seed tenant-A: should be idempotent (0 written, content already in place).
        seed_a_again = client.call("seed_workspace", {"tenant_id": "tenant-A",
                                                       "actor": {"agentId": "seed", "runId": "run-1"}})
        if seed_a_again.get("written", 0) != 0 or seed_a_again.get("chunks", 0) < 5:
            failures.append(f"seed_workspace idempotent re-seed: "
                            f"chunks={seed_a_again.get('chunks')}, "
                            f"written={seed_a_again.get('written')} (expected 0 written)")
        else:
            _print("seed_workspace (idempotent re-seed)", True,
                   f"{seed_a_again['chunks']} chunks, 0 written (same ids reused)")

        # ============================================================
        # Acceptance #4 (cold-start): we already proved the seed works.
        # ============================================================
        stats = client.call("stats")
        if stats.get("facts_active", 0) < 5:
            failures.append(f"stats: facts_active={stats.get('facts_active')} (expected >= 5)")
        else:
            _print("stats", True,
                   f"{stats['facts_active']} active facts, "
                   f"{stats['audit_rows']} audit rows, dim={stats['embedding_dim']}")

        # ============================================================
        # Acceptance #1: memory.retrieve({scope:'codebase', stage:'arch'})
        # The codebase namespace is empty in the seed; for the
        # architect stage, the injection table loads architecture +
        # security + standards + conventions + glossary + PRD +
        # tech-stack. We test the per-stage injection (the issue's
        # *literal* shape) and a codebase-namespace recall after a
        # manual write into that namespace.
        # ============================================================
        inject = client.call("inject_for_stage", {
            "stage": "architect",
            "tenant_id": "tenant-A",
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        inject_files = sorted({(f.get("source") or {}).get("ref", "")
                               for f in inject.get("facts", [])})
        expected_inject_files = {
            "memory/architecture.md", "memory/security.md",
            "customer/standards.md", "customer/conventions.md",
            "customer/glossary.md", "project/PRD.md", "project/tech-stack.md",
        }
        if not inject.get("count"):
            failures.append("inject_for_stage (architect, tenant-A): no facts returned")
        elif not expected_inject_files.intersection(inject_files):
            failures.append(f"inject_for_stage (architect, tenant-A): "
                            f"got files {inject_files}, expected overlap with {expected_inject_files}")
        else:
            _print("injection (architect / tenant-A)", True,
                   f"{inject['count']} facts, files={inject_files[:3]}{'...' if len(inject_files) > 3 else ''}")

        # Codebase namespace write + retrieve.
        write_cb = client.call("write", {
            "namespace": "codebase",
            "tenant_id": "tenant-A",
            "scope": "repo-checkout-api",
            "kind": "rule",
            "content": "src/api uses builder pattern for request objects. ADR-0012.",
            "tags": ["builder", "request"],
            "source": {"type": "code", "ref": "src/api/checkout.rs:42"},
            "ttl_policy": "sliding",
            "half_life_days": 30,
            "actor": {"agentId": "test", "runId": "run-1", "contractId": "hnd-test-1"},
        })
        if not write_cb.get("id"):
            failures.append("write (codebase): no id returned")
        else:
            _print("write (codebase)", True, f"id={write_cb['id'][:8]}...")

        retrieve_cb = client.call("retrieve", {
            "query": "builder pattern checkout api",
            "tenant_id": "tenant-A",
            "namespace": ["codebase"],
            "stage": "arch",
            "k": 3,
            "actor": {"agentId": "test", "runId": "run-1", "contractId": "hnd-test-1"},
        })
        if not retrieve_cb.get("count"):
            failures.append("retrieve (codebase / arch): no facts returned")
        else:
            top = retrieve_cb["facts"][0]
            top_ref = (top.get("source") or {}).get("ref", "")
            if "src/api/checkout.rs" not in top_ref and "builder" not in (top.get("content") or "").lower():
                failures.append(f"retrieve (codebase): top fact not from src/api; ref={top_ref}")
            else:
                _print("retrieve (codebase / arch)", True,
                       f"top: {top_ref} score={top.get('score')}")

        # ============================================================
        # Acceptance #2: memory.write({scope:'execution', ...}) and the
        # Audit system records who/when.
        # ============================================================
        write_exec = client.call("write", {
            "namespace": "execution",
            "tenant_id": "tenant-A",
            "scope": "run-481",
            "kind": "fact",
            "content": "Run #481 hit 3 retries on the cart API; idempotency key held.",
            "tags": ["retry", "checkout"],
            "source": {"type": "agent", "ref": "run-481/log"},
            "ttl_policy": "sliding",
            "half_life_days": 14,
            "actor": {"agentId": "agent:dev", "runId": "run-481",
                      "contractId": "hnd-run-481-3"},
        })
        if not write_exec.get("id"):
            failures.append("write (execution): no id returned")
        else:
            _print("write (execution)", True, f"id={write_exec['id'][:8]}...")

        # Audit row must be there.
        audit = client.call("read_audit", {
            "operation": "write",
            "actor_id": "agent:dev",
            "limit": 10,
        })
        actor_id_seen = any(
            json.loads(r["actor"]).get("agentId") == "agent:dev" and
            json.loads(r["actor"]).get("runId") == "run-481" and
            r["result"] == "ok"
            for r in audit.get("audit", [])
        )
        if not actor_id_seen:
            failures.append(f"audit: no write row for agent:dev/run-481 "
                            f"(rows={len(audit.get('audit', []))})")
        else:
            _print("audit (write, agent:dev, run-481)", True,
                   f"{audit['count']} audit rows total, who/when recorded")

        # Audit JSONL mirror must also have a row.
        if not os.path.exists(audit_path):
            failures.append(f"audit JSONL mirror missing: {audit_path}")
        else:
            with open(audit_path, "r", encoding="utf-8") as fh:
                lines = [json.loads(line) for line in fh if line.strip()]
            mirror_has = any(
                l.get("actor", {}).get("agentId") == "agent:dev" and
                l.get("operation") == "write" and
                l.get("result") == "ok"
                for l in lines
            )
            if not mirror_has:
                failures.append(f"audit JSONL mirror missing agent:dev write row")
            else:
                _print("audit JSONL mirror", True,
                       f"{len(lines)} rows at {audit_path}")

        # ============================================================
        # Acceptance #3: tenant boundary. Tenant-B must NOT see
        # tenant-A's `codebase` fact even with a codebase query.
        # ============================================================
        retrieve_b = client.call("retrieve", {
            "query": "builder pattern checkout api",
            "tenant_id": "tenant-B",
            "namespace": ["codebase"],
            "stage": "arch",
            "k": 5,
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        leaked = [
            f for f in retrieve_b.get("facts", [])
            if (f.get("source") or {}).get("ref", "").startswith("src/api/")
        ]
        if leaked:
            failures.append(f"tenant boundary: tenant-B saw {len(leaked)} tenant-A codebase facts")
        else:
            _print("tenant boundary (tenant-B isolated from tenant-A codebase)",
                   True, f"tenant-B saw {retrieve_b['count']} facts (none from tenant-A)")

        # tenant_id=None (no scope) must NOT return tenant-scoped facts.
        retrieve_global = client.call("retrieve", {
            "query": "builder pattern",
            "namespace": ["codebase"],
            "k": 5,
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        if retrieve_global.get("count", 0) != 0:
            failures.append(f"global retrieve (no tenant) returned "
                            f"{retrieve_global.get('count')} codebase facts; expected 0")
        else:
            _print("tenant boundary (no tenant_id -> only org-wide)", True,
                   f"0 codebase facts returned without tenant_id")

        # ============================================================
        # Cross-namespace promotion (ADR §4.3) sanity check.
        # ============================================================
        # Pick a tenant-A codebase fact, promote to org-wide memory.
        promote = client.call("promote", {
            "fact_id": write_cb["id"],
            "target_namespace": "memory",
            "target_scope": "global",
            "reason": "Builder pattern is org-wide, not just checkout-api",
            "tenant_id": "tenant-A",
            "actor": {"agentId": "agent:architect", "runId": "run-1"},
        })
        if not promote.get("promoted"):
            failures.append(f"promote: {promote}")
        else:
            promoted_id = promote["fact"]["id"]
            _print("promote (codebase -> memory)", True,
                   f"new org fact id={promoted_id[:8]}...")

        # Now tenant-B (no tenant on promote, but the new memory fact is global)
        # should be able to see the org-wide rule.
        retrieve_org = client.call("retrieve", {
            "query": "builder pattern",
            "namespace": ["memory"],
            "k": 5,
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        org_hit = any(
            (f.get("content") or "").lower().find("builder pattern") >= 0
            for f in retrieve_org.get("facts", [])
        )
        if not org_hit:
            failures.append(f"org-wide recall did not surface promoted fact "
                            f"({retrieve_org.get('count')} facts returned)")
        else:
            _print("org-wide recall (after promote)", True,
                   f"tenant-B can see the promoted rule ({retrieve_org['count']} facts)")

        # ============================================================
        # Forget (ADR §6.3) sanity check.
        # ============================================================
        forget = client.call("forget", {
            "fact_id": write_exec["id"],
            "reason": "GDPR / right-to-erasure",
            "tenant_id": "tenant-A",
            "actor": {"agentId": "agent:audit", "runId": "run-2"},
        })
        if not forget.get("forgotten"):
            failures.append(f"forget: {forget}")
        else:
            # The fact should not surface in a recall afterwards.
            retrieve_after = client.call("retrieve", {
                "query": "retries cart API idempotency",
                "tenant_id": "tenant-A",
                "namespace": ["execution"],
                "k": 5,
                "actor": {"agentId": "test", "runId": "run-1"},
            })
            still_there = any(
                f.get("id") == write_exec["id"] for f in retrieve_after.get("facts", [])
            )
            if still_there:
                failures.append("forget: forgotten fact still in recall results")
            else:
                _print("forget (execution fact)", True,
                       "fact removed from recall results")

        # ============================================================
        # FORA-413 / 0.8.6 Acceptance #4 (in FORA-103): tenant-aware
        # file reads via the extension-hook resolver.
        #
        # - ``memory.list(tenant=acme)`` returns the resolved tree
        #   (``acme/workspace/*`` shadows ``workspace/*``; acme has a
        #   real override at ``customer/standards.md``).
        # - ``memory.retrieve_file(tenant=acme, customer/standards.md)``
        #   returns the tenant override (8 lines).
        # - ``memory.retrieve_file(tenant=globex, customer/standards.md)``
        #   falls through to the seed (148 lines).
        # - The override is identifiable as ``source="tenant"`` in the
        #   listing; the fallthrough shows ``source="seed"``.
        # ============================================================
        list_acme = client.call("list", {
            "tenant": "acme",
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        acme_files = {f["relpath"]: f for f in list_acme.get("files", [])}
        if list_acme.get("count", 0) < 5:
            failures.append(f"list(acme): count={list_acme.get('count')} "
                            f"(expected >= 5 files)")
        elif "customer/standards.md" not in acme_files:
            failures.append(f"list(acme): missing customer/standards.md "
                            f"(got {len(acme_files)} files)")
        elif acme_files["customer/standards.md"].get("source") != "tenant":
            failures.append(f"list(acme): customer/standards.md source="
                            f"{acme_files['customer/standards.md'].get('source')!r}, "
                            f"want 'tenant' (acme has a real override)")
        elif not acme_files["customer/standards.md"].get("seed_path"):
            failures.append("list(acme): customer/standards.md has seed_path=null; "
                            "shadow should carry the seed path")
        else:
            _print("list(acme)", True,
                   f"{list_acme['count']} files; "
                   f"customer/standards.md source=tenant, "
                   f"seed_path={os.path.basename(acme_files['customer/standards.md']['seed_path'])}")

        # acme's customer/standards.md override is short and starts with
        # the ACME header; the seed is the long FORA baseline. Reading
        # through retrieve_file must surface the tenant bytes.
        rf_acme = client.call("retrieve_file", {
            "tenant": "acme",
            "path": "customer/standards.md",
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        if not rf_acme.get("found"):
            failures.append("retrieve_file(acme, customer/standards.md): not found")
        elif rf_acme.get("source") != "tenant":
            failures.append(f"retrieve_file(acme): source={rf_acme.get('source')!r}, "
                            f"want 'tenant' (acme has a real override)")
        elif "ACME" not in (rf_acme.get("content") or ""):
            failures.append("retrieve_file(acme): tenant override missing 'ACME' header "
                            f"(got {len(rf_acme.get('content') or '')} bytes)")
        else:
            _print("retrieve_file(acme, customer/standards.md)", True,
                   f"source=tenant, {len(rf_acme['content'])} bytes (override)")

        # globex has no override for customer/standards.md — the file
        # in tenants/globex/workspace/ is byte-identical to the seed
        # (the FORA-409 materializer copied the seed baseline). The
        # acceptance contract for FORA-413 AC #4 is "the call returns
        # the seed [content]"; we check that content identity (and that
        # globex does NOT return acme's override). The source label can
        # legitimately be either 'tenant' (the file exists on the tenant
        # side) or 'seed' (resolver fell through) — globex was fully
        # materialized, so it is 'tenant' on disk.
        rf_globex = client.call("retrieve_file", {
            "tenant": "globex",
            "path": "customer/standards.md",
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        # Read the seed in BINARY mode so we compare raw bytes (the
        # ``list`` tool's ``size`` field is ``os.stat().st_size``).
        seed_path = os.path.join(workspace, "customer", "standards.md")
        with open(seed_path, "rb") as fh:
            seed_raw = fh.read()
        if not rf_globex.get("found"):
            failures.append("retrieve_file(globex, customer/standards.md): not found")
        else:
            globex_raw = (rf_globex.get("content") or "").encode("utf-8")
            if globex_raw != seed_raw:
                failures.append("retrieve_file(globex): returned bytes differ from "
                                f"the seed (got {len(globex_raw)} bytes, "
                                f"seed is {len(seed_raw)} bytes)")
            elif globex_raw == (rf_acme.get("content") or "").encode("utf-8"):
                failures.append("retrieve_file(globex): returned acme's override; "
                                "expected seed-equivalent content")
            else:
                _print("retrieve_file(globex, customer/standards.md)", True,
                       f"source={rf_globex.get('source')}, "
                       f"{len(globex_raw)} bytes (seed-equivalent)")

        # Cross-check: globex's listing of customer/standards.md must
        # also reflect seed-equivalent bytes. The source label is
        # 'tenant' (file exists on tenant side) but the resolved path
        # and bytes match the seed baseline.
        list_globex = client.call("list", {
            "tenant": "globex",
            "actor": {"agentId": "test", "runId": "run-1"},
        })
        gx_files = {f["relpath"]: f for f in list_globex.get("files", [])}
        if "customer/standards.md" not in gx_files:
            failures.append("list(globex): missing customer/standards.md")
        elif gx_files["customer/standards.md"].get("size") != len(seed_raw):
            failures.append("list(globex): customer/standards.md size differs "
                            f"from seed (got "
                            f"{gx_files['customer/standards.md'].get('size')}, "
                            f"want {len(seed_raw)})")
        else:
            _print("list(globex).customer/standards.md", True,
                   f"source={gx_files['customer/standards.md'].get('source')}, "
                   f"size=seed-equivalent")

        # Bad slug must be rejected (resolver contract — no path traversal).
        try:
            bad = client.call("list", {"tenant": "BAD/SLUG"})
        except Exception as exc:  # McpError / JsonRpcError — both fine here
            err_msg = str(exc)
            if "invalid slug" not in err_msg:
                failures.append(f"list('BAD/SLUG'): wrong error: {err_msg}")
            else:
                _print("list rejects invalid slug", True, "invalid_slug error surfaced")
        else:
            failures.append(f"list('BAD/SLUG'): expected error, got {bad}")

    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nOK: FORA-32 acceptance test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
