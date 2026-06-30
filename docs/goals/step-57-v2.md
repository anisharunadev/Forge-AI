/goal


Wire three knowledge-domain pages to the real backend: Knowledge Center (graph view), Organization Knowledge (wiki-style), and Ideation Center (ideas/roadmap/PRD/approvals). The backend has 50+ routes across these areas (knowledge_graph.py, ideation/* 12 files, persona_memory.py, standards.py, policies.py, templates.py), but the frontend pages use static sample data and the Ideation Center has zero seed data. Plus the Knowledge Center comment explicitly says "the orchestrator stub is still in flight — swapping in a real fetch is one useEffect away" — that's the work to do.


Read these files first to understand the current state:

- `backend/app/api/v1/knowledge_graph.py` (9 routes — KG nodes/edges/queries/stats)

- `backend/app/db/models/knowledge_graph.py` (KG node/edge models + enums)

- `backend/app/api/v1/ideation/ideas.py` (11 routes — full CRUD + analyze + archive)

- `backend/app/api/v1/ideation/roadmaps.py` (8 routes)

- `backend/app/api/v1/ideation/prds.py` (5 routes — read/submit/approve)

- `backend/app/api/v1/ideation/approvals.py` (5 routes — decide/assign/delegate)

- `backend/app/api/v1/ideation/scoring.py` (4 routes — score batch)

- `backend/app/api/v1/ideation/push.py` (5 routes — push to jira/confluence/architecture)

- `backend/app/api/v1/standards.py` (organization knowledge — standards)

- `backend/app/api/v1/policies.py` (policies)

- `backend/app/api/v1/templates.py` (templates)

- `backend/app/api/v1/persona_memory.py` (per-persona memory)

- `backend/app/db/models/ideation.py` (Idea, Roadmap, PRD, ApprovalItem, etc.)

- `apps/forge/app/knowledge-center/page.tsx` (the "useEffect away" page)

- `apps/forge/components/knowledge-graph/KnowledgeGraphCanvas.tsx`

- `apps/forge/components/knowledge-graph/GraphEmptyState.tsx`

- `apps/forge/src/data/sample-graph.ts` (the static sample data — the problem)

- `apps/forge/app/ideation/page.tsx` (9-tab hub)

- `apps/forge/components/ideation/IdeationBoard.tsx`

- `apps/forge/components/ideation/PipelineView.tsx`

- `apps/forge/components/ideation/RoadmapTimeline.tsx`

- `apps/forge/components/ideation/PRDList.tsx`

- `apps/forge/components/ideation/ApprovalsInbox.tsx`

- `apps/forge/components/ideation/SourcesTab.tsx`

- `apps/forge/app/organization-knowledge/page.tsx` (14-zone page)

- `apps/forge/lib/ideation/data.ts` (fetch wrapper — uses SERVER_BASE)

- `apps/forge/lib/hooks/useIdeaEnhance.ts`

- `apps/forge/lib/hooks/usePushIdeaToJira.ts`

- `apps/forge/lib/hooks/useJiraSync.ts`

- `apps/forge/lib/hooks/useApprovalDecide.ts`

- `apps/forge/lib/hooks/usePersonaMemory.ts`


INVOKE THE SKILL BEFORE CODING:

  python3 -c "import webbrowser; webbrowser.open('https://reactflow.dev/learn')"

  python3 -c "import webbrowser; webbrowser.open('https://d3js.org/d3-force')"


Read the React Flow and D3-force docs for the graph canvas implementation.


Adopt every rule. Then build in this order:


==========================================================

ZONE 1 — KNOWLEDGE GRAPH SEED (REAL NODES + EDGES)

==========================================================


The Knowledge Center uses `apps/forge/src/data/sample-graph.ts` as "source of truth". The page comment says: "the orchestrator stub (/v1/knowledge-center/nodes) is still in flight". Make the backend real.


CREATE `backend/scripts/seed_knowledge_graph.py`:


```python

#!/usr/bin/env python3

"""Seed real knowledge-graph nodes + edges.


Inserts a realistic org graph: people, teams, services, code modules,

docs, decisions (ADRs), policies, runbooks, all wired by edges that

represent ownership, dependencies, references, and approvals.


Run: docker compose exec backend python -m scripts.seed_knowledge_graph

"""


import asyncio, random

from uuid import uuid4

from app.db.session import async_session_maker

from app.db.models.knowledge_graph import (

    KGNode, KGEdge, NodeKind, EdgeKind,

)

from app.db.models.tenant import Tenant

from sqlalchemy import select



# Node factory

def node(tenant_id, kind, label, summary, **props):

    return KGNode(

        id=str(uuid4()),

        tenant_id=tenant_id,

        kind=kind,

        label=label,

        summary=summary,

        properties=props,

    )



# Edge factory

def edge(tenant_id, source, target, kind, label=None, weight=1.0):

    return KGEdge(

        id=str(uuid4()),

        tenant_id=tenant_id,

        source_id=source,

        target_id=target,

        kind=kind,

        label=label,

        weight=weight,

    )



SEED_NODES = [

    # People

    ("person", "Arun Achalam", "CTO at Acme Corp", {"email": "arun@acme-corp.com", "role": "cto"}),

    ("person", "Priya Iyer", "Engineering Manager", {"email": "priya@acme-corp.com", "role": "em"}),

    ("person", "Ravi Kumar", "Tech Lead, Forge Platform", {"email": "ravi@acme-corp.com", "role": "tech_lead"}),

    ("person", "Meera Patel", "Senior Engineer, Connectors", {"email": "meera@acme-corp.com", "role": "engineer"}),

    ("person", "Vikram Shah", "Engineer, Workflows", {"email": "vikram@acme-corp.com", "role": "engineer"}),

    ("person", "Anjali Rao", "PM, Knowledge Tools", {"email": "anjali@acme-corp.com", "role": "pm"}),

    

    # Teams

    ("team", "Platform Team", "Owns the agent runtime + workflow executor", {"size": 8}),

    ("team", "Connectors Team", "Builds external system integrations", {"size": 5}),

    ("team", "Knowledge Team", "Owns the KG + Org Knowledge surface", {"size": 6}),

    ("team", "Workflows Team", "Builds the workflow editor + run executor", {"size": 7}),

    

    # Services (runtime)

    ("service", "forge-api", "FastAPI gateway", {"repo": "forge-ai/backend", "language": "python", "sloc": 28000}),

    ("service", "forge-ui", "Next.js frontend", {"repo": "forge-ai/apps/forge", "language": "typescript", "sloc": 45000}),

    ("service", "forge-core", "Canonical skills + agents", {"repo": "forge-ai/packages/forge-core", "language": "markdown", "sloc": 12000}),

    ("service", "litellm-proxy", "LLM gateway", {"repo": "litellm", "language": "python", "sloc": 15000}),

    ("service", "keycloak", "Identity provider", {"repo": "keycloak", "language": "java", "sloc": 250000}),

    ("service", "postgres", "Primary database", {"repo": "postgres", "language": "c", "sloc": 800000}),

    ("service", "mcp-server", "Tool gateway", {"repo": "forge-mcp", "language": "typescript", "sloc": 4500}),

    

    # Code modules

    ("module", "workflow_executor.py", "DAG runner for user workflows", {"path": "backend/app/services/workflow_executor.py", "language": "python"}),

    ("module", "connector_manager.py", "Connector CRUD + sync orchestration", {"path": "backend/app/services/connector_manager.py", "language": "python"}),

    ("module", "agent_center", "Agent registry UI", {"path": "apps/forge/app/agent-center", "language": "typescript"}),

    ("module", "knowledge_graph.py", "KG REST endpoints", {"path": "backend/app/api/v1/knowledge_graph.py", "language": "python"}),

    ("module", "LiveConnectorDataProvider", "Bridges TanStack hooks + mock fallback", {"path": "apps/forge/components/connector-center/LiveConnectorDataProvider.tsx", "language": "typescript"}),

    

    # Docs

    ("doc", "Forge Architecture Overview", "System-level architecture for Forge AI Agent OS", {"format": "markdown", "url": "/docs/architecture"}),

    ("doc", "Multi-tenancy model", "How tenant isolation works", {"format": "markdown", "url": "/docs/multi-tenancy"}),

    ("doc", "Connector author guide", "How to write a new connector", {"format": "markdown", "url": "/docs/connector-author"}),

    ("doc", "Workflow YAML reference", "Complete spec for workflow definitions", {"format": "markdown", "url": "/docs/workflow-yaml"}),

    

    # Decisions (ADRs)

    ("adr", "ADR-001: Use LangGraph for SDLC", "Why we picked LangGraph as the orchestrator substrate", {"date": "2025-01-15", "status": "accepted"}),

    ("adr", "ADR-002: LiteLLM proxy for LLM traffic", "Provider-agnostic LLM routing", {"date": "2025-02-03", "status": "accepted"}),

    ("adr", "ADR-003: TanStack Query for client state", "Why we standardized on TanStack Query", {"date": "2025-03-21", "status": "accepted"}),

    ("adr", "ADR-004: forge-core as canonical source", "Single source of truth for skills/agents", {"date": "2025-04-10", "status": "accepted"}),

    

    # Policies

    ("policy", "PII handling policy", "No PII in logs, redaction at the edge", {"enforced": True, "owner": "security"}),

    ("policy", "Approval gates policy", "Mandatory human approval at architecture/deployment", {"enforced": True, "owner": "platform"}),

    ("policy", "Cost ceiling policy", "Workflows must declare a cost ceiling", {"enforced": True, "owner": "platform"}),

    ("policy", "Tenant isolation policy", "Every query carries tenant_id + project_id", {"enforced": True, "owner": "platform"}),

    

    # Runbooks

    ("runbook", "DB failover runbook", "Step-by-step postgres failover", {"severity": "high", "last_tested": "2025-05-12"}),

    ("runbook", "Keycloak realm recovery", "Rebuild a tenant realm from backup", {"severity": "medium", "last_tested": "2025-04-20"}),

    ("runbook", "LiteLLM outage runbook", "Detect + route around LiteLLM outage", {"severity": "high", "last_tested": "2025-05-01"}),

    

    # Tools / Systems

    ("tool", "GitHub", "Source control + PRs", {"category": "source-control"}),

    ("tool", "Jira", "Project management", {"category": "project-mgmt"}),

    ("tool", "Slack", "Team chat", {"category": "comms"}),

    ("tool", "Figma", "Design files", {"category": "design"}),

    ("tool", "AWS", "Cloud infra", {"category": "cloud"}),

]



SEED_EDGES = [

    # People → Teams (membership)

    ("person:Arun Achalam", "team:Platform Team", "owns", "OWNS"),

    ("person:Priya Iyer", "team:Connectors Team", "owns", "OWNS"),

    ("person:Ravi Kumar", "team:Workflows Team", "owns", "OWNS"),

    ("person:Meera Patel", "team:Connectors Team", "member_of"),

    ("person:Vikram Shah", "team:Workflows Team", "member_of"),

    ("person:Anjali Rao", "team:Knowledge Team", "owns", "OWNS"),

    

    # Teams → Services (ownership)

    ("team:Platform Team", "service:forge-api", "owns", "OWNS"),

    ("team:Platform Team", "service:litellm-proxy", "owns", "OWNS"),

    ("team:Platform Team", "service:keycloak", "owns", "OWNS"),

    ("team:Connectors Team", "service:forge-api", "contributes_to"),

    ("team:Knowledge Team", "service:forge-ui", "owns", "OWNS"),

    ("team:Workflows Team", "service:forge-ui", "contributes_to"),

    

    # Services → Modules (contains)

    ("service:forge-api", "module:workflow_executor.py", "contains"),

    ("service:forge-api", "module:connector_manager.py", "contains"),

    ("service:forge-api", "module:knowledge_graph.py", "contains"),

    ("service:forge-ui", "module:agent_center", "contains"),

    ("service:forge-ui", "module:LiveConnectorDataProvider", "contains"),

    

    # Services → Services (dependencies)

    ("service:forge-api", "service:postgres", "depends_on"),

    ("service:forge-api", "service:litellm-proxy", "depends_on"),

    ("service:forge-api", "service:keycloak", "depends_on"),

    ("service:forge-ui", "service:forge-api", "depends_on"),

    ("service:forge-ui", "service:keycloak", "depends_on"),

    ("service:litellm-proxy", "service:postgres", "depends_on"),

    ("service:mcp-server", "service:forge-api", "depends_on"),

    

    # Services → Tools (integration)

    ("service:forge-api", "tool:GitHub", "integrates_with"),

    ("service:forge-api", "tool:Jira", "integrates_with"),

    ("service:forge-api", "tool:Slack", "integrates_with"),

    

    # Docs → Services (documents)

    ("doc:Forge Architecture Overview", "service:forge-api", "documents"),

    ("doc:Forge Architecture Overview", "service:forge-ui", "documents"),

    ("doc:Multi-tenancy model", "service:postgres", "documents"),

    ("doc:Connector author guide", "module:connector_manager.py", "documents"),

    ("doc:Workflow YAML reference", "module:workflow_executor.py", "documents"),

    

    # ADRs → Things (decides)

    ("adr:ADR-001: Use LangGraph for SDLC", "service:forge-api", "decides"),

    ("adr:ADR-002: LiteLLM proxy for LLM traffic", "service:litellm-proxy", "decides"),

    ("adr:ADR-003: TanStack Query for client state", "service:forge-ui", "decides"),

    ("adr:ADR-004: forge-core as canonical source", "service:forge-core", "decides"),

    

    # Policies → Things (governs)

    ("policy:PII handling policy", "service:forge-api", "governs"),

    ("policy:Approval gates policy", "service:forge-api", "governs"),

    ("policy:Cost ceiling policy", "service:forge-api", "governs"),

    ("policy:Tenant isolation policy", "service:postgres", "governs"),

    

    # Runbooks → Services

    ("runbook:DB failover runbook", "service:postgres", "operates"),

    ("runbook:Keycloak realm recovery", "service:keycloak", "operates"),

    ("runbook:LiteLLM outage runbook", "service:litellm-proxy", "operates"),

]



async def seed():

    async with async_session_maker() as session:

        tenant = (await session.execute(

            select(Tenant).where(Tenant.slug == "acme-corp")

        )).scalar_one_or_none()

        if not tenant:

            print("✗ Tenant acme-corp not found")

            return

        

        existing = (await session.execute(

            select(KGNode).where(KGNode.tenant_id == tenant.id)

        )).scalars().first()

        if existing:

            print("  → Knowledge graph already seeded")

            return

        

        # Create nodes

        nodes_by_label = {}

        for kind, label, summary, props in SEED_NODES:

            n = node(tenant.id, kind, label, summary, **props)

            session.add(n)

            await session.flush()

            nodes_by_label[f"{kind}:{label}"] = n.id

        

        print(f"✓ Created {len(SEED_NODES)} KG nodes")

        

        # Create edges

        edge_count = 0

        for source_key, target_key, kind, *args in SEED_EDGES:

            source_id = nodes_by_label.get(source_key)

            target_id = nodes_by_label.get(target_key)

            if not source_id or not target_id:

                print(f"  ⚠ Edge skipped: {source_key} → {target_key}")

                continue

            

            label = args[0] if args else None

            e = edge(tenant.id, source_id, target_id, kind, label)

            session.add(e)

            edge_count += 1

        

        print(f"✓ Created {edge_count} KG edges")

        await session.commit()

        print(f"\n✅ Knowledge graph seeded: {len(SEED_NODES)} nodes, {edge_count} edges")



if __name__ == "__main__":

    asyncio.run(seed())
Run:

bash

Copy
docker compose exec backend python -m scripts.seed_knowledge_graph
VERIFY:

bash

Copy
docker compose exec postgres psql -U forge -d forge -c "SELECT kind, COUNT(*) FROM kg_nodes GROUP BY kind;"

docker compose exec postgres psql -U forge -d forge -c "SELECT kind, COUNT(*) FROM kg_edges GROUP BY kind;"
Should show: person(6), team(4), service(7), module(5), doc(4), adr(4), policy(4), runbook(3), tool(5) = ~42 nodes, ~30 edges.

========================================================== ZONE 2 — KNOWLEDGE CENTER FETCH HOOK
Replace the static SAMPLE_GRAPH in apps/forge/app/knowledge-center/page.tsx with a real TanStack Query hook.

CREATE apps/forge/lib/hooks/useKnowledgeGraph.ts:

typescript

Copy
'use client';


/**

 * TanStack Query hooks for the Knowledge Center (Step 57 Phase 5).

 * 

 * Mirrors `useConnectors` pattern: list + detail + edges + queries.

 * 

 *   - `useKGNodes(filters?)`       — list nodes with kind/search filters

 *   - `useKGNode(id)`               — single node detail

 *   - `useKGEdges(filters?)`       — list edges

 *   - `useKGStats()`                — counts by kind, freshness

 *   - `useVectorSearch(query)`      — semantic search

 *   - `useCypherQuery()`            — raw Cypher mutation

 */


import { useMutation, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/client';

import type { KGNode, KGEdge, KGStats, NodeKind, EdgeKind } from '@/lib/knowledge-graph/types';


export const kgQueryKeys = {

  all: ['knowledge-graph'] as const,

  nodes: (filters?: { kind?: NodeKind; search?: string }) => 

    [...kgQueryKeys.all, 'nodes', filters] as const,

  node: (id: string) => [...kgQueryKeys.all, 'node', id] as const,

  edges: (filters?: { source?: string; target?: string; kind?: EdgeKind }) => 

    [...kgQueryKeys.all, 'edges', filters] as const,

  stats: () => [...kgQueryKeys.all, 'stats'] as const,

  vectorSearch: (q: string) => [...kgQueryKeys.all, 'vector', q] as const,

};


export function useKGNodes(filters?: { kind?: NodeKind; search?: string }) {

  return useQuery<KGNode[]>({

    queryKey: kgQueryKeys.nodes(filters),

    queryFn: async () => {

      const params = new URLSearchParams();

      if (filters?.kind) params.set('kind', filters.kind);

      if (filters?.search) params.set('search', filters.search);

      const q = params.toString();

      return api.get<KGNode[]>(`/knowledge-graph/nodes${q ? `?${q}` : ''}`);

    },

    staleTime: 60_000,

  });

}


export function useKGNode(id: string | null) {

  return useQuery<KGNode>({

    queryKey: id ? kgQueryKeys.node(id) : ['kg', 'none'],

    queryFn: () => api.get<KGNode>(`/knowledge-graph/nodes/${id}`),

    enabled: Boolean(id),

  });

}


export function useKGEdges(filters?: { source?: string; target?: string; kind?: EdgeKind }) {

  return useQuery<KGEdge[]>({

    queryKey: kgQueryKeys.edges(filters),

    queryFn: async () => {

      const params = new URLSearchParams();

      if (filters?.source) params.set('source', filters.source);

      if (filters?.target) params.set('target', filters.target);

      if (filters?.kind) params.set('kind', filters.kind);

      const q = params.toString();

      return api.get<KGEdge[]>(`/knowledge-graph/edges${q ? `?${q}` : ''}`);

    },

    staleTime: 60_000,

  });

}


export function useKGStats() {

  return useQuery<KGStats>({

    queryKey: kgQueryKeys.stats(),

    queryFn: () => api.get<KGStats>('/knowledge-graph/stats'),

    staleTime: 300_000, // 5 min

  });

}


export function useVectorSearch(query: string) {

  return useQuery<KGNode[]>({

    queryKey: kgQueryKeys.vectorSearch(query),

    queryFn: () => api.post<KGNode[]>('/knowledge-graph/search/vector', { query }),

    enabled: query.length > 2,

    staleTime: 30_000,

  });

}


export function useCypherQuery() {

  return useMutation({

    mutationFn: (cypher: string) => 

      api.post<KGNode[]>('/knowledge-graph/query/cypher', { cypher }),

  });

}
CREATE apps/forge/lib/knowledge-graph/types.ts:

typescript

Copy
export type NodeKind = 

  | 'person' | 'team' | 'service' | 'module' | 'doc' 

  | 'adr' | 'policy' | 'runbook' | 'tool';


export type EdgeKind = 

  | 'owns' | 'member_of' | 'contains' | 'depends_on' | 'integrates_with'

  | 'documents' | 'decides' | 'governs' | 'operates' | 'contributes_to';


export interface KGNode {

  id: string;

  kind: NodeKind;

  label: string;

  summary: string;

  properties: Record<string, unknown>;

  created_at: string;

  updated_at: string;

  freshness_score?: number;  // 0-100, computed by backend

  last_touched_at?: string;

}


export interface KGEdge {

  id: string;

  source_id: string;

  target_id: string;

  kind: EdgeKind;

  label?: string;

  weight: number;

}


export interface KGStats {

  total_nodes: number;

  total_edges: number;

  nodes_by_kind: Record<NodeKind, number>;

  edges_by_kind: Record<EdgeKind, number>;

  freshness: {

    fresh: number;  // < 7 days

    stale: number;  // 7-30 days

    ancient: number;  // > 30 days

  };

}
========================================================== ZONE 3 — WIRE KNOWLEDGE CENTER PAGE
In apps/forge/app/knowledge-center/page.tsx:

typescript

Copy
// BEFORE:

const [nodes] = React.useState<ReadonlyArray<SampleNode>>(SAMPLE_GRAPH.nodes);

const [edges] = React.useState<ReadonlyArray<SampleEdge>>(SAMPLE_GRAPH.edges);


// AFTER:

const { data: nodes = [], isLoading: nodesLoading } = useKGNodes(filters);

const { data: edges = [], isLoading: edgesLoading } = useKGEdges(filters);

const { data: stats } = useKGStats();

const vectorSearch = useVectorSearch(searchTerm);


// Add loading + empty states:

if (nodesLoading || edgesLoading) return <GraphSkeleton />;

if (nodes.length === 0) return <GraphEmptyState onIngest={() => setIngestModalOpen(true)} />;
VERIFY the canvas (KnowledgeGraphCanvas.tsx) accepts the new node/edge shapes. If it expects the SampleNode/SampleEdge shape, write a wire→canvas adapter in lib/knowledge-graph/adapter.ts.

========================================================== ZONE 4 — IDEATION CENTER SEED
CREATE backend/scripts/seed_ideation.py:

python

Copy
#!/usr/bin/env python3

"""Seed real ideation data: ideas, analyses, scores, roadmaps, PRDs,

approvals, push records.


Run: docker compose exec backend python -m scripts.seed_ideation

"""


import asyncio, json

from uuid import uuid4

from datetime import datetime, timezone, timedelta

from app.db.session import async_session_maker

from app.db.models.ideation import (

    Idea, IdeaAnalysis, OpportunityScore, Roadmap, RoadmapItem,

    PRD, ArchitecturePreview, ApprovalItem, PushRecord,

    IdeaStatus, ApprovalItemStatus, ApprovalItemType, PushTarget,

    RoadmapHorizon, RoadmapStatus, PRDStatus, ScoreSource,

)

from app.db.models.tenant import Tenant

from app.db.models.user import User

from app.db.models.project import Project

from sqlalchemy import select



async def seed():

    async with async_session_maker() as session:

        tenant = (await session.execute(

            select(Tenant).where(Tenant.slug == "acme-corp")

        )).scalar_one_or_none()

        if not tenant:

            print("✗ Tenant acme-corp not found")

            return

        

        user = (await session.execute(

            select(User).where(User.email == "arun@acme-corp.com")

        )).scalar_one_or_none()

        user_id = user.id if user else tenant.id

        

        project = (await session.execute(

            select(Project).where(Project.tenant_id == tenant.id)

        )).scalars().first()

        project_id = project.id if project else tenant.id

        

        # Skip if already seeded

        existing = (await session.execute(

            select(Idea).where(Idea.tenant_id == tenant.id)

        )).scalars().first()

        if existing:

            print("  → Ideation already seeded")

            return

        

        # ===== IDEAS =====

        ideas_data = [

            {

                "title": "AI-assisted code review for every PR",

                "description": "Use Claude to review every PR for style, correctness, and security before a human reviewer is assigned. Block merging on critical issues.",

                "source": "user",

                "status": IdeaStatus.IN_ROADMAP,

                "tags": ["ai", "code-quality", "developer-experience"],

            },

            {

                "title": "Auto-generate architecture diagrams from service graph",

                "description": "Use the live knowledge graph (services + dependencies) to render C4 architecture diagrams on demand. Export to PNG/SVG/PlantUML.",

                "source": "user",

                "status": IdeaStatus.APPROVED,

                "tags": ["documentation", "knowledge-graph", "diagrams"],

            },

            {

                "title": "Slack-native ideation capture",

                "description": "Let users submit ideas directly from Slack via /forge-idea slash command. Auto-transcribe voice notes.",

                "source": "community",

                "status": IdeaStatus.SCORED,

                "tags": ["integrations", "slack", "intake"],

            },

            {

                "title": "Cost anomaly detection for LLM spend",

                "description": "Alert when a tenant's daily spend exceeds 2× their 7-day rolling average. Show breakdown by agent + provider.",

                "source": "signal",

                "status": IdeaStatus.ANALYZING,

                "tags": ["cost", "monitoring", "llm"],

            },

            {

                "title": "Personalized on-call dashboard",

                "description": "Per-user dashboard showing their active incidents, paged services, recent deploys, and team capacity.",

                "source": "user",

                "status": IdeaStatus.NEW,

                "tags": ["operations", "dashboard"],

            },

            {

                "title": "Voice-driven PR creation",

                "description": "Speak a PR description, AI generates the title/body/diff. Review and commit.",

                "source": "community",

                "status": IdeaStatus.REJECTED,

                "tags": ["ai", "voice"],

            },

        ]

        

        idea_ids = []

        for spec in ideas_data:

            idea = Idea(

                id=str(uuid4()),

                tenant_id=tenant.id,

                project_id=project_id,

                title=spec["title"],

                description=spec["description"],

                source=spec["source"],

                status=spec["status"],

                submitted_by=str(user_id),

                tags=spec["tags"],

                created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30)),

            )

            session.add(idea)

            await session.flush()

            idea_ids.append(idea.id)

            print(f"✓ Idea: {spec['title']}")

        

        # ===== IDEA ANALYSES (LLM-generated) =====

        for idea_id, base_score in zip(idea_ids[:4], [8.5, 7.2, 6.8, 5.4]):

            analysis = IdeaAnalysis(

                id=str(uuid4()),

                tenant_id=tenant.id,

                idea_id=idea_id,

                summary_md=f"## Analysis\n\nThis idea addresses a real pain point... [AI-generated summary]",

                risks=["Requires LLM budget", "May slow PR turnaround"],

                opportunities=["Improves code quality", "Reduces reviewer load"],

                effort_estimate_weeks=4,

                confidence=0.78,

                generated_at=datetime.now(timezone.utc) - timedelta(days=1),

            )

            session.add(analysis)

        

        # ===== OPPORTUNITY SCORES =====

        score_specs = [

            {"impact": 9, "feasibility": 7, "confidence": 8, "effort": 5},

            {"impact": 7, "feasibility": 8, "confidence": 9, "effort": 4},

            {"impact": 6, "feasibility": 9, "confidence": 7, "effort": 2},

            {"impact": 8, "feasibility": 5, "confidence": 6, "effort": 7},

        ]

        for idea_id, spec in zip(idea_ids[:4], score_specs):

            score = OpportunityScore(

                id=str(uuid4()),

                tenant_id=tenant.id,

                idea_id=idea_id,

                impact=spec["impact"],

                feasibility=spec["feasibility"],

                confidence=spec["confidence"],

                effort=spec["effort"],

                overall=(spec["impact"] + spec["feasibility"] + spec["confidence"] - spec["effort"]) / 3,

                source=ScoreSource.AI,

                generated_at=datetime.now(timezone.utc) - timedelta(days=1),

            )

            session.add(score)

        

        # ===== ROADMAP =====

        roadmap = Roadmap(

            id=str(uuid4()),

            tenant_id=tenant.id,

            name="Q3 2025 — Platform Velocity",

            description="Reduce PR cycle time + improve dev experience",

            horizon=RoadmapHorizon.NOW,

            status=RoadmapStatus.ACTIVE,

            created_by=str(user_id),

        )

        session.add(roadmap)

        await session.flush()

        

        # Roadmap items (link ideas to roadmap columns)

        roadmap_items = [

            (idea_ids[0], RoadmapHorizon.NOW, "AI PR review", "S", "Q3"),       # now

            (idea_ids[1], RoadmapHorizon.NEXT, "Architecture diagrams", "M", "Q3"),  # next

            (idea_ids[3], RoadmapHorizon.LATER, "Cost anomaly alerts", "M", "Q4"),  # later

        ]

        for idea_id, horizon, title, effort, quarter in roadmap_items:

            item = RoadmapItem(

                id=str(uuid4()),

                tenant_id=tenant.id,

                roadmap_id=roadmap.id,

                idea_id=idea_id,

                horizon=horizon,

                title=title,

                effort=effort,

                quarter=quarter,

            )

            session.add(item)

        print(f"✓ Roadmap: {roadmap.name}")

        

        # ===== PRDs =====

        prd_specs = [

            {

                "idea_id": idea_ids[0],

                "title": "AI-Assisted Code Review — PRD",

                "status": PRDStatus.REVIEW,

            },

            {

                "idea_id": idea_ids[1],

                "title": "Architecture Diagram Generator — PRD",

                "status": PRDStatus.DRAFT,

            },

        ]

        for spec in prd_specs:

            prd = PRD(

                id=str(uuid4()),

                tenant_id=tenant.id,

                idea_id=spec["idea_id"],

                title=spec["title"],

                status=spec["status"],

                sections={

                    "overview": "## Overview\n\nThis PRD describes...",

                    "goals": "## Goals\n\n- Reduce PR review time by 50%\n- Catch issues earlier",

                    "non_goals": "## Non-Goals\n\n- Replace human reviewers",

                    "user_stories": "## User Stories\n\n- As a developer...",

                },

                created_by=str(user_id),

            )

            session.add(prd)

            print(f"✓ PRD: {spec['title']}")

        

        # ===== APPROVALS =====

        approval_specs = [

            {

                "kind": ApprovalItemType.PRD,

                "title": "Approve AI PR Review PRD",

                "status": ApprovalItemStatus.PENDING,

                "assignee_role": "tech_lead",

            },

            {

                "kind": ApprovalItemType.IDEA,

                "title": "Promote 'Cost anomaly' to roadmap",

                "status": ApprovalItemStatus.PENDING,

                "assignee_role": "pm",

            },

            {

                "kind": ApprovalItemType.ADR,

                "title": "ADR-005: Adopt D3-force for KG layout",

                "status": ApprovalItemStatus.APPROVED,

                "assignee_role": "architect",

            },

        ]

        for spec in approval_specs:

            approval = ApprovalItem(

                id=str(uuid4()),

                tenant_id=tenant.id,

                kind=spec["kind"],

                title=spec["title"],

                status=spec["status"],

                requested_by=str(user_id),

                assignee_role=spec["assignee_role"],

                created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(1, 7)),

            )

            session.add(approval)

            print(f"✓ Approval: {spec['title']}")

        

        # ===== PUSH RECORDS (history of past pushes) =====

        for idea_id in idea_ids[:2]:

            push = PushRecord(

                id=str(uuid4()),

                tenant_id=tenant.id,

                idea_id=idea_id,

                target=PushTarget.JIRA,

                success=True,

                external_ref="FORA-1234",

                record_id=str(uuid4()),

                pushed_at=datetime.now(timezone.utc) - timedelta(days=2),

            )

            session.add(push)

        

        await session.commit()

        print(f"\n✅ Seeded 6 ideas, 4 analyses, 4 scores, 1 roadmap, 2 PRDs, 3 approvals, 2 push records")



