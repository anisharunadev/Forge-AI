/**
 * FORA-505 / FORA-393-6 — Audit Center applyAuditQuery unit tests.
 *
 * Tests cover every axis of the query shape against a small fixture. The
 * tenant-id axis is the AC #1 invariant (no cross-tenant leak); the other
 * axes lock down the Plan 1 §3.12 filter spec.
 */

import { describe, it, expect } from "vitest";
import { applyAuditQuery } from "../src/audit/apply-query";
import type { AuditEntry } from "../src/typed-artifacts/types";

const TENANT = "acme";
const OTHER_TENANT = "globex";

function entry(overrides: Partial<AuditEntry>): AuditEntry {
  const base: AuditEntry = {
    id: overrides.id ?? "e",
    timestamp: overrides.timestamp ?? "2026-06-20T12:00:00.000Z",
    actor: overrides.actor ?? { kind: "user", id: "u1", displayName: "Alice" },
    tenantId: overrides.tenantId ?? TENANT,
    tool: overrides.tool ?? "developer",
  };
  if (overrides.queryHash !== undefined) (base as { queryHash?: string }).queryHash = overrides.queryHash;
  if (overrides.responseHash !== undefined) (base as { responseHash?: string }).responseHash = overrides.responseHash;
  if (overrides.latencyMs !== undefined) (base as { latencyMs?: number }).latencyMs = overrides.latencyMs;
  if (overrides.tokens !== undefined) (base as { tokens?: { prompt: number; completion: number } }).tokens = overrides.tokens;
  if (overrides.costUsd !== undefined) (base as { costUsd?: number }).costUsd = overrides.costUsd;
  if (overrides.artifactRef !== undefined) (base as { artifactRef?: { kind: "task" | "adr" | "patch" | "deployment" | "approval" | "security-finding"; id: string } }).artifactRef = overrides.artifactRef;
  return base;
}

const fixtures: ReadonlyArray<AuditEntry> = [
  entry({ id: "1", tool: "developer", timestamp: "2026-06-20T10:00:00.000Z", costUsd: 0.005 }),
  entry({ id: "2", tool: "qa", timestamp: "2026-06-20T11:00:00.000Z", costUsd: 0.50, queryHash: "qhash-2" }),
  entry({ id: "3", tool: "security", timestamp: "2026-06-20T12:30:00.000Z", costUsd: 5.00 }),
  entry({ id: "4", tool: "developer", tenantId: OTHER_TENANT, timestamp: "2026-06-20T13:00:00.000Z" }),
  entry({ id: "5", actor: { kind: "agent", id: "agent-1" }, tool: "audit", timestamp: "2026-06-20T14:00:00.000Z" }),
];

describe("applyAuditQuery", () => {
  it("returns every entry for an empty query", () => {
    const out = applyAuditQuery(fixtures, {});
    expect(out.map((f) => f.entry.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("filters by tenant id (AC #1: no cross-tenant leak)", () => {
    const out = applyAuditQuery(fixtures, { tenantId: TENANT });
    expect(out.map((f) => f.entry.id)).toEqual(["1", "2", "3", "5"]);
    expect(out.every((f) => f.entry.tenantId === TENANT)).toBe(true);
  });

  it("filters by free-text across tool, hashes, actor, tenant", () => {
    const byHash = applyAuditQuery(fixtures, { text: "qhash" });
    expect(byHash.map((f) => f.entry.id)).toEqual(["2"]);

    const byActor = applyAuditQuery(fixtures, { text: "alice" });
    expect(byActor.map((f) => f.entry.id)).toEqual(["1", "2", "3", "4"]);

    const byTool = applyAuditQuery(fixtures, { text: "audit" });
    expect(byTool.map((f) => f.entry.id)).toEqual(["5"]);
  });

  it("filters by stage (derived from tool name)", () => {
    const dev = applyAuditQuery(fixtures, { stages: ["dev"] });
    expect(dev.map((f) => f.entry.id)).toEqual(["1", "4"]);

    const qa = applyAuditQuery(fixtures, { stages: ["qa"] });
    expect(qa.map((f) => f.entry.id)).toEqual(["2"]);

    const none = applyAuditQuery(fixtures, { stages: ["architect"] });
    expect(none).toEqual([]);
  });

  it("filters by actor kind", () => {
    const agents = applyAuditQuery(fixtures, { actorKinds: ["agent"] });
    expect(agents.map((f) => f.entry.id)).toEqual(["5"]);
  });

  it("filters by actor id", () => {
    const alice = applyAuditQuery(fixtures, { actorIds: ["u1"] });
    expect(alice.map((f) => f.entry.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("filters by timestamp range (since inclusive, until exclusive)", () => {
    const range = applyAuditQuery(fixtures, {
      since: "2026-06-20T11:00:00.000Z",
      until: "2026-06-20T13:00:00.000Z",
    });
    expect(range.map((f) => f.entry.id)).toEqual(["2", "3"]);
  });

  it("filters by min cost (cost_usd > X)", () => {
    const cheap = applyAuditQuery(fixtures, { minCostUsd: 0.1 });
    expect(cheap.map((f) => f.entry.id)).toEqual(["2", "3"]);

    const expensive = applyAuditQuery(fixtures, { minCostUsd: 10 });
    expect(expensive).toEqual([]);
  });

  it("combines multiple axes with AND semantics", () => {
    const combined = applyAuditQuery(fixtures, {
      tenantId: TENANT,
      stages: ["qa"],
      minCostUsd: 0.1,
    });
    expect(combined.map((f) => f.entry.id)).toEqual(["2"]);
  });

  it("treats empty arrays on list axes as 'match nothing'", () => {
    const out = applyAuditQuery(fixtures, { stages: [] });
    expect(out).toEqual([]);

    const out2 = applyAuditQuery(fixtures, { actorKinds: [] });
    expect(out2).toEqual([]);
  });
});
