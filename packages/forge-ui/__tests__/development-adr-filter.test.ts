/**
 * Unit tests for the Development Center filter — Plan 1 §3.7 #8.
 *
 * Pure filter logic. Verifies the `applyAdrFilter` semantics:
 *   - absent axis = "no filter on this axis"
 *   - empty array on a list axis = "match nothing"
 *   - status / text axes honored
 */

import { describe, expect, it } from "vitest";
import { applyAdrFilter } from "../src/development/development-filters";
import type { AdrRegistryEntry } from "../src/development/development";

const ADR: ReadonlyArray<AdrRegistryEntry> = [
  { number: "0001", title: "Typed graph provider", path: "a.md", status: "accepted", date: "2026-06-17", architectureArea: "knowledge-layer" },
  { number: "0002", title: "Forge UI subpaths", path: "b.md", status: "accepted", date: "2026-06-18", architectureArea: "ui" },
  { number: "0003", title: "MCP scoped creds", path: "c.md", status: "proposed", date: "2026-06-20", architectureArea: "security" },
  { number: "0004", title: "Old ADR", path: "d.md", status: "superseded", date: "2026-06-15", architectureArea: "ui" },
];

describe("applyAdrFilter", () => {
  it("returns all ADRs with empty filter", () => {
    expect(applyAdrFilter(ADR, {})).toEqual(ADR);
  });

  it("filters by status", () => {
    const out = applyAdrFilter(ADR, { adrStatuses: ["accepted"] });
    expect(out.map((a) => a.number).sort()).toEqual(["0001", "0002"]);
  });

  it("multiple statuses are OR-ed", () => {
    const out = applyAdrFilter(ADR, { adrStatuses: ["accepted", "proposed"] });
    expect(out.map((a) => a.number).sort()).toEqual(["0001", "0002", "0003"]);
  });

  it("empty status array matches nothing", () => {
    expect(applyAdrFilter(ADR, { adrStatuses: [] })).toEqual([]);
  });

  it("text matches title + architectureArea (case-insensitive)", () => {
    const out = applyAdrFilter(ADR, { text: "SECURITY" });
    expect(out).toHaveLength(1);
    expect(out[0]?.number).toBe("0003");
  });

  it("text + status combined (AND)", () => {
    const out = applyAdrFilter(ADR, { adrStatuses: ["accepted"], text: "ui" });
    expect(out.map((a) => a.number).sort()).toEqual(["0002"]);
  });
});
