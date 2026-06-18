/**
 * Shared types for the arch-analyzer.
 *
 * A node is a source file with a stable ID. An edge is a directional import
 * or call reference between two nodes. Everything else (cycles, fanout,
 * hot files) is derived from this graph in graph.ts.
 */

export type Language = "typescript" | "javascript" | "python" | "go" | "java";

export interface ModuleNode {
  /** Stable ID: relative POSIX path from repo root, without leading "./". */
  id: string;
  /** Repository-relative path (POSIX). Same as id but kept separate for clarity. */
  path: string;
  /** Detected language. */
  language: Language;
  /** Non-blank, non-comment lines (approximate LOC). */
  loc: number;
  /** Number of times this module is imported by other modules. */
  fanIn: number;
  /** Number of distinct modules this module imports. */
  fanOut: number;
  /**
   * Tech-debt markers detected in the file. Keys are marker ids, values
   * are counts. Examples: "todo", "fixme", "hack", "xxx".
   */
  techDebt: Record<string, number>;
}

export type EdgeKind = "import" | "call";

export interface GraphEdge {
  /** ID of the source module (importer). */
  from: string;
  /** ID of the target module (imported). May be null for unresolved external imports. */
  to: string | null;
  /** Raw spec as it appears in source: import path, module name, etc. */
  raw: string;
  kind: EdgeKind;
  /** 1-based line number in the source file. */
  line: number;
  /** Whether the edge points to an in-repo module. */
  internal: boolean;
  /** Language of the source file. */
  language: Language;
}

export interface CodebaseGraph {
  /** Schema version. Bump on breaking changes. */
  version: "1.0.0";
  /** Absolute path to the repo root that was analyzed. */
  repoRoot: string;
  /** ISO 8601 timestamp of the analysis run. */
  generatedAt: string;
  /** Total source files discovered. */
  fileCount: number;
  /** Total LOC across all files. */
  totalLoc: number;
  /** Files skipped because of the LOC budget, with reasons. */
  skipped: Array<{ path: string; reason: string }>;
  /** Languages detected, with file counts. */
  languages: Record<Language, number>;
  /** Modules (files) keyed by stable id. */
  nodes: Record<string, ModuleNode>;
  /** Edges, deduplicated by (from, to, kind, raw). */
  edges: GraphEdge[];
  /** Detected strongly connected components with size > 1 (real cycles). */
  cycles: string[][];
  /** Top-N modules by outgoing imports (potential god-modules). */
  highFanOut: Array<{ id: string; fanOut: number }>;
  /** Top-N modules by incoming imports (load-bearing modules). */
  highFanIn: Array<{ id: string; fanIn: number }>;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

export interface AnalyzeOptions {
  /** Absolute path to the repo root. */
  repoRoot: string;
  /** Maximum total LOC to process (default 50_000). Files beyond the budget are skipped. */
  maxLoc?: number;
  /** Optional output directory. If omitted, prints to stdout. */
  outDir?: string;
  /** Which artefact to emit when outDir is set. Default "both". */
  format?: "json" | "markdown" | "both";
  /** Glob patterns to ignore. Default sensible node_modules / .git / dist. */
  ignore?: string[];
  /** Whether to log progress to stderr. Default true for CLI, false for MCP. */
  verbose?: boolean;
}

export interface Parser {
  /** Languages this parser handles. */
  readonly languages: Language[];
  /** File extensions this parser handles. */
  readonly extensions: string[];
  /**
   * Parse a single file and return its import edges + LOC + tech-debt markers.
   * Edges with `to: null` represent unresolved / external imports that the
   * graph builder should still record (with `internal: false`).
   */
  parse(args: {
    filePath: string;
    repoRoot: string;
    content: string;
  }): {
    edges: Array<Omit<GraphEdge, "internal" | "language">>;
    loc: number;
    techDebt: Record<string, number>;
  };
}
