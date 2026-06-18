#!/usr/bin/env node
/**
 * FORA SonarQube MCP server — entry point — READ-ONLY (FORA-290).
 *
 * Wires the typed SonarQube client to the MCP stdio transport and
 * registers the 8 read-only tools. The server reads its config from env
 * vars on startup and refuses to boot if SONARQUBE_TOKEN or
 * SONARQUBE_PROJECT_KEY is missing.
 *
 * SCOPE: This server is read-only. The `transition_issue` write tool
 * is not registered and the underlying client has no such method. The
 * smoke test asserts no POST /api/issues/do_transition is ever reached.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, projectKey } = createClient(config);

  const server = new McpServer(
    {
      name: "fora-mcp-sonarqube",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA SonarQube MCP (READ-ONLY, FORA-290) — pinned to project='${projectKey}'. ` +
        `All 8 tools are read-only; the previous transition_issue write tool is removed. ` +
        `Do not pass projectKey in tool args — it is server-pinned for safety ` +
        `(tools that take a projectKey will be asserted against the pin).`,
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
    `[fora-mcp-sonarqube] starting (READ-ONLY) — pinned to project='${projectKey}', api='${config.apiBaseUrl ?? "https://sonarcloud.io"}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM. An enterprise agent runtime will
  // restart MCP servers; a server that hangs on shutdown blocks that.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-sonarqube] received ${signal}, shutting down\n`);
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
    `[fora-mcp-sonarqube] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
