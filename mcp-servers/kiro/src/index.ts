#!/usr/bin/env node
/**
 * Forge AI Kiro MCP server — entry point.
 *
 * Wires the typed Kiro client to the MCP stdio transport and registers all
 * 4 tools. The server reads its config from env vars on startup and refuses
 * to boot if KIRO_AUTH_TOKEN or KIRO_WORKSPACE_ID is missing.
 *
 * Workspace scope is asserted on startup with a single liveness call
 * (getActiveTaskQueue) to confirm the daemon is reachable and the auth
 * works. A misconfigured token or unreachable daemon fails fast and the
 * process exits non-zero before any tool can be called.
 *
 * The Kiro daemon spec is still evolving; the liveness call is the
 * cheapest endpoint we expect to be implemented and is the same shape
 * the model will use.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, workspaceId, transportKind } = createClient(config);

  // Workspace-scope assertion on startup: hit the cheapest read endpoint
  // once and let any auth/transport error surface immediately. A bad
  // token, unreachable daemon, or wrong workspace id fails fast and the
  // process exits non-zero before any tool can be called.
  try {
    await client.getActiveTaskQueue();
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(
      `[kiro-mcp] workspace-scope assertion failed for workspace='${workspaceId}': ${msg}\n`,
    );
    process.exit(2);
  }

  const server = new McpServer(
    {
      name: "kiro-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `Forge AI Kiro MCP — pinned to workspace='${workspaceId}' via ${transportKind}. ` +
        `Tools are read-only views into the Kiro IDE state (open files, current selection, ` +
        `task queue, recent agent runs).`,
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
    `[kiro-mcp] starting — pinned to workspace='${workspaceId}', transport='${transportKind}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[kiro-mcp] received ${signal}, shutting down\n`);
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
    `[kiro-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
