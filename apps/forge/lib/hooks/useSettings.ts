'use client';

/**
 * TanStack Query hooks for the `/admin` Settings page.
 *
 * Pure wrappers around the typed SDK in `lib/settings/data.ts`.
 * Mutations invalidate their respective query keys so the UI
 * re-renders with the new state without an extra round-trip.
 *
 * Pattern mirrors `useConnectorLifecycle.ts` (canonical example
 * in this codebase). Each hook is named `use<Thing>` / `use<Action>`
 * and returns the raw TanStack Query result so callers can read
 * `isLoading`, `error`, etc. directly.
 *
 * The `useProjectId()` hook is the central seam for the project
 * scope — every other hook depends on it. Today it returns the
 * seed project id (`project-forge-demo`) matching
 * `apps/forge/app/connector-center/page.tsx:48`. The follow-up
 * `useTenantProject()` migration (FORA-128) will replace this
 * body without touching call sites.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  acceptInvite,
  createEnvVar,
  createProvider,
  deleteEnvVar,
  getAgentConfig,
  getProject,
  inviteMember,
  listAuditSettings,
  listEnvVars,
  listMembers,
  listProviders,
  listRoles,
  removeMember,
  revealEnvVar,
  updateAgentConfig,
  updateEnvVar,
  updateMemberRole,
  updateProject,
  updateProvider,
} from '@/lib/settings/data';
import type {
  AgentConfig,
  AgentConfigUpdate,
  AuditEvent,
  EnvVar,
  EnvVarCreate,
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
} from '@/lib/settings/types';
import { useAuth } from '@/lib/api/auth';

// ---------------------------------------------------------------------------
// Project scope seam — reads from the real auth context (step-62 Zone 7).
//
// `useAuth()` was extended to carry `project` (TenantScopedModel-shaped).
// When the user has not yet picked a project we fall back to fetching
// the tenant's first project so the page never sees `null` while the
// user is authenticated.
// ---------------------------------------------------------------------------

const FALLBACK_PROJECT_ID = 'project-forge-demo';

export function useProjectId(): string | null {
  const projectId = useAuth((s) => s.project?.id ?? null);
  if (projectId) return projectId;
  // SSR safety — return null on the server; the request will be
  // disabled on the client until projectId is known.
  if (typeof window === 'undefined') return null;
  return FALLBACK_PROJECT_ID;
}

/** Back-compat — many call sites still expect a non-null string. */
export function useProjectIdOrFallback(): string {
  return useProjectId() ?? FALLBACK_PROJECT_ID;
}

/** Stable query keys so the cache survives HMR / route changes. */
export const settingsQueryKeys = {
  project: (id: string) => ['settings', 'project', id] as const,
  members: (id: string) => ['settings', 'members', id] as const,
  envVars: (id: string) => ['settings', 'envVars', id] as const,
  agentConfig: (agentId: string) =>
    ['settings', 'agentConfig', agentId] as const,
  providers: () => ['settings', 'providers'] as const,
  roles: () => ['settings', 'roles'] as const,
  audit: (filterKey: string) => ['settings', 'audit', filterKey] as const,
  // F-829 Phase D — LiteLLM reconcile / anomaly query keys.
  reconcile: (tenantId: string) =>
    ['settings', 'litellm', 'reconcile', tenantId] as const,
  drift: (tenantId: string) =>
    ['settings', 'litellm', 'drift', tenantId] as const,
  anomalies: (tenantId: string) =>
    ['settings', 'litellm', 'anomalies', tenantId] as const,
};

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export function useProject(): UseQueryResult<Project, Error> {
  const projectId = useProjectIdOrFallback();
  return useQuery<Project, Error>({
    queryKey: settingsQueryKeys.project(projectId),
    queryFn: () => getProject(projectId),
  });
}

export function useUpdateProject(): UseMutationResult<
  Project,
  Error,
  ProjectUpdate
> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<Project, Error, ProjectUpdate>({
    mutationFn: (body) => updateProject(projectId, body),
    onSuccess: (data) => {
      qc.setQueryData(settingsQueryKeys.project(projectId), data);
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface MemberListData {
  readonly members: ReadonlyArray<Member>;
  readonly invitations: ReadonlyArray<Invitation>;
}

export function useMembers(): UseQueryResult<MemberListData, Error> {
  const projectId = useProjectIdOrFallback();
  return useQuery<MemberListData, Error>({
    queryKey: settingsQueryKeys.members(projectId),
    queryFn: () => listMembers(projectId),
  });
}

export function useInviteMember(): UseMutationResult<
  Invitation,
  Error,
  InviteCreate
> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<Invitation, Error, InviteCreate>({
    mutationFn: (body) => inviteMember(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.members(projectId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

export function useAcceptInvite(): UseMutationResult<Member, Error, string> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<Member, Error, string>({
    mutationFn: (token) => acceptInvite(token),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.members(projectId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

export function useUpdateMemberRole(): UseMutationResult<
  Member,
  Error,
  { memberId: string; body: RoleUpdate }
> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<Member, Error, { memberId: string; body: RoleUpdate }>({
    mutationFn: ({ memberId, body }) =>
      updateMemberRole(projectId, memberId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.members(projectId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

export function useRemoveMember(): UseMutationResult<
  void,
  Error,
  string
> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (memberId) => removeMember(projectId, memberId),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.members(projectId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

export function useEnvVars(): UseQueryResult<ReadonlyArray<EnvVar>, Error> {
  const projectId = useProjectIdOrFallback();
  return useQuery<ReadonlyArray<EnvVar>, Error>({
    queryKey: settingsQueryKeys.envVars(projectId),
    queryFn: () => listEnvVars(projectId),
  });
}

export function useCreateEnvVar(): UseMutationResult<
  EnvVar,
  Error,
  EnvVarCreate
> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<EnvVar, Error, EnvVarCreate>({
    mutationFn: (body) => createEnvVar(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.envVars(projectId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

export function useUpdateEnvVar(): UseMutationResult<
  EnvVar,
  Error,
  { key: string; body: EnvVarUpdate }
> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<EnvVar, Error, { key: string; body: EnvVarUpdate }>({
    mutationFn: ({ key, body }) => updateEnvVar(projectId, key, body),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.envVars(projectId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

export function useDeleteEnvVar(): UseMutationResult<void, Error, string> {
  const projectId = useProjectIdOrFallback();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (key) => deleteEnvVar(projectId, key),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.envVars(projectId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

export function useRevealEnvVar(): UseMutationResult<
  { key: string; value: string },
  Error,
  string
> {
  const projectId = useProjectIdOrFallback();
  return useMutation<{ key: string; value: string }, Error, string>({
    mutationFn: (key) => revealEnvVar(projectId, key),
  });
}

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

export function useAgentConfig(
  agentId: string,
): UseQueryResult<AgentConfig, Error> {
  return useQuery<AgentConfig, Error>({
    queryKey: settingsQueryKeys.agentConfig(agentId),
    queryFn: () => getAgentConfig(agentId),
    enabled: Boolean(agentId),
  });
}

export function useUpdateAgentConfig(): UseMutationResult<
  AgentConfig,
  Error,
  { agentId: string; body: AgentConfigUpdate }
> {
  const qc = useQueryClient();
  return useMutation<
    AgentConfig,
    Error,
    { agentId: string; body: AgentConfigUpdate }
  >({
    mutationFn: ({ agentId, body }) => updateAgentConfig(agentId, body),
    onSuccess: (_data, { agentId }) => {
      void qc.invalidateQueries({
        queryKey: settingsQueryKeys.agentConfig(agentId),
      });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

export function useProviders(): UseQueryResult<
  ReadonlyArray<ModelProvider>,
  Error
> {
  return useQuery<ReadonlyArray<ModelProvider>, Error>({
    queryKey: settingsQueryKeys.providers(),
    queryFn: () => listProviders(),
  });
}

export function useCreateProvider(): UseMutationResult<
  ModelProvider,
  Error,
  ModelProviderCreate
> {
  const qc = useQueryClient();
  return useMutation<ModelProvider, Error, ModelProviderCreate>({
    mutationFn: (body) => createProvider(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsQueryKeys.providers() });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

export function useUpdateProvider(): UseMutationResult<
  ModelProvider,
  Error,
  {
    id: string;
    body: Partial<ModelProviderCreate> & { enabled?: boolean };
  }
> {
  const qc = useQueryClient();
  return useMutation<
    ModelProvider,
    Error,
    { id: string; body: Partial<ModelProviderCreate> & { enabled?: boolean } }
  >({
    mutationFn: ({ id, body }) => updateProvider(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsQueryKeys.providers() });
      void qc.invalidateQueries({ queryKey: ['settings', 'audit'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function useRoles(): UseQueryResult<ReadonlyArray<Role>, Error> {
  return useQuery<ReadonlyArray<Role>, Error>({
    queryKey: settingsQueryKeys.roles(),
    queryFn: () => listRoles(),
    staleTime: 5 * 60_000, // Roles change rarely.
  });
}

// ---------------------------------------------------------------------------
// Audit (settings-scoped)
// ---------------------------------------------------------------------------

export interface UseAuditSettingsArgs {
  readonly targetTypes: ReadonlyArray<AuditEvent['targetType']>;
  readonly limit?: number;
}

export function useAuditSettings(
  args: UseAuditSettingsArgs,
): UseQueryResult<ReadonlyArray<AuditEvent>, Error> {
  const filterKey = `${args.targetTypes.join(',')}|${args.limit ?? 50}`;
  return useQuery<ReadonlyArray<AuditEvent>, Error>({
    queryKey: settingsQueryKeys.audit(filterKey),
    queryFn: () =>
      listAuditSettings({ targetTypes: args.targetTypes, limit: args.limit ?? 50 }),
    staleTime: 15_000,
  });
}


// ---------------------------------------------------------------------------
// Step-73 — additional settings hooks (Profile, Tokens, Sessions, etc.)
// All new hooks follow the existing queryKey + useQuery + useMutation shape.
// ---------------------------------------------------------------------------

import {
  applySeed,
  createApiToken,
  createWebhook,
  deleteWebhook,
  getAIGatewayHealth,
  getBillingQuota,
  getBranding,
  getMe,
  getNotifications,
  getSsoConfig,
  listAIGatewayMcpServers,
  listAIGatewayModels,
  listAIGatewaySpend,
  listApiTokens,
  listFeatureFlags,
  listSeeds,
  listSessions,
  listWebhookDeliveries,
  listWebhooks,
  patchBranding,
  patchFeatureFlag,
  patchMe,
  patchNotifications,
  revokeApiToken,
  revokeSession,
  testWebhook,
  updateWebhook,
} from '@/lib/settings/data';
import type { MeUser } from '@/lib/settings/data';
import type {
  AIGatewayHealth,
  AIGatewayMcpServer,
  AIGatewayModel,
  AIGatewaySpend,
  ApiToken,
  ApiTokenCreated,
  BillingQuota,
  Branding,
  FeatureFlag,
  FeatureFlagValue,
  NotificationPrefs,
  Session,
  SsoConfig,
  SeedManifestSummary,
  Webhook,
  WebhookCreate,
  WebhookDelivery,
  WebhookTestResult,
  WebhookUpdate,
} from '@/lib/settings/types';

// --- Me / Profile ---------------------------------------------------------

export function useMe(): UseQueryResult<MeUser, Error> {
  return useQuery({ queryKey: ['settings', 'me'] as const, queryFn: () => getMe(), staleTime: 60_000 });
}

export function useUpdateMe(): UseMutationResult<MeUser, Error, Partial<MeUser>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => patchMe(body),
    onSuccess: (user) => {
      qc.setQueryData(['settings', 'me'], user);
      void qc.invalidateQueries({ queryKey: ['settings', 'me'] });
    },
  });
}

// --- API Tokens -----------------------------------------------------------

export function useApiTokens(): UseQueryResult<ReadonlyArray<ApiToken>, Error> {
  return useQuery({
    queryKey: ['settings', 'api-tokens'] as const,
    queryFn: () => listApiTokens(),
    staleTime: 30_000,
  });
}

export function useCreateApiToken(): UseMutationResult<
  ApiTokenCreated,
  Error,
  { name: string; scope?: string; expiresInDays?: number | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => createApiToken(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'api-tokens'] });
    },
  });
}

export function useRevokeApiToken(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => revokeApiToken(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'api-tokens'] });
    },
  });
}

// --- Sessions -------------------------------------------------------------

export function useSessions(): UseQueryResult<ReadonlyArray<Session>, Error> {
  return useQuery({
    queryKey: ['settings', 'sessions'] as const,
    queryFn: () => listSessions(),
    staleTime: 15_000,
  });
}

export function useRevokeSession(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => revokeSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'sessions'] });
    },
  });
}

// --- Notifications --------------------------------------------------------

export function useNotifications(): UseQueryResult<NotificationPrefs, Error> {
  return useQuery({
    queryKey: ['settings', 'notifications'] as const,
    queryFn: () => getNotifications(),
    staleTime: 60_000,
  });
}

export function useUpdateNotifications(): UseMutationResult<
  NotificationPrefs,
  Error,
  Partial<NotificationPrefs>
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => patchNotifications(body),
    onSuccess: (prefs) => {
      qc.setQueryData(['settings', 'notifications'], prefs);
    },
  });
}

// --- Branding -------------------------------------------------------------

export function useBranding(tenantId: string | null): UseQueryResult<Branding, Error> {
  return useQuery({
    queryKey: ['settings', 'branding', tenantId] as const,
    queryFn: () => getBranding(tenantId ?? ''),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
}

export function useUpdateBranding(
  tenantId: string,
): UseMutationResult<Branding, Error, Partial<Branding>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => patchBranding(tenantId, body),
    onSuccess: (branding) => {
      qc.setQueryData(['settings', 'branding', tenantId], branding);
    },
  });
}

// --- SSO ------------------------------------------------------------------

export function useSsoConfig(): UseQueryResult<SsoConfig, Error> {
  return useQuery({
    queryKey: ['settings', 'sso'] as const,
    queryFn: () => getSsoConfig(),
    staleTime: 5 * 60_000,
  });
}

// --- Billing --------------------------------------------------------------

export function useBillingQuota(tenantId: string | null): UseQueryResult<BillingQuota, Error> {
  return useQuery({
    queryKey: ['settings', 'billing-quota', tenantId] as const,
    queryFn: () => getBillingQuota(tenantId ?? ''),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
}

// --- Feature flags --------------------------------------------------------

export function useFeatureFlags(): UseQueryResult<ReadonlyArray<FeatureFlag>, Error> {
  return useQuery({
    queryKey: ['settings', 'feature-flags'] as const,
    queryFn: () => listFeatureFlags(),
    staleTime: 30_000,
  });
}

export function useUpdateFeatureFlag(): UseMutationResult<
  FeatureFlag,
  Error,
  { key: string; value: FeatureFlagValue }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) => patchFeatureFlag(key, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'feature-flags'] });
    },
  });
}

// --- Seeds ----------------------------------------------------------------

export function useSeeds(): UseQueryResult<ReadonlyArray<SeedManifestSummary>, Error> {
  return useQuery({
    queryKey: ['settings', 'seeds'] as const,
    queryFn: () => listSeeds(),
    staleTime: 30_000,
  });
}

export function useApplySeed(): UseMutationResult<unknown, Error, { name: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name }) => applySeed(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'seeds'] });
    },
  });
}

