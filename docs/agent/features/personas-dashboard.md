# Feature: Persona Dashboards (PM / Eng Lead / CTO + Persona Memory)

> **Status:** Working — persona-switching via cookie + 4 distinct dashboards + persona-keyed memory surface
> **Routes:** `apps/forge/app/personas/pm/page.tsx` (114 lines) + `apps/forge/app/personas/eng-lead/page.tsx` (98 lines) + `apps/forge/app/personas/cto/page.tsx` (297 lines) + `apps/forge/app/persona/page.tsx` (145 lines)
> **Persona source:** `forge.persona` cookie via `apps/forge/proxy.ts` → `X-Forge-Persona` header
> **Persona types:** `apps/forge/lib/types.ts` — `Persona = 'pm' | 'eng-lead' | 'steward' | 'cto'`
> **Memory hooks:** `apps/forge/lib/hooks/usePersonaMemory.ts`
> **Memory panel:** `apps/forge/components/persona/PersonaMemoryPanel.tsx` (228 lines)
> **Constitutional rules:** R2 (tenant_id from cookie/JWT), R6 (every persona action logged)

---

## Purpose

The Persona Dashboard surface provides **role-keyed views** of the platform. Each persona sees a different facet of the same underlying data — tailored to what they need to see, not a one-size-fits-all feed.

Per PRD §1.4 the four personas are:

1. **Product Manager (pm)** — PRDs, roadmap, capacity. **Read-only** over orchestrator + memory layer.
2. **Engineering Lead (eng-lead)** — Runs in flight, blocked work, cost. **Read + approve** (pause/resume/cancel).
3. **CTO / VP Eng (cto)** — Throughput, MTTR, audit log, cost by team. **Read-only**.
4. **Steward (steward)** — Governance, audit, compliance. **Full access** (governance surfaces).

The persona is **not** an auth gate — it's a **context value** selected via `forge.persona` cookie that the proxy forwards to the orchestrator as `X-Forge-Persona` header.

---

## Architecture

```
Next.js proxy (apps/forge/proxy.ts)
└── Reads forge.persona cookie on every request
    ├── Falls back to FORGE_PERSONA_DEFAULT = 'developer'
    └── Forwards X-Forge-Persona header to FastAPI

FastAPI orchestrator (deps.py)
└── Reads X-Forge-Persona header
    └── Per-persona RBAC + memory routing

[Persona dashboards]
├── /personas/pm — read-only (PRDs, roadmap, capacity)
├── /personas/eng-lead — read + approve (runs, blocked, cost)
├── /personas/cto — read-only (throughput, MTTR, audit, cost-by-team)
└── /persona — persona-keyed memory surface (coding / architecture / security / ideation / qa / devops)
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/personas/pm` | PmDashboard | PM read-only dashboard |
| `/personas/eng-lead` | EngLeadDashboard | Eng Lead run/approve dashboard |
| `/personas/cto` | CtoDashboard | CTO throughput/audit dashboard |
| `/persona` | PersonaPage | Persona-keyed memory surface |

### Backend (FastAPI) — persona memory surface

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/persona/memory/{key}` | Read persona memory body + recent entries |
| `POST` | `/api/v1/persona/memory/{key}` | Append entry to persona memory |

---

## Data touched

### 4 Persona Types

```typescript
// apps/forge/lib/types.ts
export type Persona = 'pm' | 'eng-lead' | 'steward' | 'cto';

export interface PersonaMeta {
  id: Persona;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
}

