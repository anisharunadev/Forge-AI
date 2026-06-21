/**
 * applyAuditQuery — narrow an `AuditEntry[]` against an `AuditQuery`.
 *
 * Pure function: same input → same output. Used by the Audit Center composer
 * to derive the displayed row set from the provider's audit entries + the
 * user's current query. The provider's `getNodes` does not need to know
 * about the query — the renderer is the source of truth for what the user
 * sees, the runtime is the source of truth for tenant scope.
 *
 * A null/empty axis = "no filter on this axis." Empty arrays on a list axis
 * = "match nothing on this axis" (NOT "match everything"). The empty-query
 * shape `{}` is the only way to opt out of filtering entirely.
 */

import type { AuditEntry } from "../typed-artifacts/types";
import type { AuditQuery, FilteredAuditEntry } from "./types";

export function applyAuditQuery(
  entries: ReadonlyArray<AuditEntry>,
  query: AuditQuery,
): ReadonlyArray<FilteredAuditEntry> {
  const text = query.text?.trim().toLowerCase() ?? "";
  const stages = query.stages ?? null;
  const tools = query.tools ?? null;
  const actorKinds = query.actorKinds ?? null;
  const actorIds = query.actorIds ?? null;
  const since = query.since ? Date.parse(query.since) : null;
  const until = query.until ? Date.parse(query.until) : null;
  const minCost = query.minCostUsd ?? null;
  const tenantId = query.tenantId ?? null;

  return entries.map((entry) => ({
    entry,
    matches: matches(entry, {
      text, stages, tools, actorKinds, actorIds, since, until, minCost, tenantId,
    }),
  })).filter((f) => f.matches);
}

interface Axes {
  readonly text: string;
  readonly stages: ReadonlyArray<string> | null;
  readonly tools: ReadonlyArray<string> | null;
  readonly actorKinds: ReadonlyArray<AuditEntry["actor"]["kind"]> | null;
  readonly actorIds: ReadonlyArray<string> | null;
  readonly since: number | null;
  readonly until: number | null;
  readonly minCost: number | null;
  readonly tenantId: string | null;
}

function matches(entry: AuditEntry, axes: Axes): boolean {
  if (axes.tenantId !== null && entry.tenantId !== axes.tenantId) return false;
  if (axes.stages !== null) {
    // Entry does not carry a `stage` field; fall back to tenant-id prefix as
    // a coarse signal (matches the audit-log fixture shape). The real
    // runtime query uses the audit-spine index instead of this filter — see
    // memory/security.md §6.
    const stage = inferStageFromEntry(entry);
    if (stage === null || !axes.stages.includes(stage)) return false;
  }
  if (axes.tools !== null && !axes.tools.includes(entry.tool)) return false;
  if (axes.actorKinds !== null && !axes.actorKinds.includes(entry.actor.kind)) return false;
  if (axes.actorIds !== null && !axes.actorIds.includes(entry.actor.id)) return false;
  if (axes.text.length > 0) {
    const haystack = [
      entry.tool,
      entry.queryHash ?? "",
      entry.responseHash ?? "",
      entry.actor.id,
      entry.actor.displayName ?? "",
      entry.tenantId,
    ].join(" ").toLowerCase();
    if (!haystack.includes(axes.text)) return false;
  }
  const ts = Date.parse(entry.timestamp);
  if (axes.since !== null && (Number.isNaN(ts) || ts < axes.since)) return false;
  if (axes.until !== null && (Number.isNaN(ts) || ts >= axes.until)) return false;
  if (axes.minCost !== null && (entry.costUsd ?? 0) <= axes.minCost) return false;
  return true;
}

/**
 * Map a tool name to a BMAD stage. The mapping is intentionally narrow —
 * the runtime owns the canonical stage index, and v1.0 fixtures only cover
 * the four tool names that have shipped so far. A non-mapped tool returns
 * `null`, which the renderer treats as "no filter on the stage axis."
 */
function inferStageFromEntry(entry: AuditEntry): string | null {
  switch (entry.tool) {
    case "ideation":
      return "ideation";
    case "architect":
      return "architect";
    case "developer":
      return "dev";
    case "qa":
      return "qa";
    case "security":
      return "security";
    case "devops":
      return "devops";
    case "documentation":
      return "docs";
    default:
      return null;
  }
}
