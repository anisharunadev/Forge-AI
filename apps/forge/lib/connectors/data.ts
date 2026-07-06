/**
 * Connector Center — enriched mock dataset (Step 31).
 *
 * Provides the rich, realistic shape consumed by every tab in the
 * Connector Center and by the cross-cutting `<ConnectorPicker>` /
 * `<ConnectorActionButton>` / `<ConnectorHealthIndicator>` /
 * `<ConnectorCredentialsBadge>` components.
 *
 * The legacy `lib/connector-center/data.ts` stays the source of truth for
 * the backend orchestrator seam (`listConnectors`, `getConnector`,
 * `listSyncHistory`). This module is the richer front-end store used by
 * the Step 31 modernization.
 *
 * Design constraints honored (Step 31 spec + Rule 8):
 *   - model-provider agnostic (no SDK imports)
 *   - mock OAuth only — never touches a real provider
 *   - credentials always redacted in wire form (••••••)
 *   - dark-mode only
 *   - lucide icons only (resolved via `resolveIcon`)
 */

import {
  CheckSquare,
  Cloud,
  CloudCog,
  Database,
  GitBranch,
  GitMerge,
  Headphones, LayoutGrid,
  MessageSquare,
  Network,
  Palette,
  PenTool,
  Plug,
  Send,
  Shield, TestTube2,
  Users,
  Webhook,
  Zap,
  type LucideIcon
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectorCategory =
  | 'source-control'
  | 'project-mgmt'
  | 'comms'
  | 'cloud'
  | 'quality'
  | 'data'
  | 'design'
  | 'monitoring';

export type ConnectorHealthStatus =
  | 'healthy'
  | 'syncing'
  | 'stale'
  | 'failed'
  | 'quarantined'
  | 'paused';

/** Status returned by the per-connector live probe (used by
 * ConnectorStatusPill). Lives alongside the broader
 * ConnectorHealthStatus because the probe only knows three states. */
export type ToolCallStatus = 'success' | 'degraded' | 'error';

export type ConnectorScope = 'org' | 'project';

export type CredentialType = 'api_key' | 'oauth' | 'service_account' | 'webhook_secret';

export type CredentialStatus = 'active' | 'expiring' | 'expired';

export type SyncEventType = 'pull' | 'push' | 'webhook' | 'test';

export type SyncEventStatus = 'success' | 'partial' | 'failed';

/**
 * A capability describes something a connector can *do*. Used by the
 * cross-cutting `<ConnectorPicker>` to filter connectors by intent
 * ("pull issues", "send message", "query database"). The list is
 * intentionally small — every capability must be backed by at least one
 * connector in the dataset.
 */
export type ConnectorCapability =
  | 'pull_issues'
  | 'pull_prs'
  | 'pull_commits'
  | 'create_ticket'
  | 'update_ticket'
  | 'send_message'
  | 'send_email'
  | 'query_database'
  | 'read_warehouse'
  | 'push_metrics'
  | 'read_alerts'
  | 'read_design'
  | 'push_design'
  | 'trigger_deploy'
  | 'read_logs'
  | 'search_docs';

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  'source-control': 'Source control',
  'project-mgmt': 'Project mgmt',
  comms: 'Comms',
  cloud: 'Cloud',
  quality: 'Quality',
  data: 'Data',
  design: 'Design',
  monitoring: 'Monitoring',
};

export const CATEGORY_ORDER: ReadonlyArray<ConnectorCategory> = [
  'source-control',
  'project-mgmt',
  'comms',
  'cloud',
  'quality',
  'data',
  'design',
  'monitoring',
];

export const STATUS_LABEL: Record<ConnectorHealthStatus, string> = {
  healthy: 'Healthy',
  syncing: 'Syncing',
  stale: 'Stale',
  failed: 'Failed',
  quarantined: 'Quarantined',
  paused: 'Paused',
};

/** Status dot — single source of truth for connector health colors. */
export const STATUS_DOT_CLASS: Record<ConnectorHealthStatus, string> = {
  healthy: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
  syncing: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)]',
  stale: 'bg-[var(--accent-amber)]',
  failed: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]',
  quarantined: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]',
  paused: 'bg-[var(--fg-tertiary)]',
};

export const STATUS_ORDER: ReadonlyArray<ConnectorHealthStatus> = [
  'healthy',
  'syncing',
  'stale',
  'failed',
  'quarantined',
  'paused',
];

export const SCOPE_LABEL: Record<ConnectorScope, string> = {
  org: 'Org-wide',
  project: 'Project-scoped',
};

export const CREDENTIAL_TYPE_LABEL: Record<CredentialType, string> = {
  api_key: 'API key',
  oauth: 'OAuth token',
  service_account: 'Service account',
  webhook_secret: 'Webhook secret',
};

// ---------------------------------------------------------------------------
// Icon registry — single source for the lucide component per connector id.
// ---------------------------------------------------------------------------

const ICONS: Readonly<Record<string, LucideIcon>> = {
  github: GitBranch,
  gitlab: GitMerge,
  bitbucket: GitBranch,
  jira: CheckSquare,
  linear: CheckSquare,
  asana: CheckSquare,
  clickup: CheckSquare,
  slack: MessageSquare,
  teams: MessageSquare,
  discord: MessageSquare,
  pagerduty: Zap,
  aws: Cloud,
  gcp: Cloud,
  azure: CloudCog,
  kubernetes: Cloud,
  sonarqube: Shield,
  snyk: Shield,
  datadog: Network,
  sentry: TestTube2,
  newrelic: Network,
  postgres: Database,
  databricks: Database,
  snowflake: Database,
  figma: Palette,
  zeplin: PenTool,
  notion: LayoutGrid,
  confluence: LayoutGrid,
  zendesk: Headphones,
  intercom: Users,
  webhooks: Webhook,
  sendgrid: Send,
};

export function resolveIcon(id: string): LucideIcon {
  return ICONS[id] ?? Plug;
}

// ---------------------------------------------------------------------------
// Connector — full enriched record
// ---------------------------------------------------------------------------

export interface ConnectorCredential {
  readonly id: string;
  readonly name: string;          // "GitHub PAT · Forge Platform"
  readonly type: CredentialType;
  readonly status: CredentialStatus;
  readonly fingerprint: string;    // sha256[:12]
  readonly lastRotatedAt: string; // ISO
  readonly lastUsedAt?: string | null; // ISO — backend /v1/connectors/credentials
  readonly connectorId?: string;  // FK to connectors.id; null for orphan creds
  readonly rotatedBy: string;
  readonly expiresAt?: string;     // ISO
  readonly owner: { name: string; initials: string };
  readonly scopes: ReadonlyArray<string>;
  readonly lengthChars: number;    // raw length (never the value)
  /** True when the credential is stored as a redacted reference
   * (never display the raw value). Used by the audit harness. */
  readonly redacted?: boolean;
  /** Opaque backend handle that the rotate/reveal APIs accept. */
  readonly secretRef?: string;
  /** Legacy alias for `lengthChars` (used by some McpConnector consumers). */
  readonly valueLen?: number;
}

export interface ConnectorUsage {
  readonly workflows: number;
  readonly destinations: number;
  readonly ideationSources: number;
  readonly agentContexts: number;
  /** Total API calls today across all consumers. */
  readonly apiCallsToday: number;
  /** Percentage of the provider's per-minute rate limit used (0..1). */
  readonly rateLimitUsed: number;
  /** Approximate $ this month (mock). */
  readonly monthlyCostUsd: number;
}

