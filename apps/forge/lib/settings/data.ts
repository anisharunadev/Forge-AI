/**
 * Settings — typed async SDK for the `/admin` Settings page.
 *
 * Wraps `forgeFetch` (lib/forge-api.ts) with Settings-specific
 * resource shapes. Pure functions — no React, no caching. The
 * TanStack Query hooks in `lib/hooks/useSettings.ts` wrap these.
 *
 * The plan splits this work into two sub-plans:
 *   - Sub-plan A (backend): builds the 4 new SQLAlchemy models,
 *     encryption helper, audit helper, and 11 new REST endpoints.
 *   - Sub-plan B (this file): the frontend SDK + UI.
 *
 * The URLs below are the *target* contract (see plan, "Backend
 * Endpoint Table"). While the backend ships, calls to not-yet-
 * built endpoints surface a 404 from `forgeFetch`, which the hook
 * surfaces as a toast. As endpoints land, the calls work
 * automatically — no frontend change needed.
 *
 * Per Rule 6 (audit), every mutation here is paired with an
 * `AuditEvent` row on the server. The client only needs to
 * invalidate its query keys after success.
 */

import { forgeFetch } from '@/lib/forge-api';
import type {
  AgentConfig,
  AgentConfigUpdate,
  AuditEvent,
  EnvVar,
  EnvVarCreate,
  EnvVarReveal,
  EnvVarUpdate,
  Invitation,
  InviteCreate,
  Member,
  ModelProvider,
  ModelProviderCreate,
  Project,
  ProjectUpdate,
  Role,
  RoleUpdate,
  Webhook,
  WebhookCreate,
  WebhookUpdate,
  WebhookTestResult,
  WebhookDelivery,
  AIGatewayModel,
  AIGatewayMcpServer,
  AIGatewayHealth,
  AIGatewaySpend,
} from './types';

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export async function getProject(projectId: string): Promise<Project> {
  return forgeFetch<Project>(`/projects/${encodeURIComponent(projectId)}`);
}