if __name__ == "__main__":

    import random

    asyncio.run(seed())
Run:

bash

Copy
docker compose exec backend python -m scripts.seed_ideation
========================================================== ZONE 5 — IDEATION CENTER FETCH HOOKS
CREATE apps/forge/lib/hooks/useIdeation.ts:

typescript

Copy
'use client';


import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from 'sonner';

import { api } from '@/lib/api/client';

import type {

  Idea, IdeaAnalysis, Roadmap, RoadmapItem, PRD,

  Approval, ArchPreview, OpportunityScore,

} from '@/lib/ideation/types';


export const ideationQueryKeys = {

  all: ['ideation'] as const,

  ideas: () => [...ideationQueryKeys.all, 'ideas'] as const,

  idea: (id: string) => [...ideationQueryKeys.all, 'idea', id] as const,

  analysis: (id: string) => [...ideationQueryKeys.all, 'analysis', id] as const,

  roadmaps: () => [...ideationQueryKeys.all, 'roadmaps'] as const,

  prds: () => [...ideationQueryKeys.all, 'prds'] as const,

  approvals: () => [...ideationQueryKeys.all, 'approvals'] as const,

  archPreviews: () => [...ideationQueryKeys.all, 'arch-previews'] as const,

};


export function useIdeas() {

  return useQuery<{ items: Idea[]; total: number }>({

    queryKey: ideationQueryKeys.ideas(),

    queryFn: () => api.get('/ideation/ideas'),

    staleTime: 30_000,

  });

}


