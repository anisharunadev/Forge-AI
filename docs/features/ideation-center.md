# Feature: Ideation Center (Ideas → Roadmap → PRDs → Delivery)

> **Status:** Wired to real backend (Step 57 Phase 5) + Step 28 polish
> **Route:** `apps/forge/app/ideation/page.tsx`
> **Tabs:** 10 (Pipeline / Ideas / Roadmap / PRDs / Architecture Previews / My Approvals / Sources / Destinations / Market Signals / Customer Voice)
> **Backend modules:** `backend/app/api/v1/ideation/` — 12 sub-routers, ~56 routes total
> **Realtime:** WebSocket at `backend/app/api/ws/ideation/workflow.py`
> **Ingest hook:** `useIdeationIngestStatus` (30s polling)
> **Constitutional rules:** R1 (LiteLLM via analyze/score), R2 (multi-tenant), R3 (human approvals), R4 (typed artifacts), R5 (KG-backed knowledge), R6 (auditability)

---

## Purpose

The Ideation Center is the **continuous-context orchestration hub**. It captures ideas from anywhere (manual intake, community feedback, market signals, customer voice), analyzes them with LLM-backed reasoning, scores them with RICE-style frameworks, packages them into roadmaps and PRDs, generates architecture previews, and ships them to delivery (Jira / Confluence / Architecture Center).

Per PRD §1.4 the Ideation Center serves **all four personas** — engineers (feature ideas), tech leads (roadmap + ADRs), operators (approval gates), stewards (audit trail).

**Key capabilities:**
- **10-tab hub** — Pipeline / Ideas / Roadmap / PRDs / Architecture / Approvals / Sources / Destinations / Market Signals / Customer Voice
- **3 view modes** — Kanban / List / Timeline (toggleable, shared data shape)
- **Idea lifecycle** — intake → scoring → discovery → approved → shipped
- **LLM analysis** — `POST /ideas/{id}/analyze` produces `IdeaAnalysisRead` (reasoning chain, evidence, risks)
- **Opportunity scoring** — RICE + custom dimensions, score overrides by humans
- **Roadmap generation** — themed + ranked into 4 horizons (now / next / later / future)
- **PRD authoring** — typed artifact with section-level versioning
- **Architecture previews** — typed artifact (nodes + edges) generated from approved ideas
- **Push pipeline** — push to Jira / Confluence / Architecture Center with audit records
- **Approval workflow** — human gates on every state transition (per Rule 3)
- **Real-time WS** — `backend/app/api/ws/ideation/workflow.py` for live workflow intervention
- **Daily ingest** — nightly job pulls signals from sources; indicator shows last-run status

---

## Architecture

```
IdeationCenterPage (/ideation)
└── Hero band (IDEATION eyebrow + CaptureModal trigger + IngestIndicator + 3-dot menu)
└── Tabs (10)
    ├── Pipeline (default)        — PipelineView + OneClickPipelineDrawer
    ├── Ideas                     — IdeationBoard (Kanban/List/Timeline) + IdeaDetailPanel
    ├── Roadmap                   — RoadmapTimeline (4 horizons)
    ├── PRDs                      — PRDList + PRDViewer (section editor)
    ├── Architecture Previews     — ArchPreviewGrid + ArchPreviewGraph
    ├── My Approvals              — ApprovalsInbox + ApprovalQueuePanel
    ├── Sources                   — SourcesTab (ConnectorPicker for ingestion)
    ├── Destinations              — DestinationsTab (Jira / Confluence / Arch Center)
    ├── Market Signals            — MarketSignalsTab (per-source signal feed)
    └── Customer Voice            — CustomerVoiceTab (verbatim quotes)

CaptureModal (global)            — ⌘N shortcut, prefilled from current page context
IdeaEnhanceDialog (per-idea)     — "Enhance with editor note"
OneClickPipelineDrawer (per-idea) — 1-click run ideation → delivery pipeline
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/ideation` | Ideation Center | 10-tab hub |
| `/ideation/[id]` | IdeaDetailPanel | Single idea view (drawer) |

### Backend (FastAPI)

All routes use `@audit()` decorator. Tenant scoping enforced via `principal.tenant_id`.

