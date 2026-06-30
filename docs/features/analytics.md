# Feature: Analytics Center (LLM Usage + Drill-Downs)

> **Status:** Wired to real backend (F-829 Phase C — Per-tenant + Per-workflow LLM usage)
> **Routes:** `apps/forge/app/analytics/page.tsx` (Bento) + `apps/forge/app/analytics/usage/page.tsx` (LLM Usage) + `apps/forge/app/analytics/usage/workflow/[run_id]/page.tsx` (Drill-down)
> **Backend:** `backend/app/api/v1/analytics_usage.py` (2 routes)
> **Integration:** `backend/app/integrations/litellm/usage_query.py` (60s Redis cache + Postgres aggregation)
> **Components:** 19 analytics components + 3 LLM components
> **Constitutional rules:** R1 (LiteLLM proxy — all LLM data flows through it), R2 (multi-tenant), R6 (auditability)

---

## Purpose

The Analytics Center is the **observability surface for LLM spend and behavior**. It shows where the money goes, who spent it, and which workflows are expensive. All data flows from **LiteLLM call records** (the audit table populated by `ForgeLLMClient`) — never from direct SDK logs.

Per PRD §1.4 the Analytics Center serves **all four personas** — but with different lenses:
- **Engineers** — drill into a workflow run to see why it cost $X
- **Tech leads** — find the most expensive workflows + agents
- **Operators** — watch the live burn rate
- **Stewards** — verify cost governance (tenant-level caps)

**Key capabilities:**

**Main Bento dashboard (`/analytics`):**
- **4 KPI cards** — Total cost / Active runs / Acceptance rate / Knowledge reuse
- **8 chart widgets** in 4 rows:
  - Cost trend (area) + Runs by status (stacked bar)
  - Acceptance (line) + Agent usage (horizontal bar) + Approval latency (p50/p95/p99 fan)
  - Knowledge reuse (radial gauge) + Token usage by model (pie or stacked bar)
  - Provider cost (stacked bar) + Provider leaderboard (Top 3)
- **DateRangePicker** + Compare toggle + Export menu
- **60s polling** on backend (cache TTL)

**LLM Usage dashboard (`/analytics/usage`):**
- **Per-tenant aggregate** — total cost, prompt + completion tokens, calls, by-model breakdown, by-user breakdown
- **UsageChart** — cost timeline (single-point for now; future per-bucket timeseries)
- **ModelUsageBreakdown** — pie by model
- **UserUsageTable** — top spenders
- **60s polling** via `setInterval`

**Per-workflow drill-down (`/analytics/usage/workflow/{run_id}`):**
- **Cost + calls** for a single workflow run
- Backed by `GET /api/v1/analytics/usage/workflow/{run_id}`

---

## Architecture

```
AnalyticsCenterPage (/analytics)
└── Bento layout (Step 7 rebuild)
    ├── HeroBand (animated gradient border)
    ├── DateRangePicker + Compare + Export
    ├── KPI strip (4 cards with sparklines)
    └── Chart grid (8 widgets in 4 rows)
        ├── Row 1: Cost trend + Runs by status
        ├── Row 2: Acceptance + Agent usage + Approval latency
        ├── Row 3: Knowledge reuse + Token usage
        └── Row 4: Provider cost + Provider leaderboard

UsageDashboardPage (/analytics/usage)
└── LLM Usage dashboard (F-829 Phase C)
    ├── KPICard (cost + tokens + calls)
    ├── UsageChart (cost timeline)
    ├── ModelUsageBreakdown (pie)
    └── UserUsageTable (top spenders)
    └── 60s polling

WorkflowUsagePage (/analytics/usage/workflow/[run_id])
└── Per-workflow drill-down
    ├── KPICard (Cost)
    └── KPICard (Calls)

Backend
└── /analytics/usage → usage_query.get_tenant_usage()
        ├── Redis cache hit (60s TTL)
        └── Postgres aggregation (litellm_call_records)
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/analytics` | AnalyticsCenterPage | Main Bento dashboard |
| `/analytics/usage` | UsageDashboardPage | LLM Usage dashboard |
| `/analytics/usage/workflow/[run_id]` | WorkflowUsagePage | Per-workflow drill-down |