export function useIdea(id: string | null) {

  return useQuery<Idea>({

    queryKey: id ? ideationQueryKeys.idea(id) : ['ideation', 'idea', 'none'],

    queryFn: () => api.get<Idea>(`/ideation/ideas/${id}`),

    enabled: Boolean(id),

  });

}


export function useIdeaAnalysis(id: string | null) {

  return useQuery<IdeaAnalysis | null>({

    queryKey: id ? ideationQueryKeys.analysis(id) : ['ideation', 'analysis', 'none'],

    queryFn: () => api.get(`/ideation/ideas/${id}/analysis`),

    enabled: Boolean(id),

  });

}


export function useRoadmaps() {

  return useQuery<{ items: Roadmap[]; total: number }>({

    queryKey: ideationQueryKeys.roadmaps(),

    queryFn: () => api.get('/ideation/roadmap'),

    staleTime: 60_000,

  });

}


export function usePRDs() {

  return useQuery<{ items: PRD[]; total: number }>({

    queryKey: ideationQueryKeys.prds(),

    queryFn: () => api.get('/ideation/prds'),

    staleTime: 60_000,

  });

}


export function useApprovals() {

  return useQuery<{ items: Approval[]; total: number }>({

    queryKey: ideationQueryKeys.approvals(),

    queryFn: () => api.get('/ideation/approvals'),

    refetchInterval: 30_000,

  });

}


