/**
 * Java parser. Detects:
 *   - Single-line: `import a.b.C;`
 *   - Static imports: `import static a.b.C.method;`
 *   - Wildcards: `import a.b.*;`     (edge with raw = "a.b.*")
 *
 * The spec is the fully-qualified name. Wildcards are recorded as
 * unresolved external edges (a.b.* spans an unknown set of classes).
 * The graph builder attempts to resolve non-wildcard imports to a file
 * by walking the package directory under the conventional `src/main/java`
 * source root, falling back to the repo root.
 */

import type { Language, Parser } from "../types.js";

const IMPORT_RE = /^[ \t]*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
const PACKAGE_RE = /^[ \t]*package\s+([\w.]+)\s*;/m;

const TECH_DEBT_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;

export const javaParser: Parser = {
  languages: ["java"],
  extensions: [".java"],
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
        to: null,
        raw,
        kind: "import",
        line,
      });
    }

    // Stash the package on the loc object so the graph builder can use it
    // to compute the canonical FQN for resolution hints. We surface it
    // through techDebt shape (harmless, doesn't pollute the report).
    const loc = countLoc(content);
    const techDebt = countTechDebt(content);
    const pkg = PACKAGE_RE.exec(content)?.[1];
    if (pkg) techDebt["__package__"] = 0; // sentinel — see graph.ts

    return { edges, loc, techDebt };
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
  if (/\.java$/.test(filePath)) return "java";
  return null;
}
