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

import { api } from '@/lib/api/client';
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
  return api.get<Project>(`/projects/${encodeURIComponent(projectId)}`);
}

export async function updateProject(
  projectId: string,
  body: ProjectUpdate,
): Promise<Project> {
  return api.patch<Project>(`/projects/${encodeURIComponent(projectId)}`, body, {
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
  return api.get<MemberListResult>(`/projects/${encodeURIComponent(projectId)}/members`);
}

export async function inviteMember(
  projectId: string,
  body: InviteCreate,
): Promise<Invitation> {
  return api.post<Invitation>(`/projects/${encodeURIComponent(projectId)}/members/invite`, body, {
    });
}

export async function acceptInvite(token: string): Promise<Member> {
  return api.post<Member>('/projects/_/members/accept', { token }, {
  });
}

export async function updateMemberRole(
  projectId: string,
  memberId: string,
  body: RoleUpdate,
): Promise<Member> {
  return api.patch<Member>(`/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`, { body: JSON.stringify(body) });
}

export async function removeMember(
  projectId: string,
  memberId: string,
): Promise<void> {
  await api.delete<void>(`/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`, { });
}

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

export async function listEnvVars(projectId: string): Promise<ReadonlyArray<EnvVar>> {
  return api.get<ReadonlyArray<EnvVar>>(`/projects/${encodeURIComponent(projectId)}/env-vars`);
}

export async function createEnvVar(
  projectId: string,
  body: EnvVarCreate,
): Promise<EnvVar> {
  return api.post<EnvVar>(`/projects/${encodeURIComponent(projectId)}/env-vars`, { body: JSON.stringify(body) });
}

export async function updateEnvVar(
  projectId: string,
  key: string,
  body: EnvVarUpdate,
): Promise<EnvVar> {
  return api.patch<EnvVar>(`/projects/${encodeURIComponent(projectId)}/env-vars/${encodeURIComponent(key)}`, { body: JSON.stringify(body) });
}

export async function deleteEnvVar(
  projectId: string,
  key: string,
): Promise<void> {
  await api.delete<void>(`/projects/${encodeURIComponent(projectId)}/env-vars/${encodeURIComponent(key)}`, { });
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
  return api.post<EnvVarReveal>(`/projects/${encodeURIComponent(projectId)}/env-vars/${encodeURIComponent(key)}/reveal`, { });
}

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

export async function getAgentConfig(
  agentId: string,
): Promise<AgentConfig> {
  return api.get<AgentConfig>(`/agents/${encodeURIComponent(agentId)}/config`);
}

export async function updateAgentConfig(
  agentId: string,
  body: AgentConfigUpdate,
): Promise<AgentConfig> {
  return api.patch<AgentConfig>(`/agents/${encodeURIComponent(agentId)}/config`, { body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

export async function listProviders(): Promise<ReadonlyArray<ModelProvider>> {
  return api.get<ReadonlyArray<ModelProvider>>('/model-providers');
}

export async function createProvider(
  body: ModelProviderCreate,
): Promise<ModelProvider> {
  return api.post<ModelProvider>('/model-providers', body, {
  });
}

export async function updateProvider(
  id: string,
  body: Partial<ModelProviderCreate> & { enabled?: boolean },
): Promise<ModelProvider> {
  return api.patch<ModelProvider>(`/model-providers/${encodeURIComponent(id)}`, { body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function listRoles(): Promise<ReadonlyArray<Role>> {
  return api.get<ReadonlyArray<Role>>('/roles');
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
  return api.get<ReadonlyArray<AuditEvent>>(`/audit${qs ? `?${qs}` : ''}`);
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
  return api.get<MeUser>('/auth/me');
}

export async function patchMe(body: Partial<MeUser>): Promise<MeUser> {
  return api.patch<MeUser>('/auth/me', body, {
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
  return api.get<ReadonlyArray<ApiToken>>('/auth/api-tokens');
}

export async function createApiToken(body: {
  name: string;
  scope?: string;
  expiresInDays?: number | null;
}): Promise<ApiTokenCreated> {
  return api.post<ApiTokenCreated>('/auth/api-tokens', body, {
  });
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  await api.delete<void>(`/auth/api-tokens/${encodeURIComponent(tokenId)}`, {
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
  return api.get<ReadonlyArray<Session>>('/auth/sessions');
}

export async function revokeSession(sessionId: string): Promise<void> {
  await api.delete<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
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
  return api.get<NotificationPrefs>('/users/me/notifications');
}

export async function patchNotifications(
  body: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  return api.patch<NotificationPrefs>('/users/me/notifications', body, {
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
  return api.get<Branding>(`/tenants/${encodeURIComponent(tenantId)}/branding`);
}

export async function patchBranding(
  tenantId: string,
  body: Partial<Branding>,
): Promise<Branding> {
  return api.patch<Branding>(`/tenants/${encodeURIComponent(tenantId)}/branding`, { body: JSON.stringify(body) });
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
  return api.get<SsoConfig>('/auth/sso/config');
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
  return api.get<BillingUsage>(`/analytics/quota?tenant_id=${encodeURIComponent(tenantId)}`);
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
  return api.get<ReadonlyArray<FeatureFlag>>('/feature-flags');
}

export async function patchFeatureFlag(
  key: string,
  value: FeatureFlagValue,
): Promise<FeatureFlag> {
  return api.patch<FeatureFlag>(`/feature-flags/${encodeURIComponent(key)}`, { body: JSON.stringify({ value }) });
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
  return api.get<ReadonlyArray<SeedManifestSummary>>('/seeds');
}

export async function applySeed(
  name: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  return api.post<unknown>(`/seeds/${encodeURIComponent(name)}/apply`, { body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Step-73 — Webhooks (mirror backend /webhooks/* from webhooks_full.py)
// ---------------------------------------------------------------------------

export async function listWebhooks(direction?: 'inbound' | 'outbound'): Promise<ReadonlyArray<Webhook>> {
  const qs = direction ? `?direction=${encodeURIComponent(direction)}` : '';
  return api.get<ReadonlyArray<Webhook>>(`/webhooks${qs}`);
}

export async function createWebhook(body: WebhookCreate): Promise<Webhook> {
  return api.post<Webhook>('/webhooks', { body: JSON.stringify(body) });
}

export async function updateWebhook(id: string, body: WebhookUpdate): Promise<Webhook> {
  return api.patch<Webhook>(`/webhooks/${encodeURIComponent(id)}`, body, {
  });
}

export async function deleteWebhook(id: string): Promise<void> {
  await api.delete<void>(`/webhooks/${encodeURIComponent(id)}`, { });
}

export async function testWebhook(id: string): Promise<WebhookTestResult> {
  return api.post<WebhookTestResult>(`/webhooks/${encodeURIComponent(id)}/test`, { });
}

export async function listWebhookDeliveries(id: string): Promise<ReadonlyArray<WebhookDelivery>> {
  return api.get<ReadonlyArray<WebhookDelivery>>(`/webhooks/${encodeURIComponent(id)}/deliveries`);
}

// ---------------------------------------------------------------------------
// Step-73 — AI Gateway (mirror backend /admin/llm-gateway/*)
// ---------------------------------------------------------------------------

export async function listAIGatewayModels(): Promise<ReadonlyArray<AIGatewayModel>> {
  return api.get<ReadonlyArray<AIGatewayModel>>('/admin/llm-gateway/models');
}

export async function listAIGatewayMcpServers(): Promise<ReadonlyArray<AIGatewayMcpServer>> {
  return api.get<ReadonlyArray<AIGatewayMcpServer>>('/admin/llm-gateway/mcp-servers');
}

export async function getAIGatewayHealth(): Promise<AIGatewayHealth> {
  return api.get<AIGatewayHealth>('/admin/llm-gateway/health');
}

export async function listAIGatewaySpend(): Promise<ReadonlyArray<AIGatewaySpend>> {
  return api.get<ReadonlyArray<AIGatewaySpend>>('/admin/llm-gateway/spend/teams');
}
