/**
 * FORA-579 — typed mock audit-entry shape for the Connector Center
 * detail panel.
 *
 * Mirrors `the v2.0 typed-artifact system/types.ts#AuditEntry` (shipped
 * in FORA-505) so the typed shape stays consistent across centers.
 * Kept in a separate file so the forge app can render audit entries
 * without a workspace dep on `the v2.0 design system`.
 */

export type AuditActorKind = "user" | "agent" | "system" | "scheduler";

/**
 * MCP server ids surfaced in the Connector Center marketplace.
 * The union mirrors the registry in `lib/mcp-registry.ts` and is the
 * authoritative list used by the audit-feed tests + filter UIs.
 */
export type AuditMCPServerId =
  | "github"
  | "jira"
  | "gitlab"
  | "slack"
  | "teams"
  | "sonarqube"
  | "figma"
  | "aws"
  | "azdo"
  | "zendesk"
  | "databricks"
  | "clickup"
  | "adobe_xd"
  | "kiro"
  | "arch_analyzer";

/**
 * Tool/operation names emitted by each MCP server. The audit feed
 * keys events as `<serverId>.<tool>` (e.g. `clickup.create_task`).
 * These unions give type-safe filtering on the connector-center
 * detail panel and downstream audit center projections.
 */
export type AuditMCPTool =
  | `${AuditMCPServerId}.${string}`;

/** Per-server tool inventory — keyed by server id, value is the tool name. */
export const MCP_TOOLS: Readonly<Record<AuditMCPServerId, ReadonlyArray<string>>> = {
  github: ["read_repos", "create_pr", "read_issues", "create_issue", "trigger_workflow"],
  jira: ["create_issue", "update_issue", "read_boards", "create_epic"],
  gitlab: ["read_repos", "create_mr", "trigger_pipeline"],
  slack: ["send_message", "read_messages", "create_channel"],
  teams: ["send_message", "create_meeting"],
  sonarqube: ["scan", "read_issues", "read_quality_gate"],
  figma: ["read_file", "read_components", "export_assets"],
  aws: ["read_s3", "list_ecs", "describe_rds", "read_secrets"],
  azdo: ["read_repos", "create_pr", "trigger_pipeline"],
  zendesk: ["read_tickets", "create_ticket", "update_ticket"],
  databricks: ["read_jobs", "trigger_job", "read_tables"],
  clickup: ["read_tasks", "create_task", "update_task", "read_spaces", "read_goals"],
  adobe_xd: ["read_prototypes", "read_artboards", "read_components", "export_assets"],
  kiro: ["read_specs", "create_spec", "trigger_agent", "read_runs"],
  arch_analyzer: ["analyze_repo", "detect_patterns"],
};

/** Build a typed `<server>.<tool>` audit-event id from the registry tables. */
export function mcpAuditTool(
  server: AuditMCPServerId,
  tool: string,
): AuditMCPTool {
  return `${server}.${tool}` as AuditMCPTool;
}

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: {
    readonly kind: AuditActorKind;
    readonly id: string;
    readonly displayName?: string;
  };
  readonly tenantId: string;
  readonly tool: string;
  readonly queryHash?: string;
  readonly responseHash?: string;
  readonly latencyMs?: number;
  readonly tokens?: {
    readonly prompt: number;
    readonly completion: number;
  };
  readonly costUsd?: number;
  readonly artifactRef?: {
    readonly kind: "task" | "adr" | "patch" | "deployment" | "approval" | "security-finding";
    readonly id: string;
  };
}