export const PERSONAS: ReadonlyArray<PersonaMeta> = [
  {
    id: 'pm',
    label: 'Product Manager',
    shortLabel: 'PM',
    description: 'PRDs, roadmap, capacity. Read-only over orchestrator + memory layer.',
    href: '/personas/pm',
  },
  {
    id: 'eng-lead',
    label: 'Engineering Lead',
    shortLabel: 'Eng Lead',
    description: 'Runs in flight, blocked work, cost. Read + approve (pause/resume/cancel).',
    href: '/personas/eng-lead',
  },
  {
    id: 'cto',
    label: 'CTO / VP Eng',
    shortLabel: 'CTO',
    description: 'Throughput, MTTR, audit log, cost by team. Read-only.',
    href: '/personas/cto',
  },
];
```

> **Note:** Only 3 of 4 personas have a dashboard route. `steward` persona uses the **Governance Center** (`/governance-center`) as its primary surface — see `governance.md`.

### Per-Persona RBAC (Coarse Stub)

```typescript
// apps/forge/lib/auth.ts
const PERSONA_PERMISSIONS: Record<Persona, ReadonlySet<Permission>> = {
  pm:       new Set<Permission>(['seeds:view']),
  'eng-lead': new Set<Permission>(['seeds:view', 'seeds:manage']),
  steward:  new Set<Permission>(['seeds:view', 'seeds:manage']),
  cto:      new Set<Permission>(['seeds:view', 'seeds:manage']),
};
```

> **Caveat from docstring:** "Callers SHOULD treat the return value as best-effort: the backend is still the source of truth (Plan C raises 403 for missing permissions even if the UI thought the persona was allowed)."

This is the **dev stub** — production replaces it with real RBAC from the identity broker (FORA-123).

### 6 Persona Memory Keys

Per `usePersonaMemory.ts` docstring:

```typescript
const PERSONA_MEMORY_KEYS = [
  'coding',        // default for most personas
  'architecture',  // architects
  'security',      // security stewards
  'ideation',      // PMs
  'qa',            // QA leads
  'devops',        // ops leads
] as const;
```

**Files location:** `tenants/<slug>/workspace/memory/personas/<persona>/{coding,architecture,security,ideation,qa,devops}.md` (auto-discovered by the steering engine glob `tenants/*/workspace/memory/personas/*/*.md`).

---

## 3 Persona Dashboards

### PM Dashboard (`/personas/pm`)

**Purpose:** PRDs, roadmap, capacity. **Read-only.**

```typescript
// apps/forge/app/personas/pm/page.tsx
export default async function PmDashboard() {
  const view = await getRunsView();  // Server Component: getRunsView()
  
  return (
    <div className="space-y-8" data-testid="pm-dashboard">
      <header>
        <p className="text-xs uppercase tracking-wider text-forge-300">Persona</p>
        <h1 className="text-2xl font-semibold">Product Manager</h1>
        <p className="text-sm text-forge-200">
          Tenant {SEED_TENANT_NAME}. Read-only view over goals, runs, and stage progress.
        </p>
      </header>
      
      {view.state === 'unreachable' ? <OrchestratorUnreachable view={view} /> : null}
      
      <section className="card" aria-labelledby="runs-h">
        <h2 id="runs-h" className="text-lg font-semibold">Active runs</h2>
        {/* Real orchestrator rows */}
      </section>
    </div>
  );
}
```

**Sections:**
1. **Header** — Persona + Tenant name
2. **Active runs table** — from `GET /v1/runs` (real orchestrator)
3. **Roadmap** — Q-by-Q timeline (placeholder until Goal/Project metadata API ships)
4. **PRDs** — placeholder until DocAgent (FORA-23) ships

**Fallback states:**
- `view.state === 'unreachable'` → `OrchestratorUnreachable` notice
- `view.state === 'ok'` with empty runs → "No runs yet"
- `view.state === 'ok'` with runs → render table

### Engineering Lead Dashboard (`/personas/eng-lead`)

**Purpose:** Runs in flight, blocked work, cost. **Read + approve.**

```typescript
// apps/forge/app/personas/eng-lead/page.tsx
async function fetchRunsForEngLead() {
  'use server';
  const next = await getRunsView();
  return next.state === 'ok' ? next.runs : [];
}

