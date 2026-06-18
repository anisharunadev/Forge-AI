/**
 * Go parser. Detects:
 *   - Single-line:     `import "fmt"`
 *   - Single-line aliased: `import f "fmt"`
 *   - Grouped block:   `import ( "fmt" ; "os" ; alias "path" )`
 *
 * The spec string emitted is the package path inside the quotes.
 * External packages (e.g. "github.com/foo/bar") are recorded as
 * unresolved external edges; in-repo packages are resolved by basename
 * in the graph builder (Go imports use package basename, not file path).
 */

import type { Language, Parser } from "../types.js";

const SINGLE_IMPORT_RE = /^[ \t]*import\s+(?:\w+\s+)?"([^"]+)"/gm;
const BLOCK_IMPORT_RE = /^[ \t]*import\s*\(([\s\S]*?)\)/gm;
const BLOCK_LINE_RE = /^\s*(?:\w+\s+)?"([^"]+)"\s*$/gm;

const TECH_DEBT_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;

export const goParser: Parser = {
  languages: ["go"],
  extensions: [".go"],
  parse({ filePath, content }) {
    const edges: Array<{
      from: string;
      to: string | null;
      raw: string;
      kind: "import" | "call";
      line: number;
    }> = [];

    for (const m of content.matchAll(SINGLE_IMPORT_RE)) {
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
    for (const block of content.matchAll(BLOCK_IMPORT_RE)) {
      const body = block[1] ?? "";
      const blockStart = (block.index ?? 0) + (block[0]?.indexOf("(") ?? 0) + 1;
      for (const lineMatch of body.matchAll(BLOCK_LINE_RE)) {
        const raw = lineMatch[1];
        if (!raw) continue;
        const line = lineOf(content, blockStart + (lineMatch.index ?? 0));
        edges.push({
          from: filePath,
          to: null,
          raw,
          kind: "import",
          line,
        });
      }
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
      if (line.includes("*/")) inBlock = false;
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlock = true;
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
  if (/\.go$/.test(filePath)) return "go";
  return null;
}
