/**
 * FORA secrets-mcp — entry point.
 *
 * Wires the typed broker to the MCP stdio transport and registers
 * the two tools (`resolve`, `rotate`). The server reads its
 * configuration from env vars on startup and refuses to boot
 * without a tenant id.
 *
 * The server is per-tenant at runtime: the broker's `tenant_id`
 * claim pins the server to a single tenant. A different tenant
 * requires a separate process; the orchestrator / kubernetes
 * routing layer is responsible for that fan-out (this is a
 * scaling / availability concern, not a security one — the
 * `TenantScopeError` check at the store layer is the boundary
 * that matters).
 *
 * Backing store kinds:
 *   - `memory` (default) — InMemorySecretStore with an empty seed.
 *     Useful for unit tests and the smoke harness.
 *   - `aws-secrets-manager` — wires the AWS SDK SecretsManagerClient
 *     behind the same SecretStore interface. The v1 production
 *     adapter is implemented in `./store-aws.ts` and tested in
 *     `test/unit-aws.mjs`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { InMemorySecretStore, type SecretStore } from "./store.js";
import { InMemoryAuditSink, SecretsBroker, type AuditSink } from "./broker.js";
import { handleToolCall, toolDefinitions, type ToolName } from "./tools.js";
import { AwsSecretsManagerStore } from "./store-aws.js";
import { ForaAuditSink } from "./audit-fora.js";
import { defaultBrokeredActionRegistry, type BrokeredActionRegistry } from "./brokered.js";

function makeStore(cfg: ReturnType<typeof loadConfig>): SecretStore {
  if (cfg.backingStore === "memory") {
    return new InMemorySecretStore();
  }
  if (cfg.backingStore === "aws-secrets-manager") {
    if (!cfg.awsRegion) {
      // loadConfig() should have caught this already, but be defensive.
      throw new Error(
        "FORA_AWS_REGION is required when FORA_BACKING_STORE=aws-secrets-manager",
      );
    }
    return new AwsSecretsManagerStore({
      region: cfg.awsRegion,
      tenantClaim: cfg.tenantId,
      endpointUrl: cfg.endpointUrl,
      userAgent: cfg.userAgent,
    });
  }
  // Exhaustiveness check: loadConfig's zod enum already constrains this.
  const _exhaustive: never = cfg.backingStore;
  throw new Error(`Unknown backing store: ${String(_exhaustive)}`);
}

function makeAuditSink(cfg: ReturnType<typeof loadConfig>): AuditSink {
  if (cfg.auditSink === "memory") {
    return new InMemoryAuditSink();
  }
  if (cfg.auditSink === "fora") {
    if (!cfg.auditUrl) {
      // loadConfig() should have caught this already, but be defensive.
      throw new Error("FORA_AUDIT_URL is required when FORA_AUDIT_SINK=fora");
    }
    return new ForaAuditSink({
      baseUrl: cfg.auditUrl,
      token: cfg.auditToken ?? null,
    });
  }
  const _exhaustive: never = cfg.auditSink;
  throw new Error(`Unknown audit sink: ${String(_exhaustive)}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = makeStore(config);
  // The audit sink is `InMemoryAuditSink` (default) for tests and
  // `ForaAuditSink` (FORA-128.c) for production. The forwarder is
  // fire-and-forget — the broker's `emit` is synchronous and must
  // not block on a network round-trip.
  const audit = makeAuditSink(config);
  // The brokered-action registry (FORA-128.f) ships three stub
  // handlers. The production wiring of the side-effecting clients
  // (GitHub commit signing, Slack webhook, S3 PUT) is a follow-up
  // owned by the auth-engineer hire.
  const brokered: BrokeredActionRegistry = defaultBrokeredActionRegistry();

  const server = new McpServer(
    {
      name: "fora-mcp-secrets",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        `FORA secrets-mcp — tenant='${config.tenantId}', ` +
        `backing_store='${config.backingStore}'. ` +
        `Tools take a 'secret_ref' of the form ` +
        `tenants/{tenant_id}/secrets/{name}@{version} (version optional). ` +
        `The 'resolve' tool returns a REDACTED envelope — the raw value is ` +
        `never in the response. Use the broker-side raw-use pattern for ` +
        `MCPs that need a raw value: pass an *intent*, not a value.`,
    },
  );

  for (const def of toolDefinitions) {
    // Build a per-call broker so the audit event carries the
    // trace_id and actor from the ToolCall envelope. v0 reads
    // these from env vars (FORA_TRACE_ID, FORA_ACTOR,
    // FORA_AGENT_TYPE) — the production path passes them through
    // the ToolCall envelope directly.
    const toolHandler = async (args: unknown) => {
      const traceId = process.env.FORA_TRACE_ID ?? "trace-unknown";
      const actor = process.env.FORA_ACTOR ?? "agent:unknown";
      const agentType = process.env.FORA_AGENT_TYPE ?? "unknown";
      const broker = new SecretsBroker(
        store,
        audit,
        config.tenantId,
        traceId,
        actor,
        agentType,
        brokered,
      );
      return handleToolCall(broker, def.name as ToolName, args);
    };
    server.tool(def.name, def.description, def.shape, toolHandler);
  }

  process.stderr.write(
    `[fora-mcp-secrets] starting — tenant='${config.tenantId}', ` +
      `backing_store='${config.backingStore}', ` +
      `region='${config.awsRegion ?? "<n/a>"}', ` +
      `audit_sink='${config.auditSink}'\n`,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (signal: string) => {
    process.stderr.write(`[fora-mcp-secrets] received ${signal}, shutting down\n`);
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
    `[fora-mcp-secrets] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