export default async function EngLeadDashboard() {
  const view = await getRunsView();
  
  const runs = view.state === 'ok' ? view.runs : [];
  const blocked = runs.filter(
    (r) => r.status === 'paused' || r.status === 'waiting_approval',
  );
  const total = runs.reduce((acc, r) => acc + Number(r.cost_spent_usd), 0);
  
  return (
    <div className="space-y-8" data-testid="eng-lead-dashboard">
      <header>
        <p>Persona</p>
        <h1>Engineering Lead</h1>
        <p>Tenant {SEED_TENANT_NAME}. Read + operate. Use the action bar to pause, resume, or cancel a run.</p>
      </header>
      
      {view.state === 'unreachable' ? <OrchestratorUnreachable view={view} /> : null}
      
      {/* Runs in flight panel — RealtimeRunsList */}
      {/* Blocked work panel */}
      {/* Cost panel — sums cost_spent_usd */}
    </div>
  );
}
```

**Sections:**
1. **Runs in flight** — `<RealtimeRunsList>` (live updates via `EventSource`)
2. **Blocked work** — runs in `paused` or `waiting_approval`
3. **Cost** — sum of `cost_spent_usd` across all runs
4. **Action bar** — `<RunActions>` per run (pause / resume / cancel)

> **Only persona with `RunActions`** per the FORA-374 spec — eng-lead can operate, others can only read.

### CTO Dashboard (`/personas/cto`) — 297 lines

**Purpose:** Throughput, MTTR, audit log, cost by team. **Read-only.**

```typescript
// apps/forge/app/personas/cto/page.tsx
export default async function CtoDashboard() {
  const view = await getRunsView();
  const allStages = await Promise.all(
    runs.map((r) => getRunStages(r.id).catch(() => []))
  );
  
  const stageMetrics = allStages.flat().reduce((acc, stage) => {
    // Compute: started / finished / pending / totalDurationMs / decisions
    ...
  }, { started: 0, finished: 0, pending: 0, totalDurationMs: 0, decisions: [] });
  
  return (
    <div className="space-y-8" data-testid="cto-dashboard">
      <header>
        <h1>CTO / VP Eng</h1>
        <p>Throughput, MTTR, audit log, cost by team. Read-only.</p>
      </header>
      
      {/* KPI strip: throughput / MTTR / decisions */}
      {/* Audit log feed */}
      {/* Cost by team chart */}
    </div>
  );
}
```

**Sections:**
1. **KPI strip** — Throughput (runs finished / day) + MTTR (mean time to resolve) + Decision count
2. **Audit log** — recent Steward decisions (from `/v1/runs/{id}/stages`)
3. **Cost by team** — group `cost_spent_usd` by tenant_id or owner_id
4. **Stage metrics** — 1 run + 3 started stages + 4 pending + 1 finished (per `demo-run-001` seed)

### Stage Metrics Computation

```typescript
function computeStageMetrics(stages: ReadonlyArray<StageRecord>): StageMetrics {
  let started = 0;
  let finished = 0;
  let pending = 0;
  let totalDurationMs = 0;
  const decisions: Array<{
    stage: StageRecord['stage'];
    by: string;
    at: string;
    reason?: string;
  }> = [];
  
  for (const stage of stages) {
    if (stage.status === 'pending') pending++;
    else if (stage.status === 'finished') finished++;
    else if (stage.status === 'running') started++;
    
    if (stage.duration_ms) totalDurationMs += stage.duration_ms;
    
    if (stage.decision) {
      decisions.push({
        stage: stage.stage,
        by: stage.decision.actor,
        at: stage.decision.at,
        reason: stage.decision.reason,
      });
    }
  }
  
  return { started, finished, pending, totalDurationMs, decisions };
}
```

---

## Persona Memory Surface (`/persona`)

**Purpose:** Per-persona markdown memory file with append log. The "AI-native notepad" for each persona.

### Server Component

```typescript
// apps/forge/app/persona/page.tsx
export default async function PersonaPage() {
  const cookieStore = await cookies();
  const persona = cookieStore.get(FORGE_PERSONA_COOKIE)?.value ?? FORGE_PERSONA_DEFAULT;
  
  const data = await loadPersonaMemory(persona);
  
  return (
    <AdminShell>
      <PersonaMemoryPanel
        persona={data.persona}
        memoryKey="coding"  // Phase 3: hardcoded to 'coding'
        initialBody={data.body}
        initialRecentEntries={data.recentEntries}
      />
    </AdminShell>
  );
}
```

**Default slot:** `coding` (most common persona entry point). Future: persona-aware sidebar would expand to all 6 slots.

### `<PersonaMemoryPanel>` (228 lines)

**3 regions:**

1. **Stable Markdown body** — `<pre>` block with the persona's memory file (e.g. `developer/coding.md`)
2. **Recent entries append log** — last 24h of writes from `persona_memory_history`
3. **Append textarea + submit** — wired to `useAppendPersonaMemory(persona, key)`

**Data-testids:**
- `persona-memory-panel` — root
- `persona-memory-body` — the body `<pre>`
- `persona-memory-append-textarea` — append input
- `persona-memory-append-submit` — submit button
- `persona-memory-recent-entries` — append log section

**Why `<pre>` and not react-markdown:** "react-markdown is not in `apps/forge/package.json` and the task brief explicitly allows the `<pre>` fallback."

### 2 TanStack Query Hooks (`apps/forge/lib/hooks/usePersonaMemory.ts`)

```typescript
export function usePersonaMemory(persona: string, key: string) {
  return useQuery<PersonaMemory>({
    queryKey: personaMemoryQueryKeys.detail(persona, key),
    queryFn: () => readPersonaMemory(key),
    staleTime: 30_000,
    enabled: Boolean(persona && key),
  });
}

