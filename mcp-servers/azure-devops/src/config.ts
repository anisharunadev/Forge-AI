/**
 * Configuration for the FORA Azure DevOps MCP server.
 *
 * Auth is intentionally single-org + single-project and least-privilege. The
 * server refuses to start if it cannot pin itself to a single Azure DevOps
 * project — this prevents an agent prompt from accidentally reaching into
 * another customer's data or another project inside the same org.
 *
 * Token guidance: the PAT must be scoped to the pinned project only. A
 * broad, org-level PAT is rejected at the documentation / deployment bar,
 * not at runtime — the org URL itself doesn't tell us the token scope.
 */

import { z } from "zod";

const ConfigSchema = z
  .object({
    /**
     * PAT (Personal Access Token). Sent as Basic auth (`Authorization: Basic
     * base64(":" + pat)`) per the Azure DevOps REST 7.1 contract.
     */
    pat: z
      .string()
      .min(1, "AZURE_DEVOPS_PAT is required (project-scoped PAT)"),
    /**
     * Full org URL, e.g. `https://dev.azure.com/my-org`. Trailing slash is
     * stripped on load so URL joins are unambiguous.
     */
    orgUrl: z
      .string()
      .url()
      .refine(
        (s) => /^https?:\/\/[^/]+/i.test(s),
        "AZURE_DEVOPS_ORG_URL must be an absolute URL with a host (e.g. https://dev.azure.com/my-org)",
      ),
    /**
     * The single project the server is allowed to talk to. All REST calls
     * are scoped under `/{orgUrl}/{project}/_apis/...`. A tool that names a
     * different project is refused with `ProjectScopeError`.
     */
    project: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._-]+$/, "AZURE_DEVOPS_PROJECT must be a valid project name (letters, digits, '.', '_', '-')")
      .describe("AZURE_DEVOPS_PROJECT is required and pins the server to one project"),
    /**
     * Optional API base override — used by the smoke test against a mock
     * server. When set, it replaces BOTH the org host AND the project path
     * segment (the mock serves `/list_projects` etc. at the bare base).
     */
    apiBaseUrl: z
      .string()
      .url()
      .optional()
      .describe("Override Azure DevOps API base URL (smoke tests only)."),
    /**
     * Pin the REST API version on every request (`api-version=7.1`). This
     * keeps the deprecation / breaking-change timeline predictable.
     */
    apiVersion: z
      .string()
      .default("7.1"),
    /**
     * User-Agent override. Default identifies the server so DevOps-side logs
     * can attribute traffic.
     */
    userAgent: z
      .string()
      .default("fora-mcp-azure-devops/0.1.0"),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    pat: env.AZURE_DEVOPS_PAT,
    orgUrl: env.AZURE_DEVOPS_ORG_URL?.replace(/\/+$/, ""),
    project: env.AZURE_DEVOPS_PROJECT,
    apiBaseUrl: env.AZURE_DEVOPS_API_BASE_URL,
    apiVersion: env.AZURE_DEVOPS_API_VERSION,
    userAgent: env.AZURE_DEVOPS_USER_AGENT,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid Azure DevOps MCP configuration:\n${issues}\n\n` +
        `Set AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG_URL, and AZURE_DEVOPS_PROJECT. ` +
        `Optional: AZURE_DEVOPS_API_BASE_URL (smoke tests), ` +
        `AZURE_DEVOPS_API_VERSION (default: 7.1), ` +
        `AZURE_DEVOPS_USER_AGENT (default: fora-mcp-azure-devops/0.1.0).`,
    );
  }

  return parsed.data;
}