### Backend (FastAPI) — `backend/app/api/v1/analytics_usage.py` — **2 routes**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/analytics/usage` | Per-tenant LLM usage aggregate |
| `GET` | `/api/v1/analytics/usage/workflow/{run_id}` | Per-workflow drill-down |

Both routes delegate to `app.integrations.litellm.usage_query` (the integration layer).

---

## Data touched

### Tables queried

| Table | Purpose |
|---|---|
| `litellm_call_records` | Per-call LLM usage (model + tokens + cost) |

### Tables (Redis cache)

| Key | Purpose |
|---|---|
| `forge:litellm:usage:<tenant_id>:<since_unix>:<until_unix>` | Cached usage snapshot (TTL: 60s) |

### Pydantic schemas (the `to_dict()` shape)

```python
# backend/app/integrations/litellm/usage_query.py
def to_dict(self) -> dict[str, Any]:
    """JSON-serializable view for the API + Redis cache."""
    return {
        "total_cost_usd": round(self.total_cost_usd, 4),
        "prompt_tokens": self.prompt_tokens,
        "completion_tokens": self.completion_tokens,
        "calls": self.calls,
        "by_model": [
            {"model": b.model, "cost_usd": round(b.cost_usd, 4), "calls": b.calls}
            for b in self.by_model
        ],
        "by_user": [
            {"actor_id": b.actor_id, "cost_usd": round(b.cost_usd, 4), "calls": b.calls}
            for b in self.by_user
        ],
        "since": self.since.isoformat() if self.since else None,
        "until": self.until.isoformat() if self.until else None,
        "cached": self.cached,
    }
```

Per-workflow:

```python
{
    "workflow_id": str,
    "cost_usd": float,      # 4 decimal places
    "calls": int,
}
```

### TypeScript mirror (`apps/forge/lib/litellm/usage.ts`)

```typescript
export async function getTenantUsage(
  tenantId: string,
  params: { since?: string; until?: string } = {},
): Promise<TenantUsagePayload | null> {
  const url = new URL(`${SERVER_BASE}/api/v1/analytics/usage`);
  url.searchParams.set('tenant_id', tenantId);
  if (params.since) url.searchParams.set('since', params.since);
  if (params.until) url.searchParams.set('until', params.until);
  const res = await fetch(url.toString(), { cache: 'no-store' });
  return safeJson<TenantUsagePayload>(res);
}

export async function getWorkflowUsage(tenantId: string, workflowId: string, ...): Promise<...>
```

---

## Cache Strategy (60s Redis)

```python
# backend/app/core/config.py
litellm_usage_cache_ttl_seconds: int = 60

# backend/app/integrations/litellm/usage_query.py
def _cache_key(tenant_id, since, until) -> str:
    return (
        f"forge:litellm:usage:{tenant_id}:"
        f"{int(since.timestamp())}:{int(until.timestamp())}"
    )
```

**Format mirrors `freshness_ledger.py:57`:** `forge:<domain>:<tenant_id>:<entity_id>`.

**Graceful degradation:** When Redis is unavailable, the cache miss is logged at warning and the SQL path serves a fresh result (slower, but correct).

> "The result of `UsageQuery.get_tenant_usage` is cached in Redis at `forge:litellm:usage:<tenant_id>:<since>:<until>` for `settings.litellm_usage_cache_ttl_seconds` (default 60s) so the dashboard's 60s polling cycle does not hammer Postgres."

---

## Usage Query Path

```
1. Frontend: getTenantUsage(tenantId, {since, until})
       ↓
2. Backend: GET /api/v1/analytics/usage?tenant_id=...&since=...&until=...
       ↓
3. _parse_iso(since) and _parse_iso(until)
   - Default until = now
   - Default since = until - 24h
       ↓
4. usage_query.get_tenant_usage(tenant_id, since_dt, until_dt)
       ↓
5. Redis cache check
   - HIT → return cached payload (with `cached: true`)
   - MISS → Postgres aggregation → cache write → return
       ↓
6. to_dict() → JSON-serializable payload + cache_ttl_seconds
       ↓
7. Frontend renders chart + breakdown + table
```

---

