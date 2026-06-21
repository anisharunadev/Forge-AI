/**
 * Configuration for the Forge AI Adobe XD MCP server.
 *
 * Auth uses OAuth2 via Adobe Identity Management System (IMS), per the
 * F-016 connector contract. The operator provides an access token (which
 * may have been minted by a separate refresh-token flow handled outside
 * the MCP server — that flow lives in the orchestrator, not here).
 *
 * The server is file-pinned + project-pinned at startup. This mirrors the
 * safety property of the Figma MCP server (file-pinned + team-pinned):
 *   - the model can only pass IDs, never a file/project key,
 *   - the token scope is asserted at startup with a liveness call.
 *
 * The seven contract points from the shared template-note apply verbatim:
 *   1. single-scope pin (ADOBE_XD_FILE_ID + ADOBE_XD_PROJECT_ID) on startup,
 *   2. typed createClient wrapper,
 *   3. Zod raw shapes as the source of truth,
 *   4. stdout = JSON-RPC, stderr = logs,
 *   5. mock-HTTP integration test,
 *   6. clean SIGINT/SIGTERM,
 *   7. no agent-visible env vars beyond the pin and the token.
 *
 * Operator-known env vars:
 *   - ADOBE_XD_ACCESS_TOKEN (OAuth2 bearer)
 *   - ADOBE_XD_FILE_ID      (the single XD file the server is scoped to)
 *   - ADOBE_XD_PROJECT_ID   (the Creative Cloud project the file lives in)
 *
 * Operational knobs (not surfaced to the model):
 *   - ADOBE_XD_API_BASE_URL (mock-server override for tests)
 *   - ADOBE_XD_USER_AGENT
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** OAuth2 bearer token from Adobe IMS. Sent as `Authorization: Bearer …`. */
    accessToken: z
      .string()
      .min(1, "ADOBE_XD_ACCESS_TOKEN is required (Adobe IMS OAuth2 bearer)"),
    /** The single XD file the server is allowed to talk to. Safety property. */
    fileId: z
      .string()
      .min(1, "ADOBE_XD_FILE_ID is required and pins the server to one file"),
    /** The Creative Cloud project the file lives in. Asserted at startup. */
    projectId: z
      .string()
      .min(1, "ADOBE_XD_PROJECT_ID is required and asserts the project scope"),
    /** Optional API base override — used by tests against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Adobe XD API base URL (tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("forge-ai-mcp-adobe-xd/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    accessToken: env.ADOBE_XD_ACCESS_TOKEN,
    fileId: env.ADOBE_XD_FILE_ID,
    projectId: env.ADOBE_XD_PROJECT_ID,
    apiBaseUrl: env.ADOBE_XD_API_BASE_URL,
    userAgent: env.ADOBE_XD_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Adobe XD MCP configuration:\n${issues}\n\n` +
        `Set ADOBE_XD_ACCESS_TOKEN, ADOBE_XD_FILE_ID, and ADOBE_XD_PROJECT_ID. ` +
        `Optional: ADOBE_XD_API_BASE_URL (tests), ` +
        `ADOBE_XD_USER_AGENT (default: forge-ai-mcp-adobe-xd/0.1.0).`,
    );
  }

  return parsed.data;
}
