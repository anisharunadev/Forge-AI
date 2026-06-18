#!/usr/bin/env node
// Thin launcher — runs the compiled server.
import("../dist/index.js").catch((err) => {
  process.stderr.write(
    `[fora-mcp-slack] failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