export function useArchPreviews() {

  return useQuery<ArchPreview[]>({

    queryKey: ideationQueryKeys.archPreviews(),

    queryFn: () => api.get<ArchPreview[]>('/ideation/arch-previews'),

    staleTime: 5 * 60_000,

  });

}


export function useCreateIdea() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (input: { title: string; description: string; tags?: string[] }) =>

      api.post<Idea>('/ideation/ideas', input),

    onSuccess: (idea) => {

      qc.invalidateQueries({ queryKey: ideationQueryKeys.ideas() });

      qc.setQueryData(ideationQueryKeys.idea(idea.id), idea);

      toast.success('Idea created');

    },

  });

}


export function useUpdateIdea() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, patch }: { id: string; patch: Partial<Idea> }) =>

      api.patch<Idea>(`/ideation/ideas/${id}`, patch),

    onSuccess: (idea) => {

      qc.invalidateQueries({ queryKey: ideationQueryKeys.all });

      qc.setQueryData(ideationQueryKeys.idea(idea.id), idea);

      toast.success('Idea updated');

    },

  });

}


export function useAnalyzeIdea() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post<IdeaAnalysis>(`/ideation/ideas/${id}/analyze`, {}),

    onSuccess: (_, id) => {

      qc.invalidateQueries({ queryKey: ideationQueryKeys.analysis(id) });

      toast.success('Analysis started');

    },

  });

}


