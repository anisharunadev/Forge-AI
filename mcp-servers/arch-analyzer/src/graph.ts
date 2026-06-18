/**
 * Graph builder.
 *
 * Responsibilities:
 *   1. Walk all discovered files and run the appropriate parser.
 *   2. Resolve raw import specs to in-repo module ids where possible.
 *   3. Deduplicate edges.
 *   4. Compute per-node fan-in / fan-out.
 *   5. Detect strongly connected components of size > 1 (real cycles).
 *   6. Identify high-fanout (god modules) and high-fanin (load-bearing).
 *
 * Resolution rules (best-effort, conservative):
 *   - TS/JS: try spec with each supported extension, then index file, then
 *     path/index.{ts,js,tsx,jsx}. Relative specs resolve from the importer.
 *     Workspace packages (no leading "./" or "/") are recorded as external.
 *   - Python: convert dotted module path to path/to/module.py, also try
 *     path/to/module/__init__.py. Relative `.` / `..` paths resolve from
 *     the importer's package directory.
 *   - Go: match by package basename. Each Go file belongs to a single
 *     package; we record the package via the basename of the imported
 *     path. All in-repo packages are resolved this way.
 *   - Java: FQN → path. We try `<repo>/<fqn-as-path>.java` and the
 *     conventional `src/main/java/<fqn-as-path>.java`. Wildcards stay
 *     external.
 *
 * Unresolved imports (third-party / stdlib / typos) are kept in the edge
 * list with `to: null` and `internal: false`. They contribute to fanout
 * but not fanin.
 */

import { readFile } from "node:fs/promises";
import { dirname, extname, join, posix, sep } from "node:path";

import { pickParser } from "./parsers/index.js";
import { typescriptParser } from "./parsers/typescript.js";
import { pythonParser } from "./parsers/python.js";
import { goParser } from "./parsers/go.js";
import { javaParser } from "./parsers/java.js";
import type {
  CodebaseGraph,
  GraphEdge,
  Language,
  ModuleNode,
} from "./types.js";

const TS_EXTS = [".ts", ".tsx", ".cts", ".mts", ".js", ".jsx", ".cjs", ".mjs", ".d.ts"];
const PY_EXTS = [".py", ".pyx"];
const GO_EXTS = [".go"];
const JAVA_EXTS = [".java"];

const TOP_N_FAN = 10;

export interface BuildOptions {
  repoRoot: string;
  files: string[];
  relativeFiles: string[];
  maxLoc: number;
  verbose: boolean;
}