## Frontend Polling

```typescript
// /analytics/usage
const refresh = React.useCallback(async () => {
  if (!tenantId) return;
  setLoading(true);
  try {
    const data = await getTenantUsage(tenantId);
    setPayload(data);
  } finally {
    setLoading(false);
  }
}, [tenantId]);

React.useEffect(() => {
  refresh();
  const id = window.setInterval(refresh, 60_000);  // 60s polling
  return () => window.clearInterval(id);
}, [refresh]);
```

**60s matches the Redis cache TTL** — every poll can hit fresh cache without re-querying Postgres.

---

## Main Analytics Center Bento

### 4 KPI Cards

| KPI | Source | Visual |
|---|---|---|
| **Total cost** | `total_cost_usd` (sum of calls) | $X.XX with delta + 40px sparkline |
| **Active runs** | `run_count_24h` from audit | Number with delta + sparkline |
| **Acceptance rate** | QA pass / total tests | % with trend + sparkline |
| **Knowledge reuse** | KG hits / total searches | % with delta + sparkline |

### 8 Chart Widgets (4 rows)

**Row 1 — Operational:**
- **Cost trend** — Area chart (indigo gradient), 30-day window
- **Runs by status** — Stacked bar (Queued / Running / Succeeded / Failed / Cancelled)

**Row 2 — Quality:**
- **Acceptance** — Line chart (pass rate over time)
- **Agent usage** — Horizontal bar (top 10 agents by cost)
- **Approval latency** — Area chart with p50/p95/p99 fan

**Row 3 — Knowledge:**
- **Knowledge reuse** — Radial gauge + delta
- **Token usage by model** — Pie (≤5 models) or stacked bar (>5)

**Row 4 — Providers:**
- **Provider cost breakdown** — Stacked bar (per-model cost)
- **Provider leaderboard** — Top 3 providers (numeric rank chip)

### UX Rules Applied (per docstring)

> - **style / Data-Dense Dashboard** — 12-column Bento grid (`grid-cols-1 lg:grid-cols-12 gap-4`), 8 chart widgets in 4 rows, compact typography (12-14px chart titles), `max-w-[1600px]` container, loading skeletons (no spinners)
> - **style / Executive Dashboard** — exactly 4 KPI cards (under the 4-6 cap), each with semantic Lucide icon, signed delta, 40px sparkline
> - **chart / Multi-Variable Comparison** — Token usage pie only when ≤5 models; stacked bar fallback otherwise
> - **ux / Color Only (HIGH severity)** — KPI deltas pair accent color with `ArrowUp` / `ArrowDown` / `Minus` glyphs; stacked bar legend renders status names; provider leaderboard ranks as numeric chips; DateRangePicker active pill uses both indigo fill AND `aria-pressed` text
> - **ux / Heading Hierarchy (MEDIUM)** — h1 → h2 → h3 sequential, no skipped levels
> - **ux / Empty State** — `BarChart3` illustration, descriptive title, two primary actions ("Run your first command", "How analytics works"), row of suggestion chips (`forge-review`, `forge-arch-adr`, `forge-test-unit`, `forge-deploy-preview`)
> - **`prefers-reduced-motion`** — gates `RadialGauge` animation; zeros `.hero-border` rotation + `.shimmer`

---

## 19 Analytics Components (`apps/forge/components/analytics/`)

