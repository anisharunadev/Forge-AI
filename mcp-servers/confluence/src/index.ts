#!/usr/bin/env node
/**
 * FORA Confluence MCP server — entry point.
 *
 * Wires the typed Confluence client to the MCP stdio transport and
 * registers the 3 read-only tools (FORA-290). The server reads its
 * config from env vars on startup, resolves the configured space key
 * to a space id, and refuses to boot if any required var is missing.
 *
 * SCOPE: This server is read-only. Mutation tools
 * (create_page / update_page / add_comment) are not registered and
 * the underlying client has no such methods. The smoke test asserts
 * no POST/PATCH/DELETE route is ever reached.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, spaceId, spaceKey } = await createClient(config);

  const server = new McpServer(
    {
      name: "fora-mcp-confluence",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA Confluence MCP (READ-ONLY, FORA-290) — pinned to space '${spaceKey}' (id=${spaceId}). ` +
        `Tools accept 'page_id' (must belong to the pinned space) and tool-specific args. ` +
        `Do not pass 'spaceId' — it is server-pinned for safety. ` +
        `Mutations (create_page, update_page, add_comment) are NOT available.`,
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
    `[fora-mcp-confluence] starting (READ-ONLY) — pinned to space='${spaceKey}' (id=${spaceId}), api='${config.apiBaseUrl ?? config.baseUrl}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-confluence] received ${signal}, shutting down\n`);
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
    `[fora-mcp-confluence] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
