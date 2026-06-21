#!/usr/bin/env node
/**
 * Forge AI Adobe XD MCP server — entry point.
 *
 * Wires the typed Adobe XD client to the MCP stdio transport and registers
 * all 4 tools. The server reads its config from env vars on startup and
 * refuses to boot if ADOBE_XD_ACCESS_TOKEN, ADOBE_XD_FILE_ID, or
 * ADOBE_XD_PROJECT_ID is missing.
 *
 * Project scope is asserted on startup with a single liveness call to the
 * file endpoint. A misconfigured token or wrong project fails fast and
 * the process exits non-zero before any tool can be called.
 *
 * Review flag: Adobe XD's public API surface is evolving. The startup
 * liveness call goes to `/v1/files/{fileId}` — confirm this matches
 * Adobe's current published endpoint before shipping production traffic.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, fileId, projectId } = createClient(config);

  // Project-scope assertion on startup: hit the file endpoint once and let
  // any 401/403/404 surface immediately. A misconfigured token fails fast
  // and the process exits non-zero before any tool can be called.
  try {
    await client.getFile();
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(
      `[adobe-xd-mcp] project-scope assertion failed for file='${fileId}' project='${projectId}': ${msg}\n`,
    );
    process.exit(2);
  }

  const server = new McpServer(
    {
      name: "forge-ai-mcp-adobe-xd",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `Forge AI Adobe XD MCP — pinned to file='${fileId}' (project='${projectId}'). ` +
        `Tools accept asset ids and tool-specific args; do not pass a different file id — it is server-pinned for safety.`,
    },
  );

  // Register each tool. The MCP SDK takes a Zod raw shape (not a JSON Schema)
  // — see tools.ts for the source of truth.
  for (const def of toolDefinitions) {
    server.tool(
      def.name,
      def.description,
      def.shape,
      async (args: unknown) => handleToolCall(client, def.name as ToolName, args),
    );
  }

  // Log to stderr so we don't pollute the stdio JSON-RPC stream on stdout.
  process.stderr.write(
    `[adobe-xd-mcp] starting — pinned to file='${fileId}', project='${projectId}', api='${config.apiBaseUrl ?? "https://xd.adobe.io"}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[adobe-xd-mcp] received ${signal}, shutting down\n`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(
    `[adobe-xd-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
