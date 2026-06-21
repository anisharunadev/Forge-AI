/**
 * Configuration for the Forge AI Kiro MCP server.
 *
 * Kiro is an emerging IDE and its daemon/socket protocol is not yet a public,
 * fully documented surface. This server is scaffolded against the assumptions
 * documented in the README (Unix socket at /tmp/kiro.sock OR local HTTP at
 * localhost:<port>) and the transport is selected at startup based on which
 * env var is set. The client is abstracted behind a `Client` interface so the
 * transport can be swapped without changing the tool contracts.
 *
 * The seven contract points from the shared template-note apply verbatim:
 *   1. single-scope pin (KIRO_WORKSPACE_ID) on startup,
 *   2. typed createClient wrapper,
 *   3. Zod raw shapes as the source of truth,
 *   4. stdout = JSON-RPC, stderr = logs,
 *   5. mock-daemon test harness,
 *   6. clean SIGINT/SIGTERM,
 *   7. no agent-visible env vars beyond the pin and the auth.
 *
 * The required env vars the operator must know about are KIRO_AUTH_TOKEN and
 * KIRO_WORKSPACE_ID. KIRO_SOCKET_PATH, KIRO_HTTP_BASE_URL, and KIRO_USER_AGENT
 * are operational knobs (transport selection, smoke override, UA string) and
 * are not surfaced to the model.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /** Auth: bearer token presented to the Kiro daemon over its chosen transport. */
    authToken: z
      .string()
      .min(1, "KIRO_AUTH_TOKEN is required (bearer token for the Kiro daemon)"),
    /** The single workspace the server is allowed to talk to. Safety property. */
    workspaceId: z
      .string()
      .min(1, "KIRO_WORKSPACE_ID is required and pins the server to one workspace"),
    /**
     * Unix socket path. If set, takes precedence over httpBaseUrl.
     * Defaults to /tmp/kiro.sock — the conventional Kiro daemon socket path.
     */
    socketPath: z
      .string()
      .min(1)
      .default("/tmp/kiro.sock")
      .describe("Unix socket path for the Kiro daemon. Takes precedence over HTTP base URL."),
    /** Optional HTTP base URL — used when no socket is available. */
    httpBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Local HTTP base URL for the Kiro daemon. Used only if socket is unavailable."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("kiro-mcp/0.1.0"),
  })
  .strict()
  .refine(
    (cfg) => cfg.socketPath !== undefined || cfg.httpBaseUrl !== undefined,
    {
      message:
        "At least one of KIRO_SOCKET_PATH or KIRO_HTTP_BASE_URL must resolve a daemon. " +
        "Defaults: KIRO_SOCKET_PATH=/tmp/kiro.sock.",
    },
  );

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    authToken: env.KIRO_AUTH_TOKEN,
    workspaceId: env.KIRO_WORKSPACE_ID,
    socketPath: env.KIRO_SOCKET_PATH,
    httpBaseUrl: env.KIRO_HTTP_BASE_URL,
    userAgent: env.KIRO_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Kiro MCP configuration:\n${issues}\n\n` +
        `Set KIRO_AUTH_TOKEN and KIRO_WORKSPACE_ID. ` +
        `Optional: KIRO_SOCKET_PATH (default /tmp/kiro.sock), ` +
        `KIRO_HTTP_BASE_URL (fallback HTTP), ` +
        `KIRO_USER_AGENT (default: kiro-mcp/0.1.0).`,
    );
  }

  return parsed.data;
}
