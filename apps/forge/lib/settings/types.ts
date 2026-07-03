/**
 * Settings — typed shapes for the `/admin` Settings page.
 *
 * Mirrors the backend Pydantic schemas in `backend/app/schemas/`
 * (projects.py, members.py, env_vars.py). The backend is the source of
 * truth; this file is the TS projection. Zod schemas in
 * `schemas.ts` are the form-side validation; types here are the
 * read-side shape.
 *
 * Rule 2 (multi-tenancy): every shape that maps to a backend table
 * carries an explicit `tenantId` and `projectId` (where applicable).
 *
 * Rule 6 (audit): mutations return the canonical resource so the
 * caller can surface the new state without an extra fetch. The
 * backend writes an `AuditEvent` row server-side; the client only
 * needs to invalidate its query keys + toast.
 */

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type ProjectVisibility = 'private' | 'internal' | 'public';

export interface Project {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly defaultBranch: string;
  readonly visibility: ProjectVisibility;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectUpdate {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly defaultBranch?: string;
  readonly visibility?: ProjectVisibility;
}

// ---------------------------------------------------------------------------
// Members & invitations
// ---------------------------------------------------------------------------

export type MemberStatus = 'active' | 'inactive';

export interface Member {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly roleId: string;
  readonly roleName: string;
  readonly status: MemberStatus;
  readonly joinedAt: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invitation {
  readonly id: string;
  readonly projectId: string;
  readonly email: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly invitedBy: string;
  readonly status: InvitationStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
  /** Dev-only: the raw token is returned in the create response so the
   * user can copy the accept link. Production replaces with an email
   * dispatcher (see plan, "Out of scope"). */
  readonly token?: string;
}

export interface InviteCreate {
  readonly email: string;
  readonly roleId: string;
}

export interface RoleUpdate {
  readonly roleId: string;
}

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

export type EnvVarScope = 'workflow' | 'agent' | 'all';

/**
 * Server returns a masked value (e.g. "••••••") — never the plaintext.
 * To reveal, the client makes a one-shot `revealEnvVar` call which
 * returns the plaintext in memory only; we never log it.
 */
export interface EnvVar {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly scope: EnvVarScope;
  readonly maskedValue: string;
  readonly valueLength: number;
  readonly hashPrefix: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnvVarCreate {
  readonly key: string;
  readonly value: string;
  readonly scope: EnvVarScope;
}

export interface EnvVarUpdate {
  readonly value: string;
}

export interface EnvVarReveal {
  readonly key: string;
  readonly value: string;
}

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

/**
 * Per-project agent runtime config. Extends the org-level Agent
 * record (lib/agent-center/data.ts) with fields that vary per project
 * — model, temperature, system prompt, etc.
 */
export interface AgentConfig {
  readonly agentId: string;
  readonly projectId: string;
  readonly systemPrompt: string | null;
  readonly temperature: number | null;
  readonly maxTokens: number | null;
  readonly modelProviderId: string | null;
  readonly modelAlias: string | null;
  readonly updatedAt: string;
}

export interface AgentConfigUpdate {
  readonly systemPrompt?: string | null;
  readonly temperature?: number | null;
  readonly maxTokens?: number | null;
  readonly modelProviderId?: string | null;
  readonly modelAlias?: string | null;
}

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

export type ModelProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'bedrock'
  | 'azure_openai'
  | 'custom';

export interface ModelProvider {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly type: ModelProviderType;
  readonly litellmModelAlias: string | null;
  readonly enabled: boolean;
  readonly rateLimitRpm: number | null;
  readonly rateLimitTpm: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModelProviderCreate {
  readonly name: string;
  readonly type: ModelProviderType;
  readonly config: Record<string, unknown>;
  readonly litellmModelAlias?: string;
  readonly rateLimitRpm?: number;
  readonly rateLimitTpm?: number;
}

// ---------------------------------------------------------------------------
// Roles (for the member invite dialog)
// ---------------------------------------------------------------------------

export interface Role {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Audit (settings-scoped view)
// ---------------------------------------------------------------------------

export type AuditTargetType =
  | 'project'
  | 'member'
  | 'agent'
  | 'model_provider'
  | 'envvar';

export interface AuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: string;
}


// ---------------------------------------------------------------------------
// Step-73 — typed shapes mirroring backend Pydantic schemas
// ---------------------------------------------------------------------------

export interface ApiToken {
  readonly id: string;
  readonly name: string;
  readonly scope: string;
  readonly fingerprintSha256: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface ApiTokenCreated extends ApiToken {
  readonly secret: string;
}

export interface Session {
  readonly id: string;
  readonly label: string;
  readonly userAgent: string;
  readonly ip: string;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  readonly isCurrent: boolean;
  readonly revokedAt: string | null;
}

export interface NotificationPrefs {
  readonly emailDigest: boolean;
  readonly inapp: boolean;
  readonly slackDm: boolean;
  readonly webhookUrl: string | null;
}

export interface Branding {
  readonly logoUrl: string | null;
  readonly primaryColor: string | null;
  readonly accentColor: string | null;
  readonly faviconUrl: string | null;
  readonly supportEmail: string | null;
}

export interface SsoConfig {
  readonly enabled: boolean;
  readonly provider: string;
  readonly issuer: string | null;
  readonly clientId: string | null;
  readonly scopes: ReadonlyArray<string>;
}

export interface BillingQuota {
  readonly plan: string;
  readonly monthlyUsdLimit: number;
  readonly usedUsd: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export type FeatureFlagValue = boolean | number | string;
export type FeatureFlagType = 'bool' | 'int' | 'str';

export interface FeatureFlag {
  readonly key: string;
  readonly value: FeatureFlagValue;
  readonly type: FeatureFlagType;
  readonly description: string;
  readonly updatedAt: string | null;
}

export interface SeedManifestSummary {
  readonly name: string;
  readonly description: string;
  readonly status: string;
}

// ---------------------------------------------------------------------------
// Step-73 — Webhooks (backend: /api/v1/webhooks/* via /webhooks proxy)
// ---------------------------------------------------------------------------

export type WebhookDirection = 'inbound' | 'outbound';
export type WebhookAuthType = 'none' | 'basic' | 'bearer' | 'hmac' | 'signature';
export type WebhookStatus = 'active' | 'paused' | 'failing';

export interface Webhook {
  readonly id: string;
  readonly name: string;
  readonly direction: WebhookDirection;
  readonly url: string | null;
  readonly events: ReadonlyArray<string>;
  readonly authType: WebhookAuthType;
  readonly status: WebhookStatus;
  readonly lastTriggeredAt: string | null;
  readonly lastDeliveryStatus: string | null;
  readonly successCount24h: number;
  readonly errorCount24h: number;
  readonly createdAt: string;
}

export interface WebhookCreate {
  readonly name: string;
  readonly direction: WebhookDirection;
  readonly url?: string | null;
  readonly events: ReadonlyArray<string>;
  readonly authType: WebhookAuthType;
  readonly authSecret?: string | null;
}

export interface WebhookUpdate {
  readonly name?: string;
  readonly url?: string | null;
  readonly events?: ReadonlyArray<string>;
  readonly authType?: WebhookAuthType;
  readonly authSecret?: string | null;
  readonly status?: WebhookStatus;
}

export interface WebhookTestResult {
  readonly status: string;
  readonly responseCode: number;
  readonly message: string;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly webhookId: string;
  readonly event: string;
  readonly status: string;
  readonly responseCode: number | null;
  readonly durationMs: number;
  readonly attemptedAt: string;
  readonly payloadPreview: string;
  readonly errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Step-73 — AI Gateway (backend: /admin/llm-gateway/*)
// ---------------------------------------------------------------------------

export interface AIGatewayModel {
  readonly name: string;
  readonly provider: string;
  readonly maxTokens: number | null;
  readonly maxInputTokens: number | null;
  readonly inputCost: number;
  readonly outputCost: number;
}

export interface AIGatewayMcpServer {
  readonly id: string;
  readonly name: string;
  readonly transport: string;
  readonly command: string;
  readonly url: string;
  readonly scopes: ReadonlyArray<string>;
  readonly status: string;
}

export interface AIGatewayHealth {
  readonly healthy: boolean;
  readonly lastCheckAt: string | null;
  readonly lastOkAt: string | null;
  readonly lastFailAt: string | null;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
}

export interface AIGatewaySpend {
  readonly teamId: string | null;
  readonly teamAlias: string | null;
  readonly spend: number;
  readonly maxBudget: number;
}