#### Core Ideas (`backend/app/api/v1/ideation/ideas.py`) — 11 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/ideas` | `ideation:write` | Create idea |
| `GET` | `/api/v1/ideation/ideas` | `ideation:read` | List ideas (paginated) |
| `GET` | `/api/v1/ideation/ideas/{id}` | `ideation:read` | Get one idea |
| `PATCH` | `/api/v1/ideation/ideas/{id}` | `ideation:write` | Update idea |
| `POST` | `/api/v1/ideation/ideas/{id}/analyze` | `ideation:run` | Trigger LLM analysis (sets status=ANALYZING then SCORED) |
| `GET` | `/api/v1/ideation/ideas/{id}/analysis` | `ideation:read` | Get cached analysis |
| `POST` | `/api/v1/ideation/ideas/{id}/reanalyze` | `ideation:run` | Re-run analysis with new context |
| `POST` | `/api/v1/ideation/ideas/{id}/archive` | `ideation:write` | Archive (soft-delete) |
| `POST` | `/api/v1/ideation/ideas/{id}/artifacts` | `ideation:write` | Generate artifact from idea |
| `POST` | `/api/v1/ideation/ideas/validate` | `ideation:write` | Validate idea input |
| `POST` | `/api/v1/ideation/ideas/extract-entities` | `ideation:read` | Extract KG entities from idea description |

#### Enhance (`backend/app/api/v1/ideation/enhance.py`) — 1 route

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/ideas/{id}/enhance` | `ideation:write` | Re-run analysis with `{editor_note}` appended |

#### Approvals (`backend/app/api/v1/ideation/approvals.py`) — 5 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/approvals` | `ideation:write` | Create approval request |
| `GET` | `/api/v1/ideation/approvals` | `ideation:read` | List approval queue |
| `POST` | `/api/v1/ideation/approvals/{id}/decide` | `ideation:approve` | Approve / deny / request_changes |
| `POST` | `/api/v1/ideation/approvals/{id}/assign` | `ideation:approve` | Assign reviewer |
| `POST` | `/api/v1/ideation/approvals/{id}/delegate` | `ideation:approve` | Delegate to another reviewer |

#### Scoring (`backend/app/api/v1/ideation/scoring.py`) — 5 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/ideas/{id}/score` | `ideation:run` | Compute RICE score |
| `POST` | `/api/v1/ideation/score/batch` | `ideation:run` | Batch score (for ranking) |
| `GET` | `/api/v1/ideation/ideas/{id}/score` | `ideation:read` | Get cached score |
| `POST` | `/api/v1/ideation/ideas/{id}/score/override` | `ideation:write` | Human override (creates audit) |

#### Roadmaps (`backend/app/api/v1/ideation/roadmaps.py`) — 8 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/roadmaps` | `ideation:write` | Create roadmap |
| `GET` | `/api/v1/ideation/roadmaps` | `ideation:read` | List roadmaps |
| `GET` | `/api/v1/ideation/roadmaps/{id}` | `ideation:read` | Get one |
| `PATCH` | `/api/v1/ideation/roadmaps/{id}` | `ideation:write` | Update name / items |
| `POST` | `/api/v1/ideation/roadmaps/{id}/approve` | `ideation:approve` | Approve roadmap |
| `POST` | `/api/v1/ideation/roadmaps/{id}/regenerate` | `ideation:run` | Re-rank with new scores |
| `POST` | `/api/v1/ideation/roadmaps/{id}/items` | `ideation:write` | Add idea to roadmap |
| `DELETE` | `/api/v1/ideation/roadmaps/{id}/items/{item_id}` | `ideation:write` | Remove from roadmap |

#### PRDs (`backend/app/api/v1/ideation/prds.py`) — 5 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/prds` | `ideation:write` | Create PRD from idea |
| `GET` | `/api/v1/ideation/ideas/{idea_id}/prd` | `ideation:read` | Get PRD attached to idea |
| `PATCH` | `/api/v1/ideation/prds/{prd_id}/sections/{section}` | `ideation:write` | Update PRD section (section-level versioning) |
| `POST` | `/api/v1/ideation/prds/{prd_id}/submit` | `ideation:write` | Submit for review |
| `POST` | `/api/v1/ideation/prds/{prd_id}/approve` | `ideation:approve` | Approve PRD |

