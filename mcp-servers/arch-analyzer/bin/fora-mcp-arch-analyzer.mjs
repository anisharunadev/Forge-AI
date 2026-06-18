#!/usr/bin/env node
// Launcher for the arch-analyzer MCP server (stdio transport).
// Resolves the compiled dist/ entry point regardless of where the package is installed.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(here, "..", "dist", "mcp.js");

await import(distEntry);
