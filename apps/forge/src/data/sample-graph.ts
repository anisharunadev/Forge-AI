/**
 * Sample knowledge graph data — drives the standalone /knowledge-center
 * experience when the orchestrator is offline (no /v1/knowledge-center
 * nodes/edges available) and is also the seed for local development.
 *
 * 14 node kinds (Repo → Command) covering every artifact type in the
 * Forge taxonomy, and 6 edge kinds (references, depends_on, blocks,
 * implements, supersedes, related_to).
 *
 * All nodes carry an `author`, `tags`, `status`, optional `preview`,
 * and a deterministic seed so canvas positions remain stable across
 * re-renders (the force simulation uses these as starting points only).
 */

export type NodeKind =
  | 'Repo'
  | 'Service'
  | 'Component'
  | 'ADR'
  | 'Idea'
  | 'Risk'
  | 'Task'
  | 'Test'
  | 'Agent'
  | 'Run'
  | 'Story'
  | 'Epic'
  | 'Command'
  | 'PRD';

export type EdgeKind =
  | 'references'
  | 'depends_on'
  | 'blocks'
  | 'implements'
  | 'supersedes'
  | 'related_to';

export interface SampleNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Seed coordinates for the force simulation starting layout. */
  seedX: number;
  seedY: number;
  author: { name: string; role: string; initials: string };
  updatedAt: string; // ISO
  tags: ReadonlyArray<string>;
  status?: string;
  preview: string;
  href: string;
}

export interface SampleEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** 1-3 — drives edge thickness in the renderer. */
  strength: 1 | 2 | 3;
}

export interface SampleGraph {
  nodes: ReadonlyArray<SampleNode>;
  edges: ReadonlyArray<SampleEdge>;
}

// ---- Author pool -----------------------------------------------------------

const AUTHORS = {
  aria: { name: 'Aria Patel', role: 'Staff Engineer', initials: 'AP' },
  devon: { name: 'Devon Yu', role: 'Engineering Lead', initials: 'DY' },
  sara: { name: 'Sara M.', role: 'Product Manager', initials: 'SM' },
  ravi: { name: 'Ravi Nair', role: 'Security Engineer', initials: 'RN' },
  mei: { name: 'Mei Lin', role: 'Designer', initials: 'ML' },
  alex: { name: 'Alex Soto', role: 'SRE', initials: 'AS' },
  kira: { name: 'Kira W.', role: 'Data Engineer', initials: 'KW' },
  noa: { name: 'Noa K.', role: 'AI Engineer', initials: 'NK' },
} as const;

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 24); // 2026-06-24 — matches design-system date
const daysAgo = (d: number) => new Date(now - d * DAY).toISOString();

// ---- Nodes (14 kinds × 3–5 each = 50+) ------------------------------------

