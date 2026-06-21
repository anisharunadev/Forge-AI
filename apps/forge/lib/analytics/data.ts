/**
 * Analytics Center data layer (M2+).
 *
 * Fetches KPIs, cost trend, run status distribution, acceptance,
 * agent usage, and the approval latency histogram from the
 * orchestrator. `knowledgeReusePct` is folded into the KPI snapshot
 * returned by `/v1/analytics/kpis`.
 */

export interface CostPoint {
  date: string; // YYYY-MM-DD
  costUsd: number;
}

export interface RunStatusBucket {
  status: 'created' | 'running' | 'waiting_approval' | 'paused' | 'aborted' | 'finished';
  count: number;
}

export interface ArtifactAcceptance {
  accepted: number;
  rejected: number;
  pending: number;
}

export interface AgentUsageBucket {
  agent: string;
  invocations: number;
  costUsd: number;
}

export interface LatencyBin {
  /** Bin range label (e.g. "0-1s"). */
  range: string;
  count: number;
}

export interface KPISnapshot {
  totalCostUsd30d: number;
  activeRuns: number;
  avgAcceptancePct: number;
  knowledgeReusePct: number;
  totalRuns: number;
}

const SERVER_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function safeJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

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

/** GET /v1/analytics/kpis — includes knowledgeReusePct. */
export async function getKPIs(): Promise<KPISnapshot> {
  const res = await fetch(`${SERVER_BASE}/v1/analytics/kpis`, {
    cache: 'no-store',
  });
  const body = await safeJson<KPISnapshot>(res);
  return (
    body ?? {
      totalCostUsd30d: 0,
      activeRuns: 0,
      avgAcceptancePct: 0,
      knowledgeReusePct: 0,
      totalRuns: 0,
    }
  );
}

/** GET /v1/analytics/cost-trend */
export async function getCostTrend(): Promise<ReadonlyArray<CostPoint>> {
  const res = await fetch(`${SERVER_BASE}/v1/analytics/cost-trend`, {
    cache: 'no-store',
  });
  return safeArray<CostPoint>(res);
}

/** GET /v1/analytics/runs-by-status */
export async function getRunsByStatus(): Promise<ReadonlyArray<RunStatusBucket>> {
  const res = await fetch(`${SERVER_BASE}/v1/analytics/runs-by-status`, {
    cache: 'no-store',
  });
  return safeArray<RunStatusBucket>(res);
}

/** GET /v1/analytics/artifact-acceptance */
export async function getArtifactAcceptance(): Promise<ArtifactAcceptance> {
  const res = await fetch(`${SERVER_BASE}/v1/analytics/artifact-acceptance`, {
    cache: 'no-store',
  });
  const body = await safeJson<ArtifactAcceptance>(res);
  return body ?? { accepted: 0, rejected: 0, pending: 0 };
}

/** GET /v1/analytics/agent-usage */
export async function getAgentUsage(): Promise<ReadonlyArray<AgentUsageBucket>> {
  const res = await fetch(`${SERVER_BASE}/v1/analytics/agent-usage`, {
    cache: 'no-store',
  });
  return safeArray<AgentUsageBucket>(res);
}

/** GET /v1/analytics/latency-histogram */
export async function getLatencyHistogram(): Promise<ReadonlyArray<LatencyBin>> {
  const res = await fetch(`${SERVER_BASE}/v1/analytics/latency-histogram`, {
    cache: 'no-store',
  });
  return safeArray<LatencyBin>(res);
}
