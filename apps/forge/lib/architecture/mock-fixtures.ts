/**
 * Mock fixtures for the Architecture Center.
 *
 * Single source of truth for in-page demo data: 6 ADRs, 4 services
 * with 30+ endpoints, 12 tasks across 2 epics, 5 risks. The data is
 * internally consistent — ADR-001 owns the Provider Abstraction
 * Layer service, TASK-001 implements ADR-001, RISK-001 mitigates
 * via ADR-005, etc — so cross-tab chips and the traceability matrix
 * line up when the user clicks through.
 *
 * Skill influence:
 *   - `08-empty-ux.md` — every collection has a "default state" so
 *     the Overview/Traceability/Tech Radar panels render even on
 *     first paint (no race between fetch and empty state).
 *   - `09-empty-illustration.md` — count badges mirror the length
 *     of these arrays so the "count vs empty" bug from Step 11
 *     cannot recur.
 */

import type {
  ADR,
  APIContract,
  TaskBreakdown,
  TaskNode,
  RiskRegister,
  Risk,
  ArchitectureVersion,
  TraceabilityGraph,
} from './data';

export interface ADRComponent {
  id: 'backend' | 'frontend' | 'infra' | 'data' | 'mobile' | 'ai';
  label: string;
  tone: string;
}

export const ADR_COMPONENTS: ReadonlyArray<ADRComponent> = [
  { id: 'backend', label: 'Backend', tone: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' },
  { id: 'frontend', label: 'Frontend', tone: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' },
  { id: 'infra', label: 'Infra', tone: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  { id: 'data', label: 'Data', tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  { id: 'mobile', label: 'Mobile', tone: 'border-pink-500/40 bg-pink-500/10 text-pink-300' },
  { id: 'ai', label: 'AI', tone: 'border-violet-500/40 bg-violet-500/10 text-violet-300' },
];

export const ADR_STATUS_TONE: Record<string, string> = {
  draft: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  proposed: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  published: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  superseded: 'border-slate-500/40 bg-slate-500/10 text-slate-400',
};

export const ADR_COMPONENT_BY_NUMBER: Record<number, ADRComponent['id']> = {
  1: 'backend',
  2: 'infra',
  3: 'frontend',
  4: 'data',
  5: 'ai',
  6: 'backend',
};

export const ADR_IMPACT_BY_NUMBER: Record<number, number> = {
  1: 9,
  2: 7,
  3: 5,
  4: 8,
  5: 10,
  6: 4,
};

export const MOCK_ADRS: ReadonlyArray<ADR> = [
  {
    id: 'adr-001',
    number: 1,
    title: 'Provider Abstraction Layer for all LLM traffic',
    status: 'approved',
    owner: 'platform-team',
    updatedAt: '2026-06-12T14:22:00Z',
    markdown: [
      '# Context',
      'Every agent today depends directly on the OpenAI SDK. This couples Forge to a single vendor and blocks the rules from Rule 1 (model-provider agnosticism).',
      '',
      '# Decision',
      'Route all LLM traffic through the Forge Provider Abstraction Layer (PAL). The PAL exposes a uniform `chat.completions.create` shape and adapters for OpenAI, Anthropic, Bedrock, and vLLM.',
      '',
      '# Consequences',
      '- New agents write against one shape, not five SDKs.',
      '- Vendor swap is a config change, not a code change.',
      '- Per-tenant routing keys and cost attribution become possible.',
      '',
      '# Alternatives considered',
      '- Keep direct SDK calls (rejected: violates Rule 1).',
      '- Use LiteLLM as a sidecar (rejected: extra hop, less control over cost).',
    ].join('\n'),
  },
  {
    id: 'adr-002',
    number: 2,
    title: 'Multi-tenant Postgres with row-level isolation',
    status: 'approved',
    owner: 'platform-team',
    updatedAt: '2026-06-04T09:15:00Z',
    markdown: [
      '# Context',
      'Forge must enforce Rule 2 — every row carries `tenant_id` and `project_id`. Schema-level isolation costs too much at this scale.',
      '',
      '# Decision',
      'Single Postgres database, one schema, row-level security policies keyed on `tenant_id`. Every ORM query is automatically augmented with a tenant filter middleware.',
      '',
      '# Consequences',
      '- Cheaper to operate than one DB per tenant.',
      '- All tenants share connection pool — query latency stays predictable.',
      '- RLS bypass is reserved for admin/system jobs only.',
    ].join('\n'),
  },
  {
    id: 'adr-003',
    number: 3,
    title: 'React Flow as the default visualization framework',
    status: 'approved',
    owner: 'design-team',
    updatedAt: '2026-05-28T16:01:00Z',
    markdown: [
      '# Context',
      'Forge renders knowledge graphs, repository graphs, dependency graphs, workflow graphs, agent execution graphs, and audit timelines. The UI-first principle demands interactive viz for all of them.',
      '',
      '# Decision',
      'Adopt React Flow (xyflow) as the single visualization framework. Knowledge graphs, repo graphs, sequence diagrams, and C4 containers all use React Flow layouts.',
      '',
      '# Consequences',
      '- One library to learn, one to upgrade.',
      '- Mermaid remains acceptable for read-only SVG exports.',
    ].join('\n'),
  },
  {
    id: 'adr-004',
    number: 4,
    title: 'pgvector + hybrid lexical/semantic retrieval',
    status: 'draft',
    owner: 'knowledge-team',
    updatedAt: '2026-06-19T11:40:00Z',
    markdown: [
      '# Context',
      'The Organization Knowledge Layer needs cross-project search that surfaces both exact matches and semantically related content.',
      '',
      '# Decision',
      'Use pgvector for embeddings and BM25 for lexical fallback. Reciprocal Rank Fusion merges both result sets.',
      '',
      '# Consequences',
      '- No new infrastructure; pgvector ships with Postgres 17.',
      '- Per-tenant embeddings (Rule 2) — we never cross tenant boundaries in the index.',
    ].join('\n'),
  },
  {
    id: 'adr-005',
    number: 5,
    title: 'Mandatory human approval gates across boundaries',
    status: 'proposed',
    owner: 'governance-team',
    updatedAt: '2026-06-21T08:30:00Z',
    markdown: [
      '# Context',
      'Rule 3 forbids autonomous transitions across Architecture, Security, and Deployment boundaries. Today this is enforced by convention.',
      '',
      '# Decision',
      'Hard enforcement at the orchestration layer: a workflow cannot transition state into Security or Deployment without a recorded approval event carrying an approver identity.',
      '',
      '# Consequences',
      '- Approval bypass requires a token issued by an admin role.',
      '- All approval events are written to the audit timeline (Rule 6).',
    ].join('\n'),
  },
  {
    id: 'adr-006',
    number: 6,
    title: 'Connector framework: GitHub-first, Bitbucket parity',
    status: 'superseded',
    owner: 'integration-team',
    updatedAt: '2026-04-30T18:00:00Z',
    supersededBy: 5,
    markdown: [
      '# Context',
      'Rule 8 says no hard-coded assumption about GitHub. The original connector design treated GitHub as a special case.',
      '',
      '# Decision (superseded)',
      'Treat every connector as a peer. The connector framework is keyed on `connector_kind`, not on the underlying provider name.',
      '',
      '# Superseded by',
      'ADR-005 — the approval gate now governs connector publish operations too.',
    ].join('\n'),
  },
];

export interface ADRWithMeta extends ADR {
  component: ADRComponent['id'];
  impact: number;
  authorInitials: string;
  linkedTaskCount: number;
  linkedRiskCount: number;
  linkedApiCount: number;
}

export const MOCK_ADRS_WITH_META: ReadonlyArray<ADRWithMeta> = MOCK_ADRS.map(
  (a, idx) => ({
    ...a,
    component: ADR_COMPONENT_BY_NUMBER[a.number] ?? 'backend',
    impact: ADR_IMPACT_BY_NUMBER[a.number] ?? 5,
    authorInitials: a.owner.slice(0, 1).toUpperCase(),
    linkedTaskCount: [3, 2, 4, 1, 5, 0][idx] ?? 0,
    linkedRiskCount: [2, 1, 0, 1, 3, 0][idx] ?? 0,
    linkedApiCount: [4, 1, 0, 2, 1, 0][idx] ?? 0,
  }),
);

export interface Endpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  auth: 'api_key' | 'oidc' | 'none' | 'saml';
  status: '200' | '201' | '202' | '204' | '400' | '401' | '404' | '500';
  requestSchema?: string;
  responseSchema?: string;
}

export interface ApiService {
  id: string;
  name: string;
  version: string;
  icon: string;
  endpointCount: number;
  documented: number;
  avgResponseMs: number;
  errorRate: number;
  breakingSinceLast: number;
  lastUpdated: string;
  status: 'documented' | 'undocumented' | 'out_of_sync';
  openapiUrl: string;
  endpoints: ReadonlyArray<Endpoint>;
}

export const MOCK_SERVICES: ReadonlyArray<ApiService> = [
  {
    id: 'svc-pal',
    name: 'Provider Abstraction Layer',
    version: 'v1.4.0',
    icon: 'Layers',
    endpointCount: 12,
    documented: 12,
    avgResponseMs: 184,
    errorRate: 0.002,
    breakingSinceLast: 0,
    lastUpdated: '2026-06-22T10:00:00Z',
    status: 'documented',
    openapiUrl: '/specs/pal.openapi.yaml',
    endpoints: [
      { id: 'pal-1', method: 'POST', path: '/v1/chat/completions', description: 'Create a chat completion through any provider', auth: 'oidc', status: '200', requestSchema: 'ChatRequest', responseSchema: 'ChatResponse' },
      { id: 'pal-2', method: 'GET', path: '/v1/providers', description: 'List configured LLM providers', auth: 'api_key', status: '200', responseSchema: 'ProviderList' },
      { id: 'pal-3', method: 'POST', path: '/v1/providers', description: 'Register a new provider adapter', auth: 'oidc', status: '201', requestSchema: 'ProviderCreate', responseSchema: 'Provider' },
      { id: 'pal-4', method: 'GET', path: '/v1/providers/{id}', description: 'Get provider configuration', auth: 'api_key', status: '200', responseSchema: 'Provider' },
      { id: 'pal-5', method: 'PATCH', path: '/v1/providers/{id}', description: 'Update provider config (API keys, model routing)', auth: 'oidc', status: '200', requestSchema: 'ProviderUpdate', responseSchema: 'Provider' },
      { id: 'pal-6', method: 'DELETE', path: '/v1/providers/{id}', description: 'Retire a provider', auth: 'oidc', status: '204' },
      { id: 'pal-7', method: 'POST', path: '/v1/embeddings', description: 'Generate embeddings for an array of inputs', auth: 'oidc', status: '200', requestSchema: 'EmbeddingRequest', responseSchema: 'EmbeddingResponse' },
      { id: 'pal-8', method: 'GET', path: '/v1/models', description: 'List models available across all providers', auth: 'api_key', status: '200', responseSchema: 'ModelList' },
      { id: 'pal-9', method: 'POST', path: '/v1/usage/report', description: 'Generate a per-tenant usage report', auth: 'oidc', status: '200', responseSchema: 'UsageReport' },
      { id: 'pal-10', method: 'GET', path: '/v1/usage/{tenant_id}', description: 'Per-tenant usage query', auth: 'oidc', status: '200', responseSchema: 'UsageEntry' },
      { id: 'pal-11', method: 'POST', path: '/v1/cache/lookup', description: 'Semantic cache lookup', auth: 'oidc', status: '200', requestSchema: 'CacheLookup', responseSchema: 'CacheHit' },
      { id: 'pal-12', method: 'POST', path: '/v1/cache/store', description: 'Store an entry in semantic cache', auth: 'oidc', status: '201', requestSchema: 'CacheStore', responseSchema: 'CacheAck' },
    ],
  },
  {
    id: 'svc-tenant',
    name: 'Tenant Identity Service',
    version: 'v2.1.0',
    icon: 'Users',
    endpointCount: 9,
    documented: 7,
    avgResponseMs: 42,
    errorRate: 0.001,
    breakingSinceLast: 1,
    lastUpdated: '2026-06-18T15:30:00Z',
    status: 'out_of_sync',
    openapiUrl: '/specs/tenant.openapi.yaml',
    endpoints: [
      { id: 'tenant-1', method: 'POST', path: '/v1/tenants', description: 'Create a tenant', auth: 'saml', status: '201', requestSchema: 'TenantCreate', responseSchema: 'Tenant' },
      { id: 'tenant-2', method: 'GET', path: '/v1/tenants/{id}', description: 'Get tenant profile', auth: 'oidc', status: '200', responseSchema: 'Tenant' },
      { id: 'tenant-3', method: 'PATCH', path: '/v1/tenants/{id}', description: 'Update tenant settings', auth: 'oidc', status: '200', requestSchema: 'TenantUpdate', responseSchema: 'Tenant' },
      { id: 'tenant-4', method: 'GET', path: '/v1/tenants/{id}/projects', description: 'List projects under a tenant', auth: 'oidc', status: '200', responseSchema: 'ProjectList' },
      { id: 'tenant-5', method: 'POST', path: '/v1/tenants/{id}/members', description: 'Invite a member', auth: 'oidc', status: '201', requestSchema: 'InviteRequest', responseSchema: 'Member' },
      { id: 'tenant-6', method: 'DELETE', path: '/v1/tenants/{id}/members/{member_id}', description: 'Remove a member', auth: 'oidc', status: '204' },
      { id: 'tenant-7', method: 'GET', path: '/v1/tenants/{id}/audit', description: 'Tenant-scoped audit log', auth: 'oidc', status: '200', responseSchema: 'AuditPage' },
      { id: 'tenant-8', method: 'POST', path: '/v1/auth/sso/callback', description: 'OIDC SSO callback (undocumented)', auth: 'none', status: '200' },
      { id: 'tenant-9', method: 'POST', path: '/v1/auth/saml/acs', description: 'SAML assertion consumer (undocumented)', auth: 'none', status: '200' },
    ],
  },
  {
    id: 'svc-orchestrator',
    name: 'Workflow Orchestrator',
    version: 'v3.0.0',
    icon: 'Workflow',
    endpointCount: 8,
    documented: 8,
    avgResponseMs: 312,
    errorRate: 0.014,
    breakingSinceLast: 0,
    lastUpdated: '2026-06-24T09:00:00Z',
    status: 'documented',
    openapiUrl: '/specs/orchestrator.openapi.yaml',
    endpoints: [
      { id: 'orch-1', method: 'POST', path: '/v1/runs', description: 'Start a new workflow run', auth: 'oidc', status: '201', requestSchema: 'RunCreate', responseSchema: 'Run' },
      { id: 'orch-2', method: 'GET', path: '/v1/runs/{id}', description: 'Get a run', auth: 'oidc', status: '200', responseSchema: 'Run' },
      { id: 'orch-3', method: 'POST', path: '/v1/runs/{id}/approve', description: 'Record an approval gate transition', auth: 'oidc', status: '200', requestSchema: 'ApprovalRequest', responseSchema: 'Approval' },
      { id: 'orch-4', method: 'POST', path: '/v1/runs/{id}/cancel', description: 'Cancel a running workflow', auth: 'oidc', status: '204' },
      { id: 'orch-5', method: 'GET', path: '/v1/runs/{id}/timeline', description: 'Run timeline (steps, approvals, retries)', auth: 'oidc', status: '200', responseSchema: 'Timeline' },
      { id: 'orch-6', method: 'GET', path: '/v1/workflows', description: 'List workflows', auth: 'oidc', status: '200', responseSchema: 'WorkflowList' },
      { id: 'orch-7', method: 'POST', path: '/v1/workflows', description: 'Publish a workflow definition', auth: 'oidc', status: '201', requestSchema: 'WorkflowCreate', responseSchema: 'Workflow' },
      { id: 'orch-8', method: 'POST', path: '/v1/runs/{id}/retry', description: 'Retry a failed step', auth: 'oidc', status: '202', responseSchema: 'Run' },
    ],
  },
  {
    id: 'svc-knowledge',
    name: 'Knowledge Graph Service',
    version: 'v1.2.0',
    icon: 'Network',
    endpointCount: 7,
    documented: 3,
    avgResponseMs: 89,
    errorRate: 0.008,
    breakingSinceLast: 0,
    lastUpdated: '2026-06-15T12:45:00Z',
    status: 'undocumented',
    openapiUrl: '/specs/knowledge.openapi.yaml',
    endpoints: [
      { id: 'kg-1', method: 'POST', path: '/v1/graph/nodes', description: 'Create a knowledge graph node (undocumented)', auth: 'oidc', status: '201' },
      { id: 'kg-2', method: 'POST', path: '/v1/graph/edges', description: 'Create an edge (undocumented)', auth: 'oidc', status: '201' },
      { id: 'kg-3', method: 'GET', path: '/v1/graph/query', description: 'Cypher-like query (undocumented)', auth: 'oidc', status: '200' },
      { id: 'kg-4', method: 'POST', path: '/v1/search', description: 'Hybrid lexical + semantic search', auth: 'oidc', status: '200', requestSchema: 'SearchRequest', responseSchema: 'SearchResult' },
      { id: 'kg-5', method: 'GET', path: '/v1/search/embeddings/{id}', description: 'Fetch an embedding by id', auth: 'oidc', status: '200', responseSchema: 'Embedding' },
      { id: 'kg-6', method: 'POST', path: '/v1/index/rebuild', description: 'Rebuild the lexical index', auth: 'oidc', status: '202', responseSchema: 'IndexJob' },
      { id: 'kg-7', method: 'GET', path: '/v1/graph/{tenant_id}/neighborhood', description: 'Ego-graph around a node', auth: 'oidc', status: '200', responseSchema: 'Neighborhood' },
    ],
  },
];

export const MOCK_CONTRACTS: ReadonlyArray<APIContract> = MOCK_SERVICES.map((s) => ({
  id: `contract-${s.id}`,
  title: `${s.name} API`,
  kind: 'openapi' as const,
  service: s.name,
  version: s.version,
  owner: 'platform-team',
  updatedAt: s.lastUpdated,
  source: s.endpoints
    .map((e) => `${e.method.toLowerCase()} ${e.path}`)
    .join('\n'),
  status: s.status === 'undocumented' ? 'draft' : s.status === 'documented' ? 'published' : 'draft',
}));

const epic1Children: ReadonlyArray<TaskNode> = [
  {
    id: 'task-1-1',
    title: 'Define PAL interface contract',
    estimateHours: 8,
    status: 'done',
    children: [
      { id: 'task-1-1-1', title: 'Type unions for provider responses', estimateHours: 3, status: 'done', children: [] },
      { id: 'task-1-1-2', title: 'Streaming shape', estimateHours: 5, status: 'done', children: [] },
    ],
  },
  {
    id: 'task-1-2',
    title: 'Implement OpenAI adapter',
    estimateHours: 16,
    status: 'done',
    children: [
      { id: 'task-1-2-1', title: 'Chat completions', estimateHours: 6, status: 'done', children: [] },
      { id: 'task-1-2-2', title: 'Embeddings', estimateHours: 4, status: 'done', children: [] },
      { id: 'task-1-2-3', title: 'Tool use + JSON mode', estimateHours: 6, status: 'done', children: [] },
    ],
  },
  {
    id: 'task-1-3',
    title: 'Implement Anthropic adapter',
    estimateHours: 16,
    status: 'in_progress',
    children: [
      { id: 'task-1-3-1', title: 'Chat completions', estimateHours: 8, status: 'done', children: [] },
      { id: 'task-1-3-2', title: 'Tool use', estimateHours: 8, status: 'in_progress', children: [] },
    ],
  },
  {
    id: 'task-1-4',
    title: 'Cost attribution middleware',
    estimateHours: 12,
    status: 'in_progress',
    children: [],
  },
  {
    id: 'task-1-5',
    title: 'Mock provider for local dev',
    estimateHours: 4,
    status: 'todo',
    children: [],
  },
];

const epic2Children: ReadonlyArray<TaskNode> = [
  {
    id: 'task-2-1',
    title: 'Tenant RLS policies',
    estimateHours: 12,
    status: 'done',
    children: [
      { id: 'task-2-1-1', title: 'Policy generator from schema', estimateHours: 8, status: 'done', children: [] },
      { id: 'task-2-1-2', title: 'Migration helper', estimateHours: 4, status: 'done', children: [] },
    ],
  },
  {
    id: 'task-2-2',
    title: 'ORM tenant middleware',
    estimateHours: 16,
    status: 'done',
    children: [],
  },
  {
    id: 'task-2-3',
    title: 'Admin bypass role',
    estimateHours: 8,
    status: 'in_progress',
    children: [],
  },
  {
    id: 'task-2-4',
    title: 'Cross-tenant query guard',
    estimateHours: 6,
    status: 'todo',
    children: [],
  },
  {
    id: 'task-2-5',
    title: 'Tenant migration playbook',
    estimateHours: 10,
    status: 'todo',
    children: [],
  },
  {
    id: 'task-2-6',
    title: 'Per-tenant audit page',
    estimateHours: 14,
    status: 'blocked',
    children: [],
  },
];

export const MOCK_TASK_BREAKDOWNS: ReadonlyArray<TaskBreakdown> = [
  {
    id: 'epic-pal',
    title: 'Epic: Provider Abstraction Layer',
    source: 'ADR-001',
    totalEstimateHours: epic1Children.reduce((sum, t) => sum + t.estimateHours, 0),
    tree: {
      id: 'task-pal-0',
      title: 'Provider Abstraction Layer',
      estimateHours: epic1Children.reduce((sum, t) => sum + t.estimateHours, 0),
      status: 'in_progress',
      children: epic1Children,
    },
  },
  {
    id: 'epic-multitenant',
    title: 'Epic: Multi-tenant Isolation',
    source: 'ADR-002',
    totalEstimateHours: epic2Children.reduce((sum, t) => sum + t.estimateHours, 0),
    tree: {
      id: 'task-multi-0',
      title: 'Multi-tenant Isolation',
      estimateHours: epic2Children.reduce((sum, t) => sum + t.estimateHours, 0),
      status: 'in_progress',
      children: epic2Children,
    },
  },
];

export const MOCK_RISKS: ReadonlyArray<Risk> = [
  {
    id: 'risk-001',
    title: 'Provider outage cascades to all agents',
    likelihood: 3,
    impact: 5,
    owner: 'platform-team',
    mitigation: 'Implement circuit breaker + multi-provider fallback in PAL',
    status: 'mitigating',
  },
  {
    id: 'risk-002',
    title: 'Tenant data leak across RLS bypass role',
    likelihood: 2,
    impact: 5,
    owner: 'security-team',
    mitigation: 'Restrict bypass to scheduled jobs only, audit every use',
    status: 'open',
  },
  {
    id: 'risk-003',
    title: 'Approval gate bypass via misconfigured workflow',
    likelihood: 2,
    impact: 4,
    owner: 'governance-team',
    mitigation: 'Hard enforcement at orchestrator (ADR-005)',
    status: 'mitigating',
  },
  {
    id: 'risk-004',
    title: 'Embedding drift breaks semantic search',
    likelihood: 3,
    impact: 3,
    owner: 'knowledge-team',
    mitigation: 'Quarterly embedding model evaluation; reindex on score drop',
    status: 'open',
  },
  {
    id: 'risk-005',
    title: 'Cost overrun from runaway agent loop',
    likelihood: 4,
    impact: 3,
    owner: 'platform-team',
    mitigation: 'Per-tenant budget cap; auto-pause on threshold',
    status: 'mitigating',
  },
];

export const MOCK_RISK_REGISTERS: ReadonlyArray<RiskRegister> = [
  {
    id: 'register-platform',
    title: 'Platform Risks',
    source: 'ADR-001, ADR-005',
    updatedAt: '2026-06-22T10:00:00Z',
    risks: MOCK_RISKS.filter((r) => ['risk-001', 'risk-005'].includes(r.id)),
  },
  {
    id: 'register-security',
    title: 'Security Risks',
    source: 'ADR-002, ADR-005',
    updatedAt: '2026-06-20T14:30:00Z',
    risks: MOCK_RISKS.filter((r) => ['risk-002', 'risk-003'].includes(r.id)),
  },
  {
    id: 'register-knowledge',
    title: 'Knowledge Layer Risks',
    source: 'ADR-004',
    updatedAt: '2026-06-18T11:00:00Z',
    risks: MOCK_RISKS.filter((r) => r.id === 'risk-004'),
  },
];

export const MOCK_VERSIONS: ReadonlyArray<ArchitectureVersion> = [
  {
    version: 'v2.4',
    releasedAt: '2026-06-24T00:00:00Z',
    highlights: [
      'Promoted ADR-005 to "proposed" — approval gate enforcement spec',
      'New Tenant Identity Service endpoint: GET /v1/tenants/{id}/audit',
      'Tech Radar: React Flow promoted from "Trial" to "Adopt"',
      'Sunset notice: GET /v1/auth/legacy-token (replaced by OIDC)',
    ],
  },
  {
    version: 'v2.3',
    releasedAt: '2026-05-30T00:00:00Z',
    highlights: [
      'Promoted ADR-001, ADR-002, ADR-003 to "approved"',
      'Provider Abstraction Layer reaches v1.4 — OpenAI, Anthropic, Bedrock, vLLM adapters',
      'Per-tenant RLS policies enabled on 9 tables',
      'Tech Radar: LiteLLM moved to "Hold" (incompatible with cost attribution goals)',
    ],
  },
  {
    version: 'v2.2',
    releasedAt: '2026-05-02T00:00:00Z',
    highlights: [
      'Knowledge Graph Service v1.2 ships hybrid lexical + semantic retrieval',
      'Connector framework GA — first connector is GitHub, Bitbucket in progress',
      'Audit Timeline component adopted across all centers',
    ],
  },
  {
    version: 'v2.1',
    releasedAt: '2026-04-08T00:00:00Z',
    highlights: [
      'React Flow adopted as default visualization framework (ADR-003)',
      'Architecture Center modernized — 9 tabs, bento overview dashboard',
      'Cross-tab navigation chips added (ADR ↔ Task ↔ Risk ↔ API)',
    ],
  },
  {
    version: 'v2.0',
    releasedAt: '2026-03-15T00:00:00Z',
    highlights: [
      'Forge OS GA — released from Paperclip legacy',
      'Eight constitutional rules locked',
      'Tech Radar initialized with 24 entries',
    ],
  },
];

/** Traceability graph spanning Requirements → ADRs → Tasks → Code → Tests. */
export const MOCK_TRACEABILITY: TraceabilityGraph = {
  id: 'tg-platform',
  title: 'Platform Traceability',
  nodes: [
    // Requirements
    { id: 'req-1', label: 'REQ: Multi-vendor LLM', kind: 'requirement', x: 60, y: 60 },
    { id: 'req-2', label: 'REQ: Tenant isolation', kind: 'requirement', x: 60, y: 160 },
    { id: 'req-3', label: 'REQ: Interactive viz', kind: 'requirement', x: 60, y: 260 },
    { id: 'req-4', label: 'REQ: Approval gating', kind: 'requirement', x: 60, y: 360 },
    // ADRs
    { id: 'adr-1', label: 'ADR-001', kind: 'adr', x: 240, y: 60 },
    { id: 'adr-2', label: 'ADR-002', kind: 'adr', x: 240, y: 160 },
    { id: 'adr-3', label: 'ADR-003', kind: 'adr', x: 240, y: 260 },
    { id: 'adr-5', label: 'ADR-005', kind: 'adr', x: 240, y: 360 },
    // Tasks
    { id: 'task-1', label: 'PAL adapters', kind: 'task', x: 420, y: 60 },
    { id: 'task-2', label: 'RLS policies', kind: 'task', x: 420, y: 160 },
    { id: 'task-3', label: 'OIDC flow', kind: 'task', x: 420, y: 260 },
    { id: 'task-4', label: 'Approval gate', kind: 'task', x: 420, y: 360 },
    // Tests
    { id: 'test-1', label: 'Adapter contract', kind: 'test', x: 600, y: 60 },
    { id: 'test-2', label: 'Tenant isolation suite', kind: 'test', x: 600, y: 160 },
    { id: 'test-3', label: 'Viz a11y', kind: 'test', x: 600, y: 260 },
    { id: 'test-4', label: 'Bypass resistance', kind: 'test', x: 600, y: 360 },
  ],
  edges: [
    { id: 'e-1', source: 'req-1', target: 'adr-1', label: 'drives' },
    { id: 'e-2', source: 'req-2', target: 'adr-2', label: 'drives' },
    { id: 'e-3', source: 'req-3', target: 'adr-3', label: 'drives' },
    { id: 'e-4', source: 'req-4', target: 'adr-5', label: 'drives' },
    { id: 'e-5', source: 'adr-1', target: 'task-1', label: 'implements' },
    { id: 'e-6', source: 'adr-2', target: 'task-2', label: 'implements' },
    { id: 'e-7', source: 'adr-3', target: 'task-3', label: 'implements' },
    { id: 'e-8', source: 'adr-5', target: 'task-4', label: 'implements' },
    { id: 'e-9', source: 'task-1', target: 'test-1', label: 'tests' },
    { id: 'e-10', source: 'task-2', target: 'test-2', label: 'tests' },
    { id: 'e-11', source: 'task-3', target: 'test-3', label: 'tests' },
    { id: 'e-12', source: 'task-4', target: 'test-4', label: 'tests' },
    // Cross links
    { id: 'e-13', source: 'adr-1', target: 'adr-2', label: 'depends on' },
    { id: 'e-14', source: 'adr-3', target: 'adr-1', label: 'uses' },
    { id: 'e-15', source: 'adr-5', target: 'adr-2', label: 'relies on' },
  ],
};

/** Tech radar — 4 quadrants × 4 rings */
export type TechRing = 'adopt' | 'trial' | 'assess' | 'hold';
export type TechQuadrant = 'languages' | 'tools' | 'platforms' | 'techniques';

export interface TechBlip {
  id: string;
  name: string;
  quadrant: TechQuadrant;
  ring: TechRing;
  description: string;
  rationale: string;
  owner: string;
  prevRing?: TechRing;
}

export const MOCK_TECH_RADAR: ReadonlyArray<TechBlip> = [
  // Languages & Frameworks
  { id: 'react-flow', name: 'React Flow', quadrant: 'languages', ring: 'adopt', description: 'Node-edge visualization library', rationale: 'Used across all centers; supports interactive editing', owner: 'design-team', prevRing: 'trial' },
  { id: 'nextjs', name: 'Next.js 15', quadrant: 'languages', ring: 'adopt', description: 'Frontend framework', rationale: 'App Router stable; RSC adoption complete', owner: 'frontend-team' },
  { id: 'fastapi', name: 'FastAPI', quadrant: 'languages', ring: 'adopt', description: 'Backend HTTP framework', rationale: 'Pydantic v2 + async story is best in class', owner: 'platform-team' },
  { id: 'remix', name: 'Remix', quadrant: 'languages', ring: 'hold', description: 'Alternative frontend framework', rationale: 'No migration plans; Next.js is the locked choice', owner: 'frontend-team', prevRing: 'assess' },

  // Tools
  { id: 'langgraph', name: 'LangGraph', quadrant: 'tools', ring: 'adopt', description: 'Agent orchestration runtime', rationale: 'Stateful graph primitives fit workflow model', owner: 'agent-team' },
  { id: 'litellm', name: 'LiteLLM', quadrant: 'tools', ring: 'hold', description: 'LLM proxy library', rationale: 'Sidecar pattern conflicts with PAL goals', owner: 'platform-team', prevRing: 'trial' },
  { id: 'pgvector', name: 'pgvector', quadrant: 'tools', ring: 'adopt', description: 'Postgres vector extension', rationale: 'Hybrid retrieval without new infrastructure', owner: 'knowledge-team', prevRing: 'trial' },
  { id: 'sentry', name: 'Sentry', quadrant: 'tools', ring: 'trial', description: 'Error tracking', rationale: 'POC successful; rollout to backend services next', owner: 'platform-team' },

  // Platforms
  { id: 'postgres', name: 'PostgreSQL 17', quadrant: 'platforms', ring: 'adopt', description: 'Primary OLTP database', rationale: 'RLS + pgvector + JSONB covers 95% of storage needs', owner: 'data-team' },
  { id: 'redis', name: 'Redis', quadrant: 'platforms', ring: 'adopt', description: 'Pub/Sub + cache', rationale: 'Used for workflow event bus + semantic cache', owner: 'platform-team' },
  { id: 'keycloak', name: 'Keycloak', quadrant: 'platforms', ring: 'adopt', description: 'Identity provider', rationale: 'OIDC + SAML + RBAC in one server', owner: 'security-team' },
  { id: 'aws-bedrock', name: 'AWS Bedrock', quadrant: 'platforms', ring: 'trial', description: 'Managed model gateway', rationale: 'Adapting as an alternative provider in PAL', owner: 'platform-team' },

  // Techniques
  { id: 'rls', name: 'Row-level security', quadrant: 'techniques', ring: 'adopt', description: 'Tenant isolation pattern', rationale: 'Cheaper than schema-per-tenant at our scale', owner: 'platform-team', prevRing: 'trial' },
  { id: 'event-sourcing', name: 'Event sourcing', quadrant: 'techniques', ring: 'assess', description: 'Append-only audit log', rationale: 'Useful for approval gate timeline; trade-offs unclear', owner: 'governance-team' },
  { id: 'mcp', name: 'Model Context Protocol', quadrant: 'techniques', ring: 'trial', description: 'Tool call interface standard', rationale: 'Evaluating for connector framework parity', owner: 'integration-team' },
  { id: 'rag', name: 'Retrieval-augmented generation', quadrant: 'techniques', ring: 'adopt', description: 'Grounded generation', rationale: 'Default pattern for knowledge-grounded agents', owner: 'knowledge-team' },
];

/** Architecture diagram nodes/edges for the Diagrams tab. */
export interface DiagramNode {
  id: string;
  label: string;
  layer: 'user' | 'gateway' | 'service' | 'data' | 'external';
  x: number;
  y: number;
  details: string;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface C4Diagram {
  id: string;
  name: string;
  level: 'context' | 'container' | 'component' | 'dataflow' | 'sequence';
  description: string;
  nodes: ReadonlyArray<DiagramNode>;
  edges: ReadonlyArray<DiagramEdge>;
}

export const MOCK_DIAGRAMS: ReadonlyArray<C4Diagram> = [
  {
    id: 'c4-context',
    name: 'System Context (C4 Level 1)',
    level: 'context',
    description: 'How users and external systems interact with Forge OS.',
    nodes: [
      { id: 'user', label: 'Engineering Lead', layer: 'user', x: 100, y: 180, details: 'Primary user — defines ADRs, approves gates.' },
      { id: 'gateway', label: 'Forge Gateway', layer: 'gateway', x: 320, y: 180, details: 'OIDC SSO, rate limiting, audit.' },
      { id: 'pal', label: 'Forge OS', layer: 'service', x: 540, y: 180, details: 'Workflow orchestration + knowledge graph.' },
      { id: 'github', label: 'GitHub', layer: 'external', x: 760, y: 100, details: 'Connector — code, PRs, webhooks.' },
      { id: 'keycloak', label: 'Keycloak', layer: 'external', x: 760, y: 260, details: 'OIDC + SAML identity provider.' },
    ],
    edges: [
      { id: 'e1', source: 'user', target: 'gateway', label: 'HTTPS' },
      { id: 'e2', source: 'gateway', target: 'pal', label: 'gRPC' },
      { id: 'e3', source: 'pal', target: 'github', label: 'REST + Webhook' },
      { id: 'e4', source: 'gateway', target: 'keycloak', label: 'OIDC' },
    ],
  },
  {
    id: 'c4-container',
    name: 'Container Diagram (C4 Level 2)',
    level: 'container',
    description: 'Forge OS decomposed into deployable containers.',
    nodes: [
      { id: 'dashboard', label: 'Next.js Dashboard', layer: 'user', x: 80, y: 80, details: 'apps/forge — React 19 + TanStack Query.' },
      { id: 'api', label: 'FastAPI Backend', layer: 'service', x: 80, y: 220, details: 'Python 3.13 + Pydantic v2 + SQLAlchemy 2.x.' },
      { id: 'orchestrator', label: 'Workflow Orchestrator', layer: 'service', x: 80, y: 360, details: 'LangGraph + step state machines.' },
      { id: 'pal', label: 'Provider Abstraction Layer', layer: 'service', x: 360, y: 360, details: 'Adapters for OpenAI, Anthropic, Bedrock, vLLM.' },
      { id: 'kg', label: 'Knowledge Graph Service', layer: 'service', x: 360, y: 220, details: 'pgvector + hybrid lexical/semantic retrieval.' },
      { id: 'postgres', label: 'PostgreSQL 17', layer: 'data', x: 600, y: 220, details: 'RLS + pgvector + JSONB.' },
      { id: 'redis', label: 'Redis', layer: 'data', x: 600, y: 360, details: 'Pub/Sub for workflow events; semantic cache.' },
    ],
    edges: [
      { id: 'c1', source: 'dashboard', target: 'api', label: 'HTTPS' },
      { id: 'c2', source: 'api', target: 'orchestrator', label: 'internal' },
      { id: 'c3', source: 'orchestrator', target: 'pal', label: 'chat' },
      { id: 'c4', source: 'orchestrator', target: 'kg', label: 'query' },
      { id: 'c5', source: 'kg', target: 'postgres', label: 'SQL+RLS' },
      { id: 'c6', source: 'orchestrator', target: 'redis', label: 'pub/sub' },
      { id: 'c7', source: 'pal', target: 'redis', label: 'cache' },
    ],
  },
  {
    id: 'c4-dataflow',
    name: 'Data Flow — Architecture Center page load',
    level: 'dataflow',
    description: 'What happens when the user opens /architecture.',
    nodes: [
      { id: 'page', label: 'page.tsx', layer: 'user', x: 80, y: 180, details: 'Client component — fetches via /api/proxy.' },
      { id: 'proxy', label: '/api/proxy/[...path]', layer: 'gateway', x: 280, y: 180, details: 'Forwards to orchestrator stub.' },
      { id: 'stub', label: 'Orchestrator Stub', layer: 'service', x: 480, y: 180, details: 'bin/orchestrator-stub.py — returns 6 ADRs + fixtures.' },
      { id: 'cache', label: 'Redis', layer: 'data', x: 680, y: 100, details: 'Caches ADR list (5min TTL).' },
      { id: 'pg', label: 'Postgres', layer: 'data', x: 680, y: 260, details: 'Source of truth for ADRs (RLS scoped).' },
    ],
    edges: [
      { id: 'd1', source: 'page', target: 'proxy', label: 'GET /v1/architecture/adrs' },
      { id: 'd2', source: 'proxy', target: 'stub', label: 'forward' },
      { id: 'd3', source: 'stub', target: 'cache', label: 'lookup' },
      { id: 'd4', source: 'stub', target: 'pg', label: 'fallback' },
    ],
  },
];

export interface ArchitectureActivity {
  id: string;
  type: 'adr' | 'api' | 'task' | 'risk' | 'version' | 'diagram';
  verb: string;
  subject: string;
  actor: string;
  at: string;
}

export const MOCK_ACTIVITY: ReadonlyArray<ArchitectureActivity> = [
  { id: 'act-1', type: 'adr', verb: 'promoted', subject: 'ADR-001 to approved', actor: 'platform-team', at: '2026-06-12T14:22:00Z' },
  { id: 'act-2', type: 'version', verb: 'released', subject: 'v2.4', actor: 'release-bot', at: '2026-06-24T00:00:00Z' },
  { id: 'act-3', type: 'api', verb: 'synced OpenAPI spec for', subject: 'Tenant Identity Service', actor: 'github-bot', at: '2026-06-22T10:00:00Z' },
  { id: 'act-4', type: 'risk', verb: 'opened', subject: 'risk-005 cost overrun', actor: 'platform-team', at: '2026-06-22T11:15:00Z' },
  { id: 'act-5', type: 'task', verb: 'completed', subject: 'task-1-3-1 Anthropic chat', actor: 'agent-team', at: '2026-06-21T17:30:00Z' },
  { id: 'act-6', type: 'adr', verb: 'submitted for review', subject: 'ADR-005', actor: 'governance-team', at: '2026-06-21T08:30:00Z' },
  { id: 'act-7', type: 'diagram', verb: 'regenerated', subject: 'System Context', actor: 'design-team', at: '2026-06-20T14:00:00Z' },
  { id: 'act-8', type: 'api', verb: 'added endpoint', subject: 'GET /v1/tenants/{id}/audit', actor: 'security-team', at: '2026-06-19T16:00:00Z' },
  { id: 'act-9', type: 'task', verb: 'started', subject: 'task-2-3 admin bypass role', actor: 'platform-team', at: '2026-06-19T10:00:00Z' },
  { id: 'act-10', type: 'risk', verb: 'mitigated', subject: 'risk-003 approval gate bypass', actor: 'governance-team', at: '2026-06-18T15:00:00Z' },
];

/** Health scorecard inputs — derived from the fixtures above. */
export function computeHealth(): {
  overall: number;
  adrs: number;
  apis: number;
  tasks: number;
  risks: number;
  coverage: number;
} {
  const totalAdrs = MOCK_ADRS_WITH_META.length;
  const approvedAdrs = MOCK_ADRS_WITH_META.filter((a) => a.status === 'approved').length;
  const totalEndpoints = MOCK_SERVICES.reduce((s, svc) => s + svc.endpointCount, 0);
  const documentedEndpoints = MOCK_SERVICES.reduce((s, svc) => s + svc.documented, 0);
  const totalTasks = MOCK_TASK_BREAKDOWNS.reduce(
    (s, b) => s + countTasks(b.tree),
    0,
  );
  const doneTasks = MOCK_TASK_BREAKDOWNS.reduce(
    (s, b) => s + countDoneTasks(b.tree),
    0,
  );
  const openRisks = MOCK_RISKS.filter((r) => r.status !== 'closed').length;
  const totalRisks = MOCK_RISKS.length;

  const adrs = Math.round((approvedAdrs / totalAdrs) * 100);
  const apis = Math.round((documentedEndpoints / totalEndpoints) * 100);
  const tasks = Math.round((doneTasks / totalTasks) * 100);
  const risks = Math.round(((totalRisks - openRisks) / totalRisks) * 100);
  const coverage = Math.round((MOCK_TRACEABILITY.edges.length / (MOCK_TRACEABILITY.nodes.length * 1.5)) * 100);

  const overall = Math.round((adrs + apis + tasks + risks + coverage) / 5);
  return { overall, adrs, apis, tasks, risks, coverage };
}

function countTasks(node: TaskNode): number {
  return 1 + node.children.reduce((s, c) => s + countTasks(c), 0);
}
function countDoneTasks(node: TaskNode): number {
  return (node.status === 'done' ? 1 : 0) + node.children.reduce((s, c) => s + countDoneTasks(c), 0);
}

/** 12-week decision velocity sparkline series. */
export const MOCK_DECISION_VELOCITY: ReadonlyArray<number> = [
  1, 2, 0, 3, 1, 2, 4, 2, 3, 5, 2, 6,
];