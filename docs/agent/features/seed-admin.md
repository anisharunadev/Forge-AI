# Feature: Seed Management (Steward Surface)

> **Status:** Wired to real backend (F-805 + F-821 — SeedRunner + Seeds API)
> **Route:** `apps/forge/app/admin/seeds/page.tsx` (1 page, Server Component)
> **Backend:** `backend/app/api/v1/seeds.py` (**8 routes**)
> **Service:** `backend/app/services/seed_service.py` (apply/reset/rollback/status/diff)
> **Schema:** `backend/app/schemas/seeds.py`
> **Model:** `backend/app/db/models/seed.py`
> **Frontend seam:** `apps/forge/lib/seeds/` (data.ts + types.ts)
> **Components:** 9 seed components (1065 lines)
> **Constitutional rules:** R2 (multi-tenant — `tenant_id` FK), R4 (typed artifact — `SeedRunRead`), R5 (RBAC — `seeds:view` / `seeds:manage` / `seeds:reset:all`), R6 (auditability — every route decorated `@audit`)

---

## Purpose

The Seed Management surface lets Stewards **apply, reset, rollback, and inspect** the demo seeds that bootstrap a fresh tenant. Every operation is:

- **Idempotent** — re-running `apply` produces the same state
- **Audit-logged** — every route decorated `@audit()`
- **RBAC-enforced** — `seeds:view` to read, `seeds:manage` to mutate, `seeds:reset:all` for destructive reset
- **Drift-detected** — `checksum_match` flag tells you if the seed matches what was applied
- **Multi-tenant safe** — every seed carries `tenant_id` FK; production seeds gated by `allow_in_prod`

This is the **bootstrap surface** for `acme-corp` (the demo tenant). Per the Plan H commit 5 spec, the page is gated by `hasPermission('seeds:view')` and redirects to `/admin` for unauthorized personas.

**Key capabilities:**

- **5 read endpoints** — list / get / status / diff / runs
- **3 mutation endpoints** — apply / reset / rollback
- **3 RBAC scopes** — `seeds:view` / `seeds:manage` / `seeds:reset:all`
- **2 production gates** — `allow_in_prod` override + `production_safe` flag
- **5 lifecycle operations** — apply / reset / rollback / status / diff
- **4 run outcomes** — running / completed / failed / rolled_back
- **3 tenant types** — demo / reference / production
- **4 drift types** — none / checksum / row_count / unknown
- **DemoBanner** + **DemoLoader** — Plan G welcome surfaces

---

## Architecture

```
AdminSeedsPage (/admin/seeds) — Server Component
├── hasPermission('seeds:view') gate
└── Plan H layout
    ├── PageHeader (Sprout icon + "Seed Management")
    ├── Header action row
    │   ├── Target seed label: `acme-corp`
    │   ├── <SeedApplyModal>
    │   ├── <SeedResetModal>
    │   └── <SeedRollbackModal>
    ├── <SeedStatusPanel>
    ├── <SeedDiffView>
    └── <SeedHistoryTable>

DemoBanner (Plan G — global welcome surface)
└── DemoSeedStatus derived from useSeedStatus()

DemoLoader (Plan G — onboarding hook)
└── Polls until `applied === true`

Backend (SeedRunner + SeedService)
└── 8 routes → @audit decorated
    ├── 5 GET routes (RBAC: seeds:view)
    └── 3 POST routes (RBAC: seeds:manage | seeds:reset:*)
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Render mode | Description |
|---|---|---|---|
| `/admin/seeds` | AdminSeedsPage | Server Component | Steward seed management surface |

### Backend (FastAPI) — `backend/app/api/v1/seeds.py` — **8 routes**

| Method | Path | RBAC | Description |
|---|---|---|---|
| `GET` | `/api/v1/seeds` | `seeds:view` | List seed manifest summaries |
| `GET` | `/api/v1/seeds/{name}` | `seeds:view` | Get full manifest (data files + counts) |
| `GET` | `/api/v1/seeds/{name}/status` | `seeds:view` | Durable state + drift |
| `GET` | `/api/v1/seeds/{name}/diff` | `seeds:view` | Expected vs actual row counts |
| `GET` | `/api/v1/seeds/{name}/runs` | `seeds:view` | Run history (apply/reset/rollback) |
| `POST` | `/api/v1/seeds/{name}/apply` | `seeds:manage` | Apply idempotently (201 + SeedRunRead) |
| `POST` | `/api/v1/seeds/{name}/reset` | `seeds:reset:demo_only` or `seeds:reset:all` | Reset (delete rows) |
| `POST` | `/api/v1/seeds/{name}/rollback` | `seeds:manage` | Roll back the most recent apply |

> **Note on docstring:** The seeds.py header says "7 total" but the route file has 8 `@router.` decorators. The 8th (reset) was added in Plan H commit 5 alongside `seeds:reset:demo_only` RBAC scoping.

---

## Data touched

### Tables (`backend/app/db/models/seed.py`)

```python
class SeedOperation(str, Enum):
    """Lifecycle operations the runner can perform."""
    APPLY = "apply"
    RESET = "reset"
    ROLLBACK = "rollback"
    STATUS = "status"
    DIFF = "diff"


