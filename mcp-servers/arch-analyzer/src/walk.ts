/**
 * File walker. Recursively scans a directory and returns the absolute paths
 * of files matching one of the supported language extensions. Skips common
 * build / dependency directories by default.
 *
 * The walker is intentionally simple: deterministic, no symlink resolution,
 * no fs.watch, no concurrency. The bottleneck for the arch-analyzer is
 * always parsing, not directory traversal.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  "Pods",
  ".gradle",
  ".idea",
  ".vscode",
  "coverage",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".cts",
  ".mts",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".py",
  ".pyx",
  ".go",
  ".java",
]);

export interface WalkResult {
  /** Absolute paths, sorted. */
  files: string[];
  /** Repository-relative paths (POSIX, no leading "./"), parallel to `files`. */
  relativeFiles: string[];
}

export async function walkRepo(
  repoRoot: string,
  options: { ignore?: string[] } = {},
): Promise<WalkResult> {
  const ignoreDirs = new Set([...DEFAULT_IGNORED_DIRS, ...(options.ignore ?? [])]);
  const files: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Permission denied / broken symlink: skip the directory.
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = entry.name.slice(dot).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      files.push(full);
    }
  }

  const rootStat = await stat(repoRoot).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`walkRepo: '${repoRoot}' is not a directory`);
  }
  await visit(repoRoot);

  files.sort();
  const relativeFiles = files.map((f) => toPosixRelative(repoRoot, f));
  return { files, relativeFiles };
}

function toPosixRelative(repoRoot: string, filePath: string): string {
  const rel = relative(repoRoot, filePath);
  return rel.split(sep).join("/");
}