#### Push (`backend/app/api/v1/ideation/push.py`) — 5 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/ideas/{id}/push/jira` | `ideation:write` | Push to Jira (creates epic + stories) |
| `POST` | `/api/v1/ideation/ideas/{id}/push/confluence` | `ideation:write` | Push to Confluence (creates page) |
| `POST` | `/api/v1/ideation/ideas/{id}/push/architecture` | `ideation:write` | Push to Architecture Center |
| `POST` | `/api/v1/ideation/ideas/{id}/push/all` | `ideation:write` | Push to all enabled destinations |
| `GET` | `/api/v1/ideation/ideas/{id}/push/history` | `ideation:read` | List past pushes |

#### Impact (`backend/app/api/v1/ideation/impact.py`) — 2 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/ideation/ideas/{id}/impact-graph` | `ideation:read` | KG impact graph for idea |
| `POST` | `/api/v1/ideation/impact/compare` | `ideation:read` | Compare two ideas' impact |

#### Workflows (`backend/app/api/v1/ideation/workflows.py`) — 3 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/workflows` | `ideation:run` | Start a real-time ideation workflow session |
| `GET` | `/api/v1/ideation/workflows/{session_id}` | `ideation:read` | Get session state |
| `POST` | `/api/v1/ideation/workflows/{session_id}/intervene` | `ideation:write` | Human intervention (skip / retry / modify / cancel) |
| `POST` | `/api/v1/ideation/workflows/{session_id}/complete` | `ideation:write` | Mark complete |

#### Arch Previews (`backend/app/api/v1/ideation/arch_previews.py`) — 3 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/arch-previews` | `ideation:write` | Generate arch preview from idea |
| `GET` | `/api/v1/ideation/ideas/{id}/arch-preview` | `ideation:read` | Get preview for idea |
| `POST` | `/api/v1/ideation/ideas/{id}/arch-preview/regenerate` | `ideation:run` | Re-generate with new context |

#### KG Graph (`backend/app/api/v1/ideation/kg_graph.py`) — 3 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/kg` | `ideation:write` | Add KG node |
| `GET` | `/api/v1/ideation/projects/{id}/idea-graph` | `ideation:read` | Get idea graph for project |
| `POST` | `/api/v1/ideation/ideas/{id}/related` | `ideation:read` | Find related ideas via KG |

#### Output Bundles (`backend/app/api/v1/ideation/output_bundles.py`) — 3 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/ideation/output-bundles` | `ideation:write` | Create output bundle (zip of idea + PRD + arch + roadmap) |
| `GET` | `/api/v1/ideation/bundles/{id}` | `ideation:read` | Get bundle metadata |
| `GET` | `/api/v1/ideation/bundles/{id}/export` | `ideation:read` | Download bundle |

#### WebSocket

| Path | Description |
|---|---|
| `/api/v1/ws/ideation/workflow` | Real-time ideation workflow session (auth via JWT in initial frame) |

**Wire format (client → server):**
```json
{"type": "auth", "token": "<jwt>"}
{"type": "intervene", "action": "skip|retry|modify|cancel", "step": "<name>", "payload": {}}
{"type": "ping"}
```

**Wire format (server → client):**
```json
{"type": "ready", "session_id": "<uuid>"}
{"type": "state", "state": {...}}
{"type": "step_started", "step": "<name>"}
{"type": "step_completed", "step": "<name>", "result": {...}}
{"type": "step_failed", "step": "<name>", "error": "<msg>"}
{"type": "session_completed", "outputs": {...}}
{"type": "error", "message": "<msg>"}
{"type": "pong"}
```

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `ideas` | Idea records (status, source, description, tags, attachments) |
| `idea_analyses` | LLM-produced analysis (reasoning, evidence, risks) |
| `opportunity_scores` | RICE + custom dimension scores |
| `roadmaps` | Roadmap buckets (horizon, status) |
| `roadmap_items` | Idea-to-roadmap mappings |
| `prds` | PRD artifacts (status, version, sections JSONB) |
| `arch_previews` | Arch preview artifacts (nodes + edges JSONB) |
| `output_bundles` | Packaged bundles for delivery handoff |
| `approval_items` | Human-in-the-loop queue entries |
| `push_records` | Per-push audit records |
| `audit_events` | Every action logged |

