/**
 * Configuration for the FORA Zendesk MCP server.
 *
 * Auth is intentionally single-subdomain and least-privilege. The server
 * refuses to start if it cannot pin itself to a single Zendesk subdomain —
 * this prevents an agent prompt from accidentally reaching into another
 * customer's Zendesk account. One subdomain per server.
 *
 * Token guidance: the API token must be issued for the pinned Zendesk
 * account only. The agent's role in the Zendesk admin must be a custom
 * role with read + comment + create-ticket scopes only — never a global
 * admin token.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /**
     * The single Zendesk subdomain the server is allowed to talk to. The
     * server builds all URLs as `https://{subdomain}.zendesk.com/api/v2/...`.
     */
    subdomain: z
      .string()
      .min(1, "ZENDESK_SUBDOMAIN is required and pins the server to one Zendesk instance")
      .regex(/^[a-z0-9-]+$/i, "ZENDESK_SUBDOMAIN must contain only letters, digits, and dashes"),
    /**
     * The Zendesk agent email associated with the API token. Sent as Basic
     * auth (`Authorization: Basic base64("{email}/token:{apiToken}")`) per
     * the Zendesk REST v2 contract.
     */
    email: z
      .string()
      .email("ZENDESK_EMAIL must be a valid email address"),
    /**
     * Zendesk API token. Used as the password in the Basic auth header.
     */
    apiToken: z
      .string()
      .min(1, "ZENDESK_API_TOKEN is required (Zendesk API token)"),
    /**
     * Optional API base override — used by the smoke test against a mock
     * server. The mock serves the same path layout as
     * `https://{subdomain}.zendesk.com/api/v2/...` rooted at this base.
     */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Zendesk API base URL (smoke tests only)."),
    /**
     * User-Agent override. Default identifies the server so Zendesk-side
     * logs can attribute traffic.
     */
    userAgent: z
      .string()
      .default("fora-mcp-zendesk/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    subdomain: env.ZENDESK_SUBDOMAIN,
    email: env.ZENDESK_EMAIL,
    apiToken: env.ZENDESK_API_TOKEN,
    apiBaseUrl: env.ZENDESK_API_BASE_URL,
    userAgent: env.ZENDESK_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Zendesk MCP configuration:\n${issues}\n\n` +
        `Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN. ` +
        `Optional: ZENDESK_API_BASE_URL (smoke tests), ` +
        `ZENDESK_USER_AGENT (default: fora-mcp-zendesk/0.1.0).`,
    );
  }

  return parsed.data;
}
