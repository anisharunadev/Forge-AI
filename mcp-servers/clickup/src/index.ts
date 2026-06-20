#!/usr/bin/env node
/**
 * FORA ClickUp MCP server — entry point.
 *
 * Wires the typed ClickUp client to the MCP stdio transport and registers
 * all 8 tools. The server reads its config from env vars on startup and
 * refuses to boot if CLICKUP_API_TOKEN or CLICKUP_LIST_ID is missing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, listId, baseUrl } = createClient(config);

  const server = new McpServer(
    {
      name: "fora-mcp-clickup",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA ClickUp MCP — pinned to List '${listId}' on ${baseUrl}. ` +
        `Tools accept task ids and tool-specific args. ` +
        `Do not pass a List id — the server is List-pinned for safety. ` +
        `Mutations (create_task, update_task, set_task_status, add_comment) ` +
        `require \`confirm: true\`; read tools do not.`,
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
    `[fora-mcp-clickup] starting — pinned to list='${listId}', baseUrl='${baseUrl}', api='${config.apiBaseUrl ?? `${baseUrl}/api/v2`}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-clickup] received ${signal}, shutting down\n`);
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
    `[fora-mcp-clickup] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});