### Backend enums (`backend/app/db/models/ideation.py`)

**`IdeaSource` (5 kinds):**
```python
class IdeaSource(str, enum.Enum):
    USER = "user"
    COMMUNITY = "community"
    SIGNAL = "signal"
    ROADMAP = "roadmap"
    FEEDBACK = "feedback"
```

**`IdeaStatus` (7 states) — BACKEND:**
```python
class IdeaStatus(str, enum.Enum):
    NEW = "new"
    ANALYZING = "analyzing"
    SCORED = "scored"
    APPROVED = "approved"
    IN_ROADMAP = "in_roadmap"
    REJECTED = "rejected"
    ARCHIVED = "archived"
```

**Frontend `IdeaStatus` (7 states) — `apps/forge/lib/ideation/data.ts`:**
```typescript
export type IdeaStatus =
  | 'intake'        // = backend NEW
  | 'scoring'       // = backend ANALYZING
  | 'discovery'     // = backend SCORED (post-scoring research)
  | 'prd'           // = backend SCORED + PRD created
  | 'approved'      // = backend APPROVED
  | 'rejected'      // = backend REJECTED
  | 'shipped';      // = backend IN_ROADMAP + pushed to delivery
```

**⚠️ Status name divergence:** backend and frontend use different names for the same logical stages. The adapter (`wireToIdea` / `ideaToWire`) translates between them. AI agents must use backend names in API calls and frontend names in UI rendering.

**`ScoreSource` (3):** `AI`, `HUMAN`, `HYBRID`

**`RoadmapHorizon` (4):**
```python
NOW = "now"
NEXT = "next"
LATER = "later"
FUTURE = "future"
```

**`RoadmapStatus` (5):** `DRAFT`, `PROPOSED`, `APPROVED`, `PUBLISHED`, `ARCHIVED`

**`PRDStatus` (5):** `DRAFT`, `REVIEW`, `APPROVED`, `PUBLISHED`, `ARCHIVED`

### Pydantic schemas (`backend/app/schemas/ideation.py`)

- `IdeaBase` — `{title, description, source, tags, attachments}`
- `IdeaCreate` — `IdeaBase + {project_id}`
- `IdeaRead` — `TenantScopedModel + {id, title, description, source, submitted_by, status, tags, attachments}`
- `IdeaListResponse` — `{items: list[IdeaRead], total}`
- `IdeaAnalysisRead` — `{reasoning_chain, evidence: list[str], risks: list[str], suggested_capabilities: list[str], confidence: float}`
- `IdeaValidationResult` — `{valid: bool, errors: list[str]}`
- `OpportunityScoreRead` — `{rice: {reach, impact, confidence, effort}, custom_dimensions: dict, total: float, source: ScoreSource, overridden_by: UUID | None}`
- `RoadmapRead` — `{id, name, horizon, status, items: list[RoadmapItemRead], created_by, published_at}`
- `PRDRead` — `{id, idea_id, status, version, sections: dict[str, str], submitted_at, approved_at}`
- `ArchPreviewRead` — `{id, idea_id, nodes: list[dict], edges: list[dict], generated_at}`
- `ApprovalItemRead` — `{id, idea_id, request_type, subject_id, payload, status, requested_by, reviewer_id}`
- `ApprovalQueueResponse` — `{items: list[ApprovalItemRead], total}`
- `PushResult` — `{target: PushTarget, success: bool, external_ref: str | None, error: str | None, record_id}`
- `ImpactGraph` — `{nodes: list[KGNode], edges: list[KGEdge], root_idea_id}`

### TypeScript mirror (`apps/forge/lib/ideation/data.ts`)

Mirrors all wire-format shapes with the **frontend `IdeaStatus` enum** (not backend names).

---

## 10 Tabs (Step 28 layout)