export interface ConnectorSyncEvent {
  readonly id: string;
  readonly at: string;
  readonly eventType: SyncEventType;
  readonly entity: string;
  readonly status: SyncEventStatus;
  readonly durationMs: number;
  readonly records: number;
  readonly errorMessage?: string;
}

export interface Connector {
  readonly id: string;
  /** Tenant id (multi-tenant isolation, R2). */
  readonly tenantId?: string;
  readonly name: string;
  readonly displayName: string;
  readonly publisher: string;
  readonly tagline: string;
  readonly description: string;
  readonly category: ConnectorCategory;
  /** Scope discriminator — string for the simple cases; the legacy
   * McpConnector shape extends via `scopeBinding` below. */
  readonly scope: ConnectorScope;
  /** Optional rich scope binding used by the McpConnector-style
   * cards (granted/denied scope chips). */
  readonly scopeBinding?: {
    readonly roleBinding: string;
    readonly grantedScopes: ReadonlyArray<string>;
    readonly deniedScopes?: ReadonlyArray<string>;
  };
  readonly tier: 1 | 2;
  readonly status: ConnectorHealthStatus;
  /** Connected account display — workspace or user. */
  readonly connectedAs: string;
  /** ISO of last sync event. */
  readonly lastSyncAt: string;
  /** ISO of next scheduled sync (or undefined for event-driven). */
  readonly nextSyncAt?: string;
  /** ISO of last successful sync (used by Health tab). */
  readonly lastSuccessAt?: string;
  /** ISO of last failure (used by Health tab). */
  readonly lastFailureAt?: string;
  readonly capabilities: ReadonlyArray<ConnectorCapability>;
  readonly health: {
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly errorRate: number; // 0..1
    /** ISO timestamp of the most recent call (used by ConnectorCard). */
    readonly lastCallAt?: string;
    /** Rolling 24h call count (used by ConnectorCard). */
    readonly callCount24h?: number;
  };
  readonly credential: ConnectorCredential;
  readonly usage: ConnectorUsage;
  /** Sync events used by Activity feed — most recent first. */
  readonly recentEvents: ReadonlyArray<ConnectorSyncEvent>;
  /** Where this connector is used across the app. */
  readonly usedIn: {
    readonly workflows: ReadonlyArray<string>;
    readonly destinations: ReadonlyArray<string>;
    readonly agents: ReadonlyArray<string>;
    readonly ideationSources: ReadonlyArray<string>;
  };
  /** Whether the connector is installed (always true for the Connected tab;
   *  marketplace rows are not installed and use `available: true`). */
  readonly installed: boolean;
  /** Whether the connector is in the marketplace catalog. */
  readonly available: boolean;
  readonly featured?: boolean;
  readonly newThisMonth?: boolean;
}

// ---------------------------------------------------------------------------
// Recommended connectors (used by Overview "Recommended for you" tile)
// ---------------------------------------------------------------------------

export interface RecommendedConnector {
  readonly id: string;
  readonly displayName: string;
  readonly tagline: string;
  readonly category: ConnectorCategory;
  readonly reason: string;     // tooltip text
}

// ---------------------------------------------------------------------------
// Dataset — 18 connectors (15 connected + 3 available-only for variety).
// ---------------------------------------------------------------------------

const ISO = (d: string) => new Date(d).toISOString();

const T0 = Date.parse('2026-06-26T09:00:00Z');

function ago(ms: number): string {
  return new Date(T0 - ms).toISOString();
}

function ahead(ms: number): string {
  return new Date(T0 + ms).toISOString();
}

const ARUN = { name: 'Arun Achalam', initials: 'AA' };
const MAYA = { name: 'Maya Patel', initials: 'MP' };
const JIN  = { name: 'Jin Park', initials: 'JP' };
const LEILA = { name: 'Leila Hassan', initials: 'LH' };
const SAM = { name: 'Sam Okafor', initials: 'SO' };

