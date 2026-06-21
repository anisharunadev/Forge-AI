/**
 * FORA-505 / FORA-393-6 — TenantScopedAuditFetcher tests.
 *
 * Validates AC #1: "Audit log queries by tenant_id (no cross-tenant leak)."
 * The wrapper must drop any node whose tenant id does not match the
 * configured tenant. Edges whose endpoints were dropped must also be dropped.
 */

import { describe, it, expect } from "vitest";
import { TenantScopedAuditFetcher } from "../src/audit/tenant-scoped-fetcher";
import { InMemoryAuditFetcher } from "../src/graph/providers/audit";
import type { AuditEdge, AuditNode } from "../src/graph/nodes";

function node(overrides: { id: string; tenant: string } & Partial<AuditNode>): AuditNode {
  return {
    id: overrides.id,
    family: "audit",
    label: overrides.label ?? overrides.id,
    kind: overrides.kind ?? "audit_entry",
    subtitle: `tenant:${overrides.tenant}`,
  };
}

function edge(overrides: { id: string; source: string; target: string } & Partial<AuditEdge>): AuditEdge {
  return {
    id: overrides.id,
    source: overrides.source,
    target: overrides.target,
    kind: overrides.kind ?? "performed_by",
  };
}

describe("TenantScopedAuditFetcher", () => {
  it("throws when tenantId is empty", () => {
    const inner = new InMemoryAuditFetcher();
    expect(() => new TenantScopedAuditFetcher(inner, { tenantId: "" })).toThrow();
  });

  it("drops nodes whose tenant subtitle does not match", async () => {
    const inner = new InMemoryAuditFetcher();
    inner.setEntries([
      node({ id: "e1", tenant: "acme" }),
      node({ id: "e2", tenant: "globex" }),
      node({ id: "e3", tenant: "acme" }),
    ]);
    inner.setActors([
      node({ id: "u-alice", tenant: "acme", kind: "actor" }),
      node({ id: "u-bob", tenant: "globex", kind: "actor" }),
    ]);
    const scoped = new TenantScopedAuditFetcher(inner, { tenantId: "acme" });

    const entries = await scoped.listEntries();
    expect(entries.map((n) => n.id).sort()).toEqual(["e1", "e3"]);

    const actors = await scoped.listActors();
    expect(actors.map((n) => n.id).sort()).toEqual(["u-alice"]);
  });

  it("drops edges whose endpoints are in different tenants", async () => {
    const inner = new InMemoryAuditFetcher();
    inner.setEntries([
      node({ id: "e1", tenant: "acme" }),
      node({ id: "e2", tenant: "globex" }),
    ]);
    inner.setActors([
      node({ id: "u-alice", tenant: "acme", kind: "actor" }),
      node({ id: "u-bob", tenant: "globex", kind: "actor" }),
    ]);
    inner.setEdges([
      edge({ id: "edge-1", source: "e1", target: "u-alice" }),
      edge({ id: "edge-2", source: "e2", target: "u-bob" }), // both globex, dropped because outside scope
      edge({ id: "edge-3", source: "e1", target: "u-bob" }), // cross-tenant
    ]);
    const scoped = new TenantScopedAuditFetcher(inner, { tenantId: "acme" });

    const edges = await scoped.listEdges();
    expect(edges.map((e) => e.id)).toEqual(["edge-1"]);
  });

  it("drops nodes with no tenant subtitle (defense-in-depth)", async () => {
    const inner = new InMemoryAuditFetcher();
    inner.setEntries([
      { id: "e1", family: "audit", kind: "audit_entry", label: "no-subtitle" }, // missing subtitle
      node({ id: "e2", tenant: "acme" }),
    ]);
    const scoped = new TenantScopedAuditFetcher(inner, { tenantId: "acme" });
    const entries = await scoped.listEntries();
    expect(entries.map((n) => n.id)).toEqual(["e2"]);
  });

  it("exposes tenantId via a getter", () => {
    const inner = new InMemoryAuditFetcher();
    const scoped = new TenantScopedAuditFetcher(inner, { tenantId: "acme" });
    expect(scoped.tenantId).toBe("acme");
  });
});