export const SAMPLE_NODES: ReadonlyArray<SampleNode> = [
  // Repos (cyan) — 4
  { id: 'repo-forge-core', label: 'forge-core', kind: 'Repo', seedX: -380, seedY: -260, author: AUTHORS.devon, updatedAt: daysAgo(0), tags: ['platform', 'python'], status: 'active', preview: 'Multi-tenant platform runtime. FastAPI + SQLAlchemy + Alembic + pgvector. Owns tenant context, RBAC, audit log.', href: '/repos/forge-core' },
  { id: 'repo-forge-dashboard', label: 'forge-dashboard', kind: 'Repo', seedX: -340, seedY: -120, author: AUTHORS.aria, updatedAt: daysAgo(1), tags: ['ui', 'nextjs'], status: 'active', preview: 'Operator console — Next.js 15, React 19, shadcn/ui, TanStack Query, React Flow for visualizations.', href: '/repos/forge-dashboard' },
  { id: 'repo-forge-runtime', label: 'forge-runtime', kind: 'Repo', seedX: -380, seedY: 20, author: AUTHORS.noa, updatedAt: daysAgo(2), tags: ['agents', 'langgraph'], status: 'active', preview: 'LangGraph agent runtime + LiteLLM provider abstraction. Every LLM call routes through this package.', href: '/repos/forge-runtime' },
  { id: 'repo-forge-cli', label: 'forge-cli', kind: 'Repo', seedX: -340, seedY: 160, author: AUTHORS.devon, updatedAt: daysAgo(5), tags: ['cli'], status: 'maintained', preview: 'Local CLI: forge dev, forge ingest, forge agent. Wraps Docker Compose + CLI proxy.', href: '/repos/forge-cli' },

  // Services (green) — 4
  { id: 'svc-orchestrator', label: 'orchestrator', kind: 'Service', seedX: -80, seedY: -240, author: AUTHORS.devon, updatedAt: daysAgo(0), tags: ['core', 'python'], status: 'healthy', preview: 'Stateless FastAPI service that owns the workflow graph and routes tasks to the runtime.', href: '/services/orchestrator' },
  { id: 'svc-ingestion', label: 'ingestion', kind: 'Service', seedX: -60, seedY: -90, author: AUTHORS.kira, updatedAt: daysAgo(1), tags: ['python'], status: 'healthy', preview: 'Source connectors (GitHub, Jira, Notion) normalize payloads into the canonical knowledge graph.', href: '/services/ingestion' },
  { id: 'svc-policy', label: 'policy-engine', kind: 'Service', seedX: -60, seedY: 60, author: AUTHORS.ravi, updatedAt: daysAgo(2), tags: ['security'], status: 'healthy', preview: 'OPA sidecar that gates every cross-boundary action (architecture / security / deployment).', href: '/services/policy' },
  { id: 'svc-runtime-gateway', label: 'runtime-gateway', kind: 'Service', seedX: -80, seedY: 200, author: AUTHORS.noa, updatedAt: daysAgo(0), tags: ['litellm', 'gateway'], status: 'healthy', preview: 'Thin LiteLLM proxy — single egress point for every model provider. Records tokens + cost.', href: '/services/runtime-gateway' },

  // Components (cyan-light) — 4
  { id: 'comp-graph-builder', label: 'GraphBuilder', kind: 'Component', seedX: 180, seedY: -260, author: AUTHORS.noa, updatedAt: daysAgo(3), tags: ['react', 'visualization'], preview: 'React Flow wrapper that builds typed node/edge configs from the canonical schema.', href: '/components/graph-builder' },
  { id: 'comp-tenant-context', label: 'TenantContext', kind: 'Component', seedX: 220, seedY: -110, author: AUTHORS.devon, updatedAt: daysAgo(0), tags: ['multi-tenant'], preview: 'React context + server helpers that propagate tenant_id / project_id through render trees.', href: '/components/tenant-context' },
  { id: 'comp-audit-log', label: 'AuditLog', kind: 'Component', seedX: 200, seedY: 30, author: AUTHORS.ravi, updatedAt: daysAgo(4), tags: ['audit', 'compliance'], preview: 'Append-only log with semantic enrichment (artifact kind, action, agent, model).', href: '/components/audit-log' },
  { id: 'comp-rbac', label: 'RBACGuard', kind: 'Component', seedX: 220, seedY: 180, author: AUTHORS.ravi, updatedAt: daysAgo(6), tags: ['security'], preview: 'Declarative permission gates — `<RBACGuard action="run.execute">` wraps any subtree.', href: '/components/rbac' },

  // ADRs (violet) — 4
  { id: 'adr-tenant-isolation', label: 'ADR-014 · Tenant isolation', kind: 'ADR', seedX: 380, seedY: -260, author: AUTHORS.devon, updatedAt: daysAgo(7), tags: ['architecture', 'multi-tenant'], status: 'Accepted', preview: 'Every query, artifact, workflow, and audit row MUST carry tenant_id + project_id. Never optional, never nullable.', href: '/adrs/014' },
  { id: 'adr-model-agnostic', label: 'ADR-019 · Model-agnostic LLM layer', kind: 'ADR', seedX: 420, seedY: -110, author: AUTHORS.noa, updatedAt: daysAgo(11), tags: ['architecture', 'providers'], status: 'Accepted', preview: 'All LLM traffic routes through LiteLLM. No direct OpenAI/Anthropic/Gemini SDK imports anywhere.', href: '/adrs/019' },
  { id: 'adr-typed-artifacts', label: 'ADR-022 · Typed artifacts only', kind: 'ADR', seedX: 400, seedY: 30, author: AUTHORS.devon, updatedAt: daysAgo(14), tags: ['architecture'], status: 'Accepted', preview: 'Agents never produce free-form blobs. Everything is an ADR / API Contract / Risk Register / etc.', href: '/adrs/022' },
  { id: 'adr-local-graph', label: 'ADR-027 · Local-graph navigation', kind: 'ADR', seedX: 420, seedY: 180, author: AUTHORS.aria, updatedAt: daysAgo(2), tags: ['ux', 'obsidian-style'], status: 'Draft', preview: 'Borrow Obsidian\'s backlinks model — every node surfaces incoming + outgoing references; local graph view at N hops.', href: '/adrs/027' },

  // Ideas (amber) — 3
  { id: 'idea-time-travel', label: 'Idea · Time-travel debug', kind: 'Idea', seedX: 480, seedY: -300, author: AUTHORS.noa, updatedAt: daysAgo(9), tags: ['debug', 'agents'], status: 'scoring', preview: 'Replay a failed run step-by-step, branching from any prior node. Requires checkpoint persistence.', href: '/ideas/time-travel' },
  { id: 'idea-voice-copilot', label: 'Idea · Voice-first copilot', kind: 'Idea', seedX: 520, seedY: -150, author: AUTHORS.mei, updatedAt: daysAgo(20), tags: ['ux', 'voice'], status: 'discovery', preview: 'Speak a request, the copilot narrates its plan, then executes. Risks: hallucinations in TTS.', href: '/ideas/voice-copilot' },
  { id: 'idea-rag-pr', label: 'Idea · RAG over PRs', kind: 'Idea', seedX: 500, seedY: 0, author: AUTHORS.kira, updatedAt: daysAgo(3), tags: ['rag', 'github'], status: 'discovery', preview: 'Index every PR diff + review thread, expose as a semantic search for the Copilot.', href: '/ideas/rag-pr' },

  // Risks (rose) — 3
  { id: 'risk-pii-leak', label: 'Risk · PII leak via connector', kind: 'Risk', seedX: 480, seedY: 100, author: AUTHORS.ravi, updatedAt: daysAgo(1), tags: ['security', 'pii'], status: 'open', preview: 'Notion connector may pull sensitive pages if scope filter is misconfigured. Mitigation: policy gate + redaction job.', href: '/risks/pii-leak' },
  { id: 'risk-rate-limit', label: 'Risk · LiteLLM rate limit', kind: 'Risk', seedX: 520, seedY: 230, author: AUTHORS.alex, updatedAt: daysAgo(4), tags: ['reliability'], status: 'mitigated', preview: 'Bursty agents can exceed per-minute token quotas. Mitigation: token bucket + back-pressure queue.', href: '/risks/rate-limit' },
  { id: 'risk-tenant-mix', label: 'Risk · Cross-tenant cache hit', kind: 'Risk', seedX: 460, seedY: 320, author: AUTHORS.ravi, updatedAt: daysAgo(18), tags: ['security', 'cache'], status: 'monitoring', preview: 'Shared Redis layer could surface another tenant\'s response if the key omits tenant_id. Audit pending.', href: '/risks/tenant-mix' },

  // Tasks (yellow) — 4
  { id: 'task-knowledge-cnav', label: 'Task · Knowledge graph nav', kind: 'Task', seedX: 260, seedY: 280, author: AUTHORS.aria, updatedAt: daysAgo(0), tags: ['ui', 'step-27'], status: 'in_progress', preview: 'Rebuild /knowledge-center with Obsidian-style backlinks + local graph view. Spec lives in step-27.md.', href: '/tasks/knowledge-nav' },
  { id: 'task-rbac-fine', label: 'Task · Fine-grained RBAC', kind: 'Task', seedX: 200, seedY: 360, author: AUTHORS.ravi, updatedAt: daysAgo(2), tags: ['security'], status: 'todo', preview: 'Replace role-only checks with action+resource RBAC. Requires migration of existing decorators.', href: '/tasks/rbac-fine' },
  { id: 'task-time-travel', label: 'Task · Checkpoint persistence', kind: 'Task', seedX: 140, seedY: 320, author: AUTHORS.noa, updatedAt: daysAgo(1), tags: ['debug', 'agents'], status: 'in_progress', preview: 'Persist LangGraph checkpoints to Postgres so runs can resume and replay.', href: '/tasks/checkpoint' },
  { id: 'task-voice-mvp', label: 'Task · Voice copilot MVP', kind: 'Task', seedX: 80, seedY: 380, author: AUTHORS.mei, updatedAt: daysAgo(7), tags: ['voice'], status: 'backlog', preview: 'STT → Copilot → TTS loop. Pick a provider (ElevenLabs vs. OpenAI).', href: '/tasks/voice-mvp' },

  // Tests (cyan-bright) — 3
  { id: 'test-policy-gate', label: 'Test · Policy gate', kind: 'Test', seedX: -240, seedY: 280, author: AUTHORS.ravi, updatedAt: daysAgo(2), tags: ['security', 'pytest'], status: 'passing', preview: 'Verifies the policy engine blocks every cross-boundary action when approval gate is missing.', href: '/tests/policy-gate' },
  { id: 'test-tenant-isolation', label: 'Test · Tenant isolation', kind: 'Test', seedX: -300, seedY: 360, author: AUTHORS.devon, updatedAt: daysAgo(1), tags: ['multi-tenant', 'pytest'], status: 'passing', preview: 'Cycles through every model + endpoint, confirms no record leaks across tenant boundaries.', href: '/tests/tenant-isolation' },
  { id: 'test-litellm-fallback', label: 'Test · LiteLLM fallback', kind: 'Test', seedX: -180, seedY: 360, author: AUTHORS.noa, updatedAt: daysAgo(3), tags: ['agents', 'pytest'], status: 'flaky', preview: 'Forces primary provider 429, confirms secondary picks up within SLA.', href: '/tests/litellm-fallback' },

  // Agents (indigo) — 3
  { id: 'agent-architect', label: 'Agent · architect', kind: 'Agent', seedX: -260, seedY: 60, author: AUTHORS.noa, updatedAt: daysAgo(0), tags: ['llm', 'claude'], status: 'enabled', preview: 'Reads Organization Knowledge, drafts ADRs + API Contracts. Routed through runtime-gateway.', href: '/agents/architect' },
  { id: 'agent-copilot', label: 'Agent · copilot', kind: 'Agent', seedX: -200, seedY: 200, author: AUTHORS.noa, updatedAt: daysAgo(0), tags: ['llm', 'interactive'], status: 'enabled', preview: 'In-app assistant. Uses tenant context + project intelligence for grounded answers.', href: '/agents/copilot' },
  { id: 'agent-tester', label: 'Agent · tester', kind: 'Agent', seedX: -260, seedY: -60, author: AUTHORS.noa, updatedAt: daysAgo(5), tags: ['llm', 'qa'], status: 'enabled', preview: 'Generates pytest cases from ADRs, runs them, reports coverage gaps back to the task board.', href: '/agents/tester' },

  // Runs (cyan-running) — 4
  { id: 'run-step-27-build', label: 'Run · step-27 build', kind: 'Run', seedX: 60, seedY: 260, author: AUTHORS.aria, updatedAt: daysAgo(0), tags: ['build'], status: 'running', preview: 'Active build for the knowledge-center rewrite. Agent: architect (planning) → coder (scaffold).', href: '/runs/step-27' },
  { id: 'run-onboard-acme', label: 'Run · onboard acme-corp', kind: 'Run', seedX: 0, seedY: 360, author: AUTHORS.devon, updatedAt: daysAgo(3), tags: ['onboarding'], status: 'completed', preview: 'Ingested acme-corp demo tenant. 247 nodes, 89 edges, 12 runs replayed.', href: '/runs/acme' },
  { id: 'run-policy-audit', label: 'Run · policy audit', kind: 'Run', seedX: 120, seedY: 380, author: AUTHORS.ravi, updatedAt: daysAgo(6), tags: ['security'], status: 'completed', preview: 'Cycled every ADR through the policy engine. Found 2 actions missing approval gates.', href: '/runs/policy-audit' },
  { id: 'run-voice-spike', label: 'Run · voice spike', kind: 'Run', seedX: -100, seedY: 400, author: AUTHORS.mei, updatedAt: daysAgo(9), tags: ['spike'], status: 'failed', preview: 'ElevenLabs TTS latency too high. Switching to OpenAI TTS for MVP.', href: '/runs/voice-spike' },

  // Stories (muted) — 3
  { id: 'story-kg-redesign', label: 'Story · KG redesign', kind: 'Story', seedX: 460, seedY: -200, author: AUTHORS.sara, updatedAt: daysAgo(4), tags: ['ux', 'obsidian'], status: 'in_progress', preview: 'As a platform engineer I want to navigate the knowledge graph like Obsidian so I can trace impact in 2 clicks.', href: '/stories/kg-redesign' },
  { id: 'story-rbac-v2', label: 'Story · RBAC v2', kind: 'Story', seedX: 500, seedY: 250, author: AUTHORS.sara, updatedAt: daysAgo(20), tags: ['security'], status: 'ready', preview: 'As an admin I want per-resource permissions so I can grant contractor access without elevating roles.', href: '/stories/rbac-v2' },
  { id: 'story-onboarding', label: 'Story · First-run onboarding', kind: 'Story', seedX: 540, seedY: 100, author: AUTHORS.sara, updatedAt: daysAgo(30), tags: ['growth'], status: 'shipped', preview: 'As a new tenant owner I want a 5-minute walkthrough so I can see value before configuring SSO.', href: '/stories/onboarding' },

  // Epics (violet-dark) — 3
  { id: 'epic-trust', label: 'Epic · Trust & Audit', kind: 'Epic', seedX: 360, seedY: 360, author: AUTHORS.sara, updatedAt: daysAgo(2), tags: ['strategic'], status: 'in_progress', preview: 'Q3 epic: full audit log + per-action approval gates + tenant-scoped search. Owns 4 ADRs.', href: '/epics/trust' },
  { id: 'epic-copilot', label: 'Epic · Copilot Everywhere', kind: 'Epic', seedX: 280, seedY: 410, author: AUTHORS.sara, updatedAt: daysAgo(8), tags: ['strategic'], status: 'in_progress', preview: 'In-app copilot + voice spike + IDE plugin. North star metric: weekly active operators.', href: '/epics/copilot' },
  { id: 'epic-observability', label: 'Epic · Observability', kind: 'Epic', seedX: 200, seedY: 430, author: AUTHORS.alex, updatedAt: daysAgo(11), tags: ['platform'], status: 'in_progress', preview: 'OTel tracing across every agent + connector. Token + cost per run, surfaced in dashboard.', href: '/epics/observability' },

  // Commands (indigo-light) — 3
  { id: 'cmd-ingest', label: 'forge ingest', kind: 'Command', seedX: -400, seedY: -340, author: AUTHORS.devon, updatedAt: daysAgo(15), tags: ['cli'], preview: 'CLI command — ingest a source (GitHub, Notion, ADR dir) into the knowledge graph.', href: '/commands/ingest' },
  { id: 'cmd-agent', label: 'forge agent', kind: 'Command', seedX: -400, seedY: -260, author: AUTHORS.noa, updatedAt: daysAgo(9), tags: ['cli'], preview: 'CLI command — spawn an interactive agent in the terminal. Reads .forge/agent.yml.', href: '/commands/agent' },
  { id: 'cmd-doctor', label: 'forge doctor', kind: 'Command', seedX: -400, seedY: -180, author: AUTHORS.alex, updatedAt: daysAgo(28), tags: ['cli'], preview: 'CLI command — diagnose tenant health, connector reachability, RBAC configuration.', href: '/commands/doctor' },

  // PRDs (amber-dark) — 3
  { id: 'prd-forge', label: 'PRD · Forge Agent OS', kind: 'PRD', seedX: 0, seedY: -340, author: AUTHORS.sara, updatedAt: daysAgo(60), tags: ['strategy'], status: 'approved', preview: 'Constitutional PRD. 8 rules + 6 architecture layers. Source of truth for the entire platform.', href: '/prds/forge' },
  { id: 'prd-copilot', label: 'PRD · Copilot', kind: 'PRD', seedX: 100, seedY: -340, author: AUTHORS.sara, updatedAt: daysAgo(35), tags: ['strategy'], status: 'approved', preview: 'Defines the Copilot persona, scope (in-app + voice), and the metric north star.', href: '/prds/copilot' },
  { id: 'prd-trust', label: 'PRD · Trust & Audit', kind: 'PRD', seedX: 200, seedY: -340, author: AUTHORS.ravi, updatedAt: daysAgo(28), tags: ['security'], status: 'review', preview: 'NFR-001..033. Every audit field is enumerated; cross-boundary gates are normative.', href: '/prds/trust' },
];

