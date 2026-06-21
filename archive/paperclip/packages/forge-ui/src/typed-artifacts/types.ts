/**
 * Typed-artifact contracts — FORA-393 Plan 4 §3.
 * Each renderer consumes one of these shapes (or a subset). The Handoff
 * Contract (memory/architecture.md §7) is the authoritative source; these
 * types are the renderer-side mirror.
 *
 * Schemas are intentionally narrow render-time shapes. The full Zod-validated
 * contracts live in the Handoff Contract schema; the renderer mirror keeps
 * `readonly` everywhere so a consumer cannot mutate a typed artifact through
 * its DOM contract.
 */

export type RequirementStatus = "draft" | "review" | "accepted" | "out-of-scope";

export interface Requirement {
  readonly id: string;
  readonly title: string;
  readonly source?: string;
  readonly schemaVersion?: string;
  readonly sections: {
    problem?: string;
    targetUsers?: string;
    successMetrics?: string;
    outOfScope?: string;
    openQuestions?: ReadonlyArray<OpenQuestion>;
  };
  readonly status: RequirementStatus;
}

export interface OpenQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly owner?: string;
  readonly blocks?: ReadonlyArray<string>;
  readonly dueBy?: string;
}

export interface Adr {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status: "proposed" | "accepted" | "superseded" | "deprecated";
  readonly decisionDate?: string;
  readonly deciders?: ReadonlyArray<string>;
  readonly context?: string;
  readonly decision?: string;
  readonly consequences?: string;
  readonly supersedes?: ReadonlyArray<string>;
  readonly supersededBy?: ReadonlyArray<string>;
}

export type ApiContractFormat = "openapi" | "graphql" | "asyncapi";

export type ApiEndpointMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export interface ApiEndpoint {
  readonly id: string;
  readonly method: ApiEndpointMethod;
  readonly path: string;
  readonly summary?: string;
  readonly parameters?: ReadonlyArray<{
    readonly name: string;
    readonly in: "path" | "query" | "header" | "cookie";
    readonly required?: boolean;
    readonly schema?: string;
  }>;
  readonly requestBody?: string;
  readonly responses?: ReadonlyArray<{
    readonly status: string;
    readonly description?: string;
  }>;
}

export interface ApiContract {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly format: ApiContractFormat;
  readonly endpoints?: ReadonlyArray<ApiEndpoint>;
  /** diff variant: previous version endpoints, joined by id. */
  readonly previousVersion?: {
    readonly version: string;
    readonly endpoints?: ReadonlyArray<ApiEndpoint>;
  };
}

export interface TaskArtifact {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly status: string;
  readonly priority: "critical" | "high" | "medium" | "low";
  readonly owner?: { readonly displayName: string; readonly id: string };
  readonly blockedBy?: ReadonlyArray<string>;
  readonly blocks?: ReadonlyArray<string>;
  readonly stage?: string;
  readonly runId?: string;
  readonly lastActivityAt?: string;
}

export interface PatchFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks?: ReadonlyArray<{
    readonly kind: "context" | "addition" | "deletion";
    readonly text: string;
  }>;
}

export interface Patch {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
  readonly files?: ReadonlyArray<PatchFile>;
  readonly linkedPrs?: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly state: "open" | "merged" | "closed" | "draft";
    readonly reviewState?: "pending" | "approved" | "changes-requested" | "commented";
  }>;
  readonly testFilesExercised?: ReadonlyArray<string>;
}

export type TestTier = "unit" | "integration" | "contract" | "e2e";

export interface TestCaseResult {
  readonly id: string;
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped" | "flaky";
  readonly durationMs: number;
  readonly failureMessage?: string;
}

export interface TestReport {
  readonly id: string;
  readonly tier: TestTier;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly failingTests?: ReadonlyArray<TestCaseResult>;
  readonly coverage?: ReadonlyArray<{
    readonly modulePath: string;
    readonly coveragePct: number;
  }>;
  readonly flakeLedgerEntry?: string;
}