export async function updateProject(
  projectId: string,
  body: ProjectUpdate,
): Promise<Project> {
  return forgeFetch<Project>(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Members & invitations
// ---------------------------------------------------------------------------

export interface MemberListResult {
  readonly members: ReadonlyArray<Member>;
  readonly invitations: ReadonlyArray<Invitation>;
}

export async function listMembers(projectId: string): Promise<MemberListResult> {
  return forgeFetch<MemberListResult>(
    `/projects/${encodeURIComponent(projectId)}/members`,
  );
}

export async function inviteMember(
  projectId: string,
  body: InviteCreate,
): Promise<Invitation> {
  return forgeFetch<Invitation>(
    `/projects/${encodeURIComponent(projectId)}/members/invite`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

export async function acceptInvite(token: string): Promise<Member> {
  return forgeFetch<Member>('/projects/_/members/accept', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function updateMemberRole(
  projectId: string,
  memberId: string,
  body: RoleUpdate,
): Promise<Member> {
  return forgeFetch<Member>(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export async function removeMember(
  projectId: string,
  memberId: string,
): Promise<void> {
  await forgeFetch<void>(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

export async function listEnvVars(projectId: string): Promise<ReadonlyArray<EnvVar>> {
  return forgeFetch<ReadonlyArray<EnvVar>>(
    `/projects/${encodeURIComponent(projectId)}/env-vars`,
  );
}

export async function createEnvVar(
  projectId: string,
  body: EnvVarCreate,
): Promise<EnvVar> {
  return forgeFetch<EnvVar>(
    `/projects/${encodeURIComponent(projectId)}/env-vars`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function updateEnvVar(
  projectId: string,
  key: string,
  body: EnvVarUpdate,
): Promise<EnvVar> {
  return forgeFetch<EnvVar>(
    `/projects/${encodeURIComponent(projectId)}/env-vars/${encodeURIComponent(key)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export async function deleteEnvVar(
  projectId: string,
  key: string,
): Promise<void> {
  await forgeFetch<void>(
    `/projects/${encodeURIComponent(projectId)}/env-vars/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  );
}

/**
 * One-shot reveal. Returns the plaintext value to the client but
 * the server never logs it. The AuditEvent for this call records
 * `action=envvar.reveal` (not `envvar.read`) with payload
 * `{ key, length, hash_prefix }` so the audit log shows when a
 * value was revealed without ever storing the value itself.
 */
export async function revealEnvVar(
  projectId: string,
  key: string,
): Promise<EnvVarReveal> {
  return forgeFetch<EnvVarReveal>(
    `/projects/${encodeURIComponent(projectId)}/env-vars/${encodeURIComponent(key)}/reveal`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

export async function getAgentConfig(
  agentId: string,
): Promise<AgentConfig> {
  return forgeFetch<AgentConfig>(
    `/agents/${encodeURIComponent(agentId)}/config`,
  );
}

export async function updateAgentConfig(
  agentId: string,
  body: AgentConfigUpdate,
): Promise<AgentConfig> {
  return forgeFetch<AgentConfig>(
    `/agents/${encodeURIComponent(agentId)}/config`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

export async function listProviders(): Promise<ReadonlyArray<ModelProvider>> {
  return forgeFetch<ReadonlyArray<ModelProvider>>('/model-providers');
}

export async function createProvider(
  body: ModelProviderCreate,
): Promise<ModelProvider> {
  return forgeFetch<ModelProvider>('/model-providers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateProvider(
  id: string,
  body: Partial<ModelProviderCreate> & { enabled?: boolean },
): Promise<ModelProvider> {
  return forgeFetch<ModelProvider>(
    `/model-providers/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function listRoles(): Promise<ReadonlyArray<Role>> {
  return forgeFetch<ReadonlyArray<Role>>('/roles');
}

// ---------------------------------------------------------------------------
// Audit (settings-scoped)
// ---------------------------------------------------------------------------

export interface AuditFilter {
  readonly targetTypes?: ReadonlyArray<AuditEvent['targetType']>;
  readonly limit?: number;
  readonly before?: string;
}

export async function listAuditSettings(
  filter: AuditFilter = {},
): Promise<ReadonlyArray<AuditEvent>> {
  const params = new URLSearchParams();
  if (filter.targetTypes && filter.targetTypes.length > 0) {
    params.set('target_type_in', filter.targetTypes.join(','));
  }
  if (filter.limit) params.set('limit', String(filter.limit));
  if (filter.before) params.set('before', filter.before);
  const qs = params.toString();
  return forgeFetch<ReadonlyArray<AuditEvent>>(
    `/audit${qs ? `?${qs}` : ''}`,
  );
}


// ---------------------------------------------------------------------------
// Step-73 — Profile / Me (PATCH)
// ---------------------------------------------------------------------------

export interface MeUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly locale: string | null;
  readonly timezone: string | null;
  readonly roleIds: ReadonlyArray<string>;
}

export async function getMe(): Promise<MeUser> {
  return forgeFetch<MeUser>('/auth/me');
}

export async function patchMe(body: Partial<MeUser>): Promise<MeUser> {
  return forgeFetch<MeUser>('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Step-73 — API Tokens
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

export async function listApiTokens(): Promise<ReadonlyArray<ApiToken>> {
  return forgeFetch<ReadonlyArray<ApiToken>>('/auth/api-tokens');
}

export async function createApiToken(body: {
  name: string;
  scope?: string;
  expiresInDays?: number | null;
}): Promise<ApiTokenCreated> {
  return forgeFetch<ApiTokenCreated>('/auth/api-tokens', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  await forgeFetch<void>(`/auth/api-tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Step-73 — Sessions
// ---------------------------------------------------------------------------

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

export async function listSessions(): Promise<ReadonlyArray<Session>> {
  return forgeFetch<ReadonlyArray<Session>>('/auth/sessions');
}

export async function revokeSession(sessionId: string): Promise<void> {
  await forgeFetch<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Step-73 — Notifications
// ---------------------------------------------------------------------------

export interface NotificationPrefs {
  readonly emailDigest: boolean;
  readonly inapp: boolean;
  readonly slackDm: boolean;
  readonly webhookUrl: string | null;
}

export async function getNotifications(): Promise<NotificationPrefs> {
  return forgeFetch<NotificationPrefs>('/users/me/notifications');
}

export async function patchNotifications(
  body: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  return forgeFetch<NotificationPrefs>('/users/me/notifications', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Step-73 — Branding
// ---------------------------------------------------------------------------

export interface Branding {
  readonly logoUrl: string | null;
  readonly primaryColor: string | null;
  readonly accentColor: string | null;
  readonly faviconUrl: string | null;
  readonly supportEmail: string | null;
}

export async function getBranding(tenantId: string): Promise<Branding> {
  return forgeFetch<Branding>(
    `/tenants/${encodeURIComponent(tenantId)}/branding`,
  );
}

export async function patchBranding(
  tenantId: string,
  body: Partial<Branding>,
): Promise<Branding> {
  return forgeFetch<Branding>(
    `/tenants/${encodeURIComponent(tenantId)}/branding`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

// ---------------------------------------------------------------------------
// Step-73 — SSO (read-only)
// ---------------------------------------------------------------------------

export interface SsoConfig {
  readonly enabled: boolean;
  readonly provider: string;
  readonly issuer: string | null;
  readonly clientId: string | null;
  readonly scopes: ReadonlyArray<string>;
}

export async function getSsoConfig(): Promise<SsoConfig> {
  return forgeFetch<SsoConfig>('/auth/sso/config');
}

// ---------------------------------------------------------------------------
// Step-73 — Billing quota (analytics-derived)
// ---------------------------------------------------------------------------

export interface BillingUsage {
  readonly plan: string;
  readonly monthlyUsdLimit: number;
  readonly usedUsd: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export async function getBillingQuota(
  tenantId: string,
): Promise<BillingUsage> {
  return forgeFetch<BillingUsage>(
    `/analytics/quota?tenant_id=${encodeURIComponent(tenantId)}`,
  );
}

// ---------------------------------------------------------------------------
// Step-73 — Feature flags
// ---------------------------------------------------------------------------

export type FeatureFlagValue = boolean | number | string;
export type FeatureFlagType = 'bool' | 'int' | 'str';

export interface FeatureFlag {
  readonly key: string;
  readonly value: FeatureFlagValue;
  readonly type: FeatureFlagType;
  readonly description: string;
  readonly updatedAt: string | null;
}

export async function listFeatureFlags(): Promise<ReadonlyArray<FeatureFlag>> {
  return forgeFetch<ReadonlyArray<FeatureFlag>>('/feature-flags');
}

export async function patchFeatureFlag(
  key: string,
  value: FeatureFlagValue,
): Promise<FeatureFlag> {
  return forgeFetch<FeatureFlag>(
    `/feature-flags/${encodeURIComponent(key)}`,
    { method: 'PATCH', body: JSON.stringify({ value }) },
  );
}

// ---------------------------------------------------------------------------
// Step-73 — Seeds (already wired on backend, now typed on frontend)
// ---------------------------------------------------------------------------

export interface SeedManifestSummary {
  readonly name: string;
  readonly description: string;
  readonly status: string;
}

export async function listSeeds(): Promise<ReadonlyArray<SeedManifestSummary>> {
  return forgeFetch<ReadonlyArray<SeedManifestSummary>>('/seeds');
}

export async function applySeed(
  name: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  return forgeFetch<unknown>(
    `/seeds/${encodeURIComponent(name)}/apply`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ---------------------------------------------------------------------------
// Step-73 — Webhooks (mirror backend /webhooks/* from webhooks_full.py)
// ---------------------------------------------------------------------------

export async function listWebhooks(direction?: 'inbound' | 'outbound'): Promise<ReadonlyArray<Webhook>> {
  const qs = direction ? `?direction=${encodeURIComponent(direction)}` : '';
  return forgeFetch<ReadonlyArray<Webhook>>(`/webhooks${qs}`);
}

export async function createWebhook(body: WebhookCreate): Promise<Webhook> {
  return forgeFetch<Webhook>('/webhooks', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateWebhook(id: string, body: WebhookUpdate): Promise<Webhook> {
  return forgeFetch<Webhook>(`/webhooks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteWebhook(id: string): Promise<void> {
  await forgeFetch<void>(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function testWebhook(id: string): Promise<WebhookTestResult> {
  return forgeFetch<WebhookTestResult>(
    `/webhooks/${encodeURIComponent(id)}/test`,
    { method: 'POST' },
  );
}

export async function listWebhookDeliveries(id: string): Promise<ReadonlyArray<WebhookDelivery>> {
  return forgeFetch<ReadonlyArray<WebhookDelivery>>(
    `/webhooks/${encodeURIComponent(id)}/deliveries`,
  );
}

// ---------------------------------------------------------------------------
// Step-73 — AI Gateway (mirror backend /admin/llm-gateway/*)
// ---------------------------------------------------------------------------

export async function listAIGatewayModels(): Promise<ReadonlyArray<AIGatewayModel>> {
  return forgeFetch<ReadonlyArray<AIGatewayModel>>('/admin/llm-gateway/models');
}

export async function listAIGatewayMcpServers(): Promise<ReadonlyArray<AIGatewayMcpServer>> {
  return forgeFetch<ReadonlyArray<AIGatewayMcpServer>>('/admin/llm-gateway/mcp-servers');
}

export async function getAIGatewayHealth(): Promise<AIGatewayHealth> {
  return forgeFetch<AIGatewayHealth>('/admin/llm-gateway/health');
}

export async function listAIGatewaySpend(): Promise<ReadonlyArray<AIGatewaySpend>> {
  return forgeFetch<ReadonlyArray<AIGatewaySpend>>('/admin/llm-gateway/spend/teams');
}