// ---- Edges (100+, mixed kinds) -------------------------------------------

export const SAMPLE_EDGES: ReadonlyArray<SampleEdge> = [
  // Architecture: PRDs → ADRs
  { id: 'e-001', source: 'prd-forge',     target: 'adr-tenant-isolation', kind: 'implements', strength: 3 },
  { id: 'e-002', source: 'prd-forge',     target: 'adr-model-agnostic',   kind: 'implements', strength: 3 },
  { id: 'e-003', source: 'prd-forge',     target: 'adr-typed-artifacts',  kind: 'implements', strength: 3 },
  { id: 'e-004', source: 'prd-copilot',   target: 'adr-local-graph',      kind: 'references', strength: 2 },
  { id: 'e-005', source: 'prd-trust',     target: 'adr-tenant-isolation', kind: 'implements', strength: 3 },
  { id: 'e-006', source: 'prd-trust',     target: 'risk-tenant-mix',      kind: 'references', strength: 2 },

  // ADRs → Repos / Services (the system implements them)
  { id: 'e-010', source: 'adr-tenant-isolation', target: 'svc-orchestrator',   kind: 'implements', strength: 3 },
  { id: 'e-011', source: 'adr-tenant-isolation', target: 'comp-tenant-context', kind: 'implements', strength: 3 },
  { id: 'e-012', source: 'adr-model-agnostic',   target: 'svc-runtime-gateway', kind: 'implements', strength: 3 },
  { id: 'e-013', source: 'adr-model-agnostic',   target: 'repo-forge-runtime',  kind: 'implements', strength: 3 },
  { id: 'e-014', source: 'adr-typed-artifacts',  target: 'svc-orchestrator',   kind: 'implements', strength: 3 },

  // Repos → Services (services live inside repos)
  { id: 'e-020', source: 'repo-forge-core',       target: 'svc-orchestrator',    kind: 'implements', strength: 2 },
  { id: 'e-021', source: 'repo-forge-core',       target: 'svc-policy',          kind: 'implements', strength: 2 },
  { id: 'e-022', source: 'repo-forge-runtime',    target: 'svc-runtime-gateway', kind: 'implements', strength: 2 },
  { id: 'e-023', source: 'repo-forge-runtime',    target: 'agent-architect',     kind: 'implements', strength: 2 },
  { id: 'e-024', source: 'repo-forge-runtime',    target: 'agent-copilot',       kind: 'implements', strength: 2 },
  { id: 'e-025', source: 'repo-forge-runtime',    target: 'agent-tester',        kind: 'implements', strength: 2 },
  { id: 'e-026', source: 'repo-forge-dashboard',  target: 'comp-graph-builder',  kind: 'implements', strength: 2 },
  { id: 'e-027', source: 'repo-forge-dashboard',  target: 'comp-tenant-context', kind: 'implements', strength: 2 },

  // Services depend on each other
  { id: 'e-030', source: 'svc-orchestrator', target: 'svc-ingestion',       kind: 'depends_on', strength: 2 },
  { id: 'e-031', source: 'svc-orchestrator', target: 'svc-policy',          kind: 'depends_on', strength: 3 },
  { id: 'e-032', source: 'svc-orchestrator', target: 'svc-runtime-gateway', kind: 'depends_on', strength: 3 },
  { id: 'e-033', source: 'svc-runtime-gateway', target: 'svc-policy',       kind: 'depends_on', strength: 2 },
  { id: 'e-034', source: 'svc-ingestion',    target: 'svc-policy',          kind: 'depends_on', strength: 1 },

  // Components depend on each other
  { id: 'e-040', source: 'comp-graph-builder', target: 'comp-tenant-context', kind: 'depends_on', strength: 2 },
  { id: 'e-041', source: 'comp-rbac',          target: 'comp-tenant-context', kind: 'depends_on', strength: 2 },
  { id: 'e-042', source: 'comp-audit-log',     target: 'comp-tenant-context', kind: 'depends_on', strength: 2 },
  { id: 'e-043', source: 'comp-rbac',          target: 'comp-audit-log',     kind: 'depends_on', strength: 1 },

  // Risks block tasks / services
  { id: 'e-050', source: 'risk-pii-leak',   target: 'svc-ingestion',       kind: 'blocks', strength: 3 },
  { id: 'e-051', source: 'risk-rate-limit', target: 'svc-runtime-gateway', kind: 'blocks', strength: 2 },
  { id: 'e-052', source: 'risk-tenant-mix', target: 'svc-orchestrator',    kind: 'blocks', strength: 3 },
  { id: 'e-053', source: 'risk-tenant-mix', target: 'test-tenant-isolation', kind: 'related_to', strength: 2 },

  // Ideas → Tasks (idea birthed a task)
  { id: 'e-060', source: 'idea-time-travel', target: 'task-time-travel',  kind: 'implements', strength: 3 },
  { id: 'e-061', source: 'idea-voice-copilot', target: 'task-voice-mvp',  kind: 'implements', strength: 2 },
  { id: 'e-062', source: 'idea-rag-pr',        target: 'task-knowledge-cnav', kind: 'related_to', strength: 1 },

  // Stories → Tasks / Epics
  { id: 'e-070', source: 'story-kg-redesign', target: 'task-knowledge-cnav', kind: 'implements', strength: 3 },
  { id: 'e-071', source: 'story-rbac-v2',     target: 'task-rbac-fine',      kind: 'implements', strength: 3 },
  { id: 'e-072', source: 'story-onboarding',  target: 'run-onboard-acme',    kind: 'related_to', strength: 2 },
  { id: 'e-073', source: 'epic-trust',        target: 'story-rbac-v2',       kind: 'implements', strength: 2 },
  { id: 'e-074', source: 'epic-trust',        target: 'task-rbac-fine',      kind: 'implements', strength: 2 },
  { id: 'e-075', source: 'epic-copilot',      target: 'task-voice-mvp',      kind: 'implements', strength: 2 },
  { id: 'e-076', source: 'epic-copilot',      target: 'agent-copilot',       kind: 'implements', strength: 2 },
  { id: 'e-077', source: 'epic-observability', target: 'comp-audit-log',     kind: 'implements', strength: 2 },

  // Tasks block / depend on each other
  { id: 'e-080', source: 'task-knowledge-cnav', target: 'task-rbac-fine',    kind: 'blocks', strength: 1 },
  { id: 'e-081', source: 'task-knowledge-cnav', target: 'task-time-travel',  kind: 'related_to', strength: 1 },
  { id: 'e-082', source: 'task-rbac-fine',      target: 'task-knowledge-cnav', kind: 'depends_on', strength: 1 },

  // Runs reference the artifacts they touched
  { id: 'e-090', source: 'run-step-27-build', target: 'task-knowledge-cnav', kind: 'references', strength: 3 },
  { id: 'e-091', source: 'run-step-27-build', target: 'agent-architect',     kind: 'references', strength: 2 },
  { id: 'e-092', source: 'run-step-27-build', target: 'repo-forge-dashboard', kind: 'references', strength: 2 },
  { id: 'e-093', source: 'run-onboard-acme',  target: 'svc-ingestion',       kind: 'references', strength: 2 },
  { id: 'e-094', source: 'run-onboard-acme',  target: 'story-onboarding',    kind: 'references', strength: 2 },
  { id: 'e-095', source: 'run-policy-audit',  target: 'svc-policy',          kind: 'references', strength: 3 },
  { id: 'e-096', source: 'run-policy-audit',  target: 'risk-tenant-mix',     kind: 'references', strength: 2 },
  { id: 'e-097', source: 'run-voice-spike',   target: 'idea-voice-copilot',  kind: 'references', strength: 2 },
  { id: 'e-098', source: 'run-voice-spike',   target: 'task-voice-mvp',      kind: 'references', strength: 2 },

  // Tests cover the components/services
  { id: 'e-100', source: 'test-policy-gate',       target: 'svc-policy',          kind: 'related_to', strength: 2 },
  { id: 'e-101', source: 'test-tenant-isolation',  target: 'comp-tenant-context', kind: 'references', strength: 3 },
  { id: 'e-102', source: 'test-tenant-isolation',  target: 'risk-tenant-mix',     kind: 'related_to', strength: 1 },
  { id: 'e-103', source: 'test-litellm-fallback',  target: 'svc-runtime-gateway', kind: 'references', strength: 3 },
  { id: 'e-104', source: 'test-litellm-fallback',  target: 'risk-rate-limit',     kind: 'related_to', strength: 2 },

  // ADR-027 supersedes earlier UX experiments
  { id: 'e-110', source: 'adr-local-graph', target: 'story-kg-redesign', kind: 'supersedes', strength: 2 },
  { id: 'e-111', source: 'adr-typed-artifacts', target: 'idea-rag-pr',   kind: 'related_to', strength: 1 },

  // Commands reference repos
  { id: 'e-120', source: 'cmd-ingest',  target: 'repo-forge-cli',      kind: 'references', strength: 2 },
  { id: 'e-121', source: 'cmd-agent',   target: 'repo-forge-cli',      kind: 'references', strength: 2 },
  { id: 'e-122', source: 'cmd-doctor',  target: 'repo-forge-cli',      kind: 'references', strength: 2 },
  { id: 'e-123', source: 'cmd-ingest',  target: 'svc-ingestion',       kind: 'references', strength: 2 },
  { id: 'e-124', source: 'cmd-agent',   target: 'agent-architect',     kind: 'references', strength: 2 },

  // Cross-graph relations — services ↔ components
  { id: 'e-130', source: 'svc-policy',     target: 'comp-rbac',          kind: 'implements', strength: 2 },
  { id: 'e-131', source: 'svc-orchestrator', target: 'comp-graph-builder', kind: 'depends_on', strength: 1 },
  { id: 'e-132', source: 'svc-orchestrator', target: 'comp-audit-log',   kind: 'depends_on', strength: 2 },

  // Self-aware connections (ADRs ↔ ADRs)
  { id: 'e-140', source: 'adr-typed-artifacts', target: 'adr-tenant-isolation', kind: 'related_to', strength: 1 },
  { id: 'e-141', source: 'adr-local-graph',    target: 'adr-model-agnostic',   kind: 'related_to', strength: 1 },
];

export const SAMPLE_GRAPH: SampleGraph = {
  nodes: SAMPLE_NODES,
  edges: SAMPLE_EDGES,
};