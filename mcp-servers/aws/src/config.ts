/**
 * Configuration for the FORA AWS MCP server.
 *
 * Auth is intentionally single-account and single-region. The server refuses
 * to start without `AWS_ACCOUNT_ID` and `AWS_REGION` — this prevents an
 * agent prompt from accidentally reaching resources outside the customer
 * boundary, the same posture the GitHub MCP takes with `GITHUB_ORG` and
 * the Jira MCP takes with `JIRA_PROJECT_KEY`.
 *
 * Credential resolution is delegated to the standard AWS SDK v3 chain
 * (env vars → shared config → web identity → IAM role). The `STS` check
 * below verifies the resolved identity against the pinned account on
 * startup; it is skipped only when `AWS_SKIP_CREDENTIAL_VERIFY=1`, which
 * the smoke test sets against its mock endpoint.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** The 12-digit AWS account the server is allowed to talk to. */
    accountId: z
      .string()
      .regex(/^\d{12}$/, "AWS_ACCOUNT_ID must be exactly 12 digits"),
    /** The single region the server is allowed to talk to (e.g. `us-east-1`). */
    region: z
      .string()
      .min(1, "AWS_REGION is required and pins the server to one region"),
    /** Optional API endpoint override — used by the smoke test against a mock server. */
    endpointUrl: z
      .string()
      .url()
      .optional()
      .describe("Override AWS service endpoint URL (smoke tests only)."),
    /** Skip the STS:GetCallerIdentity verification at boot (smoke tests only). */
    skipCredentialVerify: z
      .boolean()
      .default(false)
      .describe("Skip the STS call that verifies the pinned account matches the resolved credentials."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-aws/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    accountId: env.AWS_ACCOUNT_ID,
    region: env.AWS_REGION,
    endpointUrl: env.AWS_ENDPOINT_URL,
    skipCredentialVerify: env.AWS_SKIP_CREDENTIAL_VERIFY === "1",
    userAgent: env.AWS_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid AWS MCP configuration:\n${issues}\n\n` +
        `Set AWS_ACCOUNT_ID (12 digits) and AWS_REGION (e.g. us-east-1). ` +
        `Optional: AWS_ENDPOINT_URL (smoke tests), AWS_SKIP_CREDENTIAL_VERIFY=1 (smoke tests), ` +
        `AWS_USER_AGENT (default: fora-mcp-aws/0.1.0).`,
    );
  }

  return parsed.data;
}
