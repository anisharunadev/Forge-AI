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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
  const projectId = useProjectId();
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
