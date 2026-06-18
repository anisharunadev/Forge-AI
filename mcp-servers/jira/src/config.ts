/**
 * Configuration for the FORA Jira MCP server.
 *
 * Auth is single-project and least-privilege. The server refuses to start if
 * it cannot pin itself to a single project — this prevents an agent prompt
 * from accidentally reaching issues outside the customer boundary, the same
 * posture the GitHub MCP takes with `GITHUB_ORG`.
 *
 * Atlassian Cloud uses HTTP Basic auth with `email:api_token` base64-encoded
 * for the REST v3 API. The `JIRA_BASE_URL` is the customer's site root
 * (e.g. `https://acme.atlassian.net`).
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Auth: Atlassian account email. */
    email: z
      .string()
      .min(1, "JIRA_EMAIL is required (Atlassian account email)"),
    /** Auth: Atlassian API token. */
    apiToken: z
      .string()
      .min(1, "JIRA_API_TOKEN is required"),
    /** The single project the server is allowed to talk to (e.g. `FORA`). */
    projectKey: z
      .string()
      .min(1, "JIRA_PROJECT_KEY is required and pins the server to one project"),
    /** Customer site root, e.g. `https://acme.atlassian.net`. */
    baseUrl: z
      .string()
      .url()
      .min(1, "JIRA_BASE_URL is required (e.g. https://acme.atlassian.net)"),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Atlassian REST base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-jira/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
    projectKey: env.JIRA_PROJECT_KEY,
    baseUrl: env.JIRA_BASE_URL,
    apiBaseUrl: env.JIRA_API_BASE_URL,
    userAgent: env.JIRA_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Jira MCP configuration:\n${issues}\n\n` +
        `Set JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, and JIRA_BASE_URL. ` +
        `Optional: JIRA_API_BASE_URL (smoke tests), JIRA_USER_AGENT (default: fora-mcp-jira/0.1.0).`,
    );
  }

  return parsed.data;
}