export function useAppendPersonaMemory(persona: string, key: string) {
  return useMutation<PersonaMemoryAppendResult, Error, { entry_md: string }>({
    mutationFn: (vars) => appendPersonaMemory(key, vars),
    onSuccess: () => {
      queryClient.invalidateQueries(personaMemoryQueryKeys.detail(persona, key));
    },
  });
}
```

### Backend Contract (`apps/forge/lib/persona/data.ts`)

```typescript
export interface PersonaMemoryEntry {
  readonly written_at: string;
  readonly entry_md: string;
}

export interface PersonaMemory {
  readonly body: string;
  readonly recent_entries: ReadonlyArray<PersonaMemoryEntry>;
}

export interface PersonaMemoryAppendResult {
  readonly ok: true;
}
```

**Endpoints:**
- `GET /api/v1/persona/memory/{key}` → `{ body, recent_entries[] }`
- `POST /api/v1/persona/memory/{key}` with `{ entry_md }` → `{ ok: true }`

**Header forwarding:** `X-Forge-Persona` set by `apps/forge/proxy.ts` so backend knows which persona's memory file to read/write.

---

## Persona Cookie Flow

### Cookie Name

```typescript
// apps/forge/lib/auth.ts
export const PERSONA_COOKIE_NAME = 'forge.persona';

