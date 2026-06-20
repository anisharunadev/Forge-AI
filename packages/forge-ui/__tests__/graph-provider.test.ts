/**
 * FORA-393-F2 / FORA-508 — typed graph provider contract tests.
 *
 * Verifies the typed `GraphProvider<Node, Edge>` contract, the four
 * provider implementations, and the TTL cache + eager-invalidate semantics
 * Plan 2 §5 names.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  TtlCache,
  KnowledgeGraphProvider,
  InMemoryKnowledgeFetcher,
  ArchitectureGraphProvider,
  InMemoryArchitectureFetcher,
  DependencyGraphProvider,
  InMemoryDependencyFetcher,
  AuditGraphProvider,
  InMemoryAuditFetcher,
  aggregateEdges,
  EDGE_AGGREGATION_THRESHOLD,
} from "../src/graph";
import type {
  ArchitectureNode,
  DependencyEdge,
  DependencyNode,
  KnowledgeEdge,
  KnowledgeNode,
} from "../src/graph";

describe("TtlCache", () => {
  it("returns undefined for a fresh filter", () => {
    const cache = new TtlCache<{ ok: boolean }>({ ttlMs: 1000 });
    expect(cache.get({})).toBeUndefined();
  });

  it("returns the cached value before expiry", () => {
    const cache = new TtlCache<{ ok: boolean }>({ ttlMs: 1000 });
    cache.set({}, { ok: true });
    expect(cache.get({})).toEqual({ ok: true });
  });

  it("expires the entry past ttlMs", () => {
    let now = 1_000_000;
    const cache = new TtlCache<string>({ ttlMs: 100, now: () => now });
    cache.set({}, "first");
    expect(cache.get({})).toBe("first");
    now += 200;
    expect(cache.get({})).toBeUndefined();
  });

  it("clear() drops every entry (eager-invalidate)", () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000 });
    cache.set({}, 1);
    cache.set({ nodeIds: ["x"] }, 2);
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Knowledge provider
 * ------------------------------------------------------------------ */

