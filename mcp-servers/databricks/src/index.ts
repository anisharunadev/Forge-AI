#!/usr/bin/env node
/**
 * FORA Databricks MCP server — entry point.
 *
 * Wires the typed Databricks client to the MCP stdio transport and
 * registers all 8 tools. The server reads its config from env vars on
 * startup and refuses to boot if DATABRICKS_TOKEN or
 * DATABRICKS_WORKSPACE_URL is missing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, workspaceUrl, jobId, warehouseId } = createClient(config);

  const pinDescription = [
    `pinned to workspace='${workspaceUrl}'`,
    jobId !== undefined ? `job=${jobId}` : "job=any",
    warehouseId !== undefined ? `warehouse=${warehouseId}` : "warehouse=any",
  ].join(", ");

  const server = new McpServer(
    {
      name: "fora-mcp-databricks",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA Databricks MCP — ${pinDescription}. ` +
        `Three tools (run_job, cancel_run, execute_sql) require an explicit ` +
        `confirm: true argument.`,
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
  process.stderr.write(
    `[fora-mcp-databricks] starting — ${pinDescription}, api='${config.apiBaseUrl ?? "default"}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-databricks] received ${signal}, shutting down\n`);
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
    `[fora-mcp-databricks] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
