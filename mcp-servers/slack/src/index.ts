#!/usr/bin/env node
/**
 * FORA Slack MCP server — entry point — READ-ONLY (FORA-290).
 *
 * Wires the typed Slack client to the MCP stdio transport and registers
 * the 4 read-only tools. The server reads its config from env vars on
 * startup and refuses to boot if SLACK_BOT_TOKEN or SLACK_TEAM_ID is
 * missing, or if the token doesn't belong to the pinned workspace.
 *
 * SCOPE: This server is read-only. Mutation tools
 * (`post_message`, `update_message`, `add_reaction`) are not registered
 * and the underlying client has no such methods. The smoke test asserts
 * no mutation route is ever reached.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, teamId } = createClient(config);

  // Eagerly run auth.test so the server fails fast on a wrong-workspace
  // token (e.g. operator pasted a different customer's token).
  try {
    await client.listChannels({ limit: 1 });
  } catch (err) {
    process.stderr.write(
      `[fora-mcp-slack] startup team check failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  const server = new McpServer(
    {
      name: "fora-mcp-slack",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA Slack MCP (READ-ONLY, FORA-290) — pinned to workspace '${teamId}'. ` +
        `Tools accept 'channel' (must belong to this workspace), 'ts', and tool-specific args. ` +
        `Do not pass a workspace id — it is server-pinned for safety. ` +
        `Mutations (post_message, update_message, add_reaction) are NOT available.`,
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

  process.stderr.write(
    `[fora-mcp-slack] starting (READ-ONLY) — pinned to teamId='${teamId}', api='${config.apiBaseUrl ?? "https://slack.com/api"}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-slack] received ${signal}, shutting down\n`);
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
    `[fora-mcp-slack] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
