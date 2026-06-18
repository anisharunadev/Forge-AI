#!/usr/bin/env node
/**
 * FORA GitHub MCP server — entry point.
 *
 * Wires the typed GitHub client to the MCP stdio transport and registers all
 * 7 tools. The server reads its config from env vars on startup and refuses
 * to boot if GITHUB_TOKEN or GITHUB_ORG is missing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, org } = createClient(config);

  const server = new McpServer(
    {
      name: "fora-mcp-github",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA GitHub MCP — pinned to org '${org}'. ` +
        `Tools accept 'owner' (must equal '${org}'), 'repo', and tool-specific args. ` +
        `Do not pass 'org' — it is server-pinned for safety.`,
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
    `[fora-mcp-github] starting — pinned to org='${org}', api='${config.apiBaseUrl ?? "https://api.github.com"}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-github] received ${signal}, shutting down\n`);
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
    `[fora-mcp-github] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
