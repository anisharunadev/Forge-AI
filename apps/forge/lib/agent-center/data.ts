/**
 * Agent Center data layer (M2 — FORA-590).
 *
 * Fetches agents, model providers, the task→agent assignment matrix,
 * and the runtime list from the orchestrator. The shape mirrors the
 * typed artifacts in the orchestration spec (Plan 4 §3.4 — agent
 * cards) so the swap to the real data source is a one-file change.
 */

export type AgentType = 'cli' | 'scaffold' | 'custom' | 'sdlc';
export type AgentStatus = 'active' | 'idle' | 'degraded' | 'offline';
export type ProviderStatus = 'connected' | 'rate-limited' | 'error' | 'pending';
export type RuntimeKind = 'sandbox' | 'container' | 'vm' | 'lambda';

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  version: string;
  description: string;
  defaultProvider: string;
  supportedTasks: ReadonlyArray<string>;
  lastInvokedAt: string;
  invocations24h: number;
  costUsd24h: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  displayName: string;
  status: ProviderStatus;
  region: string;
  defaultModel: string;
  models: ReadonlyArray<string>;
  costPer1kTokensUsd: number;
  errorRate24h: number;
  calls24h: number;
}

export interface AgentAssignment {
  taskType: string;
  agentId: string;
  providerId: string;
  enabled: boolean;
  notes?: string;
}

export interface Runtime {
  id: string;
  agentId: string;
  kind: RuntimeKind;
  status: AgentStatus;
  region: string;
  cpuPercent: number;
  memPercent: number;
  uptimeSec: number;
  startedAt: string;
}

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function safeArray<T>(res: Response): Promise<ReadonlyArray<T>> {
  if (!res.ok) return [];
  try {
    const json = (await res.json()) as T[] | { items?: T[] };
    if (Array.isArray(json)) return json;
    if (json && Array.isArray((json as { items?: T[] }).items)) {
      return (json as { items: T[] }).items;
    }
    return [];
  } catch {
    return [];
  }
}

/** GET /v1/agent-center/agents */
export async function listAgents(): Promise<ReadonlyArray<Agent>> {
  const res = await fetch(`${SERVER_BASE}/v1/agent-center/agents`, {
    cache: 'no-store',
  });
  return safeArray<Agent>(res);
}

/** GET /v1/agent-center/providers */
export async function listProviders(): Promise<ReadonlyArray<ModelProvider>> {
  const res = await fetch(`${SERVER_BASE}/v1/agent-center/providers`, {
    cache: 'no-store',
  });
  return safeArray<ModelProvider>(res);
}

/** GET /v1/agent-center/assignments */
export async function listAssignments(): Promise<ReadonlyArray<AgentAssignment>> {
  const res = await fetch(`${SERVER_BASE}/v1/agent-center/assignments`, {
    cache: 'no-store',
  });
  return safeArray<AgentAssignment>(res);
}

/** GET /v1/agent-center/runtimes */
export async function listRuntimes(): Promise<ReadonlyArray<Runtime>> {
  const res = await fetch(`${SERVER_BASE}/v1/agent-center/runtimes`, {
    cache: 'no-store',
  });
  return safeArray<Runtime>(res);
}

/** Local helpers — pure transforms, no I/O. */
export function getAgent(items: ReadonlyArray<Agent>, id: string): Agent | undefined {
  return items.find((a) => a.id === id);
}

export function getProvider(
  items: ReadonlyArray<ModelProvider>,
  id: string,
): ModelProvider | undefined {
  return items.find((p) => p.id === id);
}

export const TASK_TYPES: ReadonlyArray<string> = [
  'ideation',
  'architect',
  'implement',
  'review',
  'qa',
  'security',
  'docs',
];
