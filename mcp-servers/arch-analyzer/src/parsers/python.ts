/**
 * Python parser. Detects:
 *   - `import X`
 *   - `import X as Y`
 *   - `import X.Y.Z`
 *   - `from X import a, b`
 *   - `from X.Y import (a, b)`   (multi-line tolerated)
 *   - `from .relative import a`  (relative; resolved to repo path)
 *
 * Spec string emitted is the module path (`X`, `X.Y`, or `.relative`).
 * Dotted attribute access (e.g. `importlib.import_module(...)`) is a call
 * edge and is handled by a lighter call-edge pass in graph.ts — we keep
 * this parser focused on import statements.
 */

import type { Language, Parser } from "../types.js";

const IMPORT_RE = /^[ \t]*import\s+([\w.]+(?:\s+as\s+\w+)?)\s*$/gm;
const FROM_IMPORT_RE =
  /^[ \t]*from\s+(\.{0,3}[\w.]*(?:\.[\w.]+)*)\s+import\s+(?:\(([^)]+)\)|([\w., \t]+))/gm;

const TECH_DEBT_RE = /\b(TODO|FIXME|HACK|XXX|XXX|TBD)\b/g;

export const pythonParser: Parser = {
  languages: ["python"],
  extensions: [".py", ".pyx"],
  parse({ filePath, content }) {
    const edges: Array<{
      from: string;
      to: string | null;
      raw: string;
      kind: "import" | "call";
      line: number;
    }> = [];

    for (const m of content.matchAll(IMPORT_RE)) {
      const raw = m[1]?.split(/\s+as\s+/)[0]?.trim();
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
    for (const m of content.matchAll(FROM_IMPORT_RE)) {
      const mod = m[1]?.trim();
      if (!mod) continue;
      const line = lineOf(content, m.index ?? 0);
      edges.push({
        from: filePath,
        to: null,
        raw: mod,
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
  let loc = 0;
  let inBlock = false;
  const lines = content.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (inBlock) {
      if (line.includes('"""') || line.includes("'''")) inBlock = false;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (line.startsWith('"""') || line.startsWith("'''")) {
      if (!(line.endsWith('"""') && line.length > 3) && !(line.endsWith("'''") && line.length > 3)) {
        inBlock = true;
      }
      continue;
    }
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
  if (/\.py$|\.pyx$/.test(filePath)) return "python";
  return null;
}
