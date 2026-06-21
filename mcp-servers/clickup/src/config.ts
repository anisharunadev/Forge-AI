/**
 * Configuration for the FORA ClickUp MCP server.
 *
 * Auth is single-list and least-privilege. The server refuses to start if it
 * cannot pin itself to a single List — this prevents an agent prompt from
 * accidentally reaching tasks outside the customer boundary, the same posture
 * `forge-ai/mcp-jira` takes with `JIRA_PROJECT_KEY` (one level shallower: a List
 * is roughly a Jira "filter saved search" over a single board column).
 *
 * ClickUp uses HTTP Basic-style auth with a Personal API Token: the token is
 * sent verbatim in the `Authorization` header (no `Bearer` prefix per their
 * REST v2 docs). The `CLICKUP_BASE_URL` is the customer's site root
 * (default `https://api.clickup.com` for ClickUp Cloud; self-hosted tenants
 * override it).
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Auth: ClickUp personal API token (e.g. `pk_...`). */
    apiToken: z
      .string()
      .min(1, "CLICKUP_API_TOKEN is required (ClickUp personal API token)"),
    /** The single List the server is allowed to talk to (numeric string id). */
    listId: z
      .string()
      .min(1, "CLICKUP_LIST_ID is required and pins the server to one List"),
    /** Customer site root, e.g. `https://api.clickup.com`. */
    baseUrl: z
      .string()
      .url()
      .default("https://api.clickup.com"),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override ClickUp REST base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-clickup/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    apiToken: env.CLICKUP_API_TOKEN,
    listId: env.CLICKUP_LIST_ID,
    baseUrl: env.CLICKUP_BASE_URL,
    apiBaseUrl: env.CLICKUP_API_BASE_URL,
    userAgent: env.CLICKUP_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid ClickUp MCP configuration:\n${issues}\n\n` +
        `Set CLICKUP_API_TOKEN and CLICKUP_LIST_ID. ` +
        `Optional: CLICKUP_BASE_URL (default: https://api.clickup.com), ` +
        `CLICKUP_API_BASE_URL (smoke tests), CLICKUP_USER_AGENT (default: fora-mcp-clickup/0.1.0).`,
    );
  }

  return parsed.data;
}