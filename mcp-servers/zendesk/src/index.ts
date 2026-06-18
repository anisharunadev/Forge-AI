#!/usr/bin/env node
/**
 * FORA Zendesk MCP server — entry point.
 *
 * Wires the typed Zendesk client to the MCP stdio transport and registers
 * all 8 tools. The server reads its config from env vars on startup and
 * refuses to boot if ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, or ZENDESK_API_TOKEN
 * is missing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, subdomain } = createClient(config);

  const server = new McpServer(
    {
      name: "fora-mcp-zendesk",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA Zendesk MCP — pinned to subdomain '${subdomain}.zendesk.com'. ` +
        `Tools take IDs and primitives only. ` +
        `Mutations (create_ticket, update_ticket) require ` +
        `'confirm: true' in the call.`,
    },
  );

  // Register each tool. The MCP SDK takes a Zod raw shape (not a JSON
  // Schema) — see tools.ts for the source of truth.
  for (const def of toolDefinitions) {
    server.tool(
      def.name,
      def.description,
      def.shape,
      async (args: unknown) => handleToolCall(client, def.name as ToolName, args),
    );
  }

  // Log to stderr so we don't pollute the stdio JSON-RPC stream on stdout.
  const apiBase = config.apiBaseUrl ?? `https://${subdomain}.zendesk.com`;
  process.stderr.write(
    `[fora-mcp-zendesk] starting — pinned to subdomain='${subdomain}', ` +
      `api='${apiBase}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-zendesk] received ${signal}, shutting down\n`);
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
    `[fora-mcp-zendesk] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