export function useScoreIdea() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post<OpportunityScore>(`/ideation/ideas/${id}/score`, {}),

    onSuccess: (_, id) => {

      qc.invalidateQueries({ queryKey: ideationQueryKeys.idea(id) });

      toast.success('Scored');

    },

  });

}


export function useDecideApproval() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, decision, reason }: { 

      id: string; 

      decision: 'approve' | 'reject'; 

      reason?: string 

    }) => api.post<Approval>(`/ideation/approvals/${id}/decide`, { decision, reason }),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: ideationQueryKeys.approvals() });

      toast.success('Decision recorded');

    },

  });

}


export function usePushIdeaToJira() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, projectKey }: { id: string; projectKey: string }) =>

      api.post(`/ideation/ideas/${id}/push/jira`, { project_key: projectKey }),

    onSuccess: (_, { id }) => {

      qc.invalidateQueries({ queryKey: ideationQueryKeys.idea(id) });

      toast.success('Pushed to Jira');

    },

  });

}
========================================================== ZONE 6 — WIRE IDEATION TABS
Replace the static fetch wrappers in apps/forge/lib/ideation/data.ts with calls to the new hooks.

In apps/forge/components/ideation/IdeationBoard.tsx, REPLACE static listIdeas() with useIdeas().

In apps/forge/components/ideation/RoadmapTimeline.tsx, REPLACE static listRoadmapItems() with useRoadmaps().

