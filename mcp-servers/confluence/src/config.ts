/**
 * Configuration for the FORA Confluence MCP server.
 *
 * Auth is intentionally single-space and least-privilege. The server refuses
 * to start if it cannot pin itself to a single Confluence space — this
 * prevents an agent prompt from accidentally reading or writing pages in
 * a different customer's space.
 *
 * Required env vars:
 *   CONFLUENCE_BASE_URL   e.g. https://your-customer.atlassian.net/wiki
 *   CONFLUENCE_EMAIL     the account that owns the API token
 *   CONFLUENCE_API_TOKEN the Atlassian API token for that account
 *   CONFLUENCE_SPACE_KEY the single space key the server is pinned to,
 *                         e.g. "ENG". Page IDs supplied by the model are
 *                         asserted to belong to this space before any call.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Base URL of the Confluence site (Cloud). Trailing slash optional. */
    baseUrl: z
      .string()
      .url("CONFLUENCE_BASE_URL must be a valid URL (e.g. https://acme.atlassian.net/wiki)"),
    /** Email of the Atlassian account that owns the API token. */
    email: z
      .string()
      .email("CONFLUENCE_EMAIL must be a valid email"),
    /** Atlassian API token (Basic auth: email + token, base64-encoded). */
    apiToken: z
      .string()
      .min(1, "CONFLUENCE_API_TOKEN is required"),
    /**
     * The single Confluence space key this server is pinned to. All page
     * operations are asserted to land in this space.
     */
    spaceKey: z
      .string()
      .min(1, "CONFLUENCE_SPACE_KEY is required and pins the server to one space"),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Confluence API base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-confluence/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    baseUrl: env.CONFLUENCE_BASE_URL,
    email: env.CONFLUENCE_EMAIL,
    apiToken: env.CONFLUENCE_API_TOKEN,
    spaceKey: env.CONFLUENCE_SPACE_KEY,
    apiBaseUrl: env.CONFLUENCE_API_BASE_URL,
    userAgent: env.CONFLUENCE_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Confluence MCP configuration:\n${issues}\n\n` +
        `Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN, ` +
        `and CONFLUENCE_SPACE_KEY. Optional: CONFLUENCE_API_BASE_URL (smoke tests), ` +
        `CONFLUENCE_USER_AGENT (default: fora-mcp-confluence/0.1.0).`,
    );
  }

  return parsed.data;
}
