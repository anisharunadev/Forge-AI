/**
 * Async data loaders for the Architecture Center (M2+).
 *
 * Replaces `lib/architecture/mock-data.ts` with async fetchers that
 * hit the orchestrator stub. Type declarations are copied verbatim
 * from mock-data.ts so component imports (`type ADR`, etc.) keep
 * working until mock-data is removed in a later pass.
 *
 * Endpoints (see `bin/orchestrator-stub.py`):
 *   GET /v1/architecture/adrs
 *   GET /v1/architecture/contracts
 *   GET /v1/architecture/task-breakdowns
 *   GET /v1/architecture/risk-registers
 *   GET /v1/architecture/traceability        (single object)
 *   GET /v1/architecture/versions
 */

export type ADRStatus =
  | 'proposed'
  | 'draft'
  | 'approved'
  | 'published'
  | 'superseded';

export type ContractKind = 'openapi' | 'graphql' | 'grpc' | 'asyncapi';

export interface ADR {
  id: string;
  number: number;
  title: string;
  status: ADRStatus;
  owner: string;
  updatedAt: string;
  markdown: string;
  supersededBy?: number;
}

export interface APIContract {
  id: string;
  title: string;
  kind: ContractKind;
  service: string;
  version: string;
  owner: string;
  updatedAt: string;
  source: string;
  status: 'draft' | 'published' | 'deprecated';
}

export interface TaskNode {
  id: string;
  title: string;
  estimateHours: number;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  children: ReadonlyArray<TaskNode>;
}

export interface TaskBreakdown {
  id: string;
  title: string;
  source: string;
  totalEstimateHours: number;
  tree: TaskNode;
}

export interface Risk {
  id: string;
  title: string;
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  owner: string;
  mitigation: string;
  status: 'open' | 'mitigating' | 'closed';
}

export interface RiskRegister {
  id: string;
  title: string;
  source: string;
  updatedAt: string;
  risks: ReadonlyArray<Risk>;
}

export interface TraceabilityNode {
  id: string;
  label: string;
  kind: 'requirement' | 'adr' | 'task' | 'test' | 'risk';
  x: number;
  y: number;
}

export interface TraceabilityEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface TraceabilityGraph {
  id: string;
  title: string;
  nodes: ReadonlyArray<TraceabilityNode>;
  edges: ReadonlyArray<TraceabilityEdge>;
}

export interface ArchitectureVersion {
  version: string;
  releasedAt: string;
  highlights: ReadonlyArray<string>;
}

const API_BASE =
  process.env.FORA_FORGE_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getList<T>(path: string): Promise<ReadonlyArray<T>> {
  const data = await getJson<ReadonlyArray<T>>(path);
  return data ?? [];
}

export async function listADRs(): Promise<ReadonlyArray<ADR>> {
  return getList<ADR>('/v1/architecture/adrs');
}

export async function getADR(id: string): Promise<ADR | undefined> {
  const all = await listADRs();
  return all.find((a) => a.id === id);
}

export async function listContracts(): Promise<ReadonlyArray<APIContract>> {
  return getList<APIContract>('/v1/architecture/contracts');
}

export async function getContract(id: string): Promise<APIContract | undefined> {
  const all = await listContracts();
  return all.find((c) => c.id === id);
}

export async function listTaskBreakdowns(): Promise<ReadonlyArray<TaskBreakdown>> {
  return getList<TaskBreakdown>('/v1/architecture/task-breakdowns');
}

export async function getTaskBreakdown(
  id: string,
): Promise<TaskBreakdown | undefined> {
  const all = await listTaskBreakdowns();
  return all.find((t) => t.id === id);
}

export async function listRiskRegisters(): Promise<ReadonlyArray<RiskRegister>> {
  return getList<RiskRegister>('/v1/architecture/risk-registers');
}

export async function getRiskRegister(
  id: string,
): Promise<RiskRegister | undefined> {
  const all = await listRiskRegisters();
  return all.find((r) => r.id === id);
}

export async function getTraceabilityGraph(): Promise<TraceabilityGraph> {
  const data = await getJson<TraceabilityGraph>('/v1/architecture/traceability');
  return (
    data ?? {
      id: 'tg-empty',
      title: 'Traceability',
      nodes: [],
      edges: [],
    }
  );
}

export async function listVersions(): Promise<ReadonlyArray<ArchitectureVersion>> {
  return getList<ArchitectureVersion>('/v1/architecture/versions');
}