In apps/forge/components/ideation/PRDList.tsx, REPLACE static listPRDs() with usePRDs().

In apps/forge/components/ideation/ApprovalsInbox.tsx, REPLACE static listApprovals() with useApprovals().

In apps/forge/components/ideation/ArchPreviewGrid.tsx, REPLACE static listArchPreviews() with useArchPreviews().

VERIFY each component handles:

Loading state (skeleton rows)
Empty state (real "No ideas yet" message, not the placeholder)
Error state (toast + retry)
Filter chips (status: All / New / Scored / Approved / Rejected)
========================================================== ZONE 7 — ORGANIZATION KNOWLEDGE BACKEND
apps/forge/app/organization-knowledge/page.tsx has 14 zones (Standards / Templates / Policies / Runbooks / Best practices / Activity / Graph). VERIFY the backend routes exist:

backend/app/api/v1/standards.py — standards CRUD
backend/app/api/v1/policies.py — policies + enforcement
backend/app/api/v1/templates.py — templates catalog
If any are missing, ADD them. Then seed:

CREATE backend/scripts/seed_org_knowledge.py:

python

Copy
#!/usr/bin/env python3

"""Seed organization knowledge: standards, templates, policies, runbooks.


Run: docker compose exec backend python -m scripts.seed_org_knowledge

"""


import asyncio

from uuid import uuid4

from datetime import datetime, timezone

from app.db.session import async_session_maker

from app.db.models.knowledge_graph import KGNode

from app.db.models.tenant import Tenant

from sqlalchemy import select



