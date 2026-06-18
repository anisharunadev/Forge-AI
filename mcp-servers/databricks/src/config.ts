/**
 * Configuration for the FORA Databricks MCP server.
 *
 * Auth is intentionally single-workspace and least-privilege. The server
 * refuses to start if it cannot pin itself to a single workspace — this
 * prevents an agent prompt from accidentally reaching into a different
 * customer's workspace.
 *
 * The token MUST belong to a service principal. A user PAT would let the
 * agent act as the operator, which defeats the audit trail. Service
 * principals also support least-privilege grants (e.g. CAN_RESTART on a
 * single cluster, CAN_USE on a single warehouse, no Unity Catalog grants
 * for the read-only path).
 */

import { z } from "zod";

/**
 * We treat the Databricks workspace URL as a hard pin. The URL must use
 * https, must not have a trailing slash, and must parse cleanly. We do
 * NOT accept hostnames like `https://example.databricks.com/` because the
 * trailing slash would change request URL building in subtle ways.
 */
const WorkspaceUrlSchema = z
  .string()
  .url()
  .refine(
    (u) => u.startsWith("https://"),
    "DATABRICKS_WORKSPACE_URL must use https",
  )
  .refine(
    (u) => !u.endsWith("/"),
    "DATABRICKS_WORKSPACE_URL must not have a trailing slash",
  );

const ConfigSchema = z
  .object({
    /** Service-principal PAT. dapi… (classic) or the newer OAuth-flavoured PATs. */
    token: z
      .string()
      .min(1, "DATABRICKS_TOKEN is required (service-principal PAT)"),
    /** Workspace base URL, e.g. https://dbc-12345.cloud.databricks.com */
    workspaceUrl: WorkspaceUrlSchema.refine(
      (u) => u.length > 0,
      "DATABRICKS_WORKSPACE_URL is required and pins the server to one workspace",
    ),
    /**
     * Optional single-job pin. When set, the server rejects calls that
     * target a different job_id (the model can pass job_id but it must
     * match). For a multi-job workspace, leave this unset.
     */
    jobId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional single-job pin. When set, only this job_id is allowed."),
    /**
     * Optional single-warehouse pin for execute_sql. When set, the server
     * rejects calls that target a different warehouse_id.
     */
    warehouseId: z
      .string()
      .min(1)
      .optional()
      .describe("Optional single-warehouse pin for execute_sql."),
    /** Optional API base override — used by the smoke test against a mock server. */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Databricks API base URL (smoke tests only)."),
    /** Optional user-agent override. */
    userAgent: z
      .string()
      .default("fora-mcp-databricks/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jobIdRaw = env.DATABRICKS_JOB_ID;
  const jobIdParsed =
    jobIdRaw && jobIdRaw.trim().length > 0 ? Number(jobIdRaw) : undefined;

  const parsed = ConfigSchema.safeParse({
    token: env.DATABRICKS_TOKEN,
    workspaceUrl: env.DATABRICKS_WORKSPACE_URL,
    jobId: Number.isFinite(jobIdParsed) ? jobIdParsed : undefined,
    warehouseId: env.DATABRICKS_WAREHOUSE_ID,
    apiBaseUrl: env.DATABRICKS_API_BASE_URL,
    userAgent: env.DATABRICKS_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Databricks MCP configuration:\n${issues}\n\n` +
        `Set DATABRICKS_TOKEN and DATABRICKS_WORKSPACE_URL. ` +
        `Optional: DATABRICKS_JOB_ID, DATABRICKS_WAREHOUSE_ID, ` +
        `DATABRICKS_API_BASE_URL (smoke tests), DATABRICKS_USER_AGENT (default: fora-mcp-databricks/0.1.0).`,
    );
  }

  // Single-line belt-and-suspenders: a service-principal PAT is always
  // dapi… in the Databricks Cloud console. We warn loudly (not throw) if
  // the operator hands us a token that doesn't match, because some
  // customers mint custom-prefix tokens.
  if (parsed.data.token && !parsed.data.token.startsWith("dapi")) {
    process.stderr.write(
      `[fora-mcp-databricks] warning: DATABRICKS_TOKEN does not start with 'dapi'. ` +
        `Service-principal PATs in Databricks Cloud start with 'dapi'. ` +
        `If this is intentional, ignore this warning.\n`,
    );
  }

  return parsed.data;
}
