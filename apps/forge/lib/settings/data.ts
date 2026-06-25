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
