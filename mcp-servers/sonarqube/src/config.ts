/**
 * Configuration for the FORA SonarQube MCP server.
 *
 * Auth is intentionally single-project and least-privilege. The server refuses
 * to start if it cannot pin itself to a single project — this prevents an
 * agent prompt from accidentally reaching into other projects on the same
 * SonarQube instance. The optional SONARQUBE_ORG is the SonarCloud
 * organization (when this server is pointed at sonarcloud.io) and is
 * asserted on startup by fetching the pinned project and checking its
 * `organization` field.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Auth: SonarQube user token (or SonarCloud user token). */
    token: z
      .string()
      .min(1, "SONARQUBE_TOKEN is required (user token)"),
    /**
     * The single project this server is allowed to talk to. SonarQube
     * project keys are case-sensitive and may contain `_`, `-`, `.`.
     */
    projectKey: z
      .string()
      .min(1, "SONARQUBE_PROJECT_KEY is required and pins the server to one project"),
    /**
     * Optional SonarCloud organization slug. When set, the server asserts on
     * startup that the pinned project belongs to this organization. Ignored
     * on SonarQube Server (self-hosted) where the concept of org does not
     * exist.
     */
    org: z
      .string()
      .min(1)
      .optional()
      .describe("Optional SonarCloud organization slug. Asserted on startup against the pinned project."),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override SonarQube API base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-sonarqube/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    token: env.SONARQUBE_TOKEN,
    projectKey: env.SONARQUBE_PROJECT_KEY,
    org: env.SONARQUBE_ORG,
    apiBaseUrl: env.SONARQUBE_API_BASE_URL,
    userAgent: env.SONARQUBE_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid SonarQube MCP configuration:\n${issues}\n\n` +
        `Set SONARQUBE_TOKEN and SONARQUBE_PROJECT_KEY. Optional: SONARQUBE_ORG ` +
        `(SonarCloud org slug, asserted on startup), ` +
        `SONARQUBE_API_BASE_URL (smoke tests), ` +
        `SONARQUBE_USER_AGENT (default: fora-mcp-sonarqube/0.1.0).`,
    );
  }

  return parsed.data;
}