```typescript
type TabId =
  | 'pipeline'         // 1. Pipeline view (default)
  | 'ideas'            // 2. Kanban / List / Timeline
  | 'roadmap'          // 3. RoadmapTimeline
  | 'prds'             // 4. PRDList
  | 'arch'             // 5. Architecture Previews
  | 'approvals'        // 6. My Approvals
  | 'sources'          // 7. Sources (ConnectorPicker)
  | 'destinations'     // 8. Destinations (Jira / Confluence / Arch Center)
  | 'market'           // 9. Market Signals
  | 'voice';           // 10. Customer Voice

const TABS = [
  { id: 'pipeline', label: 'Pipeline', testId: 'tab-pipeline' },
  { id: 'ideas', label: 'Ideas', testId: 'tab-ideas' },
  { id: 'roadmap', label: 'Roadmap', testId: 'tab-roadmap' },
  { id: 'prds', label: 'PRDs', testId: 'tab-prds' },
  { id: 'arch', label: 'Architecture Previews', testId: 'tab-arch' },
  { id: 'approvals', label: 'My Approvals', testId: 'tab-approvals' },
  { id: 'sources', label: 'Sources', testId: 'tab-sources' },
  { id: 'destinations', label: 'Destinations', testId: 'tab-destinations' },
  { id: 'market', label: 'Market Signals', testId: 'tab-market' },
  { id: 'voice', label: 'Customer Voice', testId: 'tab-voice' },
];
```

Each tab shows a badge count of relevant items (e.g. Approvals shows pending count).

---

## 3 Idea View Modes (Step 5)

The Ideas tab supports 3 views, all sharing the same `Idea[]` shape:

```typescript
type IdeationView = 'kanban' | 'list' | 'timeline';
```

| View | Component | Best for |
|---|---|---|
| **Kanban** | `IdeaKanban` | 5-column flow visualization |
| **List** | `IdeaList` | Dense table with all metadata |
| **Timeline** | `IdeaTimeline` | Time-series (created/submitted) |

Toggle via `SegmentedControl` in toolbar.

### Kanban columns

```typescript
export type KanbanColumnKey =
  | 'captured'    // intake + rejected
  | 'scoring'     // scoring + discovery
  | 'approved'    // approved
  | 'in_prd'      // prd
  | 'shipped';    // shipped

export const KANBAN_COLUMNS = [
  { key: 'captured', label: 'Captured', dotColor: 'var(--fg-muted)',
    ideaStatuses: ['intake', 'rejected'] },
  { key: 'scoring', label: 'Scoring', dotColor: 'var(--accent-cyan)', pulse: true,
    ideaStatuses: ['scoring', 'discovery'] },
  { key: 'approved', label: 'Approved', dotColor: 'var(--accent-emerald)',
    ideaStatuses: ['approved'] },
  // ... in_prd, shipped
];
```

Drag-drop reordering calls `PATCH /ideas/{id}` with new status (optimistic update + rollback on error).

---

## Keyboard Shortcuts (Step 28)

Mounted via `useIdeationHotkeys`:

| Shortcut | Action |
|---|---|
| `⌘N` | Open CaptureModal (new idea) |
| `⌘⇧V` | Open Voice capture modal |
| `⌘⇧S` | Open Sources tab |
| `⌘K` | Open command palette |
| `⌘⇧P` | Open Pipeline view |
| `⌘/` | Open keyboard shortcuts help |

`isEditableTarget()` check disables shortcuts when focus is in `<input>` / `<textarea>` / `[contenteditable]`.

---

## Idea Ingest Status (`useIdeationIngestStatus`)

Background daily job pulls signals from configured sources (Zendesk, Slack, GitHub, etc.). The hook polls `GET /v1/ideation/ingest/status` every 30s:

```typescript
interface IdeationIngestStatusPayload {
  last_run_at: string | null;
  ideas_created_today: number;
  status: 'idle' | 'running' | 'failed';
  error?: string;
}
```

Rendered as `<IngestIndicator>` in the hero band:

| Status | Visual |
|---|---|
| `idle` (last run < 24h) | Emerald dot + "Last ingest: N new ideas" |
| `idle` (last run > 24h) | Amber dot + "Stale — last ingest 36h ago" |
| `running` | Cyan pulsing dot + "Running daily ingest..." |
| `failed` | Rose dot + error tooltip + "Retry" link |

---

## Idea Analysis Flow (LLM-backed)

