/**
 * Configuration for the FORA Figma MCP server.
 *
 * Auth is intentionally file-pinned and least-privilege. The server refuses
 * to start if it cannot pin itself to a single file and assert a team scope —
 * this prevents an agent prompt from accidentally reaching into other design
 * files inside (or outside) the customer boundary.
 *
 * The seven contract points from the shared template-note apply verbatim:
 *   1. single-scope pin (FIGMA_FILE_KEY) on startup,
 *   2. typed createClient wrapper,
 *   3. Zod raw shapes as the source of truth,
 *   4. stdout = JSON-RPC, stderr = logs,
 *   5. mock-HTTP smoke test,
 *   6. clean SIGINT/SIGTERM,
 *   7. no agent-visible env vars beyond the pin and the token.
 *
 * The two env vars the operator must know about are FIGMA_TOKEN, FIGMA_FILE_KEY,
 * and FIGMA_TEAM_ID. FIGMA_API_BASE_URL and FIGMA_USER_AGENT are operational
 * knobs (smoke override, UA string) and are not surfaced to the model.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Auth: Personal access token. `X-Figma-Token` is the auth header. */
    token: z
      .string()
      .min(1, "FIGMA_TOKEN is required (Figma personal access token)"),
    /** The single file the server is allowed to talk to. Safety property. */
    fileKey: z
      .string()
      .min(1, "FIGMA_FILE_KEY is required and pins the server to one file"),
    /** Team scope asserted at startup. */
    teamId: z
      .string()
      .min(1, "FIGMA_TEAM_ID is required and asserts the team scope"),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Figma API base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-figma/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    token: env.FIGMA_TOKEN,
    fileKey: env.FIGMA_FILE_KEY,
    teamId: env.FIGMA_TEAM_ID,
    apiBaseUrl: env.FIGMA_API_BASE_URL,
    userAgent: env.FIGMA_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Figma MCP configuration:\n${issues}\n\n` +
        `Set FIGMA_TOKEN, FIGMA_FILE_KEY, and FIGMA_TEAM_ID. ` +
        `Optional: FIGMA_API_BASE_URL (smoke tests), ` +
        `FIGMA_USER_AGENT (default: fora-mcp-figma/0.1.0).`,
    );
  }

  return parsed.data;
}
