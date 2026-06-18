#!/usr/bin/env node
/**
 * FORA Figma MCP server — entry point.
 *
 * Wires the typed Figma client to the MCP stdio transport and registers all
 * 6 tools. The server reads its config from env vars on startup and refuses
 * to boot if FIGMA_TOKEN, FIGMA_FILE_KEY, or FIGMA_TEAM_ID is missing.
 *
 * Team scope is asserted on startup with a single liveness call to the file
 * endpoint. A misconfigured token or wrong team fails fast and the process
 * exits non-zero before any tool can be called.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, fileKey, teamId } = createClient(config);

  // Team-scope assertion on startup: hit the file endpoint once and let
  // any 401/403/404 surface immediately. The mock used by the smoke test
  // accepts this call. The real Figma API will 403 if the token cannot
  // see the file (wrong team, wrong scope), and we treat that as a fatal
  // startup error rather than letting the model discover it on first call.
  try {
    await client.getFile();
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(
      `[fora-mcp-figma] team-scope assertion failed for file='${fileKey}' team='${teamId}': ${msg}\n`,
    );
    process.exit(2);
  }

  const server = new McpServer(
    {
      name: "fora-mcp-figma",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA Figma MCP — pinned to file='${fileKey}' (team='${teamId}'). ` +
        `Tools accept node ids and tool-specific args; do not pass a file key — it is server-pinned for safety.`,
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
    `[fora-mcp-figma] starting — pinned to file='${fileKey}', team='${teamId}', api='${config.apiBaseUrl ?? "https://api.figma.com"}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-figma] received ${signal}, shutting down\n`);
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
    `[fora-mcp-figma] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
