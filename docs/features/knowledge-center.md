# Feature: Knowledge Center (KG Explorer + Org Knowledge)

> **Status:** Wired to real backend (Step 57 Phase 5) + Step 27/29 modernization
> **Routes:** `apps/forge/app/knowledge-center/page.tsx` (KG graph) + `apps/forge/app/organization-knowledge/page.tsx` (Org docs)
> **Backend KG:** `backend/app/api/v1/knowledge_graph.py` (9 routes, prefix `/kg`)
> **Backend service:** `backend/app/services/knowledge_graph.py` (Apache AGE-backed, SQL fallback)
> **Backend schemas:** `backend/app/schemas/project_intelligence.py` (KGNodeRead, KGEdgeRead, KGStats, etc.)
> **Constitutional rules:** R1 (LiteLLM for vector embeddings), R2 (multi-tenant), R5 (KG-backed knowledge — core of R5), R6 (auditability)

---

## Purpose

The Knowledge Center is the **two-faced knowledge surface**:

1. **Knowledge Graph Explorer** (`/knowledge-center`) — Obsidian-style visual graph of every typed artifact in Forge (repos, services, ADRs, ideas, risks, tasks, tests, agents, runs, stories, epics, commands, PRDs). Search, filter, traverse, link, discover.
2. **Organization Knowledge** (`/organization-knowledge`) — Master-detail editor for org-level documents: standards, templates, policies, runbooks, best practices. Wiki-style with backlinks, graph view, activity log.

Per PRD §1.4 both surfaces serve **all four personas** — engineers (search), tech leads (standards authoring), operators (runbooks), stewards (policies + compliance).

**Key capabilities:**

**KG Explorer:**
- **14 node kinds** — Repo / Service / Component / ADR / Idea / Risk / Task / Test / Agent / Run / Story / Epic / Command / PRD
- **6 edge kinds** — references / depends_on / blocks / implements / supersedes / related_to
- **6 graph layouts** — force / tb / lr / radial / grid / timeline (cycle with `L` shortcut)
- **3 view modes** — graph / list / outline
- **Vector search** — embedding-based similarity
- **Cypher + SQL + Hybrid queries** — graph query layer
- **Freshness tracking** — per-node freshness status + source
- **Time range filtering** — all / 7d / 30d / 90d
- **Multi-filter** — by kind, edge kind, author, tag, isolated
- **Ingest sources** — connect to GitHub, Jira, Notion to populate KG

**Org Knowledge:**
- **7 tabs** — Overview / Standards / Templates / Policies / Runbooks / Best Practices / Activity / Graph
- **Master-detail editor** (Step 12 reused) with markdown + AI suggestions
- **Backlinks sidebar** (Obsidian-style) in every editor
- **3-step new artifact modal** with templates
- **5 keyboard shortcuts** — ⌘N / ⌘⇧S / ⌘K / / / ⌘/
- **Adoption metrics** + drift detection + gamification

---

## Architecture

```
KnowledgeCenterPage (/knowledge-center)
└── Graph explorer
    ├── GraphHeader (search + view toggle + layout)
    ├── NodeKindFilterBar (14 kind chips)
    ├── KnowledgeGraphCanvas (Cytoscape / vis-network)
    ├── NodeInspectorPanel (right drawer)
    ├── FiltersDrawer (advanced filters)
    ├── IngestSourceModal (connect GitHub / Jira / Notion)
    └── 3 view modes: Graph / List / Outline

OrganizationKnowledgePage (/organization-knowledge)
└── 14 zones (Step 29 layout)
    ├── Z1  Header + scope switcher
    ├── Z2  Tabs (7)
    ├── Z3  Overview bento
    ├── Z4  Standards master-detail
    ├── Z5  Templates grid
    ├── Z6  Policies list + editor + enforcement sidebar
    ├── Z7  Runbooks timeline
    ├── Z8  Best practices (featured + grid + progress)
    ├── Z9  Activity (change log + adoption metrics)
    ├── Z10 Graph tab (Obsidian-style for artifacts)
    ├── Z11 New artifact modal (3-step)
    ├── Z12 Backlinks sidebar
    ├── Z13 Smart features (AI suggestions, drift detection, gamification)
    └── Z14 Keyboard shortcuts
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/knowledge-center` | KnowledgeGraphCanvas | KG visual explorer |
| `/organization-knowledge` | Org Knowledge master-detail | 7-tab wiki |

