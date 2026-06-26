/**
 * Knowledge graph builder — fuses code + tickets + docs into one graph.
 *
 * Backed by `GET /api/v1/projects/:project_id/knowledge-graph` once the
 * backend lands; the deterministic stub below preserves the same shape
 * so every Forge surface can develop against it.
 */

import type {
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  TenantScopedContext,
} from './types';

type NodeSeed = Omit<KnowledgeGraphNode, 'tenant_id' | 'project_id'>;
type EdgeSeed = Omit<KnowledgeGraphEdge, 'tenant_id' | 'project_id'>;

const NODES: NodeSeed[] = [
  {
    id: 'n-svc-frontend',
    kind: 'service',
    label: 'forge-dashboard',
    attrs: { language: 'typescript', loc: 78_400 },
    source: 'apps/forge',
  },
  {
    id: 'n-svc-backend',
    kind: 'service',
    label: 'forge-api',
    attrs: { language: 'python', loc: 105_920 },
    source: 'backend',
  },
  {
    id: 'n-adr-001',
    kind: 'adr',
    label: 'ADR-001 — Multi-Tenancy by Default',
    attrs: { status: 'accepted' },
    source: '.planning/adr/001-multi-tenancy.md',
  },
  {
    id: 'n-persona-pm',
    kind: 'persona',
    label: 'Product Manager',
    attrs: { surfaces_count: 2 },
    source: 'app/personas/pm',
  },
];

const EDGES: EdgeSeed[] = [
  { from: 'n-svc-frontend', to: 'n-svc-backend', relation: 'calls', weight: 1.0 },
  { from: 'n-svc-backend', to: 'n-adr-001', relation: 'implements', weight: 1.0 },
  { from: 'n-persona-pm', to: 'n-svc-frontend', relation: 'owns', weight: 0.5 },
];

export async function buildKnowledgeGraph(
  ctx: TenantScopedContext,
): Promise<KnowledgeGraph> {
  return {
    ...ctx,
    graph_id: `kg_${ctx.tenant_id}_${ctx.project_id}`,
    nodes: NODES.map((n) => ({ ...n, ...ctx })),
    edges: EDGES.map((e) => ({ ...e, ...ctx })),
    built_at: new Date().toISOString(),
  };
}

export async function queryKnowledgeGraph(
  ctx: TenantScopedContext,
  query: { kind?: string; label_contains?: string } = {},
): Promise<KnowledgeGraph> {
  const graph = await buildKnowledgeGraph(ctx);
  const filteredNodes = graph.nodes.filter((n) => {
    if (query.kind && n.kind !== query.kind) return false;
    if (query.label_contains && !n.label.toLowerCase().includes(query.label_contains.toLowerCase()))
      return false;
    return true;
  });
  const ids = new Set(filteredNodes.map((n) => n.id));
  return {
    ...graph,
    nodes: filteredNodes,
    edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}