describe("KnowledgeGraphProvider", () => {
  const files: KnowledgeNode[] = [
    {
      id: "f1",
      family: "knowledge",
      kind: "knowledge_file",
      label: "memory/architecture.md",
      folder: "memory",
    },
    {
      id: "f2",
      family: "knowledge",
      kind: "knowledge_file",
      label: "project/adr-registry.md",
      folder: "project",
    },
  ];
  const edges: KnowledgeEdge[] = [
    { id: "e1", source: "f2", target: "f1", kind: "references" },
  ];
  let fetcher: InMemoryKnowledgeFetcher;
  let provider: KnowledgeGraphProvider;

  beforeEach(() => {
    fetcher = new InMemoryKnowledgeFetcher({ files, edges });
    provider = new KnowledgeGraphProvider(fetcher, { ttlMs: 60_000 });
  });

  it("lists all knowledge nodes", async () => {
    const nodes = await provider.getNodes({});
    expect(nodes.map((n) => n.id).sort()).toEqual(["f1", "f2"]);
  });

  it("filters by nodeIds", async () => {
    const nodes = await provider.getNodes({ nodeIds: ["f1"] });
    expect(nodes.map((n) => n.id)).toEqual(["f1"]);
  });

  it("filters by family", async () => {
    const nodes = await provider.getNodes({ family: ["knowledge"] });
    expect(nodes.length).toBe(2);
  });

  it("returns the cross-ref edges", async () => {
    const e = await provider.getEdges({});
    expect(e.map((x) => x.id)).toEqual(["e1"]);
  });

  it("caches the read for ttlMs (no second fetcher call)", async () => {
    const spy = vi.spyOn(fetcher, "listFiles");
    await provider.getNodes({});
    await provider.getNodes({});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("invalidate() drops the cache and notifies subscribers", async () => {
    const onChange = vi.fn();
    provider.watch({}, onChange);
    provider.invalidate();
    expect(onChange).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Architecture provider
 * ------------------------------------------------------------------ */

describe("ArchitectureGraphProvider", () => {
  const adrs: ArchitectureNode[] = [
    { id: "adr-1", family: "architecture", kind: "adr", label: "ADR-0001", adrStatus: "proposed" },
    { id: "adr-2", family: "architecture", kind: "adr", label: "ADR-0002", adrStatus: "accepted" },
  ];
  let fetcher: InMemoryArchitectureFetcher;
  let provider: ArchitectureGraphProvider;

  beforeEach(() => {
    fetcher = new InMemoryArchitectureFetcher();
    fetcher.setAdrs(adrs);
    provider = new ArchitectureGraphProvider(fetcher, { ttlMs: 60_000 });
  });

  it("lists ADRs across the registries", async () => {
    const nodes = await provider.getNodes({});
    expect(nodes.map((n) => n.id).sort()).toEqual(["adr-1", "adr-2"]);
  });

  it("filters by adrStatus attribute", async () => {
    const accepted = await provider.getNodes({ attributes: { adrStatus: "accepted" } });
    expect(accepted.map((n) => n.id)).toEqual(["adr-2"]);
  });

  it("eager-invalidate on ADR transition clears the cache", async () => {
    await provider.getNodes({});
    fetcher.setAdrs([
      { id: "adr-3", family: "architecture", kind: "adr", label: "ADR-0003", adrStatus: "accepted" },
    ]);
    provider.invalidate();
    const after = await provider.getNodes({});
    expect(after.map((n) => n.id)).toEqual(["adr-3"]);
  });
});

/* ------------------------------------------------------------------ *
 * Dependency provider
 * ------------------------------------------------------------------ */

describe("DependencyGraphProvider", () => {
  const buildEdges = (count: number): DependencyEdge[] => {
    const out: DependencyEdge[] = [];
    for (let i = 0; i < count; i++) {
      out.push({ id: `e${i}`, source: `m${i}`, target: `p1`, kind: "imports" });
    }
    return out;
  };
  const modules: DependencyNode[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    family: "dependency",
    kind: "module",
    label: `module ${i}`,
    modulePath: `src/m${i}.ts`,
  }));

  it("returns all edges below the aggregation threshold", async () => {
    const fetcher = new InMemoryDependencyFetcher();
    fetcher.setModules(modules);
    fetcher.setPackages([{ id: "p1", family: "dependency", kind: "package", label: "react", packageName: "react", packageVersion: "19.0.0" }]);
    fetcher.setEdges(buildEdges(EDGE_AGGREGATION_THRESHOLD - 1));
    const provider = new DependencyGraphProvider(fetcher, { ttlMs: 60_000 });
    const edges = await provider.getEdges({});
    expect(edges.length).toBe(EDGE_AGGREGATION_THRESHOLD - 1);
  });

  it("aggregates edges beyond the threshold", async () => {
    const fetcher = new InMemoryDependencyFetcher();
    fetcher.setModules(modules);
    fetcher.setPackages([{ id: "p1", family: "dependency", kind: "package", label: "react", packageName: "react", packageVersion: "19.0.0" }]);
    const total = EDGE_AGGREGATION_THRESHOLD + 100;
    fetcher.setEdges(buildEdges(total));
    const provider = new DependencyGraphProvider(fetcher, { ttlMs: 60_000 });
    const edges = await provider.getEdges({});
    expect(edges.length).toBeLessThan(total);
    expect(edges.every((e) => e.kind === "imports_external")).toBe(true);
  });

  it("refresh() drops the cache (build-completion hook)", async () => {
    const fetcher = new InMemoryDependencyFetcher();
    fetcher.setModules(modules);
    const provider = new DependencyGraphProvider(fetcher, { ttlMs: 60_000 });
    await provider.getNodes({});
    fetcher.setModules([
      ...modules,
      { id: "m99", family: "dependency", kind: "module", label: "module 99", modulePath: "src/m99.ts" },
    ]);
    provider.refresh();
    const after = await provider.getNodes({});
    expect(after.find((n) => n.id === "m99")).toBeDefined();
  });
});

describe("aggregateEdges()", () => {
  it("rolls multiple imports edges to a package into one imports_external edge", () => {
    const out = aggregateEdges([
      { id: "e1", source: "m1", target: "p1", kind: "imports" },
      { id: "e2", source: "m2", target: "p1", kind: "imports" },
      { id: "e3", source: "m3", target: "p2", kind: "imports" },
    ]);
    expect(out.length).toBe(2);
    const p1 = out.find((e) => e.target === "p1")!;
    expect(p1.kind).toBe("imports_external");
    expect(p1.aggregatedCount).toBe(2);
  });

  it("passes non-imports edges through unchanged", () => {
    const owns: DependencyEdge = { id: "owns1", source: "owner-1", target: "m1", kind: "owns" };
    const out = aggregateEdges([owns]);
    expect(out).toEqual([owns]);
  });
});

/* ------------------------------------------------------------------ *
 * Audit provider
 * ------------------------------------------------------------------ */

describe("AuditGraphProvider", () => {
  const fetcher = new InMemoryAuditFetcher();
  fetcher.setEntries([
    { id: "a1", family: "audit", kind: "audit_entry", label: "tool-call x", bucketStart: "2026-06-20T00:00:00Z" },
  ]);
  fetcher.setActors([
    { id: "u1", family: "audit", kind: "actor", label: "agent cto" },
  ]);
  fetcher.setEdges([
    { id: "ae1", source: "a1", target: "u1", kind: "performed_by" },
  ]);
  const provider = new AuditGraphProvider(fetcher, {
    pollMs: 1_000_000,
    setInterval: () => 1,
    clearInterval: () => {},
  });

  it("returns audit entries + actors", async () => {
    const nodes = await provider.getNodes({});
    expect(nodes.length).toBe(2);
  });

  it("returns the performed_by edge", async () => {
    const edges = await provider.getEdges({});
    expect(edges[0]?.kind).toBe("performed_by");
  });

  it("invalidate() drops the cache and notifies", async () => {
    const onChange = vi.fn();
    provider.watch({}, onChange);
    provider.invalidate();
    expect(onChange).toHaveBeenCalled();
  });
});