SEED_ORG_DOCS = [

    # Standards

    {"kind": "doc", "label": "Python Style Guide", "summary": "Internal Python coding standard", "properties": {"category": "standard", "language": "python", "owner": "Platform Team", "version": "2.1"}},

    {"kind": "doc", "label": "TypeScript Style Guide", "summary": "Frontend TS coding standard", "properties": {"category": "standard", "language": "typescript", "owner": "Knowledge Team", "version": "1.4"}},

    {"kind": "doc", "label": "API Design Standard", "summary": "REST + GraphQL conventions", "properties": {"category": "standard", "topic": "api", "owner": "Platform Team", "version": "3.0"}},

    {"kind": "doc", "label": "Database Migration Standard", "summary": "How to write reversible migrations", "properties": {"category": "standard", "topic": "db", "owner": "Platform Team", "version": "1.2"}},

    

    # Templates

    {"kind": "doc", "label": "PR Review Template", "summary": "Markdown template for PR descriptions", "properties": {"category": "template", "format": "markdown", "owner": "Workflows Team"}},

    {"kind": "doc", "label": "Incident Postmortem Template", "summary": "Blameless postmortem structure", "properties": {"category": "template", "format": "markdown", "owner": "Platform Team"}},

    {"kind": "doc", "label": "Architecture Decision Record Template", "summary": "Lightweight ADR template (Michael Nygard)", "properties": {"category": "template", "format": "markdown", "owner": "Knowledge Team"}},

    {"kind": "doc", "label": "Workflow YAML Template", "summary": "Starter template for workflow definitions", "properties": {"category": "template", "format": "yaml", "owner": "Workflows Team"}},

    

    # Policies (already in KG but link here)

    {"kind": "doc", "label": "Data Retention Policy", "summary": "How long we keep user data, audit logs, run artifacts", "properties": {"category": "policy", "enforced": True, "owner": "Security"}},

    {"kind": "doc", "label": "Secret Handling Policy", "summary": "How to store, rotate, and audit secrets", "properties": {"category": "policy", "enforced": True, "owner": "Security"}},

    

    # Best practices

    {"kind": "doc", "label": "Multi-tenant Query Patterns", "summary": "Always carry tenant_id + project_id in queries", "properties": {"category": "best-practice", "owner": "Platform Team", "adoption_score": 92}},

    {"kind": "doc", "label": "Idempotency Keys for Mutations", "summary": "All POST/PATCH/DELETE should accept Idempotency-Key", "properties": {"category": "best-practice", "owner": "Platform Team", "adoption_score": 87}},

    {"kind": "doc", "label": "Approval Gates at Critical Points", "summary": "Human review required for architecture / security / deploy", "properties": {"category": "best-practice", "owner": "Platform Team", "adoption_score": 78}},

]



async def seed():

    async with async_session_maker() as session:

        tenant = (await session.execute(

            select(Tenant).where(Tenant.slug == "acme-corp")

        )).scalar_one_or_none()

        if not tenant:

            print("✗ Tenant acme-corp not found")

            return

        

        # Skip if already seeded

        existing = (await session.execute(

            select(KGNode).where(KGNode.tenant_id == tenant.id, KGNode.kind == "doc")

        )).scalars().first()

        if existing:

            print("  → Org knowledge already seeded")

            return

        

        for spec in SEED_ORG_DOCS:

            n = KGNode(

                id=str(uuid4()),

                tenant_id=tenant.id,

                kind=spec["kind"],

                label=spec["label"],

                summary=spec["summary"],

                properties=spec["properties"],

                created_at=datetime.now(timezone.utc),

                updated_at=datetime.now(timezone.utc),

            )

            session.add(n)

            print(f"✓ Created: {spec['label']} ({spec['properties']['category']})")

        

        await session.commit()

        print(f"\n✅ Seeded {len(SEED_ORG_DOCS)} org knowledge docs")



if __name__ == "__main__":

    asyncio.run(seed())
Run:

bash

Copy
docker compose exec backend python -m scripts.seed_org_knowledge
========================================================== ZONE 8 — ORGANIZATION KNOWLEDGE FILTER BY CATEGORY
The org knowledge page filters by properties.category in the client. After seeding, verify the filter works:

typescript

Copy
// In organization-knowledge page

const { data: allDocs = [] } = useKGNodes({ kind: 'doc' });


const standards = allDocs.filter(n => n.properties.category === 'standard');

const templates = allDocs.filter(n => n.properties.category === 'template');

const policies = allDocs.filter(n => n.properties.category === 'policy');

const bestPractices = allDocs.filter(n => n.properties.category === 'best-practice');
If the backend has dedicated routes (/standards, /templates, /policies), use those instead. Otherwise, the client-side filter approach is fine.

========================================================== ZONE 9 — VECTOR SEARCH (SEMANTIC)
The knowledge graph has POST /knowledge-graph/search/vector endpoint. Wire it in the Knowledge Center search bar:

typescript

Copy
const vectorSearch = useVectorSearch(searchTerm);


useEffect(() => {

  if (searchTerm.length > 2) {

    vectorSearch.refetch();

  }

}, [searchTerm]);


// Show search results in a dropdown:

{searchTerm.length > 2 && vectorSearch.data && (

  <SearchResults results={vectorSearch.data} onSelect={(node) => focusNode(node.id)} />

)}
The backend likely uses pgvector for semantic search. VERIFY the schema:

sql

Copy
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE kg_nodes ADD COLUMN embedding vector(1536);
If pgvector isn't set up, the endpoint may return empty array — that's OK for now, mark as TODO.

========================================================== ZONE 10 — IDEA PUSH TO JIRA (REAL FLOW)
The usePushIdeaToJira hook calls POST /ideation/ideas/{id}/push/jira. VERIFY end-to-end:

1.
Configure Jira connector: POST /connectors with {type: "jira", config: {api_base, api_key}}
2.
Get the project key from the connector config
3.
Push idea: POST /ideation/ideas/{id}/push/jira with {project_key}
4.
Backend creates a Jira issue via the connector
5.
Returns {success: true, external_ref: "FORA-1234"}
6.
Frontend shows toast + adds a PushRecord to the idea's history
If no Jira connector is configured, the push should fail gracefully with "Jira not connected" — DON'T mock the success.

========================================================== ZONE 11 — TEST SCRIPTS
CREATE backend/scripts/test_knowledge_api.py:

python

Copy
#!/usr/bin/env python3

"""Test knowledge graph + ideation APIs.

Run: docker compose exec backend python -m scripts.test_knowledge_api"""


import asyncio, sys, httpx


BASE_URL = "http://localhost:8000/api/v1"


async def get_token():

    async with httpx.AsyncClient() as c:

        res = await c.post(

            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",

            data={"grant_type": "password", "client_id": "forge-backend",

                  "username": "arun@acme-corp.com", "password": "dev-password-change-in-prod"},

        )

        return res.json()["access_token"]



async def test(client, method, path, token, expected=200, **kw):

    res = await getattr(client, method)(

        f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {token}"}, **kw,

    )

    ok = "✓" if res.status_code == expected else "✗"

    print(f"{ok} {method.upper():6s} {path:50s} → {res.status_code} (expected {expected})")

    if res.status_code != expected:

        print(f"  Body: {res.text[:200]}")

    try:

        return res.json()

    except Exception:

        return None



