/**
 * RequirementBrief parser — FORA-501 AC #2 round-trip.
 *
 * The Requirement Brief is a `schema_version: "1.0"` JSON envelope.
 * The parser MUST preserve `schema_version` on round-trip
 * (`parse → serialize → parse` yields the same `schema_version` and
 * the same 11 sections).
 *
 * Source of truth: `workspace/memory/architecture.md` §7 (the Handoff
 * Contract schema that pins the brief envelope) and FORA-501 AC #2.
 */

import {
  REQUIREMENT_BRIEF_SECTIONS,
  type RequirementBrief,
  type RequirementBriefSection,
  type RequirementBriefSectionKey,
  type OpenQuestion,
  type ProjectIntelligenceId,
} from "./types";

/** The pinned schema version. Any other version on parse → `null`. */
export const REQUIREMENT_BRIEF_SCHEMA_VERSION = "1.0" as const;

/** Shape we accept on the wire. Anything else is rejected. */
export interface RawRequirementBrief {
  readonly id: ProjectIntelligenceId;
  readonly epicId: ProjectIntelligenceId;
  readonly title: string;
  readonly schema_version?: unknown;
  readonly source: string;
  readonly sections: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly body: string;
    readonly openQuestions?: ReadonlyArray<{
      readonly id: string;
      readonly prompt: string;
      readonly owner?: string | null;
      readonly blocks?: ReadonlyArray<string>;
      readonly dueBy?: string | null;
    }>;
  }>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Parse a raw JSON envelope into the typed `RequirementBrief`. Returns
 *  `null` when `schema_version` is missing or not "1.0", when a
 *  section key is outside the canonical 11, or when required fields
 *  are missing. The parser does NOT mutate the input. */
export function parseRequirementBrief(
  raw: unknown,
): RequirementBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RawRequirementBrief>;

  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.epicId !== "string" || r.epicId.length === 0) return null;
  if (typeof r.title !== "string") return null;
  if (typeof r.source !== "string") return null;
  if (typeof r.createdAt !== "string") return null;
  if (typeof r.updatedAt !== "string") return null;
  if (!Array.isArray(r.sections)) return null;

  if (r.schema_version !== REQUIREMENT_BRIEF_SCHEMA_VERSION) return null;

  const sections: RequirementBriefSection[] = [];
  for (const s of r.sections) {
    if (!s || typeof s !== "object") return null;
    const key = (s as { key?: unknown }).key;
    if (typeof key !== "string") return null;
    if (!isCanonicalSectionKey(key)) return null;
    const title = (s as { title?: unknown }).title;
    const body = (s as { body?: unknown }).body;
    if (typeof title !== "string") return null;
    if (typeof body !== "string") return null;
    const rawOq = (s as { openQuestions?: unknown }).openQuestions;
    const openQuestions: OpenQuestion[] = [];
    if (Array.isArray(rawOq)) {
      for (const q of rawOq) {
        if (!q || typeof q !== "object") return null;
        const id = (q as { id?: unknown }).id;
        const prompt = (q as { prompt?: unknown }).prompt;
        const owner = (q as { owner?: unknown }).owner;
        const blocks = (q as { blocks?: unknown }).blocks;
        const dueBy = (q as { dueBy?: unknown }).dueBy;
        if (typeof id !== "string") return null;
        if (typeof prompt !== "string") return null;
        if (owner !== null && owner !== undefined && typeof owner !== "string") {
          return null;
        }
        if (blocks !== undefined && !Array.isArray(blocks)) return null;
        if (dueBy !== null && dueBy !== undefined && typeof dueBy !== "string") {
          return null;
        }
        openQuestions.push({
          id,
          prompt,
          owner: (owner ?? null) as OpenQuestion["owner"],
          blocks: Array.isArray(blocks)
            ? (blocks as ReadonlyArray<string>)
            : [],
          dueBy: (dueBy ?? null) as string | null,
        });
      }
    }
    sections.push({
      key,
      title,
      body,
      ...(openQuestions.length > 0 ? { openQuestions } : {}),
    });
  }

  if (sections.length !== REQUIREMENT_BRIEF_SECTIONS.length) return null;

  return {
    id: r.id,
    epicId: r.epicId,
    title: r.title,
    schema_version: REQUIREMENT_BRIEF_SCHEMA_VERSION,
    source: r.source,
    sections,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Serialize a typed `RequirementBrief` back to the wire JSON shape.
 *  Round-trip invariant: `parseRequirementBrief(serializeRequirementBrief(b))`
 *  equals `b` (deep equal on every field). */
export function serializeRequirementBrief(
  brief: RequirementBrief,
): RawRequirementBrief {
  return {
    id: brief.id,
    epicId: brief.epicId,
    title: brief.title,
    schema_version: brief.schema_version,
    source: brief.source,
    sections: brief.sections.map((s) => ({
      key: s.key,
      title: s.title,
      body: s.body,
      ...(s.openQuestions && s.openQuestions.length > 0
        ? {
            openQuestions: s.openQuestions.map((q) => ({
              id: q.id,
              prompt: q.prompt,
              owner: q.owner,
              blocks: q.blocks,
              dueBy: q.dueBy,
            })),
          }
        : {}),
    })),
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
  };
}

/** Round-trip a raw envelope: parse → serialize → parse. Used in tests
 *  to prove AC #2 (`schema_version: "1.0"` survives round-trip). */
export function roundTripRequirementBrief(
  raw: unknown,
): RequirementBrief | null {
  const parsed = parseRequirementBrief(raw);
  if (!parsed) return null;
  const serialized = serializeRequirementBrief(parsed);
  return parseRequirementBrief(serialized);
}

function isCanonicalSectionKey(key: string): key is RequirementBriefSectionKey {
  return (REQUIREMENT_BRIEF_SECTIONS as ReadonlyArray<string>).includes(key);
}