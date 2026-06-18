/**
 * Output formatters. The graph artefact is `codebase-graph.json` (a
 * structured, stable representation). The summary is a human-readable
 * Markdown report covering entry points, modules, hot files, cycles,
 * and tech-debt markers.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CodebaseGraph } from "./types.js";

export interface EmitOptions {
  graph: CodebaseGraph;
  outDir: string;
  format: "json" | "markdown" | "both";
}

export async function emit(opts: EmitOptions): Promise<{
  jsonPath?: string;
  markdownPath?: string;
}> {
  const { graph, outDir, format } = opts;
  await mkdir(outDir, { recursive: true });

  const out: { jsonPath?: string; markdownPath?: string } = {};

  if (format === "json" || format === "both") {
    const jsonPath = join(outDir, "codebase-graph.json");
    await writeFile(jsonPath, JSON.stringify(graph, null, 2), "utf8");
    out.jsonPath = jsonPath;
  }

  if (format === "markdown" || format === "both") {
    const markdownPath = join(outDir, "summary.md");
    await writeFile(markdownPath, renderSummary(graph), "utf8");
    out.markdownPath = markdownPath;
  }

  return out;
}

export function renderSummary(g: CodebaseGraph): string {
  const lines: string[] = [];
  lines.push(`# Codebase Graph Summary`);
  lines.push("");
  lines.push(`- **Repository root**: \`${g.repoRoot}\``);
  lines.push(`- **Generated at**: ${g.generatedAt}`);
  lines.push(`- **Schema version**: ${g.version}`);
  lines.push(`- **Files analyzed**: ${g.fileCount}`);
  lines.push(`- **Total LOC**: ${g.totalLoc}`);
  lines.push(`- **Edges**: ${g.edges.length}`);
  lines.push(`- **Cycles detected**: ${g.cycles.length}`);
  lines.push(`- **Duration**: ${g.durationMs} ms`);
  lines.push("");

  // Languages
  lines.push("## Languages");
  lines.push("");
  lines.push("| Language | Files |");
  lines.push("| --- | ---: |");
  for (const [lang, count] of Object.entries(g.languages)) {
    if (count > 0) lines.push(`| ${lang} | ${count} |`);
  }
  lines.push("");

  // Top fan-out (god modules).
  lines.push("## High fan-out modules (potential god modules)");
  lines.push("");
  if (g.highFanOut.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Module | Outgoing imports |");
    lines.push("| --- | ---: |");
    for (const h of g.highFanOut) {
      lines.push(`| \`${h.id}\` | ${h.fanOut} |`);
    }
  }
  lines.push("");

  // Top fan-in (load-bearing).
  lines.push("## High fan-in modules (load-bearing)");
  lines.push("");
  if (g.highFanIn.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Module | Incoming imports |");
    lines.push("| --- | ---: |");
    for (const h of g.highFanIn) {
      lines.push(`| \`${h.id}\` | ${h.fanIn} |`);
    }
  }
  lines.push("");

  // Cycles.
  lines.push("## Circular dependencies");
  lines.push("");
  if (g.cycles.length === 0) {
    lines.push("_No circular dependencies detected._");
  } else {
    lines.push("Each group is a strongly connected component (size > 1) of modules that import each other in a cycle. Break the cycle by removing or inverting one edge per group.");
    lines.push("");
    for (const [i, cycle] of g.cycles.entries()) {
      lines.push(`### Cycle ${i + 1} (${cycle.length} modules)`);
      lines.push("");
      for (const id of cycle) lines.push(`- \`${id}\``);
      lines.push("");
    }
  }
  lines.push("");

  // Entry points heuristic: low fan-in + non-zero fan-out (i.e. they call
  // others but aren't called by many). Sorted by fan-out desc.
  const entries = Object.values(g.nodes)
    .filter((n) => n.fanIn <= 1 && n.fanOut >= 2)
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);
  lines.push("## Likely entry points");
  lines.push("");
  if (entries.length === 0) {
    lines.push("_No entry-point candidates detected. (Threshold: fan-in ≤ 1, fan-out ≥ 2.)_");
  } else {
    lines.push("| Module | Fan-in | Fan-out | LOC |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const e of entries) {
      lines.push(`| \`${e.path}\` | ${e.fanIn} | ${e.fanOut} | ${e.loc} |`);
    }
  }
  lines.push("");

  // Tech-debt summary: aggregate counts across all nodes.
  const debtTotals: Record<string, number> = {};
  for (const n of Object.values(g.nodes)) {
    for (const [tag, count] of Object.entries(n.techDebt)) {
      if (tag === "__package__") continue;
      debtTotals[tag] = (debtTotals[tag] ?? 0) + count;
    }
  }
  lines.push("## Tech-debt markers");
  lines.push("");
  const tags = Object.keys(debtTotals).sort();
  if (tags.length === 0) {
    lines.push("_No TODO/FIXME/HACK/XXX markers detected._");
  } else {
    lines.push("| Marker | Count |");
    lines.push("| --- | ---: |");
    for (const tag of tags) {
      lines.push(`| \`${tag.toUpperCase()}\` | ${debtTotals[tag] ?? 0} |`);
    }
  }
  lines.push("");

  // Skipped files (LOC budget).
  if (g.skipped.length > 0) {
    lines.push("## Skipped files");
    lines.push("");
    lines.push(`| File | Reason |`);
    lines.push(`| --- | --- |`);
    for (const s of g.skipped) lines.push(`| \`${s.path}\` | ${s.reason} |`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Full machine-readable graph: see `codebase-graph.json` in this directory.");
  return lines.join("\n");
}

// Re-export the dirname/join to keep the helper import surface small.
export const _emitHelpers = { dirname, join };