// apps/forge/proxy.ts
export const FORGE_PERSONA_COOKIE = 'forge.persona';
```

**30-day cookie** with `SameSite=Lax`:

```typescript
export function personaCookie(value: Persona): string {
  const maxAge = 60 * 60 * 24 * 30;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
```

### Proxy (Next.js 16 convention)

```typescript
// apps/forge/proxy.ts
export const FORGE_PERSONA_DEFAULT = 'developer';

export const config = {
  matcher: ['/((?!_next/|api/|favicon.ico|.*\\..*).*)'],
};

export function proxy(request: NextRequest) {
  const persona = readPersonaFromRequest(request);
  const forwarded = new Headers(request.headers);
  forwarded.set(FORGE_PERSONA_HEADER, persona);
  return NextResponse.next({ request: { headers: forwarded } });
}
```

**`FORGE_PERSONA_HEADER = 'X-Forge-Persona'`** — read by FastAPI `deps.py`.

### Backend fallback

> "If the cookie is absent the proxy falls back to the tenant default persona (`developer`) — the backend `Tenant.default_persona` column also defaults to `'developer'`, so the two sides stay in lockstep."

---

## Real Backend Integration

### `getRunsView()` server-side helper

```typescript
// Used by all 3 persona dashboards
const view = await getRunsView();

if (view.state === 'unreachable') {
  // Render OrchestratorUnreachable notice
} else {
  // view.state === 'ok' → view.runs[]
}
```

**Backed by:** `GET /v1/runs` (LangGraph orchestrator).

### `getRunStages(runId)` per-run helper

```typescript
// Used by CTO dashboard
const stages = await getRunStages(run.id).catch(() => []);
```

**Backed by:** `GET /v1/runs/{id}/stages`.

### `FORA-379` seed

> "the active-runs table now renders real rows from the orchestrator's `GET /v1/runs` index (backed by the seed run id `demo-run-001` after `scripts/dev-up.sh`)."

Seed run `demo-run-001`:
- Goal: `demo-goal-forge`
- Status: `running`
- Stage: `architect`
- Spent: $0 of $100 ceiling
- Started stages: 3 (ideation finished, architect + dev running)
- Pending stages: 4 (qa / security / devops / docs)
- Finished stages: 1 (ideation, 3 min duration)

---

## OrchestratorUnreachable Component

When `getRunsView()` returns `state === 'unreachable'`:

```typescript
<OrchestratorUnreachable view={view} />
```

**Renders:**
- "—" placeholder for all metrics
- Honest explanation: "Orchestrator unreachable. Check `pnpm dev:up` and confirm FastAPI is on :8000."
- Honest fallback (NOT empty state — explicit failure mode)

> "When the orchestrator is unreachable, the same `OrchestratorUnreachable` notice from the PM/EngLead pages replaces the metrics with `—` and an honest explanation."

---

## Read-Only / Approve-Only / Full-Access Matrix

| Persona | pm | eng-lead | steward | cto |
|---|---|---|---|---|
| View runs | ✓ | ✓ | ✓ | ✓ |
| Pause/resume/cancel runs | ❌ | ✓ | ❌ | ❌ |
| Settings | ❌ | ✓ | ✓ | ✓ |
| Members | ❌ | ✓ | ✓ | ❌ |
| Env vars | ❌ | ✓ | ✓ | ❌ |
| Audit | ❌ | ✓ | ✓ | ✓ |
| Governance | ❌ | ❌ | ✓ | ❌ |
| LLM Gateway | ❌ | ❌ | ✓ | ❌ |
| Org Knowledge | ❌ | ❌ | ✓ | ❌ |
| Persona memory | ✓ | ✓ | ✓ | ✓ |
| Tenant switcher | ✓ | ✓ | ✓ | ✓ |

(Per the cookie-driven persona model — `eng-lead` and `steward` both have `seeds:manage` in the stub, but `steward` is the only one with full admin/gateway access in the real app.)

---

## Edge cases

| State | Treatment |
|---|---|
| **Cookie missing** | Default persona (`eng-lead` per `defaultPersona()`) |
| **Cookie invalid** | Default persona |
| **Orchestrator unreachable** | `OrchestratorUnreachable` notice with `—` placeholders |
| **No runs** | "No runs yet" empty state |
| **No memory entries** | Empty body + empty recent entries |
| **Persona = steward** | Redirects to `/governance-center` |
| **Persona = customer** | Read-only across all surfaces |
| **Memory key mismatch** | 404 from backend |
| **Append fails** | Toast + retry CTA |
| **`prefers-reduced-motion`** | Status pulse animations disabled |

---

## Forbidden patterns

AI agents modifying Personas MUST NOT:

- ❌ Treat persona as auth gate — it's a context value, not security
- ❌ Skip `forge.persona` cookie forwarding — proxy must set `X-Forge-Persona`
- ❌ Hardcode persona in components — read from cookie via `readPersonaFromCookieHeader()`
- ❌ Skip tenant scoping — persona cookie + tenant_id together (Rule 2)
- ❌ Allow eng-lead to bypass Steward approval gates on Architecture/Security/Deployment
- ❌ Render PII in persona memory appends — memory is markdown but can leak
- ❌ Add react-markdown to `apps/forge/package.json` — `<pre>` fallback is canonical
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist

- [ ] `/personas/pm` renders PM dashboard with read-only view
- [ ] `/personas/eng-lead` renders Eng Lead dashboard with run actions
- [ ] `/personas/cto` renders CTO dashboard with throughput + MTTR + audit
- [ ] `/persona` renders persona-keyed memory panel (default `coding` slot)
- [ ] `forge.persona` cookie set via persona form
- [ ] Proxy forwards `X-Forge-Persona` header to FastAPI
- [ ] Switch persona via cookie → reload → new dashboard renders
- [ ] `curl .../persona/memory/coding` returns body + recent_entries
- [ ] `POST .../persona/memory/coding` with `{entry_md}` appends + returns `{ok: true}`
- [ ] Append textarea + submit wired to `useAppendPersonaMemory`
- [ ] Recent entries show last 24h writes
- [ ] `X-Forge-Persona` header propagated end-to-end
- [ ] Orchestrator unreachable → `OrchestratorUnreachable` notice
- [ ] PM persona cannot see `RunActions` (eng-lead only)
- [ ] CTO persona read-only (no approve / cancel)
- [ ] Empty state renders when no runs
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — dashboard tokens
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R2 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — `/persona/memory/{key}` routes
- [DB schema](../reference/db-schema.md) — `persona_memory_history` rows
- [Dashboard](./dashboard.md) — non-persona dashboard (defaults to eng-lead)
- [Runs](./runs.md) — driven by `getRunsView()` helper
- [Audit](./audit.md) — Audit log in CTO persona
- [Governance](./governance.md) — `steward` persona primary surface
- [Settings](./settings.md) — only eng-lead / steward / cto have access
- [Auth](./auth.md) — Production replaces cookie stub with broker JWT

---

## Maintenance notes

**When to update this doc:**

- A new persona added → update 4-persona table
- A new memory key added → update 6-key list
- A new dashboard route added → update 4-route table
- Permissions change → update persona RBAC stub
- Persona memory hook signature changes → update 2-hook list

**Files to keep in sync (the lock-step rectangle):**

```
apps/forge/proxy.ts                             ←  X-Forge-Persona header forwarding
apps/forge/lib/auth.ts                          ←  Persona + cookie helpers + RBAC stub
apps/forge/lib/types.ts                         ←  Persona type + PERSONAS array
apps/forge/lib/persona/data.ts                  ←  Persona memory fetcher
apps/forge/lib/hooks/usePersonaMemory.ts        ←  2 TanStack Query hooks (read + append)
         ↓
apps/forge/app/personas/pm/page.tsx             ←  PM dashboard (114 lines)
apps/forge/app/personas/eng-lead/page.tsx      ←  Eng Lead dashboard (98 lines)
apps/forge/app/personas/cto/page.tsx            ←  CTO dashboard (297 lines)
apps/forge/app/persona/page.tsx                 ←  Persona memory page (145 lines)
apps/forge/components/persona/PersonaMemoryPanel.tsx ←  Memory panel (228 lines)
```

If any link in this chain drifts, the Personas surface breaks silently. Always update all links.

---

## Why persona is a context, not auth

> **"Persona is a context value, not an auth gate: anonymous tenants still see the same shell."**

The persona model works because:

1. **No security boundaries** — `X-Forge-Persona` is informational, not authoritative
2. **Backend is source of truth** — every mutation re-checks RBAC via the real broker (FORA-123)
3. **Cookie can be set by user** — they're choosing what view to see, not what they can do
4. **Steward is the only elevated role** — but Steward actions still go through the same `@audit()` and `require_permission()`

In production, the persona cookie is replaced by a broker JWT claim. The UI is the same; the backend enforcement is stronger. **The cookie is the dev affordance**, not the security model.

This is why the docstring says: *"Callers SHOULD treat the return value as best-effort: the backend is still the source of truth."*