/**
 * Async data loaders for the Knowledge Center (M2+ — F-115).
 *
 * Replaces `lib/knowledge-center/mock-data.ts` with async fetchers
 * that hit the orchestrator stub. Type declarations are copied verbatim
 * from mock-data.ts so component imports (`type KGNode`, `NodeKind`,
 * etc.) keep working until mock-data is removed in a later pass.
 *
 * Endpoints (see `bin/orchestrator-stub.py`):
 *   GET /v1/knowledge-center/nodes
 *   GET /v1/knowledge-center/edges
 */

export type NodeKind =
  | 'Repo'
  | 'Service'
  | 'Component'
  | 'ADR'
  | 'Idea'
  | 'Risk'
  | 'Task'
  | 'Test';

export type EdgeKind =
  | 'implements'
  | 'owns'
  | 'derived_from'
  | 'blocks'
  | 'mitigates'
  | 'covered_by'
  | 'depends_on'
  | 'relates_to';

export interface KGNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** ISO timestamp the node was last touched. */
  updatedAt: string;
}

export interface KGEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
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

export async function listKGNodes(): Promise<ReadonlyArray<KGNode>> {
  return getList<KGNode>('/v1/knowledge-center/nodes');
}

export async function listKGEdges(): Promise<ReadonlyArray<KGEdge>> {
  return getList<KGEdge>('/v1/knowledge-center/edges');
}

export async function getKGNode(id: string): Promise<KGNode | undefined> {
  const all = await listKGNodes();
  return all.find((n) => n.id === id);
}