```
1. POST /ideas/{id}/analyze
   ↓
2. IdeaEnhanceService dispatched (background task)
   ↓
3. status: NEW → ANALYZING
   ↓
4. LLM call via LiteLLM (Rule 1)
   - prompt = idea.title + idea.description + project_context
   - tools called: search_knowledge, get_standards (per Rule 5)
   ↓
5. LLM returns reasoning_chain + evidence + risks + suggested_capabilities
   ↓
6. Store as IdeaAnalysis row
   ↓
7. status: ANALYZING → SCORED
   ↓
8. Auto-trigger scoring: POST /ideas/{id}/score
   ↓
9. OpportunityScore created with RICE breakdown
   ↓
10. SSE event emitted → UI shows analysis + score
```

`confidence` field (0.0–1.0) drives `ConfidenceIndicator` UI: high (emerald), medium (amber), low (rose).

---

## Approval Workflow (Per Rule 3)

Every state transition that ships to delivery requires human approval:

```
Idea approved → PRD created → PRD submit → PRD REVIEW
                                          ↓
                                   approval requested
                                          ↓
                              ┌───────────┴───────────┐
                              ↓                       ↓
                       PRD APPROVED            PRD DENIED / REQUEST_CHANGES
                              ↓
                       Idea status: APPROVED
                              ↓
                       Push to destinations
```

