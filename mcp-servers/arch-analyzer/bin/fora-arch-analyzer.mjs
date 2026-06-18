#!/usr/bin/env node
// CLI launcher for the arch-analyzer (used by humans, scripts, and CI).
// Usage:
//   fora-arch-analyzer <repo-path> [--out <dir>] [--max-loc <n>] [--format json|markdown|both]
// Exit codes:
//   0  success
//   1  invalid args
//   2  input path missing or not a directory
//   3  analyzer internal error

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, "..", "dist", "cli.js");

await import(distEntry);
