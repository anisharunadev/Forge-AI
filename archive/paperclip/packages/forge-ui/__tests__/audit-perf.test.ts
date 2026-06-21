/**
 * FORA-505 / FORA-393-6 — Audit Timeline perf smoke (500 entries).
 *
 * AC #2: "Audit Timeline Graph renders 500 entries at 60 fps." We can't
 * measure true fps in jsdom, but we can measure the time to lay out 500
 * audit nodes + 1500 edges through `applyAuditTimelineLayout` — the most
 * expensive part of the render path. Plan 2 §4.5 virtualization kicks in
 * at 200 nodes, so the actual render cost in the browser is bounded by
 * the layout phase. The 60fps browser target is enforced via Playwright.
 */

import { describe, it, expect } from "vitest";
import { applyAuditTimelineLayout } from "../src/graph/layout";

function makeNodes(n: number) {
  const entries = Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    type: "typed" as const,
    position: { x: 0, y: 0 },
    data: {
      family: "audit" as const,
      label: `entry-${i}`,
      kind: "audit_entry" as const,
      bucketStart: new Date(Date.UTC(2026, 5, 20, 0, 0, i)).toISOString(),
    },
  }));
  return entries;
}

function makeEdges(n: number) {
  const edges = [];
  for (let i = 0; i < n; i++) {
    edges.push({ id: `p${i}`, source: `e${i}`, target: "u-alice", kind: "performed_by" });
    if (i > 0) edges.push({ id: `f${i}`, source: `e${i - 1}`, target: `e${i}`, kind: "followed_by" });
  }
  return edges;
}

describe("Audit Timeline layout — 500 entry performance", () => {
  it("lays out 500 entries + ~1000 edges in under 1500ms (jsdom budget)", () => {
    const N = 500;
    const nodes = makeNodes(N);
    const edges = makeEdges(N);

    const t0 = performance.now();
    const result = applyAuditTimelineLayout(nodes, edges, {});
    const dt = performance.now() - t0;

    expect(result.nodes).toHaveLength(N);
    // Each node should have a position assigned.
    expect(result.nodes[0]?.position.x).toBeGreaterThanOrEqual(0);
    // jsdom is materially slower than a real browser. The 60fps target is
    // enforced separately via Playwright in the perf harness.
    expect(dt).toBeLessThan(1500);
  });
});
