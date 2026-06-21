#!/usr/bin/env node
// Thin launcher — runs the compiled server.
import("../dist/index.js").catch((err) => {
  process.stderr.write(
    `[kiro-mcp] failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
