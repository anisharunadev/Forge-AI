/**
 * FORA-501 — RequirementBrief parser round-trip (AC #2).
 *
 * `schema_version: "1.0"` MUST survive parse → serialize → parse.
 * The 11 canonical section keys MUST also survive the round-trip.
 */

import { describe, expect, it } from "vitest";
import {
  parseRequirementBrief,
  roundTripRequirementBrief,
  serializeRequirementBrief,
  REQUIREMENT_BRIEF_SCHEMA_VERSION,
} from "../../lib/intelligence/parser";
import { REQUIREMENT_BRIEF_SECTIONS } from "../../lib/intelligence/types";
import {
  listRequirementBriefs,
  resolveIdentifier,
} from "../../lib/intelligence/mock-data";

function rawBriefFromFixture() {
  const b = listRequirementBriefs()[0]!;
  return serializeRequirementBrief(b);
}

describe("parseRequirementBrief", () => {
  it("accepts the canonical mock fixture and preserves schema_version", () => {
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
    const brief = listRequirementBriefs()[0]!;
    const after = parseRequirementBrief(serializeRequirementBrief(brief));
    expect(after).toEqual(brief);
  });
});

describe("resolveIdentifier (mock-data seam)", () => {
  it("resolves known epic ids to their human identifier", () => {
    expect(resolveIdentifier("epic-forge-501")).toBe("FORA-501");
  });

  it("resolves known story ids to their human identifier", () => {
    expect(resolveIdentifier("story-forge-501-list")).toBe("FORA-501.list");
  });

  it("returns the raw id when the id is unknown", () => {
    expect(resolveIdentifier("not-in-the-mock")).toBe("not-in-the-mock");
  });
});