export async function buildGraph(opts: BuildOptions): Promise<CodebaseGraph> {
  const startedAt = Date.now();
  const { repoRoot, files, relativeFiles } = opts;
  const maxLoc = opts.maxLoc;

  // 1. Index: relative path → absolute path; package basename → set of files.
  const relToAbs = new Map<string, string>();
  for (let i = 0; i < relativeFiles.length; i++) {
    relToAbs.set(relativeFiles[i]!, files[i]!);
  }

  // Go package index: "fmt" → ["src/fmt/print.go", ...]
  const goPackageIndex = indexGoPackages(repoRoot, relativeFiles);

  // Java package index: "com.foo.Bar" → "com/foo/Bar.java"
  // Built lazily during the parse loop.

  // 2. Parse all files (subject to LOC budget).
  const nodes: Record<string, ModuleNode> = {};
  const edges: GraphEdge[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const languages: Record<Language, number> = {
    typescript: 0,
    javascript: 0,
    python: 0,
    go: 0,
    java: 0,
  };

  let totalLoc = 0;
  for (let i = 0; i < relativeFiles.length; i++) {
    const rel = relativeFiles[i]!;
    const abs = files[i]!;
    const picked = pickParser(rel);
    if (!picked) continue;
    const { parser, language } = picked;

    if (totalLoc >= maxLoc) {
      skipped.push({ path: rel, reason: "loc_budget_exceeded" });
      continue;
    }

    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch (err) {
      skipped.push({ path: rel, reason: `read_error:${(err as Error).message}` });
      continue;
    }

    const result = parser.parse({ filePath: rel, repoRoot, content });
    totalLoc += result.loc;
    languages[language]++;

    // Strip the Java package sentinel before storing.
    const techDebt = { ...result.techDebt };
    delete techDebt["__package__"];

    nodes[rel] = {
      id: rel,
      path: rel,
      language,
      loc: result.loc,
      fanIn: 0,
      fanOut: 0,
      techDebt,
    };

    for (const edge of result.edges) {
      const resolved = resolveImport({
        spec: edge.raw,
        importerRel: rel,
        relToAbs,
        repoRoot,
        language,
        goPackageIndex,
      });
      edges.push({
        from: rel,
        to: resolved,
        raw: edge.raw,
        kind: edge.kind,
        line: edge.line,
        internal: resolved !== null,
        language,
      });
    }

    if (opts.verbose && (i % 50 === 0 || i === relativeFiles.length - 1)) {
      process.stderr.write(
        `[arch-analyzer] parsed ${i + 1}/${relativeFiles.length} files (${totalLoc} LOC)\n`,
      );
    }
  }

  // 3. Deduplicate edges: (from, to, kind, raw) signature.
  const seen = new Set<string>();
  const uniqueEdges: GraphEdge[] = [];
  for (const e of edges) {
    const key = `${e.from}|${e.to ?? "<ext>"}|${e.kind}|${e.raw}|${e.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEdges.push(e);
  }

  // 4. Fan-in / fan-out.
  for (const e of uniqueEdges) {
    if (e.internal && e.to && nodes[e.to]) nodes[e.to]!.fanIn++;
    const fromNode = nodes[e.from];
    if (fromNode) fromNode.fanOut++;
  }

  // 5. Cycles via Tarjan's SCC.
  const cycles = findCycles(nodes, uniqueEdges);

  // 6. Hot files: top N by fanOut and fanIn.
  const byFanOut = Object.values(nodes)
    .filter((n) => n.fanOut > 0)
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, TOP_N_FAN)
    .map((n) => ({ id: n.id, fanOut: n.fanOut }));
  const byFanIn = Object.values(nodes)
    .filter((n) => n.fanIn > 0)
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, TOP_N_FAN)
    .map((n) => ({ id: n.id, fanIn: n.fanIn }));

  return {
    version: "1.0.0",
    repoRoot,
    generatedAt: new Date().toISOString(),
    fileCount: Object.keys(nodes).length,
    totalLoc,
    skipped,
    languages,
    nodes,
    edges: uniqueEdges,
    cycles,
    highFanOut: byFanOut,
    highFanIn: byFanIn,
    durationMs: Date.now() - startedAt,
  };
}

// --- Resolution -----------------------------------------------------------

interface ResolveArgs {
  spec: string;
  importerRel: string;
  relToAbs: Map<string, string>;
  repoRoot: string;
  language: Language;
  goPackageIndex: Map<string, string[]>;
}

function resolveImport(args: ResolveArgs): string | null {
  const { spec, importerRel, relToAbs, language, goPackageIndex } = args;

  if (language === "typescript" || language === "javascript") {
    return resolveTsSpec(spec, importerRel, relToAbs);
  }
  if (language === "python") {
    return resolvePySpec(spec, importerRel, relToAbs);
  }
  if (language === "go") {
    return resolveGoSpec(spec, goPackageIndex);
  }
  if (language === "java") {
    return resolveJavaSpec(spec, relToAbs, args.repoRoot);
  }
  return null;
}

function resolveTsSpec(
  spec: string,
  importerRel: string,
  relToAbs: Map<string, string>,
): string | null {
  // External (workspace / npm) packages: no leading . or / and not a URL.
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;

  const importerDir = posix.dirname(importerRel);
  const base = spec.startsWith("/")
    ? spec.slice(1)
    : posix.join(importerDir, spec);
  const normalized = posix.normalize(base);

  // Try spec verbatim first.
  for (const ext of TS_EXTS) {
    const candidate = `${normalized}${ext}`;
    if (relToAbs.has(candidate)) return candidate;
  }
  // Try directory + index.{ts,tsx,js,jsx}.
  for (const ext of TS_EXTS) {
    const candidate = `${normalized}/index${ext}`;
    if (relToAbs.has(candidate)) return candidate;
  }
  return null;
}

function resolvePySpec(
  spec: string,
  importerRel: string,
  relToAbs: Map<string, string>,
): string | null {
  // Relative: starts with '.'
  if (spec.startsWith(".")) {
    const importerDir = posix.dirname(importerRel);
    // number of dots = number of `..` to climb plus 1 for current.
    const dots = spec.match(/^\.+/)?.[0].length ?? 0;
    const rest = spec.slice(dots);
    let base = importerDir;
    for (let i = 1; i < dots; i++) base = posix.dirname(base);
    const parts = rest ? rest.split(".") : [];
    base = posix.normalize(posix.join(base, ...parts));
    return findPyFile(base, relToAbs);
  }

  // Absolute dotted module path: e.g. "pkg.sub.mod"
  const parts = spec.split(".");
  const base = parts.join("/");
  return findPyFile(base, relToAbs);
}

function findPyFile(base: string, relToAbs: Map<string, string>): string | null {
  for (const ext of PY_EXTS) {
    const candidate = `${base}${ext}`;
    if (relToAbs.has(candidate)) return candidate;
  }
  const init = `${base}/__init__.py`;
  if (relToAbs.has(init)) return init;
  return null;
}

function resolveGoSpec(spec: string, goPackageIndex: Map<string, string[]>): string | null {
  // spec is a path like "fmt" or "github.com/foo/bar/pkg".
  const parts = spec.split("/");
  const basename = parts[parts.length - 1] ?? "";
  const candidates = goPackageIndex.get(basename);
  if (candidates && candidates.length > 0) {
    // If only one Go file in the package, return it. If multiple, return the
    // first deterministically (sorted) — we still record all imports.
    return [...candidates].sort()[0]!;
  }
  return null;
}

function indexGoPackages(repoRoot: string, relativeFiles: string[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const rel of relativeFiles) {
    if (!rel.endsWith(".go")) continue;
    // The "package" in Go import resolution is the basename of the dir.
    // We index by the directory basename, not the package name, because
    // the spec from import "fmt" → "fmt" matches the dir basename.
    const dir = posix.dirname(rel);
    const base = posix.basename(dir);
    if (!idx.has(base)) idx.set(base, []);
    idx.get(base)!.push(rel);
  }
  return idx;
}

function resolveJavaSpec(
  spec: string,
  relToAbs: Map<string, string>,
  repoRoot: string,
): string | null {
  if (spec.endsWith(".*")) return null; // wildcard, not a single class
  const path = spec.replace(/\./g, "/") + ".java";
  if (relToAbs.has(path)) return path;
  // Conventional Maven layout.
  const mvn = posix.join("src", "main", "java", path);
  if (relToAbs.has(mvn)) return mvn;
  // Gradle layout.
  const gradle = posix.join("src", path);
  if (relToAbs.has(gradle)) return gradle;
  return null;
}

// --- Cycle detection (Tarjan's SCC) --------------------------------------

function findCycles(
  nodes: Record<string, ModuleNode>,
  edges: GraphEdge[],
): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const id of Object.keys(nodes)) adj.set(id, new Set());
  for (const e of edges) {
    if (!e.internal || !e.to) continue;
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.add(e.to);
  }
  const ids = Object.keys(nodes);
  const indexOf = new Map<string, number>();
  ids.forEach((id, i) => indexOf.set(id, i));
  const indices = new Array<number>(ids.length).fill(-1);
  const lowlink = new Array<number>(ids.length).fill(-1);
  const onStack = new Array<boolean>(ids.length).fill(false);
  const stack: string[] = [];
  let idx = 0;
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    const vi = indexOf.get(v)!;
    indices[vi] = idx;
    lowlink[vi] = idx;
    idx++;
    stack.push(v);
    onStack[vi] = true;
    for (const w of adj.get(v) ?? []) {
      const wi = indexOf.get(w);
      if (wi === undefined) continue;
      if (indices[wi] === -1) {
        strongconnect(w);
        lowlink[vi] = Math.min(lowlink[vi]!, lowlink[wi]!);
      } else if (onStack[wi]) {
        lowlink[vi] = Math.min(lowlink[vi]!, indices[wi]!);
      }
    }
    if (lowlink[vi] === indices[vi]) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack[indexOf.get(w)!] = false;
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort());
    }
  }

  for (const v of ids) {
    if (indices[indexOf.get(v)!] === -1) strongconnect(v);
  }
  sccs.sort((a, b) => b.length - a.length);
  return sccs;
}

// Re-export for unit tests / smoke checks.
export const _internal = {
  resolveTsSpec,
  resolvePySpec,
  resolveGoSpec,
  resolveJavaSpec,
  findCycles,
  indexGoPackages,
  TS_EXTS,
  PY_EXTS,
  GO_EXTS,
  JAVA_EXTS,
};

// Reference the parser modules so they aren't tree-shaken if a future build
// configuration accidentally strips dynamic imports. They are imported via
// ./parsers/index.js above, but this keeps the dependency surface explicit.
export const _parsersLoaded = {
  typescriptParser,
  pythonParser,
  goParser,
  javaParser,
};

// Use the `dirname`/`extname`/`join`/`sep` imports to avoid TypeScript
// complaining about unused locals if the build is non-isolated.
export const _platformHelpers = { dirname, extname, join, sep };