Approval queue: `<ApprovalsInbox>` shows pending items. Each item shows:
- Subject (idea title + thumbnail)
- Request type (analyze / score / push / prd / arch / roadmap)
- Payload (what's being approved)
- Requested by + timestamp
- "Decide" button → `<ApprovalQueuePanel>` opens decision modal

Decision types:
- `approve` — green check, proceeds
- `deny` — red X, sets status=REJECTED
- `request_changes` — amber, sends back with reason

---

## Push Pipeline (Jira / Confluence / Architecture Center)

`POST /ideas/{id}/push/jira` creates:
- 1 epic in target project
- N stories (one per suggested_capability + persona)
- 1 confluence page with PRD content
- 1 architecture center entry (if arch_preview exists)

`POST /push/all` orchestrates all three in order with rollback on failure.

Every push writes a `PushRecord` row:
```typescript
interface PushResult {
  target: 'jira' | 'confluence' | 'architecture' | 'all';
  success: boolean;
  external_ref?: string;  // e.g. "PROJ-1234" or page URL
  error?: string;
  record_id: string;      // for audit trail
}
```

`GET /push/history` lists all past pushes for an idea (audit trail).

---

## CaptureModal (Global, ⌘N)

Opens from anywhere in the app. Prefills with current page context:
- From `/agents` → title prefilled with agent name
- From `/workflows` → title prefilled with workflow name
- From `/stories` → title prefilled with story title

Fields:
- Title (required, 200 char max)
- Description (required, 4000 char max)
- Source (default: `USER`; auto-set if launched from signal pages)
- Tags (chips)
- Attachments (drag-drop, max 5 files, 10MB each)

Submit → `POST /ideas` → redirects to `/ideation?tab=ideas&highlight={id}`.

---

## OneClickPipelineDrawer

Per-idea drawer that runs the full pipeline (analyze → score → PRD → arch → push) in one click with human approval gates between phases.

Visible from IdeaCard menu → "Run pipeline".

States:
- `IDLE` — "Run pipeline" CTA
- `RUNNING` — Phase progress bar + cancel button
- `PAUSED_AT_APPROVAL` — "Approve to continue" prompt
- `COMPLETED` — Summary card with all outputs + links
- `FAILED` — Error banner with retry button

---

## Real-Time Workflow WS (`backend/app/api/ws/ideation/workflow.py`)

For long-running ideation workflows (multi-step LLM chains), the WS endpoint provides:
- Live step progress (`step_started` / `step_completed` / `step_failed`)
- State snapshots (`state` events)
- Human intervention (`intervene` messages: skip / retry / modify / cancel)

JWT auth happens via the first `{"type": "auth", "token": "..."}` frame. WS closes if auth fails or heartbeat (ping/pong) is lost.

---

## Edge cases

| State | Treatment |
|---|---|
| **No ideas** | Empty state + CaptureModal trigger + "Ingest from sources" CTA |
| **Idea in NEW** | Status pill `intake` + "Analyze" CTA |
| **Idea in ANALYZING** | Status pill `scoring` + cyan pulse + "LLM reasoning..." |
| **Idea in SCORED** | Status pill `discovery` + score badge + "Generate PRD" CTA |
| **Idea in IN_ROADMAP** | Status pill `prd` + roadmap link |
| **Idea APPROVED** | Status pill `approved` + emerald + "Push to destinations" CTA |
| **Idea REJECTED** | Status pill `rejected` + muted + reason tooltip |
| **Idea ARCHIVED** | Status pill `archived` + muted (filter default excludes) |
| **LLM analysis fails** | Status: ANALYZING → NEW + error banner + "Retry" |
| **Score override** | Original score preserved + override row + "Override by {user}" badge |
| **PRD section edit conflict** | Server returns 409 with latest version; UI shows "Newer version exists" modal |
| **Push to Jira fails** | Roll back partial push; surface error in PushResult; offer retry |
| **Push to all destinations fails midway** | Compensating transaction — undo successful pushes from earlier destinations |
| **Approval timeout** | After 7 days, approval auto-denied with reason "No response" |
| **Concurrent idea edit** | Optimistic locking via `updated_at`; 409 on conflict |
| **Daily ingest job fails** | `IngestIndicator` shows rose + error + "Retry" CTA |
| **WS disconnect mid-workflow** | Auto-reconnect with session resume; UI shows "Reconnecting..." |
| **Idea created from signal** | `source: SIGNAL` + original signal URL preserved in attachments |
| **`prefers-reduced-motion`** | Pulse animations disabled; status dots static |

---

## Forbidden patterns

AI agents modifying Ideation MUST NOT:

- ❌ Auto-approve approvals — Rule 3 enforcement (human must decide)
- ❌ Bypass LiteLLM proxy for LLM analysis — Rule 1
- ❌ Skip tenant scoping on idea queries — Rule 2
- ❌ Skip audit logging on push / approve / archive — Rule 6
- ❌ Mix backend `IdeaStatus` and frontend `IdeaStatus` names in API calls — always use backend names server-side, frontend names UI-side
- ❌ Use the legacy mock layer (`lib/ideation/data.ts`) for new features — use `useIdeaEnhance` / `usePushIdeaToJira` hooks
- ❌ Add a new `PushTarget` without updating both backend enum AND frontend `PushResult.target`
- ❌ Add a new approval `request_type` without updating ApprovalQueuePanel rendering
- ❌ Skip `editor_note` propagation when enhancing — enhance requires context
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Skip OAuth state validation in WS auth frame
- ❌ Implement concurrent idea edits without optimistic locking

---

## Verification checklist

- [ ] `/ideation` renders 10 tabs with badges
- [ ] ⌘N opens CaptureModal with prefilled context
- [ ] CaptureModal → POST /ideas creates idea with status=NEW (frontend: intake)
- [ ] IdeaCard "Analyze" → POST /analyze → status transitions to ANALYZING then SCORED
- [ ] IdeaAnalysisRead shows reasoning_chain + evidence + risks + confidence
- [ ] ScoreBadge renders RICE breakdown on idea cards
- [ ] Score override → POST /score/override writes hybrid score + audit row
- [ ] Kanban drag-drop → PATCH /ideas/{id} with new status (optimistic)
- [ ] List / Timeline views share same Idea[] data
- [ ] RoadmapTimeline shows 4 horizons (now / next / later / future)
- [ ] PRDList shows 2 seeded PRDs (Step 57 v2)
- [ ] PRDViewer renders sections with section-level edit
- [ ] PRD section edit → PATCH /prds/{id}/sections/{section} updates one section
- [ ] PRD submit → POST /prds/{id}/submit creates approval request
- [ ] ApprovalsInbox shows 3 pending approvals (Step 57 v2)
- [ ] Approval decide → POST /approvals/{id}/decide with decision + reason
- [ ] "Push to Jira" → POST /push/jira creates epic + stories + writes PushRecord
- [ ] "Push to all" → POST /push/all orchestrates Jira + Confluence + Arch
- [ ] Push history → GET /push/history returns all past pushes
- [ ] SourcesTab shows 6 seeded connectors (Step 55)
- [ ] DestinationsTab shows Jira + Confluence + Arch Center config
- [ ] MarketSignalsTab shows recent signals per source
- [ ] CustomerVoiceTab shows verbatim quotes with sentiment
- [ ] ArchPreviewGrid renders 2 arch previews (if seeded)
- [ ] ArchPreviewGraph shows nodes + edges
- [ ] ArchPreview regenerate → POST /arch-preview/regenerate
- [ ] Daily ingest indicator shows last-run status
- [ ] WS workflow session opens, sends step events, allows intervene
- [ ] IngestIndicator shows rose + retry on daily job failure
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — kanban dot colors, status pill tones
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R5 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (12 sub-routers)
- [DB schema](../reference/db-schema.md) — `ideas`, `idea_analyses`, `opportunity_scores`, `roadmaps`, `prds`, `arch_previews`
- [Dashboard](./dashboard.md) — Ideation widget on dashboard
- [Agent Center](./agent-center.md) — Some agent types (ideation-enhancer, scoring-agent)
- [Connector Center](./connector-center.md) — Sources tab uses ConnectorPicker
- [Architecture Center](./architecture-center.md) — Push destination for arch previews
- [Knowledge Center](./knowledge-center.md) — `search_knowledge` tool used in analysis
- [Co-pilot](./copilot.md) — Draft idea via "Draft a new idea" action
- [Settings](./settings.md) — Ideation defaults tab
- [Audit](./audit.md) — every ideation action logged

---

## Maintenance notes

**When to update this doc:**

- A new tab added → update 10-tab list + TABS array
- A new `IdeaSource` added → update 5-kind table
- A new approval `request_type` added → update ApprovalsInbox rendering
- A new `PushTarget` added → update push pipeline + PushResult type
- Status name divergence fixed (frontend ↔ backend) → update status tables

**Files to keep in sync (the lock-step triangle):**

```
backend/app/api/v1/ideation/                  ←  12 sub-routers (~56 routes)
backend/app/db/models/ideation.py             ←  5 enums (IdeaSource, IdeaStatus, ScoreSource, RoadmapHorizon, RoadmapStatus, PRDStatus)
backend/app/schemas/ideation.py               ←  Pydantic source of truth
backend/app/services/ideation/                ←  Analysis + scoring + push services
backend/app/api/ws/ideation/workflow.py       ←  Real-time WS endpoint
         ↓
apps/forge/lib/ideation/data.ts               ←  Legacy mock layer + TS types
apps/forge/lib/ideation/pipeline-data.ts      ←  Pipeline enrichment
apps/forge/lib/hooks/useIdeaEnhance.ts        ←  TanStack enhance hook
apps/forge/lib/hooks/usePushIdeaToJira.ts     ←  TanStack push hook
apps/forge/lib/hooks/useIdeationIngestStatus.ts ←  TanStack ingest hook
apps/forge/lib/hooks/useIdeationHotkeys.ts    ←  Keyboard shortcuts
         ↓
apps/forge/app/ideation/page.tsx              ←  10-tab index
apps/forge/components/ideation/               ←  25+ components (Kanban, List, Timeline, PRDViewer, etc.)
apps/forge/components/ideation/CaptureModal.tsx ←  ⌘N global capture
apps/forge/components/ideation/OneClickPipelineDrawer.tsx ←  Per-idea pipeline run
```

If any link in this chain drifts, the Ideation Center breaks silently. Always update all links.

---

## Status name divergence note (IMPORTANT)

The backend `IdeaStatus` and frontend `IdeaStatus` enums use **different names** for the same logical states:

| Backend | Frontend | Logical meaning |
|---|---|---|
| `NEW` | `intake` | Just captured, no work done |
| `ANALYZING` | `scoring` | LLM reasoning in progress |
| `SCORED` | `discovery` | Analyzed + scored, ready for review |
| (PRD created) | `prd` | PRD drafted, awaiting approval |
| `APPROVED` | `approved` | Approved for delivery |
| `REJECTED` | `rejected` | Denied, archived |
| `IN_ROADMAP` | `shipped` | In roadmap + pushed |

AI agents must:
- Send backend names in API calls (POST /ideas, PATCH /ideas/{id})
- Display frontend names in UI
- Use the adapter (`wireToIdea` / `ideaToWire`) when converting between layers
- Document any divergence in code comments when adding new states

This divergence exists because:
- Backend uses workflow-pipeline semantics (NEW → ANALYZING → SCORED)
- Frontend uses user-facing semantics (intake → scoring → discovery → prd → shipped)

Both are correct in their respective layers. The adapter is the contract.