| Component | Lines | Purpose |
|---|---|---|
| `AnalyticsSkeletons.tsx` | 180 | Loading skeletons (per chart type) |
| `ApprovalLatencyAreaChart.tsx` | 168 | p50/p95/p99 fan area |
| `RunsChart.tsx` | (in folder) | Runs by status stacked bar |
| `ProviderLeaderboard.tsx` | 151 | Top 3 providers |
| `RadialGauge.tsx` | 151 | Knowledge reuse gauge |
| `KpiTile.tsx` | 146 | Generic KPI tile |
| `HorizontalBarCard.tsx` | 131 | Top N agents |
| `AnalyticsKpiCard.tsx` | 131 | Main KPI card with sparkline |
| `ExportMenu.tsx` | 138 | Export (CSV / JSON / PNG) |
| `TokenUsageByModel.tsx` | 127 | Pie / stacked bar |
| `DateRangePicker.tsx` | 115 | Date range presets |
| `ApprovalLatencyArea.tsx` | 82 | Approval latency area |
| `KnowledgeReuseGauge.tsx` | 78 | KG reuse gauge |
| `AnalyticsHero.tsx` | 75 | Hero band |
| `AnalyticsCompareToggle.tsx` | 63 | Compare mode toggle |
| `AcceptanceChart.tsx` | 64 | QA pass rate line |
| `CostChart.tsx` | 61 | Cost area chart |
| `AgentUsageChart.tsx` | 58 | Agent usage horizontal bar |
| `RunsChart.tsx` | 64 | Runs by status (re-listed) |
| `LatencyHistogram.tsx` | 51 | Latency histogram |
| `KPICard.tsx` | 67 | Simple KPI card (used in usage page) |
| **Total** | **2,101** | |

### 3 LLM Components (`apps/forge/components/analytics/llm/`)

| Component | Purpose |
|---|---|
| `UsageChart.tsx` | Cost timeline (single-point) |
| `ModelUsageBreakdown.tsx` | Pie by model |
| `UserUsageTable.tsx` | Top spenders |

---

## Per-Workflow Drill-Down (`/analytics/usage/workflow/[run_id]`)

```typescript
// apps/forge/app/analytics/usage/workflow/[run_id]/page.tsx
export default function WorkflowUsagePage({ params }: { params: { run_id: string } }) {
  const tenantId = useTenantId();
  const runId = decodeURIComponent(params.run_id);
  const [payload, setPayload] = React.useState<{
    workflow_id: string;
    cost_usd: number;
    calls: number;
  } | null>(null);

  React.useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const data = await getWorkflowUsage(tenantId, runId);
      if (!cancelled) setPayload(data);
    })();
    return () => { cancelled = true; };
  }, [tenantId, runId]);

  return (
    <AdminShell>
      <PageHeader
        eyebrow="Analytics · Workflow"
        title={runId}
        icon={<Activity className="h-4 w-4" />}
        description="LLM cost + call count for this workflow run."
      />
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <KPICard label="Cost (USD)" value={`$${(payload?.cost_usd ?? 0).toFixed(4)}`} />
        <KPICard label="Calls" value={String(payload?.calls ?? 0)} />
      </section>
    </AdminShell>
  );
}
```

Returns 2 KPI cards: **Cost (USD)** and **Calls**.

---

## Edge cases

| State | Treatment |
|---|---|
| **No data** | Empty state + `BarChart3` + "Run your first command" + "How analytics works" CTAs |
| **Loading** | Chart-specific shimmer skeletons (no spinners) |
| **Redis down** | Graceful degradation — SQL path serves fresh result (slower but correct) |
| **Cache miss + Postgres slow** | Cache miss logged at warning; query continues |
| **Invalid ISO timestamp** | 400 `Invalid ISO-8601 timestamp: 'foo'` |
| **Unknown run_id** | Returns empty drill-down (cost_usd=0, calls=0) |
| **Token usage > 5 models** | Auto-fallback to stacked bar (per chart guidance) |
| **Run status: all zero** | KPI cards show `$0` / `0` / `0%` |
| **`prefers-reduced-motion`** | `.hero-border` rotation + `.shimmer` disabled; `RadialGauge` static |

---

## Forbidden patterns

AI agents modifying Analytics MUST NOT:

- ❌ Query LLM provider SDKs directly — Rule 1 (via `litellm_call_records` table)
- ❌ Skip tenant scoping on usage queries — Rule 2
- ❌ Skip the 60s Redis cache — every dashboard poll must be cache-friendly
- ❌ Render exact cost with >4 decimal places (privacy + readability)
- ❌ Bypass `usage_query` — direct SQL queries break cache consistency
- ❌ Skip audit logging on usage export — Rule 6
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use chart-specific skeletons
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Render color-only KPIs — must pair color with `ArrowUp` / `ArrowDown` / `Minus`
- ❌ Skip heading hierarchy — h1 → h2 → h3 sequential, no skipped levels

---

## Verification checklist