export interface SecurityFinding {
  readonly id: string;
  readonly severity: "critical" | "high" | "medium" | "low" | "info";
  readonly title: string;
  readonly exploitPath?: string;
  readonly fixRecommendation?: string;
  readonly affectedModules?: ReadonlyArray<string>;
}

export interface SecurityReport {
  readonly id: string;
  readonly stage: string;
  readonly findings: ReadonlyArray<SecurityFinding>;
  readonly threatModelLink?: string;
  readonly secretsInventoryLink?: string;
}

export type DeployStrategy = "blue-green" | "canary" | "rolling" | "recreate";
export type DeployApprovalState = "pending" | "approved" | "blocked" | "rolled-back";

export interface DeploymentStep {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "running" | "succeeded" | "failed";
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface DeploymentPlan {
  readonly id: string;
  readonly title: string;
  readonly targetEnv: "dev" | "staging" | "prod" | "customer-tenant";
  readonly version: string;
  readonly strategy: DeployStrategy;
  readonly approvalState: DeployApprovalState;
  readonly deployer?: string;
  readonly timeWindow?: { readonly startsAt: string; readonly endsAt: string };
  readonly steps?: ReadonlyArray<DeploymentStep>;
  readonly canaryHealth?: ReadonlyArray<{
    readonly metric: string;
    readonly value: number;
    readonly threshold: number;
  }>;
  readonly rollbackPlan?: string;
  readonly lastRollback?: {
    readonly id: string;
    readonly reason: string;
    readonly triggeredAt: string;
    readonly triggeredBy: string;
  };
}

export type AuditActorKind = "user" | "agent" | "system" | "scheduler";

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

export type ApprovalKind =
  | "request_confirmation"
  | "request_checkbox_confirmation"
  | "ask_user_questions"
  | "suggest_tasks";
export type ApprovalState =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "superseded";

export interface ApprovalRequest {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly title: string;
  readonly prompt: string;
  readonly state: ApprovalState;
  readonly idempotencyKey?: string;
  readonly createdAt: string;
  readonly decider?: { readonly displayName: string; readonly id: string };
  readonly decidedAt?: string;
  readonly reason?: string;
  readonly options?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description?: string;
  }>;
  readonly issueRef?: { readonly identifier: string; readonly id: string };
}

export type RendererVariant = "card" | "panel" | "row" | "summary" | "summary-card" | "detail-panel" | "inline-banner" | "compact-list-row" | "kanban-card" | "finding-list" | "coverage-map" | "run-log-table" | "diff" | "pr-link" | "history-row" | "export-row" | "injection-list";

