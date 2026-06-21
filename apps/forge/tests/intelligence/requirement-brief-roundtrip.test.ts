/**
 * FORA-501 — RequirementBrief parser round-trip (AC #2).
 *
 * `schema_version: "1.0"` MUST survive parse → serialize → parse.
 * The 11 canonical section keys MUST also survive the round-trip.
 *
 * Uses inline fixtures so the parser is tested in isolation against
 * a known canonical shape.
 */

import { describe, expect, it } from "vitest";
import {
  parseRequirementBrief,
  roundTripRequirementBrief,
  serializeRequirementBrief,
  REQUIREMENT_BRIEF_SCHEMA_VERSION,
} from "../../lib/intelligence/parser";
import { REQUIREMENT_BRIEF_SECTIONS } from "../../lib/intelligence/types";
import { resolveIdentifier } from "../../lib/intelligence/data";
import type { RequirementBrief } from "../../lib/intelligence/types";

const fixtureBrief: RequirementBrief = {
  id: "rb-test-001",
  epicId: "epic-test-001",
  title: "Test Requirement Brief",
  schema_version: "1.0",
  source: "FORA-test",
  sections: REQUIREMENT_BRIEF_SECTIONS.map((key) => ({
    key,
    title: key.replace(/_/g, " "),
    body: `Body for ${key}.`,
  })),
  createdAt: "2026-06-20T00:00:00Z",
  updatedAt: "2026-06-20T00:00:00Z",
};

function rawBriefFromFixture() {
  return serializeRequirementBrief(fixtureBrief);
}

describe("parseRequirementBrief", () => {
  it("accepts the canonical fixture and preserves schema_version", () => {
    const raw = rawBriefFromFixture();
    const parsed = parseRequirementBrief(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.schema_version).toBe(REQUIREMENT_BRIEF_SCHEMA_VERSION);
  });

  it("rejects envelopes with a missing or wrong schema_version", () => {
    const raw = rawBriefFromFixture();
    expect(parseRequirementBrief({ ...raw, schema_version: undefined })).toBeNull();
    expect(parseRequirementBrief({ ...raw, schema_version: "2.0" })).toBeNull();
    expect(parseRequirementBrief({ ...raw, schema_version: "1" })).toBeNull();
  });

  it("rejects envelopes with the wrong section count", () => {
    const raw = rawBriefFromFixture();
    expect(
      parseRequirementBrief({ ...raw, sections: raw.sections.slice(0, 5) }),
    ).toBeNull();
  });

  it("rejects envelopes with a non-canonical section key", () => {
    const raw = rawBriefFromFixture();
    const bad = {
      ...raw,
      sections: raw.sections.map((s, i) =>
        i === 0 ? { ...s, key: "not_canonical" } : s,
      ),
    };
    expect(parseRequirementBrief(bad)).toBeNull();
  });
});

describe("roundTripRequirementBrief", () => {
  it("preserves schema_version '1.0' across parse → serialize → parse", () => {
    const raw = rawBriefFromFixture();
    const after = roundTripRequirementBrief(raw);
    expect(after).not.toBeNull();
    expect(after!.schema_version).toBe("1.0");
  });

  it("preserves the 11 canonical section keys across the round-trip", () => {
    const raw = rawBriefFromFixture();
    const after = roundTripRequirementBrief(raw)!;
    const keys = after.sections.map((s) => s.key);
    expect(keys).toEqual([...REQUIREMENT_BRIEF_SECTIONS]);
  });

  it("preserves every section title and body across the round-trip", () => {
    const raw = rawBriefFromFixture();
    const after = roundTripRequirementBrief(raw)!;
    for (const sec of after.sections) {
      const original = raw.sections.find((s) => s.key === sec.key);
      expect(original).toBeDefined();
      expect(sec.title).toBe(original!.title);
      expect(sec.body).toBe(original!.body);
    }
  });

  it("parse(serialize(brief)) is deep-equal to brief on the canonical fixture", () => {
    const after = parseRequirementBrief(serializeRequirementBrief(fixtureBrief));
    expect(after).toEqual(fixtureBrief);
  });
});

describe("resolveIdentifier", () => {
  it("returns the raw id for unknown ids when no arrays match", () => {
    // The data-layer resolveIdentifier walks pre-fetched arrays and
    // falls through to the raw id when nothing matches.
    expect(resolveIdentifier("not-in-the-data", [], [])).toBe(
      "not-in-the-data",
    );
  });

  it("returns the identifier when the id is in the epics array", () => {
    expect(
      resolveIdentifier(
        "epic-x",
        [{ id: "epic-x", identifier: "FORA-X" } as never],
        [],
      ),
    ).toBe("FORA-X");
  });

  it("returns the identifier when the id is in the stories array", () => {
    expect(
      resolveIdentifier(
        "story-y",
        [],
        [{ id: "story-y", identifier: "FORA-Y.s" } as never],
      ),
    ).toBe("FORA-Y.s");
  });
});