// --- Webhooks -------------------------------------------------------------

export function useWebhooks(
  direction?: 'inbound' | 'outbound',
): UseQueryResult<ReadonlyArray<Webhook>, Error> {
  return useQuery({
    queryKey: ['settings', 'webhooks', direction ?? 'all'] as const,
    queryFn: () => listWebhooks(direction),
    staleTime: 30_000,
  });
}

export function useCreateWebhook(): UseMutationResult<Webhook, Error, WebhookCreate> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => createWebhook(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'webhooks'] });
    },
  });
}

export function useUpdateWebhook(): UseMutationResult<
  Webhook,
  Error,
  { id: string; body: WebhookUpdate }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => updateWebhook(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'webhooks'] });
    },
  });
}

export function useDeleteWebhook(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteWebhook(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'webhooks'] });
    },
  });
}

export function useTestWebhook(): UseMutationResult<WebhookTestResult, Error, string> {
  return useMutation({
    mutationFn: (id) => testWebhook(id),
  });
}

export function useWebhookDeliveries(
  id: string | null,
): UseQueryResult<ReadonlyArray<WebhookDelivery>, Error> {
  return useQuery({
    queryKey: ['settings', 'webhook-deliveries', id] as const,
    queryFn: () => listWebhookDeliveries(id ?? ''),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

// --- AI Gateway -----------------------------------------------------------

export function useAIGatewayModels(): UseQueryResult<ReadonlyArray<AIGatewayModel>, Error> {
  return useQuery({
    queryKey: ['settings', 'ai-gateway', 'models'] as const,
    queryFn: () => listAIGatewayModels(),
    staleTime: 60_000,
  });
}

export function useAIGatewayMcpServers(): UseQueryResult<ReadonlyArray<AIGatewayMcpServer>, Error> {
  return useQuery({
    queryKey: ['settings', 'ai-gateway', 'mcp-servers'] as const,
    queryFn: () => listAIGatewayMcpServers(),
    staleTime: 60_000,
  });
}

export function useAIGatewayHealth(): UseQueryResult<AIGatewayHealth, Error> {
  return useQuery({
    queryKey: ['settings', 'ai-gateway', 'health'] as const,
    queryFn: () => getAIGatewayHealth(),
    staleTime: 30_000,
  });
}

export function useAIGatewaySpend(): UseQueryResult<ReadonlyArray<AIGatewaySpend>, Error> {
  return useQuery({
    queryKey: ['settings', 'ai-gateway', 'spend'] as const,
    queryFn: () => listAIGatewaySpend(),
    staleTime: 60_000,
  });
}