async def main():

    token = await get_token()

    passed = failed = 0

    def count(ok):

        nonlocal passed, failed

        if ok: passed += 1

        else: failed += 1

    

    async with httpx.AsyncClient(timeout=30) as c:

        print("=" * 60 + "\nKNOWLEDGE GRAPH\n" + "=" * 60)

        nodes = await test(c, "get", "/knowledge-graph/nodes", token)

        count(nodes is not None and len(nodes) >= 40)

        

        edges = await test(c, "get", "/knowledge-graph/edges", token)

        count(edges is not None and len(edges) >= 25)

        

        count(await test(c, "get", "/knowledge-graph/stats", token) is not None)

        

        # Filter by kind

        persons = await test(c, "get", "/knowledge-graph/nodes?kind=person", token)

        count(persons is not None and len(persons) >= 5)

        

        # Search

        search = await test(c, "post", "/knowledge-graph/search/vector", token, json={"query": "LangGraph"})

        count(search is not None)

        

        # Cypher

        cypher = await test(c, "post", "/knowledge-graph/query/cypher", token, json={"cypher": "MATCH (n) RETURN n LIMIT 10"})

        count(cypher is not None)

        

        print("\n" + "=" * 60 + "\nIDEATION\n" + "=" * 60)

        ideas = await test(c, "get", "/ideation/ideas", token)

        count(ideas is not None and len(ideas.get("items", [])) >= 5)

        

        idea_id = ideas["items"][0]["id"] if ideas and ideas.get("items") else None

        if idea_id:

            count(await test(c, "get", f"/ideation/ideas/{idea_id}", token) is not None)

            count(await test(c, "get", f"/ideation/ideas/{idea_id}/analysis", token) is not None)

            count(await test(c, "post", f"/ideation/ideas/{idea_id}/score", token, json={}) is not None)

            count(await test(c, "post", f"/ideation/ideas/{idea_id}/push/jira", token, json={"project_key": "FORA"}, expected=200) is not None or True)

        

        # Create + update

        new_idea = await test(c, "post", "/ideation/ideas", token, expected=201, json={

            "title": "Test idea from smoke test",

            "description": "This is a test idea created by the smoke test script",

            "tags": ["test"],

        })

        count(new_idea is not None)

        if new_idea:

            count(await test(c, "patch", f"/ideation/ideas/{new_idea['id']}", token, json={"tags": ["test", "smoke"]}))

        

        count(await test(c, "get", "/ideation/roadmap", token) is not None)

        count(await test(c, "get", "/ideation/prds", token) is not None)

        count(await test(c, "get", "/ideation/approvals", token) is not None)

        count(await test(c, "get", "/ideation/arch-previews", token) is not None)

        

        # Approval decide

        approvals = await test(c, "get", "/ideation/approvals", token)

        if approvals and approvals.get("items"):

            approval_id = approvals["items"][0]["id"]

            count(await test(c, "post", f"/ideation/approvals/{approval_id}/decide", token, json={"decision": "approve"}) is not None)

    

    print(f"\n{'=' * 60}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 60}")

    return 0 if failed == 0 else 1



if __name__ == "__main__":

    sys.exit(asyncio.run(main()))
Run:

bash

Copy
docker compose exec backend python -m scripts.test_knowledge_api
========================================================== ZONE 12 — VERIFICATION CHECKLIST
All must pass:

 seed_knowledge_graph.py inserts 40+ nodes, 25+ edges
 seed_ideation.py inserts 6 ideas, 4 analyses, 4 scores, 1 roadmap, 2 PRDs, 3 approvals
 seed_org_knowledge.py inserts 13 docs across 4 categories
 test_knowledge_api.py shows 15/15 passed
 curl .../knowledge-graph/nodes returns 40+ nodes grouped by kind
 curl .../knowledge-graph/edges returns 25+ edges
 curl .../knowledge-graph/stats returns counts by kind + freshness buckets
 Knowledge Center page shows the seeded graph (not SAMPLE_GRAPH)
 Filter by kind (person/team/service/module/doc/adr/policy/runbook/tool) works
 Search box returns vector-search results when query > 2 chars
 Click a node → inspector panel shows full properties + connected edges
 Ideation Center Ideas tab shows the 6 seeded ideas
 Click an idea → detail panel shows analysis + score + push history
 "Push to Jira" button calls the API and shows real success/failure
 Roadmap tab shows the Q3 2025 roadmap with items in Now/Next/Later columns
 PRDs tab shows the 2 PRDs (1 review, 1 draft)
 Approvals tab shows 3 approvals (2 pending, 1 approved)
 Decide approve/reject on an approval removes it from pending queue
 Organization Knowledge Standards tab shows 4 standards (Python, TypeScript, API, DB)
 Organization Knowledge Templates tab shows 4 templates
 Organization Knowledge Policies tab shows 2 policies
 Organization Knowledge Best practices tab shows 3 best practices with adoption scores
 Empty states render correctly when API returns 0 items (not mock fallback)
 Loading skeletons show during fetch
========================================================== CONSTRAINTS
Don't delete SAMPLE_GRAPH — keep it as offline fallback (like CONNECTORS mock)
Don't break the canvas (KnowledgeGraphCanvas, RoadmapTimeline) — just feed it real data
Don't break the ideation hooks (useIdeaEnhance, usePushIdeaToJira) — keep them working
Keep the useIdeation and useKnowledgeGraph hooks idiomatic TanStack Query
Tenant scoping (Rule 2) — every backend query filters by tenant_id
Audit logging (Rule 6) — @audit() on every mutation
RBAC (Rule 8) — require_permission(...) on every route
The KG nodes have freshness_score — show staleness visually (e.g. dim nodes > 30 days)
The ideation page has 9 tabs — wire ALL of them, not just Ideas
========================================================== DELIVERABLE
backend/scripts/seed_knowledge_graph.py (Zone 1) — 40+ nodes, 25+ edges
backend/scripts/seed_ideation.py (Zone 4) — ideas + analyses + roadmap + PRDs + approvals
backend/scripts/seed_org_knowledge.py (Zone 7) — standards/templates/policies/best practices
backend/scripts/test_knowledge_api.py (Zone 11) — 15 endpoint tests
apps/forge/lib/hooks/useKnowledgeGraph.ts (Zone 2) — KG TanStack hooks
apps/forge/lib/hooks/useIdeation.ts (Zone 5) — Ideation TanStack hooks
apps/forge/lib/knowledge-graph/types.ts (Zone 2) — KG wire types
apps/forge/lib/ideation/types.ts (Zone 5) — Ideation wire types
apps/forge/app/knowledge-center/page.tsx — wire to real hooks (Zone 3)
All 9 Ideation tabs (Zone 6)
apps/forge/app/organization-knowledge/page.tsx — wire to real filters (Zone 8)
All 22 verification items pass
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep SAMPLE_GRAPH as offline fallback, keep existing ideation hooks (useIdeaEnhance, usePushIdeaToJira), keep the canvas component shape