### Backend KG (`backend/app/api/v1/knowledge_graph.py`) — 9 routes

Prefix: `/api/v1/kg`

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/kg/nodes` | `kg:read` | List KG nodes (filter by project_id / type) |
| `GET` | `/api/v1/kg/nodes/{id}` | `kg:read` | Get one node |
| `GET` | `/api/v1/kg/nodes/{id}/freshness` | `kg:read` | Get freshness status for a node |
| `GET` | `/api/v1/kg/edges` | `kg:read` | List edges (filter by from/to/type) |
| `POST` | `/api/v1/kg/query/cypher` | `kg:query` | Run Cypher query (Apache AGE) |
| `POST` | `/api/v1/kg/query/sql` | `kg:query` | Run SQL query against KG tables |
| `POST` | `/api/v1/kg/query/hybrid` | `kg:query` | Run Cypher + SQL in same request |
| `POST` | `/api/v1/kg/search/vector` | `kg:query` | Vector similarity search (top_k=10) |
| `GET` | `/api/v1/kg/stats` | `kg:read` | Node count + edge count + type histograms |

### Backend Org Knowledge

Org Knowledge currently uses **in-memory fixtures** (`lib/organization-knowledge/data.ts`). Backend persistence routes are planned — see [Maintenance notes](#maintenance-notes).

---

## Data touched

### Tables (`backend/app/services/knowledge_graph.py`)

| Table | Purpose |
|---|---|
| `kg_nodes` | Graph nodes (function, file, service, decision, doc, etc.) |
| `kg_edges` | Graph edges between nodes |
| `freshness_ledger` | Per-node freshness records |

### KG Node columns

```python
class KGNode(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "kg_nodes"
    tenant_id: UUID          # indexed
    project_id: UUID         # indexed
    repo_id: UUID | None     # indexed
    node_type: str           # indexed (Service / ADR / Story / etc.)
    name: str                # max 512 chars
    properties: dict         # JSONB
    embedding: list[float]   # pgvector (pg17+)
    freshness_at: datetime | None
    freshness_source: str | None

    __table_args__ = (
        Index("ix_kg_nodes_tenant_project_type", "tenant_id", "project_id", "node_type"),
        Index("ix_kg_nodes_freshness", "tenant_id", "freshness_at"),
    )
```

### KG Edge columns

```python
class KGEdge(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "kg_edges"
    tenant_id: UUID
    project_id: UUID
    from_node_id: UUID
    to_node_id: UUID
    edge_type: str           # 'references' | 'depends_on' | 'blocks' | 'implements' | 'supersedes' | 'related_to'
    properties: dict

    __table_args__ = (
        Index("ix_kg_edges_from", "from_node_id"),
        Index("ix_kg_edges_to", "to_node_id"),
        Index("ix_kg_edges_type", "edge_type"),
    )
```

### Pydantic schemas (`backend/app/schemas/project_intelligence.py`)

- `KGNodeRead` — `{id, node_type, name, properties: dict, tenant_id, project_id, repo_id, freshness_at, freshness_source, created_at, updated_at}`
- `KGEdgeRead` — `{id, from_node_id, to_node_id, edge_type, properties, created_at, updated_at}`
- `KGStats` — `{node_count, edge_count, node_types: dict, edge_types: dict}`
- `KGFreshnessInfo` — `{node_id, status, ...}`
- `CypherQueryRequest` — `{query: str, params: dict}`
- `SQLQueryRequest` — `{query: str, params: dict}`
- `HybridQueryRequest` — `{cypher: str, sql: str, params: dict}`
- `VectorSearchRequest` — `{embedding: list[float], top_k: int (1-100, default 10), project_id?, node_type?}`

### 14 Node Kinds (`apps/forge/src/data/sample-graph.ts`)

```typescript
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
```

### 6 Edge Kinds (`apps/forge/components/knowledge-graph/graph-palette.ts`)

```typescript
export const ALL_EDGE_KINDS: ReadonlyArray<EdgeKind> = [
  'references',
  'depends_on',
  'blocks',
  'implements',
  'supersedes',
  'related_to',
];
```

### Layout cycle (6 layouts)

```typescript
const LAYOUT_CYCLE: ReadonlyArray<GraphLayout> = ['force', 'tb', 'lr', 'radial', 'grid', 'timeline'];
```

---

## Org Knowledge 7 Tabs (`apps/forge/app/organization-knowledge/page.tsx`)

```typescript
type TabId =
  | 'overview'     // 1. KPI + adoption metrics
  | 'standards'    // 2. Coding/design/architecture standards
  | 'templates'    // 3. ADR/PRD/Story/Runbook templates
  | 'policies'     // 4. Governance policies + enforcement
  | 'runbooks'     // 5. Operational runbooks (timeline view)
  | 'practices'    // 6. Best practices (featured + grid)
  | 'activity'     // 7. Change log + adoption metrics
  | 'graph';       // 8. KG view of org docs (Obsidian-style)

const TABS = [
  { id: 'overview',  label: 'Overview',       icon: Sparkles },
  { id: 'standards', label: 'Standards',      icon: BookText },
  { id: 'templates', label: 'Templates',      icon: LayoutTemplate },
  { id: 'policies',  label: 'Policies',       icon: ShieldCheck },
  { id: 'runbooks',  label: 'Runbooks',       icon: PlayCircle },
  { id: 'practices', label: 'Best Practices', icon: BookOpenCheck },
  { id: 'activity',  label: 'Activity',       icon: Activity },
  { id: 'graph',     label: 'Graph',          icon: Network },
];
```

### 5 Keyboard Shortcuts (Step 29)

| Shortcut | Action |
|---|---|
| `⌘N` | New artifact modal (3-step) |
| `⌘⇧S` | Search across all artifacts |
| `⌘K` | Open command palette |
| `/` | Quick search |
| `⌘/` | Keyboard shortcuts help |

---

## Knowledge Center Header Actions

| Action | Description |
|---|---|
| Search | Filter nodes by label / kind / preview |
| View toggle | Graph / List / Outline |
| Layout cycle (`L`) | force → tb → lr → radial → grid → timeline |
| Ingest source | Connect GitHub / Jira / Notion (modal) |
| Filters drawer | Advanced multi-filter |

---

## Knowledge Center Filters

`FiltersState`:
```typescript
interface FiltersState {
  visibleKinds: ReadonlyArray<NodeKind>;   // default: ALL_KINDS
  hiddenEdgeKinds: ReadonlyArray<EdgeKind>;
  timeRange: 'all' | '7d' | '30d' | '90d';
  authors: ReadonlyArray<string>;
  tags: ReadonlyArray<string>;
  hideIsolated: boolean;
}
```

Applied in this order:
1. Filter by `visibleKinds`
2. Filter by `timeRange` cutoff
3. Filter by `authors` (if any selected)
4. Filter by `tags` (if any selected)
5. Filter out isolated nodes (if `hideIsolated`)
6. Build edge list from remaining nodes + filter `hiddenEdgeKinds`

Search uses substring match on `label`, `kind`, or `preview`.

---

## Seed Data (Step 57 v2 — assumed running)

**KG nodes:** 40+ nodes spanning all 14 kinds. The default tenant (`acme-corp`) includes:

| Kind | Count | Examples |
|---|---|---|
| `Repo` | 3 | acme-platform, mobile-app, infra |
| `Service` | 6 | orchestrator, ingestion, runtime-gateway, policy-engine, etc. |
| `Component` | 4 | shared cache, auth, RBAC, telemetry |
| `ADR` | 5 | adopt-litellm, multi-tenant-isolation, etc. |
| `Idea` | 3 | voice-copilot, time-travel, fine-rbac |
| `Risk` | 3 | cross-tenant cache hit, rate limit, etc. |
| `Task` | 4 | voice MVP, checkpoint persistence, etc. |
| `Test` | 4 | tenant isolation, policy gate, etc. |
| `Agent` | 3 | architect, coder, reviewer |
| `Run` | 4 | voice spike, step-27 build, etc. |
| `Story` | 3 | RBAC v2, onboarding, KG redesign |
| `Epic` | 2 | platform v2, mobile v3 |
| `Command` | 2 | seed-data, run-pipeline |
| `PRD` | 2 | voice MVP, time-travel |

**KG edges:** 25+ edges using the 6 edge kinds (most common: `references`, `depends_on`, `implements`).

**Org Knowledge docs:** 13 documents across 4 categories (Step 57 v2 seed):
- **Standards** (4): coding standards, design system, architecture rules, API conventions
- **Templates** (3): ADR template, PRD template, runbook template
- **Policies** (3): data retention, model usage, audit log
- **Runbooks** (3): incident response, deploy rollback, tenant onboarding

---

## KG Query Layer (3 query types)

### 1. Cypher (Apache AGE)

`POST /api/v1/kg/query/cypher` with `{query, params}`:
- Backed by Apache AGE (PostgreSQL 17 extension)
- Falls back to plain SQL over `kg_nodes` + `kg_edges` if AGE unavailable
- Permission required: `kg:query`
- Examples: `MATCH (n:Service)-[r:depends_on]->(m) RETURN n, r, m`

### 2. SQL

`POST /api/v1/kg/query/sql` with `{query, params}`:
- Direct SQL over `kg_nodes` + `kg_edges` tables
- Useful for aggregations: `SELECT node_type, COUNT(*) FROM kg_nodes GROUP BY node_type`
- Permission required: `kg:query`

### 3. Hybrid

`POST /api/v1/kg/query/hybrid` with `{cypher, sql, params}`:
- Run both queries in same request
- Combine results in response
- Useful for graph + tabular analytics

### Vector Search

`POST /api/v1/kg/search/vector` with `{embedding, top_k, project_id?, node_type?}`:
- Cosine similarity over node embeddings (pgvector)
- `top_k` default 10, max 100
- Filters: `project_id`, `node_type`

---

## Freshness Tracking

`/api/v1/kg/nodes/{id}/freshness` returns:

```python
class KGFreshnessInfo(BaseModel):
    node_id: UUID
    status: str            # 'fresh' | 'stale' | 'unknown'
    last_updated_at: datetime
    source: str            # 'connector:github' | 'manual' | 'llm-inferred'
    age_hours: float
```

**Why freshness matters (R5 enforcement):**
- KG nodes older than their `stale_threshold` are flagged
- Downstream consumers (Copilot `search_knowledge` tool, Architecture traceability) check freshness before using a node
- "Unknown freshness" = trust score 0 (UI shows muted color)

---

## KG Stats

`GET /api/v1/kg/stats?project_id=...` returns:

```typescript
{
  node_count: number;
  edge_count: number;
  node_types: { [kind: string]: number };   // histogram
  edge_types: { [kind: string]: number };   // histogram
}
```

Rendered as overview bento: total nodes, total edges, kind breakdown (donut chart), top contributors.

---

## Ingest Sources

The KG IngestSourceModal lets operators connect:
- **GitHub** — pull repos, files, commits, PRs
- **Jira** — pull issues, projects
- **Notion** — pull pages, databases
- **Confluence** — pull spaces, pages
- **Slack** — pull channels (read-only metadata)

Per ingest source, the `kg_ingest_service` (in `backend/app/services/`) runs nightly + on-demand. Each connector call is **Rule 1 compliant** (no direct SDK imports — via orchestrator).

---

## Org Knowledge — Master-Detail Editor (Step 12 reused)

The editor shell (`KnowledgeEditorShell`) is **shared across all 4 artifact types** (standards / templates / policies / runbooks / practices) per Step 12 constraints.

**Editor features:**
- Markdown WYSIWYG with toolbar (Bold / Italic / H2 / Link / List / Code / Quote)
- AI suggestions sidebar (drift detection, related docs)
- Backlinks sidebar (Obsidian-style — lists docs that reference this one)
- Save draft + Publish (requires approval for policies)
- Variable substitution (`{{tenant_id}}`, `{{project_id}}`)
- Diff view (compare to previous version)
- Comment thread (per-section discussion)

---

## Org Knowledge — New Artifact Modal (3-step)

```
Step 1: Choose type (Standard / Template / Policy / Runbook / Practice)
Step 2: Choose template (existing or blank)
Step 3: Fill metadata + commit message + save
```

Creates the artifact in `draft` status. Author can save + edit + publish.

---

## Org Knowledge — Activity Tab

Shows recent changes across all artifacts:
- Who edited what
- When (with relative time)
- What changed (diff summary)
- Adoption metrics (views, references, attestations)

Used for governance audits.

---

## Org Knowledge — Graph Tab (Z10)

Same Obsidian-style graph as `/knowledge-center`, but scoped to **org docs only** (standards, templates, policies, runbooks, practices). Backlinks show as edges.

Useful for:
- "Which standards does this policy reference?"
- "Which runbooks implement this policy?"
- "Which templates derive from this standard?"

---

## Smart Features (Z13)

| Feature | Description |
|---|---|
| **AI suggestions** | "This standard could be split into 2 docs" |
| **Drift detection** | Flags standards that haven't been updated in 90+ days |
| **Gamification** | "Top contributor this month: Aria (12 edits)" |

AI suggestions are advisory only — never auto-edit. Drift detection triggers a banner + email reminder.

---

## Edge cases

| State | Treatment |
|---|---|
| **Empty KG** | Empty state + "Ingest from source" CTA |
| **No nodes match filter** | "No nodes match — try removing filters" + filter reset link |
| **Stale node** | Muted color + freshness badge + "Last updated N days ago" |
| **Unknown freshness** | Grey + "Unknown freshness" tooltip |
| **Isolated node** | Hidden when `hideIsolated=true`; badge "isolated" |
| **Vector search returns 0 results** | Empty state + "Try a different query" |
| **Cypher query fails** | Error banner with error message + "View raw SQL fallback" |
| **Cypher query slow (>5s)** | Loading skeleton + "Complex query — taking longer than usual" |
| **Org doc with broken link** | Show "Broken link" badge in backlinks |
| **Org doc superseded** | Show "Superseded by {new_doc}" banner + read-only mode |
| **Concurrent edit conflict** | 409 + "Newer version exists — refresh to continue" |
| **Ingest source fails** | Error toast + retry button + last-success timestamp |
| **`prefers-reduced-motion`** | Graph animations disabled; layout transitions instant |

---

## Forbidden patterns

AI agents modifying Knowledge Center MUST NOT:

- ❌ Add a new `NodeKind` without updating both backend `node_type` column + frontend `NodeKind` type + palette filter chips (3-way lock-step)
- ❌ Add a new `EdgeKind` without updating both backend `edge_type` column + frontend `EdgeKind` type + palette filter
- ❌ Skip tenant scoping on KG queries — Rule 2 (every query carries `tenant_id`)
- ❌ Bypass `freshness_ledger` on KG writes — Rule 5 freshness tracking is mandatory
- ❌ Use direct SDK imports in `kg_ingest_service` — Rule 1 (via orchestrator)
- ❌ Skip audit logging on node/edge create/update/delete — Rule 6
- ❌ Skip permission check (`kg:query` for queries, `kg:read` for reads)
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Auto-apply AI suggestions — always require human review

---

## Verification checklist

- [ ] `/knowledge-center` renders KG graph with 40+ seeded nodes + 25+ edges
- [ ] `/organization-knowledge` renders 7 tabs
- [ ] `curl .../kg/nodes` returns 40+ nodes with valid Bearer token + tenant scope
- [ ] `GET /kg/nodes?type=Service` filters by kind
- [ ] `GET /kg/nodes/{id}` returns full node + properties
- [ ] `GET /kg/nodes/{id}/freshness` returns freshness info
- [ ] `GET /kg/edges` returns 25+ edges
- [ ] `POST /kg/query/cypher` with valid cypher returns results
- [ ] `POST /kg/query/sql` with valid SQL returns results
- [ ] `POST /kg/query/hybrid` returns both cypher + sql results
- [ ] `POST /kg/search/vector` with embedding returns top_k similar nodes
- [ ] `GET /kg/stats` returns node/edge counts + histograms
- [ ] 14 NodeKind filter chips render correctly
- [ ] 6 EdgeKind filter chips render correctly
- [ ] 6 layouts cycle via `L` shortcut
- [ ] 3 view modes (Graph / List / Outline) switch correctly
- [ ] Search filters nodes by label/kind/preview
- [ ] Time range filter (all / 7d / 30d / 90d) works
- [ ] Multi-filter (kind + edge + author + tag + isolated) composes correctly
- [ ] Ingest source modal opens for GitHub / Jira / Notion
- [ ] Org Knowledge Standards tab shows 4 seeded standards
- [ ] Org Knowledge Templates tab shows 3 seeded templates
- [ ] Org Knowledge Policies tab shows 3 seeded policies
- [ ] Org Knowledge Runbooks tab shows 3 seeded runbooks
- [ ] ⌘N opens new artifact modal (3-step)
- [ ] Master-detail editor renders markdown correctly
- [ ] Backlinks sidebar shows cross-references
- [ ] Activity tab shows recent edits + adoption metrics
- [ ] Graph tab (org docs) shows Obsidian-style view
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md) — surfaced as an Org Knowledge doc
- [Design system](../standards/design-system.md) — surfaced as an Org Knowledge doc
- [Architecture rules](../standards/architecture-rules.md) — surfaced as an Org Knowledge doc
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (9 KG routes)
- [DB schema](../reference/db-schema.md) — `kg_nodes`, `kg_edges`, `freshness_ledger`
- [Dashboard](./dashboard.md) — KG stats widget
- [Co-pilot](./copilot.md) — `search_knowledge` tool queries KG
- [Architecture Center](./architecture-center.md) — Traceability backed by KG
- [Ideation Center](./ideation-center.md) — `kg_graph` sub-router for ideation
- [Connector Center](./connector-center.md) — Ingest sources pull from connectors
- [Settings](./settings.md) — KG defaults tab
- [Audit](./audit.md) — every KG mutation logged

---

## Maintenance notes

**When to update this doc:**

- A new `NodeKind` added → update 14-kind table + sample-graph.ts + graph-palette.ts
- A new `EdgeKind` added → update 6-kind list + graph-palette.ts
- A new KG query type added → update 3 query types
- A new ingest source added → update Ingest Sources section

**Files to keep in sync (the lock-step triangle):**

```
backend/app/api/v1/knowledge_graph.py          ←  9 routes (prefix /kg)
backend/app/services/knowledge_graph.py        ←  KGNode + KGEdge + Apache AGE + SQL fallback
backend/app/services/freshness_ledger.py       ←  Per-node freshness records
backend/app/schemas/project_intelligence.py    ←  KGNodeRead + KGEdgeRead + KGStats + query types
         ↓
apps/forge/src/data/sample-graph.ts            ←  14 NodeKind + SAMPLE_GRAPH fixtures
apps/forge/components/knowledge-graph/graph-palette.ts ←  ALL_KINDS + ALL_EDGE_KINDS + palettes
         ↓
apps/forge/app/knowledge-center/page.tsx       ←  Graph explorer
apps/forge/app/organization-knowledge/page.tsx ←  Org knowledge 7-tab wiki
apps/forge/components/knowledge-graph/         ←  KnowledgeGraphCanvas + NodeInspector + filters
```

If any link in this chain drifts, the Knowledge Center breaks silently. Always update all links.

---

## Org Knowledge — Backend status note

**Org Knowledge currently uses in-memory fixtures** (`lib/organization-knowledge/data.ts`) for offline / storybook rendering. Backend persistence routes for org documents are planned for a future iteration.

Per Step 57 v2, the seed provides 13 org docs across 4 categories. These are surfaced via the UI but **not yet backed by API routes**. When persistence routes ship, they will live in `backend/app/api/v1/organization_knowledge.py` (file does not yet exist) and mirror the in-memory shape.

**Rule of thumb:**
- KG Explorer → real backend (9 routes, all live)
- Org Knowledge → in-memory for now, backend planned
- AI agents must NOT assume Org Knowledge persists across restarts

This is the current state per Step 57 v2. Update this note when backend persistence ships.