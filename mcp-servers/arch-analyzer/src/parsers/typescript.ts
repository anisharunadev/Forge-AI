/**
 * TypeScript / JavaScript parser. Detects:
 *   - `import X from "spec"`           (default + named)
 *   - `import { a, b } from "spec"`
 *   - `import "spec"`                  (side-effect)
 *   - `import("spec")`                 (dynamic)
 *   - `require("spec")`                (CJS)
 *   - `export ... from "spec"`         (re-export)
 *   - `/// <reference path="spec" />`  (legacy triple-slash)
 *
 * The output is raw spec strings (e.g. "./foo", "lodash", "@scope/pkg/sub").
 * The graph builder resolves in-repo specs to module ids; everything else
 * is recorded as an unresolved external edge.
 */

import type { Language, Parser } from "../types.js";

const IMPORT_RE =
  /^\s*(?:import\s+(?:type\s+)?(?:[^'"`;]+?\s+from\s+)?|export\s+(?:[^'"`;]+?\s+from\s+)|import\s*\(|require\s*\()\s*['"`]([^'"`]+)['"`]/gm;

const REFERENCE_RE = /^\s*\/\/\/\s*<reference\s+path\s*=\s*["']([^"']+)["']/gm;

const TECH_DEBT_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;

export const typescriptParser: Parser = {
  languages: ["typescript", "javascript"],
  extensions: [".ts", ".tsx", ".cts", ".mts", ".js", ".jsx", ".cjs", ".mjs"],
  parse({ filePath, content }) {
    const edges: Array<{
      from: string;
      to: string | null;
      raw: string;
      kind: "import" | "call";
      line: number;
    }> = [];

    for (const m of content.matchAll(IMPORT_RE)) {
      const raw = m[1];
      if (!raw) continue;
      const line = lineOf(content, m.index ?? 0);
      edges.push({
        from: filePath,
        to: null, // resolved in graph builder
        raw,
        kind: "import",
        line,
      });
    }
    for (const m of content.matchAll(REFERENCE_RE)) {
      const raw = m[1];
      if (!raw) continue;
      const line = lineOf(content, m.index ?? 0);
      edges.push({
        from: filePath,
        to: null,
        raw,
        kind: "import",
        line,
      });
    }

    return {
      edges,
      loc: countLoc(content),
      techDebt: countTechDebt(content),
    };
  },
};

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function countLoc(content: string): number {
  // Approximate: non-blank, non-pure-comment lines. We strip block comments
  // line by line to avoid counting them.
  let loc = 0;
  let inBlock = false;
  const lines = content.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (inBlock) {
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
      continue;
    }
    if (line.startsWith("//")) continue;
    loc++;
  }
  return loc;
}

function countTechDebt(content: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of content.matchAll(TECH_DEBT_RE)) {
    const tag = m[1]!.toLowerCase();
    out[tag] = (out[tag] ?? 0) + 1;
  }
  return out;
}

/** Helper for tests. */
export function detectLanguage(filePath: string): Language | null {
  if (/\.[cm]?ts$|\.tsx$/.test(filePath)) return "typescript";
  if (/\.[cm]?js$|\.jsx$/.test(filePath)) return "javascript";
  return null;
}