- [ ] `/analytics` renders Bento with 4 KPI cards + 8 chart widgets
- [ ] `/analytics/usage` renders LLM Usage dashboard
- [ ] `/analytics/usage/workflow/[run_id]` renders per-workflow drill-down
- [ ] `curl .../analytics/usage?tenant_id=...` returns aggregated payload
- [ ] `curl .../analytics/usage/workflow/{run_id}?tenant_id=...` returns cost + calls
- [ ] `since=2026-06-01T00:00:00Z&until=2026-06-30T23:59:59Z` filters by date range
- [ ] Default `since` is `until - 24h`
- [ ] Redis cache hit returns `cached: true`
- [ ] Redis cache miss logs warning + serves fresh SQL result
- [ ] `litellm_usage_cache_ttl_seconds = 60` matches dashboard 60s polling
- [ ] Invalid ISO timestamp returns 400
- [ ] `by_model` + `by_user` arrays populated
- [ ] KPI cards show correct totals with deltas + sparklines
- [ ] Token usage pie renders for ≤5 models, stacked bar for >5
- [ ] Approval latency p50/p95/p99 fan renders correctly
- [ ] Provider leaderboard shows Top 3
- [ ] DateRangePicker presets (24h / 7d / 30d / 90d) work
- [ ] Export menu (CSV / JSON / PNG) downloads
- [ ] Empty state renders when no data
- [ ] Loading skeletons render during fetch
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — chart tokens
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (2 routes)
- [DB schema](../reference/db-schema.md) — `litellm_call_records`
- [Dashboard](./dashboard.md) — "Today's cost" widget
- [Terminal](./terminal.md) — Terminal cost feeds Analytics
- [Workflows](./workflows.md) — Per-workflow cost via drill-down
- [Agent Center](./agent-center.md) — Top agent usage
- [Governance](./governance.md) — Per-tenant cost caps
- [Settings](./settings.md) — Tenant default budgets
- [Admin Hub](./admin-hub.md) — Virtual Key lifecycle affects usage
- [Co-pilot](./copilot.md) — Per-conversation cost feeds Usage dashboard

---

## Maintenance notes

**When to update this doc:**

- A new chart widget added → update 8-widget bento
- A new KPI added → update 4-KPI strip
- Cache TTL changed → update `litellm_usage_cache_ttl_seconds`
- A new drill-down added → update Routes table
- A new usage query endpoint added → update 2-route backend list

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/analytics_usage.py             ←  2 routes (tenant + workflow)
backend/app/integrations/litellm/usage_query.py   ←  UsageQuery + Redis cache
backend/app/core/config.py                       ←  litellm_usage_cache_ttl_seconds = 60
backend/app/db/models/litellm_call_record.py      ←  LiteLLMCallRecord table
         ↓
apps/forge/lib/litellm/usage.ts                  ←  getTenantUsage + getWorkflowUsage
         ↓
apps/forge/app/analytics/page.tsx                ←  Bento dashboard
apps/forge/app/analytics/usage/page.tsx           ←  LLM Usage dashboard
apps/forge/app/analytics/usage/workflow/[run_id]/page.tsx ←  Drill-down
apps/forge/components/analytics/                 ←  19 components (2101 lines)
apps/forge/components/analytics/llm/             ←  3 LLM components
```

If any link in this chain drifts, the Analytics Center breaks silently. Always update all links.

---

## Why Analytics is the truth source

Per Rule 1 (LiteLLM proxy), **every LLM call in Forge flows through LiteLLM**, which records every operation to `litellm_call_records`. This means:

- **No SDK call escapes metering** — even direct library calls are wrapped
- **Cost is exact** — derived from LiteLLM's pricing model, not estimated
- **Token counts are exact** — returned by the upstream provider, not estimated
- **By-model breakdown is accurate** — no provider SDK aggregation needed
- **By-user breakdown is accurate** — `X-Forge-Persona` header carries user attribution

The 60s Redis cache + Postgres aggregation gives **near-real-time cost visibility** without hammering the database. A Steward watching `/analytics/usage` sees their tenant's spend within 60s of any LLM call.

This is the observability bedrock (Rule 7) for cost governance. Without it, every cost claim would be a guess. With it, every cost claim is auditable.