class SeedRunStatus(str, Enum):
    """Outcome state for a seed run."""
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


class SeedRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One seed runner invocation (apply, reset, rollback, status, diff)."""

    __tablename__ = "seed_runs"

    seed_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    manifest_version: Mapped[int] = mapped_column(Integer, nullable=False)
    operation: Mapped[SeedOperation] = mapped_column(
        SAEnum(SeedOperation, name="seed_operation"),
        nullable=False,
    )
    status: Mapped[SeedRunStatus] = mapped_column(
        SAEnum(SeedRunStatus, name="seed_run_status"),
        nullable=False,
        default=SeedRunStatus.RUNNING,
    )
    env: Mapped[str] = mapped_column(String(20), nullable=False)
    triggered_by: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    tenant_id: Mapped[UUID | None] = mapped_column(
        GUID(), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True
    )
    project_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    applied_versions: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=list
    )
    # ... row_counts, dropped_rows, checksum_after, duration_ms, error
```

### Pydantic schemas (`backend/app/schemas/seeds.py`)

```python
class SeedManifestSummary(ForgeBaseModel):
    """Light-weight manifest summary for GET /seeds.

    Mirrors the fields the UI needs for the seed list view and the
    admin "Load Demo" picker — name, version, tenant classification,
    short description, and declared dependencies.
    """
    name: str = Field(..., min_length=1, max_length=200)
    version: int = Field(..., ge=1)
    tenant_type: Literal["demo", "reference", "production"] = "reference"
    description: str | None = None
    depends_on: list[str] = Field(default_factory=list)


class SeedDataFileRead(ForgeBaseModel):
    """A single ordered data file declared in a manifest."""
    file: str
    table: str
    order: int
    idempotency_key: list[str]
    description: str | None = None


class SeedManifestRead(SeedManifestSummary):
    """Full manifest payload for GET /seeds/{name}."""
    data_files: list[SeedDataFileRead] = Field(default_factory=list)
    row_counts_expected: dict[str, int] = Field(default_factory=dict)
    production_safety: dict[str, bool] = Field(default_factory=dict)


class SeedRunRead(ForgeBaseModel):
    """Return value for apply/reset/rollback operations.

    Mirrors the dataclass SeedRunner.SeedRun 1:1 but uses Pydantic
    so it can be returned directly from a route handler.
    """
    id: UUID
    seed_name: str
    manifest_version: int
    operation: Literal["apply", "reset", "rollback"]
    status: Literal["running", "completed", "failed", "rolled_back"]
    env: str
    triggered_by: str
    actor_id: UUID
    tenant_id: UUID | None = None


class SeedStatusRead(ForgeBaseModel):
    """Result of GET /seeds/{name}/status."""
    seed_name: str
    applied: bool
    applied_version: int | None = None
    last_run_at: str | None = None
    last_run_status: SeedRunStatus | None = None
    checksum: str | None = None
    checksum_match: bool
    drift: SeedDrift
    row_counts: dict[str, int]
    production_safe: bool


class SeedDiffRead(ForgeBaseModel):
    """Result of GET /seeds/{name}/diff."""
    seed_name: str
    checksum_match: bool
    row_count_changes: dict[str, tuple[int, int]]  # [expected, actual]
    missing_files: list[str]
    extra_rows: dict[str, int]
    summary: str


class SeedApplyRequest(ForgeBaseModel):
    """Body for POST /seeds/{name}/apply.

    `allow_in_prod` is the production-safety override knob — when
    True the runner will skip the demo-vs-production gate. The
    override is itself audited.
    """
    allow_in_prod: bool = False


class SeedResetRequest(ForgeBaseModel):
    """Body for POST /seeds/{name}/reset.

    `scope` controls whether the reset deletes only demo rows
    (`demo_only`) or every row this seed owns (`all`). The latter
    requires the `seeds:reset:all` permission and is Steward-only.
    """
    scope: Literal["demo_only", "all"] = "demo_only"
```

### TypeScript mirror (`apps/forge/lib/seeds/types.ts`)

```typescript
export type SeedOperation = 'apply' | 'reset' | 'rollback' | 'status' | 'diff';

/** Backend SeedRunRead.status literal + a sentinel used by the UI. */
export type SeedRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'drift_detected';

/** Backend SeedManifestSummary.tenant_type + future content pack kind. */
export type SeedTenantType = 'demo' | 'reference' | 'production' | 'customer_seed';

export interface SeedManifestSummary {
  name: string;
  version: number;
  tenant_type: SeedTenantType;
  description: string | null;
  depends_on: string[];
}

export interface SeedDataFileRead {
  file: string;
  table: string;
  order: number;
  idempotency_key: string[];
  description: string | null;
}

export interface SeedManifestRead extends SeedManifestSummary {
  data_files: SeedDataFileRead[];
  row_counts_expected: Record<string, number>;
  /** Free-form knobs; today only `{ allow_in_prod: boolean }` is defined. */
  production_safety: Record<string, boolean>;
}

export interface SeedRunRead {
  id: string;
  seed_name: string;
  manifest_version: number;
  operation: SeedOperation;
  status: SeedRunStatus;
  env: string;
  triggered_by: string;
  actor_id: string | null;
  tenant_id: string | null;
  row_counts: Record<string, number>;
  dropped_rows: Record<string, number>;
  checksum_after: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  /** Per-backend Pydantic: dict[str, str]. */
  error: Record<string, string>;
}

export type SeedDrift = 'none' | 'checksum' | 'row_count' | 'unknown';

export interface SeedStatusRead {
  seed_name: string;
  applied: boolean;
  applied_version: number | null;
  last_run_at: string | null;
  /** Backend exposes this as str; we narrow to the same union. */
  last_run_status: SeedRunStatus | null;
  checksum: string | null;
  checksum_match: boolean;
  drift: SeedDrift;
  row_counts: Record<string, number>;
  production_safe: boolean;
}

export interface SeedDiffRead {
  seed_name: string;
  checksum_match: boolean;
  /** Tuple-as-record from Pydantic dict[str, tuple[int, int]]. */
  row_count_changes: Record<string, [number, number]>;
  missing_files: string[];
  extra_rows: Record<string, number>;
  summary: string;
}

export interface SeedApplyRequest {
  allow_in_prod?: boolean;
}

export type SeedResetScope = 'demo_only' | 'all';

export interface SeedResetRequest {
  scope: SeedResetScope;
}
```

> **TypeScript widening (explicitly documented):**
> - **`SeedRunStatus`** — adds `'drift_detected'` sentinel (Plan G banner state) beyond backend's 4 values
> - **`SeedTenantType`** — adds `'customer_seed'` for future content packs beyond backend's 3 values
>
> These are intentional — locked at the wire boundary, widened at the UI boundary.

---

## 5 Query + 3 Mutation Hooks (`apps/forge/lib/hooks/useSeeds.ts`)

```typescript
// 1. List — 30s staleTime
export function useSeedsList() {
  return useQuery({
    queryKey: seedKeys.list(),
    queryFn: () => seedsApi.listSeeds(),
    staleTime: 30_000,
  });
}

// 2. Manifest — 60s staleTime
export function useSeed(name: string) {
  return useQuery({
    queryKey: seedKeys.detail(name),
    queryFn: () => seedsApi.getSeed(name),
    enabled: Boolean(name),
    staleTime: 60_000,
  });
}

// 3. Status — 5s staleTime + optional refetchInterval (for Plan G welcome polling)
export function useSeedStatus(name: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: seedKeys.status(name),
    queryFn: () => seedsApi.getSeedStatus(name),
    enabled: Boolean(name),
    refetchInterval: options?.refetchInterval,
    staleTime: 5_000,
  });
}

// 4. Diff — staleTime: 0 (re-click always re-fetches)
export function useSeedDiff(name: string) {
  return useQuery({
    queryKey: seedKeys.diff(name),
    queryFn: () => seedsApi.getSeedDiff(name),
    enabled: Boolean(name),
    staleTime: 0,
  });
}

// 5. Runs — 30s staleTime
export function useSeedRuns(name: string) {
  return useQuery({
    queryKey: seedKeys.runs(name),
    queryFn: () => seedsApi.getSeedRuns(name),
    enabled: Boolean(name),
    staleTime: 30_000,
  });
}

// 6. Apply — invalidates status + runs
export function useApplySeed(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeedApplyRequest = {}) => seedsApi.applySeed(name, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seedKeys.status(name) });
      void qc.invalidateQueries({ queryKey: seedKeys.runs(name) });
    },
  });
}

// 7. Reset — invalidates status + runs
export function useResetSeed(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeedResetRequest) => seedsApi.resetSeed(name, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seedKeys.status(name) });
      void qc.invalidateQueries({ queryKey: seedKeys.runs(name) });
    },
  });
}

// 8. Rollback — invalidates status + runs
export function useRollbackSeed(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => seedsApi.rollbackSeed(name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: seedKeys.status(name) });
      void qc.invalidateQueries({ queryKey: seedKeys.runs(name) });
    },
  });
}
```

**3 staleTime tiers:**
- **5s** — `useSeedStatus` (polled by Plan G welcome banner)
- **30s** — `useSeedsList` + `useSeedRuns` (low-frequency reference data)
- **60s** — `useSeed` (manifest rarely changes)
- **0s** — `useSeedDiff` (re-click always re-fetches — diff is a snapshot)

**Invalidation pattern:** All 3 mutations invalidate `status(name)` + `runs(name)`. After apply/reset/rollback, the UI re-fetches both automatically.

---

## RBAC — 3 Scopes

```typescript
// apps/forge/lib/auth.ts (verbatim)
export type Permission = 'seeds:view' | 'seeds:manage';

const PERSONA_PERMISSIONS: Record<Persona, ReadonlySet<Permission>> = {
  pm: new Set<Permission>(['seeds:view']),
  'eng-lead': new Set<Permission>(['seeds:view', 'seeds:manage']),
  steward: new Set<Permission>(['seeds:view', 'seeds:manage']),
  cto: new Set<Permission>(['seeds:view', 'seeds:manage']),
};
```

**3 RBAC scopes (server-enforced):**

| Permission | Granted to | Used for |
|---|---|---|
| `seeds:view` | `pm`, `eng-lead`, `steward`, `cto` | All 5 GET routes |
| `seeds:manage` | `eng-lead`, `steward`, `cto` | `POST /apply` + `POST /rollback` |
| `seeds:reset:demo_only` | (Steward) | `POST /reset` with `scope: demo_only` |
| `seeds:reset:all` | (Steward) | `POST /reset` with `scope: all` (destructive) |

> "Callers SHOULD treat the return value as best-effort: the backend is still the source of truth (Plan C raises 403 for missing permissions even if the UI thought the persona was allowed)."

---

## Production Safety — 2 Gates

```python
class SeedApplyRequest(ForgeBaseModel):
    """Body for POST /seeds/{name}/apply.

    `allow_in_prod` is the production-safety override knob — when
    True the runner will skip the demo-vs-production gate. The
    override is itself audited.
    """
    allow_in_prod: bool = False
```

**2 gates:**

1. **`production_safe`** — manifest-declared knob (in `production_safety: dict[str, bool]`). The runner reads this and refuses to apply if the env is `production` and the flag is `false`.

2. **`allow_in_prod`** — request-body override. When `true`, the runner skips the demo-vs-production gate. **The override itself is audited** (see `audit_service.record()` call).

```python
class SeedResetRequest(ForgeBaseModel):
    """Body for POST /seeds/{name}/reset.

    `scope` controls whether the reset deletes only demo rows
    (`demo_only`) or every row this seed owns (`all`). The latter
    requires the `seeds:reset:all` permission and is Steward-only.
    """
    scope: Literal["demo_only", "all"] = "demo_only"
```

**Destructive reset:** `scope: "all"` deletes every row this seed owns. Requires `seeds:reset:all` permission. Default is `demo_only` (safe).

---

## Drift Detection — 4 Types

```typescript
export type SeedDrift = 'none' | 'checksum' | 'row_count' | 'unknown';
```

| Drift | Meaning | Cause |
|---|---|---|
| `none` | Manifest matches DB exactly | Healthy |
| `checksum` | Manifest checksum drifted | Manifest file changed |
| `row_count` | Row counts diverge | Manual edits / extra runs |
| `unknown` | Cannot compute (corrupt state) | DB error |

Drift surfaces in:
- `<SeedStatusPanel>` — banner color
- `<SeedDiffView>` — per-table breakdown
- `DemoBanner` (Plan G) — `checksumStatus: 'drift'`

---

## 9 Seed Components (`apps/forge/components/seeds/`)

| Component | Lines | Purpose |
|---|---|---|
| `SeedResetModal.tsx` | 164 | Confirm + scope picker (demo_only vs all) |
| `SeedDiffView.tsx` | 148 | Per-table expected vs actual + drift banner |
| `SeedApplyModal.tsx` | 134 | Confirm + `allow_in_prod` toggle |
| `SeedStatusPanel.tsx` | 116 | Status banner + drift indicator + counts |
| `SeedRollbackModal.tsx` | 108 | Confirm rollback + warning |
| `SeedHistoryTable.tsx` | 104 | Run history (10 rows, sortable) |
| `DemoStateCard.tsx` | 108 | Plan G card (demo seed status) |
| `DemoLoader.tsx` | 99 | Plan G polling until `applied === true` |
| `DemoBanner.tsx` | 84 | Plan G banner (drift warning) |
| **Total** | **1065** | |

---

## Plan H Page Composition (`/admin/seeds`)

```typescript
// apps/forge/app/admin/seeds/page.tsx (Server Component)
export default async function AdminSeedsPage() {
  if (!(await hasPermission('seeds:view'))) {
    redirect('/admin');
  }

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="admin-seeds-page">
        <PageHeader
          eyebrow="Admin"
          title="Seed Management"
          icon={<Sprout className="h-4 w-4" aria-hidden="true" />}
          description="Inspect, apply, reset, and rollback demo seeds for the current tenant. All mutations are idempotent and audit-logged."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4" aria-hidden="true" />
            Target seed:{' '}
            <span className="font-mono text-foreground">{SEED_TENANT_SLUG}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <SeedApplyModal seedName={SEED_TENANT_SLUG} />
            <SeedResetModal seedName={SEED_TENANT_SLUG} />
            <SeedRollbackModal seedName={SEED_TENANT_SLUG} />
          </div>
        </div>

        <SeedStatusPanel seedName={SEED_TENANT_SLUG} />
        <SeedDiffView seedName={SEED_TENANT_SLUG} />

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Run history</h2>
          <SeedHistoryTable seedName={SEED_TENANT_SLUG} />
        </section>
      </div>
    </AdminShell>
  );
}
```

**Key design decisions:**

1. **Server Component** — calls `hasPermission` before any client component mounts
2. **Target seed pinned to `acme-corp`** — `SEED_TENANT_SLUG` constant (future: swap for `useSeedsList()` picker)
3. **Mutations in modals** — `<SeedApplyModal>`, `<SeedResetModal>`, `<SeedRollbackModal>` own their click handlers + RBAC + `use<Verb>Seed` hook
4. **Inspection below actions** — status panel + diff view + history table render the **current state**, not a stale snapshot
5. **`force-dynamic`** — must be dynamic because `hasPermission` reads cookies

---

## Edge cases

| State | Treatment |
|---|---|
| **Missing `seeds:view`** | `redirect('/admin')` from Server Component |
| **No seed applied** | `useSeedStatus().applied === false` + `<DemoLoader>` polls |
| **Drift detected** | `drift: 'checksum'` + rose banner + "Re-apply recommended" |
| **Production seed** | `production_safe: false` → apply refused unless `allow_in_prod: true` |
| **Destructive reset** | `scope: 'all'` requires `seeds:reset:all` (403 otherwise) |
| **Cross-tenant seed name** | 404 (RLS scoped) |
| **Concurrent apply** | `SeedRun` row locked + unique constraint on `(seed_name, manifest_version, RUNNING)` |
| **Run failed** | `status: 'failed'` + `error: dict[str, str]` surfaced in `<SeedHistoryTable>` |
| **Run rolled back** | `status: 'rolled_back'` + new `SeedRun` row with `operation: 'rollback'` |
| **`prefers-reduced-motion`** | Drift banner animations disabled |

---

## Forbidden patterns

AI agents modifying Seed Management MUST NOT:

- ❌ Skip `@audit()` decorator on any new route — Rule 6
- ❌ Skip `require_permission()` on mutations — RBAC enforcement
- ❌ Skip `tenant_id` FK on `SeedRun` — Rule 2
- ❌ Bypass `production_safe` flag — production gate is mandatory
- ❌ Set `allow_in_prod: true` without audit trail — override itself must be logged
- ❌ Add a new lifecycle operation without updating `SeedOperation` enum (5 closed values)
- ❌ Add a new tenant_type without updating `Literal["demo", "reference", "production"]` (3 closed values)
- ❌ Add a new drift type without updating `SeedDrift` literal (4 closed values)
- ❌ Skip `useApplySeed`/`useResetSeed`/`useRollbackSeed` invalidation pattern (status + runs)
- ❌ Mutate seeds directly via SQL — must go through `SeedRunner`
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only (Sprout, Database, etc.)
- ❌ Use spinners for loading — use skeletons
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Trust `hasPermission` as the source of truth — backend is authoritative

---

## Verification checklist

- [ ] `/admin/seeds` renders for `steward` persona
- [ ] `/admin/seeds` redirects to `/admin` for `pm` without `seeds:view`
- [ ] `GET /api/v1/seeds` returns list of manifest summaries (RLS-scoped)
- [ ] `GET /api/v1/seeds/{name}` returns full manifest (data files + counts)
- [ ] `GET /api/v1/seeds/{name}/status` returns `applied` + `drift` + `production_safe`
- [ ] `GET /api/v1/seeds/{name}/diff` returns `row_count_changes` + `missing_files`
- [ ] `GET /api/v1/seeds/{name}/runs` returns run history
- [ ] `POST /api/v1/seeds/{name}/apply` creates new `SeedRun` (idempotent)
- [ ] `POST /api/v1/seeds/{name}/reset` with `scope: 'demo_only'` deletes demo rows
- [ ] `POST /api/v1/seeds/{name}/reset` with `scope: 'all'` requires `seeds:reset:all`
- [ ] `POST /api/v1/seeds/{name}/rollback` reverses most recent apply
- [ ] `allow_in_prod: true` override is recorded in audit log
- [ ] `production_safe: false` + missing override → 403
- [ ] Drift detection surfaces in `<SeedStatusPanel>` (4 types)
- [ ] `<SeedDiffView>` shows per-table breakdown
- [ ] `<SeedHistoryTable>` shows last 10 runs (sortable)
- [ ] `<DemoLoader>` polls until `applied === true`
- [ ] `<DemoBanner>` shows drift warning when `checksumStatus: 'drift'`
- [ ] Empty state renders when no seed applied
- [ ] Loading state renders during fetch
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — drift banner colors
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R2 + R4 + R5 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (8 routes)
- [DB schema](../reference/db-schema.md) — `seed_runs` + `tenants` FK
- [Admin Hub](./admin-hub.md) — `/admin/seeds` is a sub-route of Admin Hub
- [Dashboard](./dashboard.md) — "Seed health" widget surfaces drift
- [Onboarding](./onboarding.md) — `DemoLoader` drives Step 1 of wizard
- [Auth](./auth.md) — `hasPermission` gates the page
- [Personas & Dashboards](./personas-dashboards.md) — `pm` vs `steward` permission diff
- [Settings](./settings.md) — Tenant-level seed defaults
- [Audit](./audit.md) — Every seed mutation logged

---

## Maintenance notes

**When to update this doc:**

- A new route added → update 8-route table
- A new RBAC scope added → update 3-scope table
- A new lifecycle operation added → update `SeedOperation` enum
- A new tenant_type added → update 3-type list
- A new drift type added → update 4-type list
- A new component added → update 9-component list

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/seeds.py                ←  8 routes (5 GET + 3 POST)
backend/app/services/seed_service.py       ←  SeedRunner orchestration (apply/reset/rollback/status/diff)
backend/app/schemas/seeds.py               ←  Pydantic source of truth (5 schemas + 3 enums)
backend/app/db/models/seed.py              ←  SeedRun model (operation + status enums)
         ↓
apps/forge/lib/seeds/types.ts              ←  TypeScript mirror (widened at wire boundary)
apps/forge/lib/seeds/data.ts               ←  8 thin fetchers via forgeFetch (99 lines)
apps/forge/lib/hooks/useSeeds.ts           ←  8 hooks (5 query + 3 mutation) (152 lines)
apps/forge/lib/auth.ts                     ←  hasPermission + PERSONA_PERMISSIONS
         ↓
apps/forge/app/admin/seeds/page.tsx        ←  Server Component (83 lines)
apps/forge/components/seeds/               ←  9 components (1065 lines)
```

If any link in this chain drifts, the Seed Management surface breaks silently. Always update all links.

---

## Why this is a "Steward" surface

Per Plan H commit 5, Seed Management is intentionally scoped to **Stewards** (with `eng-lead` and `cto` granted dev-convenience access). Three reasons:

1. **Destructive potential** — `scope: 'all'` deletes every row a seed owns. Wrong click → data loss.
2. **Production safety** — `production_safe: false` + missing override = bad day in prod. Stewards know the gate.
3. **Audit accountability** — every mutation logged with `actor_id`. PMs shouldn't be running prod resets.

The page is a **Server Component** specifically because `hasPermission` must gate rendering before any client code mounts. This is the only RBAC-protected page in Forge that uses Server Component gating (other pages rely on client-side checks or proxy-level filtering).

The `DemoBanner` + `DemoLoader` (Plan G) surfaces give a non-Steward view: PMs see "demo data applied, drift detected" without needing `seeds:manage`. The boundary is intentional — **observation is universal, mutation is Steward-only**.