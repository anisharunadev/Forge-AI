/**
 * FORA AWS MCP server — entry point.
 *
 * Wires the typed AWS client to the MCP stdio transport and registers all 7
 * read-only tools. The server reads its config from env vars on startup
 * and refuses to boot if `AWS_ACCOUNT_ID` or `AWS_REGION` is missing (or
 * if the resolved credentials point at a different account, unless
 * `AWS_SKIP_CREDENTIAL_VERIFY=1` is set for the smoke test).
 *
 * Mutations (CloudFormation `ExecuteChangeSet`, Cloud Control write tools)
 * are deliberately not registered yet. They will land in a tracked
 * follow-up to FORA-92, behind a `confirm: true` Zod argument.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createClient } from "./client.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  // createClient is async because it may call STS:GetCallerIdentity at
  // boot to verify the pinned account matches the resolved credentials.
  const { client, accountId, region } = await createClient(config);

  const server = new McpServer(
    {
      name: "fora-mcp-aws",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA AWS MCP (READ-ONLY, FORA-290 allow-list) — pinned to account='${accountId}', region='${region}'. ` +
        `Tools accept resource IDs (stack names, change-set names, type names) — ` +
        `the account and region are server-pinned for safety. ` +
        `This server is READ-ONLY in v1; mutations (execute_change_set) are a tracked follow-up to FORA-92. ` +
        `Access is broker-mediated via FORA-126 customer-cloud-broker, gated by FORA-125 IAM.`,
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
    `[fora-mcp-aws] starting (READ-ONLY, FORA-290) — pinned to account='${accountId}', region='${region}', ` +
      `endpoint='${config.endpointUrl ?? "<default AWS>"}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM. An enterprise agent runtime will
  // restart MCP servers; a server that hangs on shutdown blocks that.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-aws] received ${signal}, shutting down\n`);
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
    `[fora-mcp-aws] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
