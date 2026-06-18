/**
 * Configuration for the FORA Slack MCP server.
 *
 * Auth is single-workspace and least-privilege. The server refuses to start
 * if it cannot pin itself to a single Slack workspace — this prevents an
 * agent prompt from accidentally reaching channels outside the customer
 * boundary, the same posture the GitHub MCP takes with `GITHUB_ORG`.
 *
 * Slack bot tokens are passed as `Authorization: Bearer xoxb-…`. The
 * workspace pin is asserted on startup via `auth.test`; the response's
 * `team_id` MUST match `SLACK_TEAM_ID` or the server refuses to boot.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Auth: Slack bot token (xoxb-…). */
    token: z
      .string()
      .min(1, "SLACK_BOT_TOKEN is required (xoxb-…)"),
    /** The single Slack workspace the server is allowed to talk to. */
    teamId: z
      .string()
      .min(1, "SLACK_TEAM_ID is required and pins the server to one workspace (e.g. T0123…)"),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Slack API base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-slack/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    token: env.SLACK_BOT_TOKEN,
    teamId: env.SLACK_TEAM_ID,
    apiBaseUrl: env.SLACK_API_BASE_URL,
    userAgent: env.SLACK_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Slack MCP configuration:\n${issues}\n\n` +
        `Set SLACK_BOT_TOKEN and SLACK_TEAM_ID. Optional: SLACK_API_BASE_URL (smoke tests), ` +
        `SLACK_USER_AGENT (default: fora-mcp-slack/0.1.0).`,
    );
  }

  return parsed.data;
}