export const CONNECTORS: ReadonlyArray<Connector> = [
  // ----- source-control -----
  {
    id: 'github',
    name: 'github',
    displayName: 'GitHub',
    publisher: 'Forge Team',
    tagline: 'Source control, issues, PRs and Actions',
    description:
      'Sync repositories, issues and pull requests from GitHub. Forge can read code, create branches, open PRs and trigger Actions workflows.',
    category: 'source-control',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'arun@acme.com · acme-corp org',
    lastSyncAt: ago(2 * 60_000),
    nextSyncAt: ahead(8 * 60_000),
    lastSuccessAt: ago(2 * 60_000),
    capabilities: ['pull_issues', 'pull_prs', 'pull_commits'],
    health: { p50Ms: 142, p95Ms: 410, errorRate: 0.004 },
    credential: {
      id: 'cred-github-01',
      name: 'GitHub PAT · Forge Platform',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:8a91f0c4e21b',
      lastRotatedAt: ago(14 * 86_400_000),
      rotatedBy: ARUN.name,
      owner: ARUN,
      scopes: ['repo', 'read:org', 'workflow'],
      lengthChars: 40,
    },
    usage: {
      workflows: 12, destinations: 4, ideationSources: 2, agentContexts: 5,
      apiCallsToday: 4_812, rateLimitUsed: 0.18, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'gh-1', at: ago(2 * 60_000), eventType: 'webhook', entity: 'PR #4821 opened', status: 'success', durationMs: 312, records: 1 },
      { id: 'gh-2', at: ago(11 * 60_000), eventType: 'pull', entity: 'Issues · forge-ai', status: 'success', durationMs: 1_240, records: 47 },
      { id: 'gh-3', at: ago(38 * 60_000), eventType: 'pull', entity: 'Commits · main', status: 'success', durationMs: 480, records: 12 },
      { id: 'gh-4', at: ago(2 * 3_600_000), eventType: 'pull', entity: 'PRs · review queue', status: 'success', durationMs: 612, records: 8 },
      { id: 'gh-5', at: ago(5 * 3_600_000), eventType: 'webhook', entity: 'Issue #1124 closed', status: 'success', durationMs: 198, records: 1 },
    ],
    usedIn: {
      workflows: ['PR Review Triage', 'Security Scan Fan-out', 'Release Notes Generator'],
      destinations: ['GitHub Issues', 'PR comments'],
      agents: ['Code Reviewer', 'Security Auditor'],
      ideationSources: ['Engineering Backlog'],
    },
    installed: true,
    available: true,
    featured: true,
  },
  {
    id: 'gitlab',
    name: 'gitlab',
    displayName: 'GitLab',
    publisher: 'Forge Team',
    tagline: 'GitLab repositories, MRs and pipelines',
    description: 'Mirror GitLab merge requests, issues and CI pipelines into Forge.',
    category: 'source-control',
    scope: 'project',
    tier: 1,
    status: 'syncing',
    connectedAs: 'forge-bot @ acme-corp',
    lastSyncAt: ago(6 * 60_000),
    capabilities: ['pull_issues', 'pull_prs', 'pull_commits'],
    health: { p50Ms: 198, p95Ms: 612, errorRate: 0.012 },
    credential: {
      id: 'cred-gitlab-01',
      name: 'GitLab Token · mobile-app',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:7c2e9b81f04a',
      lastRotatedAt: ago(62 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['api', 'read_repository'],
      lengthChars: 32,
    },
    usage: {
      workflows: 4, destinations: 1, ideationSources: 1, agentContexts: 2,
      apiCallsToday: 1_203, rateLimitUsed: 0.22, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'gl-1', at: ago(6 * 60_000), eventType: 'pull', entity: 'MRs · mobile-app', status: 'success', durationMs: 982, records: 9 },
      { id: 'gl-2', at: ago(46 * 60_000), eventType: 'pull', entity: 'Issues · mobile-app', status: 'success', durationMs: 712, records: 23 },
    ],
    usedIn: {
      workflows: ['Mobile Release Triage'],
      destinations: ['GitLab MRs'],
      agents: ['Mobile Release Manager'],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'bitbucket',
    name: 'bitbucket',
    displayName: 'Bitbucket',
    publisher: 'Forge Team',
    tagline: 'Atlassian-hosted git repositories',
    description: 'Sync Bitbucket repos and pull requests.',
    category: 'source-control',
    scope: 'org',
    tier: 2,
    status: 'paused',
    connectedAs: 'forge-bot @ legacy-team',
    lastSyncAt: ago(11 * 86_400_000),
    capabilities: ['pull_prs', 'pull_commits'],
    health: { p50Ms: 220, p95Ms: 880, errorRate: 0.0 },
    credential: {
      id: 'cred-bitbucket-01',
      name: 'Bitbucket App Password',
      type: 'api_key',
      status: 'expiring',
      fingerprint: 'sha256:1d4f8a72c6e9',
      lastRotatedAt: ago(120 * 86_400_000),
      rotatedBy: SAM.name,
      owner: SAM,
      scopes: ['repo', 'pullrequest:write'],
      lengthChars: 24,
    },
    usage: {
      workflows: 0, destinations: 0, ideationSources: 0, agentContexts: 0,
      apiCallsToday: 0, rateLimitUsed: 0, monthlyCostUsd: 0,
    },
    recentEvents: [],
    usedIn: { workflows: [], destinations: [], agents: [], ideationSources: [] },
    installed: true,
    available: true,
  },

  // ----- project-mgmt -----
  {
    id: 'jira',
    name: 'jira',
    displayName: 'Jira',
    publisher: 'Forge Team',
    tagline: 'Atlassian Jira issues, epics and sprints',
    description: 'Sync Jira projects, epics, stories and sprints. Forge can create and update issues.',
    category: 'project-mgmt',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme.atlassian.net',
    lastSyncAt: ago(4 * 60_000),
    nextSyncAt: ahead(6 * 60_000),
    lastSuccessAt: ago(4 * 60_000),
    capabilities: ['pull_issues', 'create_ticket', 'update_ticket'],
    health: { p50Ms: 168, p95Ms: 502, errorRate: 0.008 },
    credential: {
      id: 'cred-jira-01',
      name: 'Jira OAuth · Forge',
      type: 'oauth',
      status: 'expiring',
      fingerprint: 'sha256:5b21d8e34a07',
      lastRotatedAt: ago(78 * 86_400_000),
      rotatedBy: MAYA.name,
      owner: MAYA,
      scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user'],
      lengthChars: 64,
      expiresAt: ahead(12 * 86_400_000),
    },
    usage: {
      workflows: 8, destinations: 6, ideationSources: 5, agentContexts: 4,
      apiCallsToday: 2_148, rateLimitUsed: 0.31, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'ji-1', at: ago(4 * 60_000), eventType: 'webhook', entity: 'FORA-1284 updated', status: 'success', durationMs: 412, records: 1 },
      { id: 'ji-2', at: ago(22 * 60_000), eventType: 'pull', entity: 'Sprint 47 board', status: 'success', durationMs: 1_320, records: 84 },
      { id: 'ji-3', at: ago(58 * 60_000), eventType: 'push', entity: 'FORA-1290 created by Idea Synthesizer', status: 'success', durationMs: 612, records: 1 },
    ],
    usedIn: {
      workflows: ['Idea → Story Breakdown', 'Sprint Health Report'],
      destinations: ['Jira backlog', 'Sprint board'],
      agents: ['Story Decomposer', 'Sprint Planner'],
      ideationSources: ['Product Backlog', 'Customer Feedback'],
    },
    installed: true,
    available: true,
    featured: true,
  },
  {
    id: 'linear',
    name: 'linear',
    displayName: 'Linear',
    publisher: 'Forge Team',
    tagline: 'Modern issue tracking for fast-moving teams',
    description: 'Sync Linear projects and issues. Forge can create and update issues.',
    category: 'project-mgmt',
    scope: 'org',
    tier: 2,
    status: 'healthy',
    connectedAs: 'acme-corp.linear.app',
    lastSyncAt: ago(9 * 60_000),
    capabilities: ['pull_issues', 'create_ticket', 'update_ticket'],
    health: { p50Ms: 124, p95Ms: 318, errorRate: 0.002 },
    credential: {
      id: 'cred-linear-01',
      name: 'Linear API Key',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:2e8c14b09f33',
      lastRotatedAt: ago(22 * 86_400_000),
      rotatedBy: MAYA.name,
      owner: MAYA,
      scopes: ['read', 'write', 'issues:create'],
      lengthChars: 48,
    },
    usage: {
      workflows: 3, destinations: 2, ideationSources: 1, agentContexts: 1,
      apiCallsToday: 612, rateLimitUsed: 0.08, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'li-1', at: ago(9 * 60_000), eventType: 'pull', entity: 'Forge Mobile team', status: 'success', durationMs: 412, records: 14 },
    ],
    usedIn: {
      workflows: ['Mobile Bug Triage'],
      destinations: ['Linear backlog'],
      agents: ['Bug Classifier'],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'asana',
    name: 'asana',
    displayName: 'Asana',
    publisher: 'Forge Team',
    tagline: 'Work management for cross-functional teams',
    description: 'Sync Asana projects and tasks.',
    category: 'project-mgmt',
    scope: 'project',
    tier: 2,
    status: 'stale',
    connectedAs: 'marketing-ops workspace',
    lastSyncAt: ago(38 * 3_600_000),
    capabilities: ['pull_issues', 'create_ticket'],
    health: { p50Ms: 240, p95Ms: 920, errorRate: 0.041 },
    credential: {
      id: 'cred-asana-01',
      name: 'Asana PAT',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:9f08a3c2e51d',
      lastRotatedAt: ago(45 * 86_400_000),
      rotatedBy: LEILA.name,
      owner: LEILA,
      scopes: ['default'],
      lengthChars: 40,
    },
    usage: {
      workflows: 1, destinations: 1, ideationSources: 0, agentContexts: 0,
      apiCallsToday: 42, rateLimitUsed: 0.02, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'as-1', at: ago(38 * 3_600_000), eventType: 'pull', entity: 'Q3 Campaign tasks', status: 'partial', durationMs: 1_240, records: 22, errorMessage: 'rate-limited (429)' },
    ],
    usedIn: {
      workflows: ['Campaign Status Digest'],
      destinations: ['Asana board'],
      agents: [],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'clickup',
    name: 'clickup',
    displayName: 'ClickUp',
    publisher: 'Forge Team',
    tagline: 'All-in-one workspace',
    description: 'Sync ClickUp spaces, lists and tasks.',
    category: 'project-mgmt',
    scope: 'project',
    tier: 2,
    status: 'healthy',
    connectedAs: 'acme-workspace',
    lastSyncAt: ago(14 * 60_000),
    capabilities: ['pull_issues', 'create_ticket', 'update_ticket'],
    health: { p50Ms: 198, p95Ms: 540, errorRate: 0.011 },
    credential: {
      id: 'cred-clickup-01',
      name: 'ClickUp API Key',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:4d2f1c8b30ae',
      lastRotatedAt: ago(7 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['default'],
      lengthChars: 40,
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 1, agentContexts: 0,
      apiCallsToday: 318, rateLimitUsed: 0.05, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'cu-1', at: ago(14 * 60_000), eventType: 'pull', entity: 'Design Ops list', status: 'success', durationMs: 612, records: 19 },
    ],
    usedIn: {
      workflows: ['Design Ops Triage'],
      destinations: ['ClickUp tasks'],
      agents: [],
      ideationSources: ['Design Requests'],
    },
    installed: true,
    available: true,
  },

  // ----- comms -----
  {
    id: 'slack',
    name: 'slack',
    displayName: 'Slack',
    publisher: 'Forge Team',
    tagline: 'Send messages, react and manage channels',
    description: 'Send messages to Slack channels, react and trigger workflows from events.',
    category: 'comms',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme-corp.slack.com',
    lastSyncAt: ago(45_000),
    nextSyncAt: ahead(15_000),
    lastSuccessAt: ago(45_000),
    capabilities: ['send_message'],
    health: { p50Ms: 92, p95Ms: 218, errorRate: 0.003 },
    credential: {
      id: 'cred-slack-01',
      name: 'Slack OAuth · Forge',
      type: 'oauth',
      status: 'active',
      fingerprint: 'sha256:6f3a8e12b5d4',
      lastRotatedAt: ago(34 * 86_400_000),
      rotatedBy: ARUN.name,
      owner: ARUN,
      scopes: ['chat:write', 'channels:read', 'users:read', 'reactions:write'],
      lengthChars: 64,
    },
    usage: {
      workflows: 14, destinations: 8, ideationSources: 0, agentContexts: 6,
      apiCallsToday: 6_204, rateLimitUsed: 0.42, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'sl-1', at: ago(45_000), eventType: 'push', entity: '#forge-deploys', status: 'success', durationMs: 184, records: 1 },
      { id: 'sl-2', at: ago(7 * 60_000), eventType: 'push', entity: '#forge-incidents', status: 'success', durationMs: 211, records: 1 },
      { id: 'sl-3', at: ago(34 * 60_000), eventType: 'webhook', entity: '/forge command', status: 'success', durationMs: 412, records: 1 },
    ],
    usedIn: {
      workflows: ['Deploy Announcer', 'Incident Notifier', 'PR Review Pings'],
      destinations: ['Slack channels'],
      agents: ['Release Announcer'],
      ideationSources: [],
    },
    installed: true,
    available: true,
    featured: true,
  },
  {
    id: 'teams',
    name: 'teams',
    displayName: 'Microsoft Teams',
    publisher: 'Forge Team',
    tagline: 'Send messages and react in Teams channels',
    description: 'Send messages and reply to Teams channels.',
    category: 'comms',
    scope: 'project',
    tier: 1,
    status: 'failed',
    connectedAs: 'acme-corp on Teams',
    lastSyncAt: ago(2 * 3_600_000),
    lastFailureAt: ago(2 * 3_600_000),
    capabilities: ['send_message'],
    health: { p50Ms: 280, p95Ms: 1_240, errorRate: 0.18 },
    credential: {
      id: 'cred-teams-01',
      name: 'Teams Bot Token',
      type: 'oauth',
      status: 'expired',
      fingerprint: 'sha256:8b17d44a29e6',
      lastRotatedAt: ago(102 * 86_400_000),
      rotatedBy: SAM.name,
      owner: SAM,
      scopes: ['ChannelMessage.Send', 'Team.ReadBasic.All'],
      lengthChars: 64,
      expiresAt: ago(2 * 3_600_000),
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 0, agentContexts: 1,
      apiCallsToday: 0, rateLimitUsed: 0, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'ms-1', at: ago(2 * 3_600_000), eventType: 'push', entity: '#Platform · deploy notice', status: 'failed', durationMs: 4_120, records: 0, errorMessage: 'AADSTS700016: application not found in directory' },
    ],
    usedIn: {
      workflows: ['EU Deploy Notifier'],
      destinations: ['Teams channels'],
      agents: [],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'sendgrid',
    name: 'sendgrid',
    displayName: 'SendGrid',
    publisher: 'Forge Team',
    tagline: 'Transactional and marketing email',
    description: 'Send transactional emails from Forge workflows.',
    category: 'comms',
    scope: 'org',
    tier: 2,
    status: 'healthy',
    connectedAs: 'acme@sendgrid.com',
    lastSyncAt: ago(3 * 60_000),
    capabilities: ['send_email'],
    health: { p50Ms: 88, p95Ms: 240, errorRate: 0.001 },
    credential: {
      id: 'cred-sendgrid-01',
      name: 'SendGrid API Key',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:3a1b9c8e72d4',
      lastRotatedAt: ago(11 * 86_400_000),
      rotatedBy: LEILA.name,
      owner: LEILA,
      scopes: ['mail.send'],
      lengthChars: 69,
    },
    usage: {
      workflows: 3, destinations: 1, ideationSources: 0, agentContexts: 0,
      apiCallsToday: 1_812, rateLimitUsed: 0.06, monthlyCostUsd: 47,
    },
    recentEvents: [
      { id: 'sg-1', at: ago(3 * 60_000), eventType: 'push', entity: 'forge-weekly digest', status: 'success', durationMs: 312, records: 142 },
    ],
    usedIn: {
      workflows: ['Weekly Digest', 'Welcome Email', 'Alert Digest'],
      destinations: ['forge-users@acme.com'],
      agents: [],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'zendesk',
    name: 'zendesk',
    displayName: 'Zendesk',
    publisher: 'Forge Team',
    tagline: 'Customer support tickets and views',
    description: 'Pull Zendesk tickets, cluster by topic, route to ideation.',
    category: 'comms',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme.zendesk.com',
    lastSyncAt: ago(8 * 60_000),
    nextSyncAt: ahead(12 * 60_000),
    capabilities: ['pull_issues', 'create_ticket'],
    health: { p50Ms: 162, p95Ms: 480, errorRate: 0.006 },
    credential: {
      id: 'cred-zendesk-01',
      name: 'Zendesk API Token',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:7e2d0a8b41c3',
      lastRotatedAt: ago(28 * 86_400_000),
      rotatedBy: LEILA.name,
      owner: LEILA,
      scopes: ['tickets:read', 'tickets:write'],
      lengthChars: 40,
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 6, agentContexts: 3,
      apiCallsToday: 942, rateLimitUsed: 0.12, monthlyCostUsd: 89,
    },
    recentEvents: [
      { id: 'zd-1', at: ago(8 * 60_000), eventType: 'pull', entity: 'Tickets · last 7d', status: 'success', durationMs: 1_240, records: 47 },
      { id: 'zd-2', at: ago(1.5 * 3_600_000), eventType: 'pull', entity: 'Tickets · last 24h', status: 'success', durationMs: 980, records: 12 },
    ],
    usedIn: {
      workflows: ['Support Topic Clusterer'],
      destinations: ['Ideation · support themes'],
      agents: ['Support Analyst'],
      ideationSources: ['Support Tickets'],
    },
    installed: true,
    available: true,
    featured: true,
  },
  {
    id: 'intercom',
    name: 'intercom',
    displayName: 'Intercom',
    publisher: 'Forge Team',
    tagline: 'Customer messaging platform',
    description: 'Pull Intercom conversations and tag them.',
    category: 'comms',
    scope: 'org',
    tier: 2,
    status: 'healthy',
    connectedAs: 'acme.intercom.io',
    lastSyncAt: ago(11 * 60_000),
    capabilities: ['pull_issues'],
    health: { p50Ms: 180, p95Ms: 412, errorRate: 0.009 },
    credential: {
      id: 'cred-intercom-01',
      name: 'Intercom Access Token',
      type: 'oauth',
      status: 'active',
      fingerprint: 'sha256:0e9b2c8f4d17',
      lastRotatedAt: ago(56 * 86_400_000),
      rotatedBy: LEILA.name,
      owner: LEILA,
      scopes: ['read'],
      lengthChars: 80,
    },
    usage: {
      workflows: 1, destinations: 1, ideationSources: 2, agentContexts: 1,
      apiCallsToday: 312, rateLimitUsed: 0.04, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'ic-1', at: ago(11 * 60_000), eventType: 'pull', entity: 'Conversations · last 7d', status: 'success', durationMs: 612, records: 28 },
    ],
    usedIn: {
      workflows: ['Voice of Customer'],
      destinations: ['Ideation themes'],
      agents: [],
      ideationSources: ['Customer Conversations'],
    },
    installed: true,
    available: true,
  },

  // ----- cloud -----
  {
    id: 'aws',
    name: 'aws',
    displayName: 'Amazon Web Services',
    publisher: 'Forge Team',
    tagline: 'Deploy, monitor and query AWS services',
    description: 'Read CloudWatch logs, deploy via CodeDeploy, query S3 metadata.',
    category: 'cloud',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'arn:aws:iam::1294...:role/forge',
    lastSyncAt: ago(60_000),
    nextSyncAt: ahead(4 * 60_000),
    capabilities: ['trigger_deploy', 'read_logs'],
    health: { p50Ms: 320, p95Ms: 1_120, errorRate: 0.014 },
    credential: {
      id: 'cred-aws-01',
      name: 'AWS Access Key · Forge',
      type: 'service_account',
      status: 'active',
      fingerprint: 'sha256:1c2b3d4e5f60',
      lastRotatedAt: ago(19 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['s3:ListBucket', 'logs:GetLogEvents', 'codedeploy:CreateDeployment'],
      lengthChars: 40,
    },
    usage: {
      workflows: 6, destinations: 3, ideationSources: 0, agentContexts: 2,
      apiCallsToday: 3_812, rateLimitUsed: 0.28, monthlyCostUsd: 412,
    },
    recentEvents: [
      { id: 'aw-1', at: ago(60_000), eventType: 'pull', entity: 'CloudWatch · forge-prod', status: 'success', durationMs: 612, records: 1_840 },
      { id: 'aw-2', at: ago(38 * 60_000), eventType: 'push', entity: 'CodeDeploy · forge-prod', status: 'success', durationMs: 8_120, records: 1 },
    ],
    usedIn: {
      workflows: ['Deploy to Prod', 'Log Anomaly Detector'],
      destinations: ['AWS S3'],
      agents: ['SRE Agent'],
      ideationSources: [],
    },
    installed: true,
    available: true,
    featured: true,
  },
  {
    id: 'gcp',
    name: 'gcp',
    displayName: 'Google Cloud',
    publisher: 'Forge Team',
    tagline: 'GCP compute, storage and BigQuery',
    description: 'Query BigQuery and read Cloud Logging.',
    category: 'cloud',
    scope: 'project',
    tier: 1,
    status: 'quarantined',
    connectedAs: 'forge@acme-gcp.iam',
    lastSyncAt: ago(2 * 86_400_000),
    lastFailureAt: ago(2 * 86_400_000),
    capabilities: ['read_logs', 'query_database'],
    health: { p50Ms: 412, p95Ms: 1_840, errorRate: 0.42 },
    credential: {
      id: 'cred-gcp-01',
      name: 'GCP Service Account',
      type: 'service_account',
      status: 'expired',
      fingerprint: 'sha256:5f8e1c2a3b94',
      lastRotatedAt: ago(140 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['bigquery.jobs.create', 'logging.logEntries.list'],
      lengthChars: 64,
      expiresAt: ago(2 * 86_400_000),
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 0, agentContexts: 1,
      apiCallsToday: 0, rateLimitUsed: 0, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'gc-1', at: ago(2 * 86_400_000), eventType: 'pull', entity: 'BigQuery · events_*', status: 'failed', durationMs: 4_120, records: 0, errorMessage: 'invalid_grant: JWT signature mismatch' },
    ],
    usedIn: {
      workflows: ['Analytics Snapshot'],
      destinations: ['BigQuery'],
      agents: [],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'azure',
    name: 'azure',
    displayName: 'Microsoft Azure',
    publisher: 'Forge Team',
    tagline: 'Azure subscriptions and devops',
    description: 'Connect Azure subscriptions for deploy and monitoring.',
    category: 'cloud',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme.onmicrosoft.com',
    lastSyncAt: ago(7 * 60_000),
    capabilities: ['trigger_deploy', 'read_logs'],
    health: { p50Ms: 280, p95Ms: 920, errorRate: 0.008 },
    credential: {
      id: 'cred-azure-01',
      name: 'Azure SP · Forge',
      type: 'service_account',
      status: 'active',
      fingerprint: 'sha256:9b6e2a0c8f31',
      lastRotatedAt: ago(34 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['https://graph.microsoft.com/.default'],
      lengthChars: 64,
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 0, agentContexts: 1,
      apiCallsToday: 612, rateLimitUsed: 0.10, monthlyCostUsd: 184,
    },
    recentEvents: [
      { id: 'az-1', at: ago(7 * 60_000), eventType: 'pull', entity: 'Azure Monitor · forge-eu', status: 'success', durationMs: 612, records: 412 },
    ],
    usedIn: {
      workflows: ['EU Mirror Deploy'],
      destinations: ['Azure Blob'],
      agents: [],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'kubernetes',
    name: 'kubernetes',
    displayName: 'Kubernetes',
    publisher: 'Forge Team',
    tagline: 'Read cluster state and apply manifests',
    description: 'Read pod state, scale deployments, apply manifests.',
    category: 'cloud',
    scope: 'project',
    tier: 1,
    status: 'healthy',
    connectedAs: 'prod-us-east-1 cluster',
    lastSyncAt: ago(2 * 60_000),
    capabilities: ['read_logs', 'trigger_deploy'],
    health: { p50Ms: 110, p95Ms: 340, errorRate: 0.005 },
    credential: {
      id: 'cred-k8s-01',
      name: 'K8s Service Account Token',
      type: 'service_account',
      status: 'active',
      fingerprint: 'sha256:4a2c7e9d1f58',
      lastRotatedAt: ago(8 * 86_400_000),
      rotatedBy: ARUN.name,
      owner: ARUN,
      scopes: ['get', 'list', 'watch', 'patch'],
      lengthChars: 96,
    },
    usage: {
      workflows: 4, destinations: 2, ideationSources: 0, agentContexts: 1,
      apiCallsToday: 1_412, rateLimitUsed: 0.18, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'k8-1', at: ago(2 * 60_000), eventType: 'pull', entity: 'Pods · forge-prod', status: 'success', durationMs: 312, records: 87 },
    ],
    usedIn: {
      workflows: ['Canary Rollout', 'Pod Restart Detector'],
      destinations: ['K8s events'],
      agents: ['SRE Agent'],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },

  // ----- quality -----
  {
    id: 'sonarqube',
    name: 'sonarqube',
    displayName: 'SonarQube',
    publisher: 'Forge Team',
    tagline: 'Static analysis and quality gates',
    description: 'Pull code quality reports and enforce quality gates.',
    category: 'quality',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'sonar.acme.internal',
    lastSyncAt: ago(18 * 60_000),
    capabilities: ['read_alerts'],
    health: { p50Ms: 312, p95Ms: 1_120, errorRate: 0.012 },
    credential: {
      id: 'cred-sonar-01',
      name: 'SonarQube Token',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:8c1d4f0a9b22',
      lastRotatedAt: ago(41 * 86_400_000),
      rotatedBy: SAM.name,
      owner: SAM,
      scopes: ['scan', 'project analysis'],
      lengthChars: 40,
    },
    usage: {
      workflows: 4, destinations: 2, ideationSources: 0, agentContexts: 1,
      apiCallsToday: 412, rateLimitUsed: 0.07, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'sq-1', at: ago(18 * 60_000), eventType: 'pull', entity: 'forge-ai · main', status: 'success', durationMs: 1_840, records: 23 },
    ],
    usedIn: {
      workflows: ['Quality Gate Check'],
      destinations: ['Code review checks'],
      agents: ['Security Auditor'],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'snyk',
    name: 'snyk',
    displayName: 'Snyk',
    publisher: 'Forge Team',
    tagline: 'Vulnerability scanning',
    description: 'Scan dependencies for known vulnerabilities.',
    category: 'quality',
    scope: 'org',
    tier: 2,
    status: 'healthy',
    connectedAs: 'acme-corp',
    lastSyncAt: ago(60 * 60_000),
    capabilities: ['read_alerts'],
    health: { p50Ms: 412, p95Ms: 1_840, errorRate: 0.022 },
    credential: {
      id: 'cred-snyk-01',
      name: 'Snyk API Token',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:2b9f0e3a8c41',
      lastRotatedAt: ago(60 * 86_400_000),
      rotatedBy: SAM.name,
      owner: SAM,
      scopes: ['org.read', 'project.read'],
      lengthChars: 36,
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 0, agentContexts: 0,
      apiCallsToday: 184, rateLimitUsed: 0.03, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'sn-1', at: ago(60 * 60_000), eventType: 'pull', entity: 'forge-ai · main', status: 'success', durationMs: 2_140, records: 12 },
    ],
    usedIn: {
      workflows: ['Dependency Audit'],
      destinations: ['Security dashboard'],
      agents: [],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },

  // ----- data -----
  {
    id: 'postgres',
    name: 'postgres',
    displayName: 'PostgreSQL',
    publisher: 'Forge Team',
    tagline: 'Query Postgres databases read-only',
    description: 'Run read-only SQL queries against project databases.',
    category: 'data',
    scope: 'project',
    tier: 1,
    status: 'healthy',
    connectedAs: 'forge-prod.db.acme.internal',
    lastSyncAt: ago(7 * 60_000),
    capabilities: ['query_database'],
    health: { p50Ms: 38, p95Ms: 142, errorRate: 0.001 },
    credential: {
      id: 'cred-pg-01',
      name: 'Postgres Role · forge_readonly',
      type: 'service_account',
      status: 'active',
      fingerprint: 'sha256:0f1e2d3c4b5a',
      lastRotatedAt: ago(6 * 86_400_000),
      rotatedBy: ARUN.name,
      owner: ARUN,
      scopes: ['CONNECT', 'SELECT'],
      lengthChars: 32,
    },
    usage: {
      workflows: 5, destinations: 2, ideationSources: 3, agentContexts: 4,
      apiCallsToday: 2_412, rateLimitUsed: 0.12, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'pg-1', at: ago(7 * 60_000), eventType: 'pull', entity: 'SELECT · users_active', status: 'success', durationMs: 92, records: 1 },
    ],
    usedIn: {
      workflows: ['Daily Metrics Rollup', 'Feature Adoption'],
      destinations: ['Analytics dataset'],
      agents: ['Data Analyst'],
      ideationSources: ['Product Analytics'],
    },
    installed: true,
    available: true,
    featured: true,
  },
  {
    id: 'snowflake',
    name: 'snowflake',
    displayName: 'Snowflake',
    publisher: 'Forge Team',
    tagline: 'Cloud data warehouse',
    description: 'Query Snowflake for analytics.',
    category: 'data',
    scope: 'org',
    tier: 2,
    status: 'healthy',
    connectedAs: 'acme.us-east-1',
    lastSyncAt: ago(22 * 60_000),
    capabilities: ['read_warehouse', 'query_database'],
    health: { p50Ms: 412, p95Ms: 1_840, errorRate: 0.018 },
    credential: {
      id: 'cred-snow-01',
      name: 'Snowflake Key Pair',
      type: 'service_account',
      status: 'active',
      fingerprint: 'sha256:6d8e2a1c4f73',
      lastRotatedAt: ago(48 * 86_400_000),
      rotatedBy: LEILA.name,
      owner: LEILA,
      scopes: ['ANALYTICS_WH'],
      lengthChars: 128,
    },
    usage: {
      workflows: 3, destinations: 2, ideationSources: 4, agentContexts: 2,
      apiCallsToday: 612, rateLimitUsed: 0.10, monthlyCostUsd: 320,
    },
    recentEvents: [
      { id: 'sf-1', at: ago(22 * 60_000), eventType: 'pull', entity: 'SELECT · funnel_30d', status: 'success', durationMs: 1_240, records: 1 },
    ],
    usedIn: {
      workflows: ['Funnel Snapshot'],
      destinations: ['Reports'],
      agents: ['Analyst'],
      ideationSources: ['Funnel Drop-offs'],
    },
    installed: true,
    available: true,
  },
  {
    id: 'databricks',
    name: 'databricks',
    displayName: 'Databricks',
    publisher: 'Forge Team',
    tagline: 'Lakehouse platform',
    description: 'Run Databricks jobs and query Delta tables.',
    category: 'data',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme.cloud.databricks.com',
    lastSyncAt: ago(28 * 60_000),
    capabilities: ['read_warehouse', 'query_database'],
    health: { p50Ms: 380, p95Ms: 1_640, errorRate: 0.014 },
    credential: {
      id: 'cred-db-01',
      name: 'Databricks PAT',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:1f8a4e2c9b60',
      lastRotatedAt: ago(26 * 86_400_000),
      rotatedBy: LEILA.name,
      owner: LEILA,
      scopes: ['jobs', 'sql'],
      lengthChars: 64,
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 1, agentContexts: 1,
      apiCallsToday: 412, rateLimitUsed: 0.09, monthlyCostUsd: 215,
    },
    recentEvents: [
      { id: 'db-1', at: ago(28 * 60_000), eventType: 'pull', entity: 'Delta · gold.funnel', status: 'success', durationMs: 1_840, records: 1 },
    ],
    usedIn: {
      workflows: ['ML Feature Snapshot'],
      destinations: ['ML features'],
      agents: ['ML Engineer'],
      ideationSources: ['Conversion Cohorts'],
    },
    installed: true,
    available: true,
  },

  // ----- design -----
  {
    id: 'figma',
    name: 'figma',
    displayName: 'Figma',
    publisher: 'Forge Team',
    tagline: 'Design files and components',
    description: 'Pull Figma files, components and design tokens.',
    category: 'design',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme-corp.figma.com',
    lastSyncAt: ago(12 * 60_000),
    capabilities: ['read_design'],
    health: { p50Ms: 220, p95Ms: 612, errorRate: 0.008 },
    credential: {
      id: 'cred-figma-01',
      name: 'Figma OAuth',
      type: 'oauth',
      status: 'active',
      fingerprint: 'sha256:3e8b1a4c9d27',
      lastRotatedAt: ago(50 * 86_400_000),
      rotatedBy: MAYA.name,
      owner: MAYA,
      scopes: ['files:read', 'comments:write'],
      lengthChars: 64,
    },
    usage: {
      workflows: 1, destinations: 1, ideationSources: 1, agentContexts: 1,
      apiCallsToday: 212, rateLimitUsed: 0.04, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'fg-1', at: ago(12 * 60_000), eventType: 'pull', entity: 'Forge design system', status: 'success', durationMs: 612, records: 47 },
    ],
    usedIn: {
      workflows: ['Design Token Sync'],
      destinations: ['Design tokens'],
      agents: ['Design System'],
      ideationSources: ['Design Backlog'],
    },
    installed: true,
    available: true,
  },
  {
    id: 'notion',
    name: 'notion',
    displayName: 'Notion',
    publisher: 'Forge Team',
    tagline: 'Docs and knowledge base',
    description: 'Sync Notion pages and databases.',
    category: 'design',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme-corp.notion.site',
    lastSyncAt: ago(8 * 60_000),
    capabilities: ['search_docs', 'read_design'],
    health: { p50Ms: 180, p95Ms: 540, errorRate: 0.004 },
    credential: {
      id: 'cred-notion-01',
      name: 'Notion Integration',
      type: 'oauth',
      status: 'active',
      fingerprint: 'sha256:5a2b4c8e7f19',
      lastRotatedAt: ago(11 * 86_400_000),
      rotatedBy: MAYA.name,
      owner: MAYA,
      scopes: ['read_content', 'read_user'],
      lengthChars: 50,
    },
    usage: {
      workflows: 2, destinations: 2, ideationSources: 4, agentContexts: 3,
      apiCallsToday: 612, rateLimitUsed: 0.05, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'no-1', at: ago(8 * 60_000), eventType: 'pull', entity: 'Engineering wiki', status: 'success', durationMs: 412, records: 28 },
    ],
    usedIn: {
      workflows: ['Doc Sync', 'Onboarding Tour'],
      destinations: ['Doc search'],
      agents: ['Docs Researcher'],
      ideationSources: ['Strategy Docs'],
    },
    installed: true,
    available: true,
  },

  // ----- monitoring -----
  {
    id: 'datadog',
    name: 'datadog',
    displayName: 'Datadog',
    publisher: 'Forge Team',
    tagline: 'Metrics, traces and logs',
    description: 'Pull metrics, traces and logs from Datadog.',
    category: 'monitoring',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme.datadoghq.com',
    lastSyncAt: ago(60_000),
    nextSyncAt: ahead(2 * 60_000),
    capabilities: ['push_metrics', 'read_alerts', 'read_logs'],
    health: { p50Ms: 88, p95Ms: 240, errorRate: 0.002 },
    credential: {
      id: 'cred-dd-01',
      name: 'Datadog API Key',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:4c2d9a3e7f81',
      lastRotatedAt: ago(9 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['metrics_write', 'logs_read'],
      lengthChars: 32,
    },
    usage: {
      workflows: 4, destinations: 2, ideationSources: 0, agentContexts: 2,
      apiCallsToday: 8_412, rateLimitUsed: 0.32, monthlyCostUsd: 612,
    },
    recentEvents: [
      { id: 'dd-1', at: ago(60_000), eventType: 'pull', entity: 'forge-api latency', status: 'success', durationMs: 312, records: 1_240 },
      { id: 'dd-2', at: ago(11 * 60_000), eventType: 'webhook', entity: 'alert · api.p95>800ms', status: 'success', durationMs: 412, records: 1 },
    ],
    usedIn: {
      workflows: ['Anomaly Detector', 'SLO Reporter'],
      destinations: ['Datadog dashboards'],
      agents: ['SRE Agent'],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'sentry',
    name: 'sentry',
    displayName: 'Sentry',
    publisher: 'Forge Team',
    tagline: 'Error tracking',
    description: 'Pull errors and crashes from Sentry.',
    category: 'monitoring',
    scope: 'org',
    tier: 1,
    status: 'healthy',
    connectedAs: 'acme-corp.sentry.io',
    lastSyncAt: ago(4 * 60_000),
    capabilities: ['read_alerts'],
    health: { p50Ms: 220, p95Ms: 612, errorRate: 0.012 },
    credential: {
      id: 'cred-sentry-01',
      name: 'Sentry Auth Token',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:9d1c5b2a8e47',
      lastRotatedAt: ago(15 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['project:read', 'event:read'],
      lengthChars: 64,
    },
    usage: {
      workflows: 2, destinations: 1, ideationSources: 0, agentContexts: 1,
      apiCallsToday: 412, rateLimitUsed: 0.05, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'se-1', at: ago(4 * 60_000), eventType: 'pull', entity: 'forge-web · errors', status: 'success', durationMs: 412, records: 18 },
    ],
    usedIn: {
      workflows: ['Error Triage'],
      destinations: ['Error dashboard'],
      agents: [],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },
  {
    id: 'pagerduty',
    name: 'pagerduty',
    displayName: 'PagerDuty',
    publisher: 'Forge Team',
    tagline: 'Incident management',
    description: 'Trigger and resolve PagerDuty incidents.',
    category: 'monitoring',
    scope: 'org',
    tier: 2,
    status: 'healthy',
    connectedAs: 'acme-corp.pagerduty.com',
    lastSyncAt: ago(7 * 60_000),
    capabilities: ['read_alerts'],
    health: { p50Ms: 142, p95Ms: 412, errorRate: 0.003 },
    credential: {
      id: 'cred-pd-01',
      name: 'PagerDuty API Key',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:7a3e1d4c8b92',
      lastRotatedAt: ago(20 * 86_400_000),
      rotatedBy: JIN.name,
      owner: JIN,
      scopes: ['incidents.read', 'incidents.write'],
      lengthChars: 20,
    },
    usage: {
      workflows: 3, destinations: 1, ideationSources: 0, agentContexts: 1,
      apiCallsToday: 184, rateLimitUsed: 0.02, monthlyCostUsd: 0,
    },
    recentEvents: [
      { id: 'pd-1', at: ago(7 * 60_000), eventType: 'pull', entity: 'on-call schedule', status: 'success', durationMs: 312, records: 4 },
    ],
    usedIn: {
      workflows: ['Incident Bridge', 'On-call Handoff'],
      destinations: ['PagerDuty incidents'],
      agents: ['Incident Commander'],
      ideationSources: [],
    },
    installed: true,
    available: true,
  },

  // ----- available (marketplace-only, not installed) -----
  {
    id: 'adobe_xd',
    name: 'adobe_xd',
    displayName: 'Adobe XD',
    publisher: 'Forge Team',
    tagline: 'Design and prototyping',
    description: 'Pull design files from Adobe XD.',
    category: 'design',
    scope: 'org',
    tier: 2,
    status: 'paused',
    connectedAs: '',
    lastSyncAt: ago(0),
    capabilities: ['read_design'],
    health: { p50Ms: 0, p95Ms: 0, errorRate: 0 },
    credential: {
      id: 'cred-xd-01',
      name: 'Adobe XD Token',
      type: 'oauth',
      status: 'active',
      fingerprint: 'sha256:000000000000',
      lastRotatedAt: ago(0),
      rotatedBy: '',
      owner: { name: '', initials: '' },
      scopes: [],
      lengthChars: 0,
    },
    usage: { workflows: 0, destinations: 0, ideationSources: 0, agentContexts: 0, apiCallsToday: 0, rateLimitUsed: 0, monthlyCostUsd: 0 },
    recentEvents: [],
    usedIn: { workflows: [], destinations: [], agents: [], ideationSources: [] },
    installed: false,
    available: true,
  },
  {
    id: 'discord',
    name: 'discord',
    displayName: 'Discord',
    publisher: 'Forge Team',
    tagline: 'Community chat',
    description: 'Send messages to Discord channels.',
    category: 'comms',
    scope: 'project',
    tier: 2,
    status: 'paused',
    connectedAs: '',
    lastSyncAt: ago(0),
    capabilities: ['send_message'],
    health: { p50Ms: 0, p95Ms: 0, errorRate: 0 },
    credential: {
      id: 'cred-discord-01',
      name: 'Discord Bot Token',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:000000000000',
      lastRotatedAt: ago(0),
      rotatedBy: '',
      owner: { name: '', initials: '' },
      scopes: [],
      lengthChars: 0,
    },
    usage: { workflows: 0, destinations: 0, ideationSources: 0, agentContexts: 0, apiCallsToday: 0, rateLimitUsed: 0, monthlyCostUsd: 0 },
    recentEvents: [],
    usedIn: { workflows: [], destinations: [], agents: [], ideationSources: [] },
    installed: false,
    available: true,
    newThisMonth: true,
  },
  {
    id: 'newrelic',
    name: 'newrelic',
    displayName: 'New Relic',
    publisher: 'Forge Team',
    tagline: 'Observability platform',
    description: 'Read metrics, traces and logs from New Relic.',
    category: 'monitoring',
    scope: 'org',
    tier: 2,
    status: 'paused',
    connectedAs: '',
    lastSyncAt: ago(0),
    capabilities: ['read_logs', 'read_alerts'],
    health: { p50Ms: 0, p95Ms: 0, errorRate: 0 },
    credential: {
      id: 'cred-nr-01',
      name: 'New Relic API Key',
      type: 'api_key',
      status: 'active',
      fingerprint: 'sha256:000000000000',
      lastRotatedAt: ago(0),
      rotatedBy: '',
      owner: { name: '', initials: '' },
      scopes: [],
      lengthChars: 0,
    },
    usage: { workflows: 0, destinations: 0, ideationSources: 0, agentContexts: 0, apiCallsToday: 0, rateLimitUsed: 0, monthlyCostUsd: 0 },
    recentEvents: [],
    usedIn: { workflows: [], destinations: [], agents: [], ideationSources: [] },
    installed: false,
    available: true,
  },
];

// ---------------------------------------------------------------------------
// Selectors / helpers
// ---------------------------------------------------------------------------

export function getConnectorById(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export function listConnected(): ReadonlyArray<Connector> {
  return CONNECTORS.filter((c) => c.installed);
}

export function listMarketplace(): ReadonlyArray<Connector> {
  return CONNECTORS.filter((c) => c.available);
}

export function listByCapability(cap: ConnectorCapability): ReadonlyArray<Connector> {
  return CONNECTORS.filter((c) => c.capabilities.includes(cap));
}

export function listCredentials(): ReadonlyArray<{
  credential: ConnectorCredential;
  connector: Pick<Connector, 'id' | 'displayName' | 'category' | 'status'>;
}> {
  return listConnected().map((c) => ({
    credential: c.credential,
    connector: { id: c.id, displayName: c.displayName, category: c.category, status: c.status },
  }));
}

// ---------------------------------------------------------------------------
// Rollups used by Overview KPIs
// ---------------------------------------------------------------------------

export interface ConnectorRollup {
  readonly connected: number;
  readonly healthy: number;
  readonly syncing: number;
  readonly stale: number;
  readonly failed: number;
  readonly quarantined: number;
  readonly paused: number;
  readonly syncsToday: number;
  readonly apiCallsToday: number;
  readonly monthlyCostUsd: number;
  readonly rateLimitUsed: number; // max across all connectors
}

export function computeRollup(): ConnectorRollup {
  const connected = listConnected();
  return {
    connected: connected.length,
    healthy: connected.filter((c) => c.status === 'healthy').length,
    syncing: connected.filter((c) => c.status === 'syncing').length,
    stale: connected.filter((c) => c.status === 'stale').length,
    failed: connected.filter((c) => c.status === 'failed').length,
    quarantined: connected.filter((c) => c.status === 'quarantined').length,
    paused: connected.filter((c) => c.status === 'paused').length,
    syncsToday: connected.reduce((acc, c) => acc + c.recentEvents.length, 0),
    apiCallsToday: connected.reduce((acc, c) => acc + c.usage.apiCallsToday, 0),
    monthlyCostUsd: connected.reduce((acc, c) => acc + c.usage.monthlyCostUsd, 0),
    rateLimitUsed: Math.max(0, ...connected.map((c) => c.usage.rateLimitUsed)),
  };
}

// ---------------------------------------------------------------------------
// Top connectors by usage (for Overview "Most-used" tile)
// ---------------------------------------------------------------------------

export function topByUsage(n: number): ReadonlyArray<Connector> {
  return [...listConnected()]
    .sort((a, b) => {
      const au =
        a.usage.workflows + a.usage.destinations + a.usage.ideationSources + a.usage.agentContexts;
      const bu =
        b.usage.workflows + b.usage.destinations + b.usage.ideationSources + b.usage.agentContexts;
      return bu - au;
    })
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Recommended (AI suggestion mock)
// ---------------------------------------------------------------------------

export const RECOMMENDED: ReadonlyArray<RecommendedConnector> = [
  {
    id: 'pagerduty',
    displayName: 'PagerDuty',
    tagline: 'Incident management — wire to your on-call schedule',
    category: 'monitoring',
    reason: 'You have 3 monitoring connectors (Datadog, Sentry, PagerDuty) and 6 workflows reference incidents — install PagerDuty to close the loop with paging.',
  },
  {
    id: 'snowflake',
    displayName: 'Snowflake',
    tagline: 'Cloud data warehouse — query conversion funnels',
    category: 'data',
    reason: 'Your Postgres connector is used in 5 workflows. Snowflake would let you scale beyond transactional storage for cohort analysis.',
  },
  {
    id: 'intercom',
    displayName: 'Intercom',
    tagline: 'Voice-of-customer — pull conversations for ideation',
    category: 'comms',
    reason: 'You have 2 ideation sources today. Intercom conversations would give you a third voice-of-customer stream for Idea Synthesizer.',
  },
  {
    id: 'linear',
    displayName: 'Linear',
    tagline: 'Modern issue tracking — already in use as a PM tier',
    category: 'project-mgmt',
    reason: 'Jira is the dominant PM system but the mobile team explicitly prefers Linear. Add it to give them a dedicated path.',
  },
];

// ---------------------------------------------------------------------------
// Sparkline data (mock — 14 days of API calls)
// ---------------------------------------------------------------------------

export function sparklineFor(days = 14): ReadonlyArray<number> {
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    out.push(80 + Math.round(Math.sin(i * 0.9) * 12) + (i * 4) % 28 + (i % 3 === 0 ? -10 : 0));
  }
  return out;
}

export const SYNC_HISTORY_24H: ReadonlyArray<{
  hour: number;
  success: number;
  failed: number;
}> = Array.from({ length: 24 }, (_, i) => ({
  hour: i,
  success: 12 + Math.round(Math.sin(i / 3) * 6) + (i % 4 === 0 ? 4 : 0),
  failed: Math.max(0, Math.round(Math.cos(i / 5) * 2) + (i === 9 ? 3 : 0)),
}));