export interface BaseRendererProps<T> {
  readonly artifact: T;
  readonly variant?: RendererVariant;
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// MCP Connector — Plan 1 §3.2 typed-artifact surface
//   * `McpConnector` / `ConnectorHealth` / `ConnectorScope` / `CredentialEnvelope`
//   * `ToolCallStatus` — the audit-log enum that pins the status-pill colors
//     per Plan 3 §7.1. Owned by the IAM broker (FORA-125).
//   * The renderer mirror of the runtime contract; the canonical types
//     live in `@fora/connector-config` and `@fora/secrets-mcp`.
//   * `CredentialEnvelope.redacted` is the literal `true` — any other
//     value on the wire is a contract violation. The runtime raises a
//     typed `CredentialEnvelopeViolationError`; the renderer never
//     displays a raw value and the regression test in
//     `__tests__/typed-artifacts-connector.test.tsx` enforces that.
// ---------------------------------------------------------------------------

/**
 * The audit log's tool_call_status enum, owned by the IAM broker (FORA-125).
 * Plan 3 §7.1 pins the Connector Center status colors to this enum:
 * `success` → --brand-success, `degraded` → --brand-warn, `error` → --brand-danger.
 */
export type ToolCallStatus = "success" | "degraded" | "error";

/**
 * Health snapshot for a connector — Plan 1 §3.2 typed artifact.
 * p50 / p95 are computed over the last 24h by the health-check worker
 * (see @fora/connector-config `recordHealthCheck`); errorRate is the
 * ratio of failed tool calls to total tool calls over the same window.
 */
export interface ConnectorHealth {
  readonly lastCallAt?: string;
  readonly p50Ms?: number;
  readonly p95Ms?: number;
  readonly errorRate?: number; // 0..1
  readonly callCount24h: number;
}

/**
 * Scope grant for a connector — the per-tenant MCP scopes the IAM broker
 * (FORA-125) granted to the binding. `deniedScopes` are scopes the
 * Architect/tenant explicitly revoked; `roleBinding` is the agent role
 * that owns this grant.
 */
export interface ConnectorScope {
  readonly grantedScopes: ReadonlyArray<string>;
  readonly deniedScopes?: ReadonlyArray<string>;
  readonly roleBinding: string;
}

/**
 * Redacted credential envelope per the FORA-128 secrets-mcp v0 contract.
 * The raw secret value NEVER crosses the wire or the DOM. The renderer
 * displays `secretRef`, `fingerprint`, `expiresAt`, `lastRotatedAt`,
 * and `valueLen`; the runtime's secrets-mcp returns this shape from
 * `resolve(secret_ref)` and the new shape from `rotate(secret_ref)`.
 *
 * `redacted` is the literal `true`; any other value is a contract
 * violation and a typed `CredentialEnvelopeViolationError` will be
 * raised by the consumer.
 */
export interface CredentialEnvelope {
  /** `tenants/{tenant_id}/secrets/{name}@{version}` per FORA-128. */
  readonly secretRef: string;
  /** Always the literal `true` on the wire; see FORA-128. */
  readonly redacted: true;
  /** Length of the raw value, for size sanity; not the value itself. */
  readonly valueLen?: number;
  /** sha256[:12] of the raw value — the only stable identifier. */
  readonly fingerprint: string;
  /** Optional rotation deadline; renderer surfaces a callout within 14d. */
  readonly expiresAt?: string;
  /** Timestamp of the last successful rotate action. */
  readonly lastRotatedAt?: string;
}

/** Tier 1 = tech-stack.md §10 priority-1; Tier 2 = priority-2. */
export type ConnectorTier = 1 | 2;

/**
 * The McpConnector typed artifact (Plan 1 §3.2). Mirrors the
 * @fora/connector-config `ConnectorId` closed enum.
 */
export interface McpConnector {
  /** Connector id; matches the ConnectorId closed enum. */
  readonly id: string;
  /** Stable machine name: 'jira', 'github', 'slack', ... */
  readonly name: string;
  /** Human label: 'Jira', 'GitHub', 'Slack', ... */
  readonly displayName: string;
  readonly tenantId: string;
  readonly status: ToolCallStatus;
  readonly tier: ConnectorTier;
  readonly health: ConnectorHealth;
  readonly scope: ConnectorScope;
  /** ALWAYS redacted. Renderers must never display the raw value. */
  readonly credential: CredentialEnvelope;
  readonly lastUsedAt?: string;
  readonly lastAuditEntryId?: string;
}

// ---------------------------------------------------------------------------
// Knowledge Center — Plan 1 §3.3 typed-artifact surface
//   * `KnowledgeFile`     — the Knowledge Layer file the center browses
//   * `GlossaryEntry`     — a term from `customer/glossary.md` (always injected)
//   * `StageInjectionMap` — per-stage file list per workspace/README.md §2
//
// The renderers below are the typed twin of the Handoff Contract's
// `KnowledgeFile` / `GlossaryEntry` / `StageInjectionMap` artifacts
// (memory/architecture.md §7). v1.0 is read-only — the renderers expose
// no edit affordances. v1.1 will add the "request glossary PR" + "add
// file" affordances behind RBAC.
// ---------------------------------------------------------------------------

/**
 * The Knowledge Layer's `memory/` / `customer/` / `project/` /
 * `engagements/<slug>/` folders. `reference` covers Plan 2's typed
 * graph source (the Foundation registry); the renderer never
 * distinguishes colour from `customer` (Plan 2 §3.1).
 */
export type KnowledgeFolder =
  | "memory"
  | "customer"
  | "project"
  | "engagements"
  | "reference";

/**
 * File type discriminator for the file viewer (Plan 1 §3.3 #2).
 * `markdown` → render with prose viewer.
 * `json-schema` → render as a typed schema tree.
 * `adr-registry` → render the ADR list (per project/adr-registry.md).
 * `glossary` → render the glossary dictionary.
 */
export type KnowledgeFileType =
  | "markdown"
  | "json-schema"
  | "adr-registry"
  | "glossary";

/**
 * The injection role a file plays for a given sub-agent stage. The
 * glossary is always injected (Plan 1 §3.3, README §2); other files
 * are selected by the Master Orchestrator.
 */
export type InjectionRole = "primary" | "secondary" | "glossary";

/** Per-stage row of the README §2 injection model. */
export interface KnowledgeInjectionRole {
  readonly stage: string;
  readonly role: InjectionRole;
}

/**
 * A file in the Knowledge Layer. The renderer surfaces the file
 * metadata (path, folder, byte size, version hash) and, when the
 * `panel` variant is requested, a markdown body. The body is the raw
 * file content as a string; the renderer does NOT sanitise it — the
 * producer side is responsible for content safety.
 */
export interface KnowledgeFile {
  readonly id: string;
  /** Path relative to the workspace root, e.g. "memory/coding.md". */
  readonly path: string;
  /** Display title — usually the basename of `path`. */
  readonly title: string;
  readonly folder: KnowledgeFolder;
  readonly fileType: KnowledgeFileType;
  /** Byte size of the file on disk. */
  readonly byteSize: number;
  /** sha256[:12] of the file content — the version pin. */
  readonly versionHash: string;
  /** Per-stage injection roles (denormalised from README §2). */
  readonly injectionRoles: ReadonlyArray<KnowledgeInjectionRole>;
  /** Optional body — only loaded by the `panel` variant. */
  readonly content?: string;
  /**
   * Last-write timestamp (ISO 8601). Used by the file viewer header
   * and by the Knowledge Center's "recently changed" widget.
   */
  readonly updatedAt?: string;
}

/**
 * A glossary entry from `customer/glossary.md`. `usageCount` drives
 * the node-size hint in the Knowledge Graph (Plan 2 §3.1).
 */
export interface GlossaryEntry {
  readonly id: string;
  readonly term: string;
  /** The definition. Markdown allowed (rendered as prose). */
  readonly definition: string;
  /** KnowledgeFile ids that reference this term. */
  readonly relatedFileIds?: ReadonlyArray<string>;
  /** Number of files that inject this term — drives the graph node size. */
  readonly usageCount: number;
  /** Optional anti-glossary note (Plan 1 §3.3 + customer/glossary.md). */
  readonly antiNote?: string;
}

/**
 * A row of the README §2 injection model — the per-stage file list
 * the "what does each agent see?" panel renders. The renderer
 * composes this with the `KnowledgeFile` rows to produce the
 * injection-list view (Plan 1 §3.3 #3).
 */
export interface StageInjectionMap {
  readonly id: string;
  /** Stage label, e.g. "Developer", "QA", "Security". */
  readonly stage: string;
  /** KnowledgeFile ids injected for this stage (denormalised). */
  readonly fileIds: ReadonlyArray<string>;
  /** KnowledgeFile ids always injected (the glossary). */
  readonly glossaryFileIds: ReadonlyArray<string>;
  /** Optional co-owner sub-agent role (e.g. "Developer", "Security"). */
  readonly ownerRole?: string;
}
