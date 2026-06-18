/**
 * Configuration for the FORA secrets-mcp.
 *
 * The server is per-tenant at the secret level, but the *server
 * process* itself runs once per broker and serves every tenant the
 * broker routes to it. We therefore:
 *
 *   - Pin the broker's `tenant_id` claim to the server at boot
 *     (the server refuses to start without it).
 *   - Pin the backing-store kind (`memory` for dev/test,
 *     `aws-secrets-manager` for production).
 *   - Pin an AWS region (AWS SM is regional).
 *   - Allow an optional endpoint override for smoke tests against
 *     a mock AWS endpoint.
 *
 * Cross-tenant reads are a programming error: the `ToolCall` from
 * the broker carries the `tenant_id` claim, the parser emits a
 * `SecretRef`, and the store's `assertTenant` check enforces that
 * the ref's `tenant_id` matches the claim. The server itself
 * never re-derives a tenant from the ref alone.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** The tenant this server process is bound to. The broker routes
     *  every ToolCall for this tenant here. The server refuses to
     *  read secrets for any other tenant — even if the secret_ref
     *  names them — and throws `TenantScopeError` at the store. */
    tenantId: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "FORA_TENANT_ID must match /^[A-Za-z0-9][A-Za-z0-9_-]*$/"),

    /** The backing-store kind. v1 ships `memory` (dev/test) and
     *  `aws-secrets-manager` (production). A future ADR adds `vault`. */
    backingStore: z.enum(["memory", "aws-secrets-manager"]).default("memory"),

    /** AWS region for AWS Secrets Manager. Required when
     *  `backingStore=aws-secrets-manager`. */
    awsRegion: z
      .string()
      .min(1)
      .optional()
      .describe("AWS region (e.g. us-east-1). Required when backingStore=aws-secrets-manager."),

    /** Optional API endpoint override — smoke tests only. */
    endpointUrl: z
      .string()
      .url()
      .optional()
      .describe("Override AWS Secrets Manager endpoint URL (smoke tests only)."),

    /** Skip credential verification at boot (smoke tests only). */
    skipCredentialVerify: z
      .boolean()
      .default(false)
      .describe("Skip the STS:GetCallerIdentity check at boot (smoke tests only)."),

    /** Optional user-agent override. */
    userAgent: z.string().default("fora-mcp-secrets/0.1.0"),

    /** Audit sink kind. `memory` (default for tests) writes to the
     *  in-process array; `fora` (production) forwards to FORA-36's
     *  append-only event store. The forwarder lives in
     *  `./audit-fora.ts`. */
    auditSink: z.enum(["memory", "fora"]).default("memory"),

    /** Base URL of the FORA-36 audit service. Required when
     *  `auditSink=fora`. The forwarder POSTs to
     *  `${auditUrl}/v1/audit/events`. */
    auditUrl: z
      .string()
      .url()
      .optional()
      .describe("FORA-36 audit service base URL (required when auditSink=fora)."),

    /** Optional service-to-service bearer token for FORA-36. */
    auditToken: z
      .string()
      .optional()
      .describe("Bearer token for the FORA-36 audit service."),
  })
  .strict()
  .refine(
    (cfg) => cfg.backingStore !== "aws-secrets-manager" || !!cfg.awsRegion,
    {
      message:
        "FORA_AWS_REGION is required when FORA_BACKING_STORE=aws-secrets-manager",
      path: ["awsRegion"],
    },
  )
  .refine((cfg) => cfg.auditSink !== "fora" || !!cfg.auditUrl, {
    message: "FORA_AUDIT_URL is required when FORA_AUDIT_SINK=fora",
    path: ["auditUrl"],
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    tenantId: env.FORA_TENANT_ID,
    backingStore: env.FORA_BACKING_STORE ?? "memory",
    awsRegion: env.FORA_AWS_REGION,
    endpointUrl: env.FORA_AWS_ENDPOINT_URL,
    skipCredentialVerify: env.FORA_SKIP_CREDENTIAL_VERIFY === "1",
    userAgent: env.FORA_USER_AGENT,
    auditSink: env.FORA_AUDIT_SINK ?? "memory",
    auditUrl: env.FORA_AUDIT_URL,
    auditToken: env.FORA_AUDIT_TOKEN,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid secrets-mcp configuration:\n${issues}\n\n` +
        `Set FORA_TENANT_ID (the broker's tenant claim) and ` +
        `FORA_BACKING_STORE=memory|aws-secrets-manager. ` +
        `When backing_store=aws-secrets-manager, FORA_AWS_REGION is also required. ` +
        `Optional: FORA_AWS_ENDPOINT_URL (smoke tests), ` +
        `FORA_SKIP_CREDENTIAL_VERIFY=1 (smoke tests), ` +
        `FORA_USER_AGENT (default: fora-mcp-secrets/0.1.0), ` +
        `FORA_AUDIT_SINK=memory|fora (default: memory), ` +
        `FORA_AUDIT_URL (required when FORA_AUDIT_SINK=fora), ` +
        `FORA_AUDIT_TOKEN (optional bearer token).`,
    );
  }

  return parsed.data;
}
