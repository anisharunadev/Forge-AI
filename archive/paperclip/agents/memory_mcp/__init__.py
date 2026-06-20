"""Memory MCP server package (FORA-32).

A Knowledge-Layer-backed memory service for FORA sub-agents. The full
design lives in [docs/architecture/adr-0002-memory-store.md](../../docs/architecture/adr-0002-memory-store.md);
this package is the v1 dev implementation against SQLite + sqlite-vec.

The five memory scopes the issue enumerates map to namespaces:

    project  -> project  (per-project, tenant_id = project_id)
    org      -> memory   (org-wide, ADR-0002's 'memory' namespace)
    customer -> customer (per-customer, tenant_id = customer_id)
    codebase -> codebase (per-repo, tenant_id = repo_id; code-derived facts)
    execution-> execution (per-run, tenant_id = run_id; runtime facts)

The single-writer rule from ADR-0002 §4.1 is preserved: this MCP server is
the only writer. Every write mirrors to the audit log.
"""
