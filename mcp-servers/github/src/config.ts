/**
 * Configuration for the FORA GitHub MCP server.
 *
 * Auth is intentionally single-org and least-privilege. The server refuses to
 * start if it cannot pin itself to a single org — this prevents an agent
 * prompt from accidentally reaching into repos outside the customer boundary.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Auth: Personal Access Token (classic or fine-grained) OR a GitHub App installation token. */
    token: z
      .string()
      .min(1, "GITHUB_TOKEN is required (PAT or installation token)"),
    /** The single org the server is allowed to talk to. */
    org: z
      .string()
      .min(1, "GITHUB_ORG is required and pins the server to one org"),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override GitHub API base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-github/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    token: env.GITHUB_TOKEN,
    org: env.GITHUB_ORG,
    apiBaseUrl: env.GITHUB_API_BASE_URL,
    userAgent: env.GITHUB_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid GitHub MCP configuration:\n${issues}\n\n` +
        `Set GITHUB_TOKEN and GITHUB_ORG. Optional: GITHUB_API_BASE_URL (smoke tests), ` +
        `GITHUB_USER_AGENT (default: fora-mcp-github/0.1.0).`,
    );
  }

  return parsed.data;
}
