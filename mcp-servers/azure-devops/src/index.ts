#!/usr/bin/env node
/**
 * FORA Azure DevOps MCP server — entry point.
 *
 * Wires the typed Azure DevOps client to the MCP stdio transport and
 * registers all 9 tools. The server reads its config from env vars on
 * startup and refuses to boot if AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG_URL,
 * or AZURE_DEVOPS_PROJECT is missing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, project } = createClient(config);

  const server = new McpServer(
    {
      name: "fora-mcp-azure-devops",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA Azure DevOps MCP — pinned to project '${project}' ` +
        `in org '${config.orgUrl}'. ` +
        `Tools take IDs and primitives only. ` +
        `Mutations (run_pipeline, create_work_item, add_work_item_comment) require ` +
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
  const apiBase = config.apiBaseUrl ?? `${config.orgUrl}/${config.project}`;
  process.stderr.write(
    `[fora-mcp-azure-devops] starting — pinned to project='${project}', ` +
      `org='${config.orgUrl}', api='${apiBase}', api-version='${config.apiVersion}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-azure-devops] received ${signal}, shutting down\n`);
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
    `[fora-mcp-azure-devops] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
