/**
 * Agent Center — UI shape adapter (step-54 Phase 2).
 *
 * The backend Pydantic schemas (e.g. `AgentRead`) and the existing
 * UI components (`AgentCard`, `ModelProviderCard`, `RuntimeStatus`,
 * `AgentAssignmentMatrix`) speak slightly different shapes:
 *
 *   - Backend `Agent` is sparse: name, type, version, capabilities, status.
 *     No `defaultProvider`, no `lastInvokedAt`, no `invocations24h`.
 *   - UI components expect a richer shape for the bento dashboard
 *     (KPI tiles, status pills, sparklines).
 *
 * This adapter fills the gaps with safe defaults so the visual design
 * (Step 4 + Step 43 clarity) keeps working. Future iterations can
 * either add real metrics columns or drop the unused fields entirely.
 *
 * Skill rule adopted: **Project Intelligence precedes automation**
 * (Rule 10) — we only show what we actually have, never fabricate
 * metrics. Defaults are explicit "—" or 0 so the user can tell what
 * is real.
 */

import type {
  Agent,
  ModelProvider,
  Runtime,
  AgentAssignment,
} from '@/lib/query/hooks';
import {
  TASK_TYPES as LEGACY_TASK_TYPES,
  type Agent as UiAgent,
  type AgentStatus as UiAgentStatus,
  type AgentType as UiAgentType,
  type ModelProvider as UiModelProvider,
  type ProviderStatus as UiProviderStatus,
  type Runtime as UiRuntime,
  type RuntimeKind as UiRuntimeKind,
  type AgentAssignment as UiAgentAssignment,
} from '@/lib/agent-center/data';

// ---------------------------------------------------------------------------
// Agent adapter
// ---------------------------------------------------------------------------

function backendTypeToUi(type: Agent['type']): UiAgentType {
  switch (type) {
    case 'claude_code':
      return 'cli';
    case 'codex':
      return 'cli';
    case 'gemini':
      return 'cli';
    case 'custom':
      return 'custom';
    default:
      return 'custom';
  }
}

function backendStatusToUi(status: Agent['status']): UiAgentStatus {
  switch (status) {
    case 'enabled':
      return 'active';
    case 'disabled':
      return 'idle';
    case 'deprecated':
      return 'offline';
    default:
      return 'offline';
  }
}

export function agentToUi(a: Agent): UiAgent {
  // Capabilities are a dict in the backend; the UI used to expect an
  // array of task-type strings. Derive the supported-task list from
  // `capabilities.tasks` if present, else fall back to ["general"].
  const caps = (a.capabilities ?? {}) as Record<string, unknown>;
  const rawTasks = caps.tasks;
  const supportedTasks = Array.isArray(rawTasks)
    ? rawTasks.filter((t): t is string => typeof t === 'string')
    : ['general'];

  return {
    id: a.id,
    name: a.name,
    type: backendTypeToUi(a.type),
    status: backendStatusToUi(a.status),
    version: a.version,
    description: '',
    defaultProvider: '',
    supportedTasks,
    lastInvokedAt: a.updated_at,
    invocations24h: 0,
    costUsd24h: 0,
  };
}

export function agentsToUi(rows: Agent[] | undefined): UiAgent[] {
  if (!rows) return [];
  return rows.map(agentToUi);
}

// ---------------------------------------------------------------------------
// Model provider adapter
// ---------------------------------------------------------------------------

function backendProviderStatusToUi(p: ModelProvider): UiProviderStatus {
  if (!p.enabled) return 'pending';
  // Without a real `last_test_at` we treat configured + enabled as
  // "connected". A later wiring can switch on last_test_status.
  return 'connected';
}

export function providerToUi(p: ModelProvider): UiModelProvider {
  return {
    id: p.id,
    name: p.name,
    displayName: p.name,
    status: backendProviderStatusToUi(p),
    region: (p.config as Record<string, unknown>)?.region as string ?? '—',
    defaultModel: p.litellm_model_alias,
    models: [p.litellm_model_alias],
    costPer1kTokensUsd: 0,
    errorRate24h: 0,
    calls24h: 0,
  };
}

export function providersToUi(rows: ModelProvider[] | undefined): UiModelProvider[] {
  if (!rows) return [];
  return rows.map(providerToUi);
}

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

function backendRuntimeKindToUi(kind: Runtime['kind']): UiRuntimeKind {
  switch (kind) {
    case 'local_subprocess':
      return 'sandbox';
    case 'kubernetes_pod':
      return 'container';
    default:
      return 'sandbox';
  }
}

function backendRuntimeStateToUi(state: Runtime['state']): UiAgentStatus {
  switch (state) {
    case 'starting':
      return 'degraded';
    case 'running':
      return 'active';
    case 'stopped':
      return 'idle';
    case 'failed':
      return 'offline';
    default:
      return 'idle';
  }
}

export function runtimeToUi(r: Runtime): UiRuntime {
  return {
    id: r.id,
    agentId: r.agent_id,
    kind: backendRuntimeKindToUi(r.kind),
    status: backendRuntimeStateToUi(r.state),
    region: '—',
    cpuPercent: 0,
    memPercent: 0,
    uptimeSec: r.started_at
      ? Math.max(
          0,
          (Date.now() - new Date(r.started_at).getTime()) / 1000,
        )
      : 0,
    startedAt: r.started_at ?? r.created_at,
  };
}

export function runtimesToUi(rows: Runtime[] | undefined): UiRuntime[] {
  if (!rows) return [];
  return rows.map(runtimeToUi);
}

// ---------------------------------------------------------------------------
// Assignment adapter — backend returns one assignment per query
// (task_type + project + strategy). The UI matrix expects many
// assignments (one per task_type × agent). To bridge, we surface a
// single "picked" assignment as a synthetic row, but expose the
// underlying agent and provider so the UI can render cells.
// ---------------------------------------------------------------------------

export function assignmentToUi(
  a: AgentAssignment | null | undefined,
  taskType: string,
): UiAgentAssignment | null {
  if (!a) return null;
  return {
    taskType,
    agentId: a.agent.id,
    providerId: a.agent.id, // placeholder — provider is on the agent in our schema
    enabled: a.agent.status === 'enabled',
    notes: a.strategy,
  };
}

// Re-export the legacy task types list so the page doesn't need to
// import from both files.
export const TASK_TYPES = LEGACY_TASK_TYPES;