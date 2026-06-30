# Feature: Audit Center (Immutable Event Ledger)

> **Status:** Wired to real backend (Phase 0.5 redesign, Step 17)
> **Route:** `apps/forge/app/audit/page.tsx`
> **Backend:** `backend/app/api/v1/audit.py` (1 list endpoint)
> **Decorator:** `backend/app/core/audit.py` (`@audit(action, target_type)`)
> **Service:** `backend/app/services/audit_service.py` (`audit_service.record(...)`)
> **Model:** `backend/app/db/models/audit.py` (`AuditEvent` — append-only)
> **Schema:** `backend/app/schemas/audit.py`
> **Tool:** `backend/app/copilot/tools/audit_event.py` (Co-pilot `audit_event` tool)
> **Constitutional rules:** R2 (multi-tenant), R6 (MANDATORY auditability — every mutation logged)

---

## Purpose

The Audit Center is the **immutable event ledger** for the entire platform. Every state-changing action across Forge — agent invocations, workflow runs, story transitions, approvals, role changes, connector installs, policy updates, terminal commands, logins, logouts — is recorded as an `AuditEvent` row with a tamper-evident SHA-256 hash chain.

Per PRD §1.4 the Audit Center serves **stewards** (forensic analysis) and **operators** (debugging recent changes). It is the single source of truth for "who did what, when, to what."

**Why this is R6 (Mandatory Auditability):**

- Every backend route that mutates state wraps its handler in `@audit(action=..., target_type=...)`
- Every service-layer mutation calls `audit_service.record(...)`
- Every Co-pilot-originated action calls the `audit_event` tool
- `AuditEvent` rows are **append-only** — DB-level enforcement rejects UPDATE/DELETE
- SHA-256 hash chain: each row includes `prev_hash` → tampering with one row invalidates every subsequent hash

---

## Architecture

```
AuditCenterPage (/audit)
└── Phase 0.5 redesign (Step 17) — 8 zones
    ├── 1. Hero band (animated gradient border + ShieldCheck icon + Export)
    ├── 2. Integrity Banner (verified shield + last anchor + record count + root hash)
    ├── 3. Filter Bar (Actor + Action + Target Type + Date range + presets)
    ├── 4. Table header (count + density + column visibility)
    ├── 5. Virtualized table (@tanstack/react-virtual, 10k+ rows smooth)
    ├── 6. Detail drawer (640px: summary + payload + hash chain + diff + related)
    ├── 7. Empty states (filtered + no records)
    └── 8. Loading state (8 skeleton rows with shimmer)
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/audit` | Audit Center | Event ledger + filters + detail drawer |

### Backend (FastAPI)

#### Audit (`backend/app/api/v1/audit.py`) — 1 route

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/audit` | `audit:read` | List audit events (paginated, filtered) |

**Query params:**
```python
page: int = Query(ge=1, default=1)
page_size: int = Query(ge=1, le=500, default=50)
action: str | None = None          # e.g. "workflows.runs.start"
target_type: str | None = None     # e.g. "workflow_run"
actor_id: UUID | None = None
since: datetime | None = None      # indexed on occurred_at
until: datetime | None = None
```

**Returns:**
```python
AuditPage = Page[AuditEventRead]
# { items: list[AuditEventRead], total, page, page_size }
```

> **NOTE:** Only the list endpoint exists in the backend API. Export (CSV/JSON) and verify-chain operations are client-side computations over the page response. This avoids a 3rd-party dependency on the audit chain algorithm at the API boundary.

---

## Data touched

### Table (`backend/app/db/models/audit.py`)

```python
class AuditEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "audit_events"

    tenant_id: UUID       # indexed — Rule 2 mandatory
    project_id: UUID      # indexed
    actor_id: UUID | None # NULL for system actions (e.g. connector sync)
    action: str           # max 128 chars, indexed
    target_type: str      # max 64 chars, indexed
    target_id: str        # max 128 chars
    payload: dict         # JSONB — opaque
    occurred_at: datetime # indexed (timezone-aware)
```

**Indexes:**
- `tenant_id` (Rule 2 scoping)
- `project_id` (project-level filtering)
- `action` (action-type filtering)
- `target_type` (entity-type filtering)
- `occurred_at` (time-range filtering)

### DB-Level Immutability (R6 enforcement)

```python
# SQLAlchemy ORM-level immutability: any UPDATE or DELETE attempt is
# rejected at the application boundary so we get a clean stacktrace.
@event.listens_for(AuditEvent, "before_update", propagate=True)
@event.listens_for(AuditEvent, "before_delete", propagate=True)
def _reject_mutation(_mapper, _connection, _target):
    logger.error("audit.immutability_violation")
    raise RuntimeError(
        "AuditEvent is append-only; UPDATE/DELETE forbidden (Rule 6, DB trigger backup)"
    )
```

Per Rule 6, even a programming bug that tries to UPDATE or DELETE an audit row is **rejected at the ORM boundary** with a clean stacktrace. There is also a database trigger as a backup.

### Pydantic schema (`backend/app/schemas/audit.py`)

```python
class AuditEventRead(ForgeBaseModel):
    id: UUID
    tenant_id: UUID
    project_id: UUID
    actor_id: UUID | None
    action: str
    target_type: str
    target_id: str
    payload: dict[str, Any]
    occurred_at: datetime


class AuditQueryParams(ForgeBaseModel):
    action: str | None = None
    target_type: str | None = None
    actor_id: UUID | None = None
    since: datetime | None = None
    until: datetime | None = None


AuditPage = Page[AuditEventRead]
```

### TypeScript mirror (`apps/forge/lib/audit/data.ts`)

```typescript
export interface AuditActor {
  id: string;
  name: string;
  avatar: string;
}

export type AuditAction =
  | 'login'
  | 'logout'
  | 'command_run'
  | 'artifact_created'
  | 'artifact_published'
  | 'terminal_command'
  | 'approval_decided'
  | 'role_changed'
  | 'policy_updated'
  | 'connector_attached';

export type AuditTargetType =
  | 'user'
  | 'run'
  | 'idea'
  | 'adr'
  | 'prd'
  | 'artifact'
  | 'terminal'
  | 'approval'
  | 'policy'
  | 'connector';

export interface AuditRecord {
  id: string;
  tenantId: string;
  tenantName: string;
  actor: AuditActor;
  action: AuditAction;
  target: { type: AuditTargetType; id: string; label: string };
  payload: Record<string, unknown>;
  timestamp: string;
  /** SHA-256 chain head at this record (tamper-evident). */
  hash: string;
  /** Previous hash (chained). */
  prevHash: string;
}
```

> **⚠️ Backend vs frontend mismatch:** Backend uses free-form strings for `action` (e.g. `"workflows.runs.start"`) and `target_type` (e.g. `"workflow_run"`). Frontend uses a closed enum (10 values). The adapter (`wireToAuditRecord`) maps backend → frontend, returning only events matching known frontend types. **Unknown backend actions are surfaced as `Unknown` badges** with the raw action string visible on hover.

---

## 10 Frontend Action Types + Tone Mapping

```typescript
const ACTION_TONE: Record<AuditAction, string> = {
  login:               'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  logout:              'border-forge-500/40 bg-forge-500/10 text-forge-200',
  command_run:         'border-blue-500/40 bg-blue-500/10 text-blue-300',
  artifact_created:    'border-violet-500/40 bg-violet-500/10 text-violet-300',
  artifact_published:  'border-violet-500/60 bg-violet-500/20 text-violet-200',
  terminal_command:    'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  approval_decided:    'border-amber-500/40 bg-amber-500/10 text-amber-300',
  role_changed:        'border-pink-500/40 bg-pink-500/10 text-pink-300',
  policy_updated:      'border-indigo-500/40 bg-indigo-500/10 text-indigo-300',
  connector_attached:  'border-teal-500/40 bg-teal-500/10 text-teal-300',
};
```

Each action has a distinct color so operators can scan timelines visually. The badge text is the action name with underscores replaced by spaces (e.g. `command_run` → "command run").

---

## 10 Frontend Target Types

```typescript
type AuditTargetType =
  | 'user'         // Login/logout events
  | 'run'          // Workflow + SDLC runs
  | 'idea'         // Ideation events
  | 'adr'          // Architecture Decision Records
  | 'prd'          // Product Requirements Documents
  | 'artifact'     // Generic artifacts
  | 'terminal'     // Terminal commands
  | 'approval'     // Approval queue items
  | 'policy'       // Governance policies
  | 'connector';   // Connector lifecycle
```

---

## SHA-256 Hash Chain

Each `AuditRecord` carries:

```typescript
{
  hash: string;     // SHA-256 of (prevHash + serialize(record without hash))
  prevHash: string; // Previous record's hash
}
```

**Chain integrity invariant:**

```
hash_i = SHA-256(prevHash_i + serialize(record_i))
```

If any record is tampered with (modified payload, changed actor, etc.), its hash changes. Every subsequent record's `prevHash` no longer matches → **the chain is broken**. The Audit Center displays this visibly:

```
┌──────────────────────────────────────────┐
│ 🛡 Tamper-evident hash chain              │
│   #1234 a1b2c3d4...                      │
│   #1233 e5f6g7h8... ──                   │
│   #1232 i9j0k1l2... ──                   │
│   #1231 m3n4o5p6...                      │
│   head q7r8s9t0...                       │
│                                          │
│ Each record carries the SHA-256 of the   │
│ previous record. Any tampering           │
│ invalidates every subsequent hash.       │
└──────────────────────────────────────────┘
```

**Verify Now button** (in Integrity Banner):
1. Recomputes hash chain from page 1 → last page
2. Compares against stored hashes
3. Shows "Verified ✓" or "Broken at record #N — tamper detected"

---

## How Audit Events Are Written

### Path 1: `@audit()` decorator (endpoint layer)

```python
# backend/app/core/audit.py
def audit(*, action: str, target_type: str):
    """Decorator factory: tag a handler with an audit action+target_type."""
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Resolve principal from kwargs
            principal = kwargs.get("principal")
            
            # Run the wrapped handler
            result = await func(*args, **kwargs)
            
            # Extract target_id from result + kwargs
            target_id = str(result.get("id")) or kwargs.get("path_params", {}).get("id")
            
            # Emit AuditEvent
            await audit_service.record(
                tenant_id=principal.tenant_id,
                project_id=principal.project_id,
                actor_id=principal.user_id,
                action=action,
                target_type=target_type,
                target_id=target_id,
                payload={"result": "success"},
            )
            
            return result
        return wrapper
    return decorator
```

Usage in every mutating route:

```python
@router.post("/{workflow_id}/runs", response_model=WorkflowRunRead)
@audit(action="workflows.runs.start", target_type="workflow_run")
async def start_workflow_run(...):
    ...
```

### Path 2: `audit_service.record(...)` (service layer)

For non-endpoint code (background jobs, services):

```python
# backend/app/services/audit_service.py
class AuditService:
    async def record(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        action: str,
        target_type: str,
        target_id: str,
        payload: dict[str, Any] | None = None,
        occurred_at: datetime | None = None,
    ) -> None:
        # Insert AuditEvent row
        ...


audit_service = AuditService()
```

### Path 3: Co-pilot `audit_event` tool

For user actions triggered via Co-pilot:

```python
# backend/app/copilot/tools/audit_event.py
class AuditEventTool:
    name = "audit_event"
    description = (
        "Emit an audit event from the Co-pilot context. Use when the "
        "model wants to record that the user acted on a suggestion "
        "(e.g. clicked a navigation link, exported an artifact)."
    )
    permission = COPILOT_PERMISSION_TOOL_AUDIT_EVENT
    rate_limit_per_min = 60
```

Called by the Co-pilot when the user clicks a suggested action (navigate, run_command, draft, open_modal).

---

## Audit Filters

The `AuditFilter` component exposes:

```typescript
interface AuditFilterState {
  actorId: string;                   // Combobox
  action: AuditAction | 'all';       // Multi-select
  targetType: AuditTargetType | 'all'; // Multi-select
  from: string;                      // ISO date
  to: string;                        // ISO date
}
```

**Filter presets:**
- Last 24h
- Last 7d
- Last 30d
- Last 90d
- Custom range

**Client-side filtering** (per Step 17 design): filters apply instantly to the loaded page. Date range triggers refetch.

---

## Audit Detail Drawer (640px)

The `AuditDetailPanel` drawer shows:

```
┌─────────────────────────────────────┐
│ Audit Event #abc-123...        [×] │
├─────────────────────────────────────┤
│ [Badge: command_run]                │
│ [Badge: run]                        │
│                                     │
│ SUMMARY                             │
│   Actor:    Arun Achalam            │
│   Action:   command_run             │
│   Target:   run-abc-123             │
│   Timestamp: 2026-06-29 22:18:00Z  │
│   Tenant:   acme-corp               │
│   Project:  acme-platform           │
│                                     │
│ PAYLOAD                             │
│   {                                  │
│     "command": "seed-data",         │
│     "args": {...},                  │
│     "result": "success"             │
│   }                                  │
│                                     │
│ HASH CHAIN                          │
│   head: a1b2c3d4...                │
│   prev: e5f6g7h8...                │
│                                     │
│ RELATED LINKS                       │
│   → Open run-abc-123                │
│   → Open actor profile              │
│                                     │
├─────────────────────────────────────┤
│ [Copy Record ID]  [Open in New Tab] │
└─────────────────────────────────────┘
```

**Drawer accessible:** Esc closes, focus restores, ARIA labels throughout.

---

## Audit Export (CSV / JSON)

The `AuditExportButton` exports the currently filtered set:

| Format | Content |
|---|---|
| CSV | id, timestamp, actor_name, action, target_type, target_id, payload (JSON-stringified) |
| JSON | Full AuditRecord[] with hash chain |

Both use the browser's `Blob` + `URL.createObjectURL` download pattern. No server-side export endpoint.

---

## Virtualized Table (`AuditTimelineVirtualized`)

For pages that may show >1000 events (e.g. cross-tenant audit roll-up), use `AuditTimelineVirtualized` instead of `AuditTimeline`:

```typescript
import { AuditTimelineVirtualized } from '@/components/audit/AuditTimelineVirtualized';

<AuditTimelineVirtualized
  records={records}
  height={600}     // container height
/>
```

Uses `@tanstack/react-virtual` with overscan for smooth scrolling at 10k+ records.

---

## Common Audit Action Patterns

The backend uses dot-notation action names that are NOT in the frontend enum:

| Backend action | Frontend mapping |
|---|---|
| `workflows.runs.start` | (mapped to `command_run` or similar) |
| `workflows.runs.cancel` | (similar) |
| `agents.invoke` | (similar) |
| `ideation.analyze` | `artifact_created` |
| `ideation.push.jira` | (similar) |
| `architecture.approvals.decide` | `approval_decided` |
| `connectors.install` | `connector_attached` |
| `users.role.change` | `role_changed` |
| `governance.policies.update` | `policy_updated` |
| `terminal.command.run` | `terminal_command` |
| `artifacts.create` | `artifact_created` |
| `artifacts.publish` | `artifact_published` |
| `auth.login` | `login` |
| `auth.logout` | `logout` |

The frontend adapter collapses these into the 10 frontend types via keyword matching. Unknown actions are surfaced as "Unknown" badges with the raw action string visible on hover.

---

## Edge cases

| State | Treatment |
|---|---|
| **No events** | Empty state with ShieldCheck icon + "All clear — no audit events match" |
| **Filtered to empty** | Different empty state + "Try removing filters" |
| **Loading** | 8 skeleton rows with shimmer (no spinners) |
| **Long payload** | Truncate in drawer with "Show full JSON" toggle |
| **Unknown action** | "Unknown" badge + raw action on hover |
| **Hash chain broken** | Red banner + "Tamper detected at #N" + link to offending record |
| **Export >10k records** | Confirm modal: "Export N records? This may take a moment." |
| **Concurrent inserts** | Each `audit_service.record()` is independent; no locking |
| **System actor (actor_id=NULL)** | Show as "System" with bot icon |
| **`prefers-reduced-motion`** | Gradient + shimmer animations disabled |

---

## Forbidden patterns

AI agents modifying Audit MUST NOT:

- ❌ Add a route that mutates audit rows (UPDATE/DELETE) — Rule 6 + DB-level trigger enforces
- ❌ Bypass `@audit()` decorator on any state-mutating endpoint
- ❌ Skip tenant scoping on audit queries — Rule 2 (every query carries `tenant_id`)
- ❌ Add a new frontend `AuditAction` value without updating `ACTION_TONE` map (10 keys)
- ❌ Add a new frontend `AuditTargetType` value without updating `Badge variant="outline"` rendering
- ❌ Use raw SQL to UPDATE/DELETE audit_events — DB trigger rejects
- ❌ Skip `actor_id` attribution when one is available — system actions get NULL but user actions MUST have it
- ❌ Log sensitive secrets in payload — payloads are opaque JSONB, scrub before write
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist

- [ ] `/audit` renders 8 zones per Step 17 design
- [ ] `curl .../audit` returns paginated events with valid Bearer token + tenant scope
- [ ] `?action=auth.login` filters to login events only
- [ ] `?target_type=workflow_run` filters to workflow run events
- [ ] `?actor_id={uuid}` filters to one user's events
- [ ] `?since=2026-06-01T00:00:00Z&until=2026-06-30T00:00:00Z` filters by date range
- [ ] `?page=2&page_size=50` paginates correctly
- [ ] Integrity Banner shows "Verified ✓" with root hash
- [ ] "Verify Now" button re-runs hash chain verification
- [ ] Tampered record → red banner with broken-at index
- [ ] Filter Bar actor combobox lists users from `AuditActor[]`
- [ ] Filter Bar action multi-select lists 10 frontend actions + "All"
- [ ] Filter Bar target type multi-select lists 10 frontend types + "All"
- [ ] Date presets (24h / 7d / 30d / 90d) apply correctly
- [ ] Virtualized table handles 10k+ records smoothly
- [ ] Detail drawer (640px) shows summary + payload + hash chain + related
- [ ] Export CSV downloads with correct format
- [ ] Export JSON downloads with full AuditRecord[]
- [ ] Copy Record ID copies UUID to clipboard
- [ ] Open in New Tab opens record in standalone view
- [ ] Unknown action renders as "Unknown" badge with raw string on hover
- [ ] System actor renders as "System" with bot icon
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (8 skeleton rows)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md) — every rule must include `@audit()` example
- [Design system](../standards/design-system.md) — action tone colors
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — **R6 (Mandatory Auditability)**
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (1 route)
- [DB schema](../reference/db-schema.md) — `audit_events`
- [Dashboard](./dashboard.md) — "Recent activity" widget
- [Co-pilot](./copilot.md) — `audit_event` tool used by suggested actions
- [Every other feature](./README.md) — all use `@audit()` decorator

---

## Maintenance notes

**When to update this doc:**

- A new `@audit(action=X, target_type=Y)` is added → update Common Audit Action Patterns table
- A new frontend `AuditAction` is added → update 10-action table + `ACTION_TONE` map
- A new frontend `AuditTargetType` is added → update 10-type table
- A new audit-related route is added → update Routes section

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/audit.py                       ←  1 list endpoint
backend/app/core/audit.py                         ←  @audit decorator factory
backend/app/services/audit_service.py             ←  AuditService.record() entry-point
backend/app/db/models/audit.py                    ←  AuditEvent table + before_update/before_delete listeners
backend/app/schemas/audit.py                      ←  AuditEventRead + AuditQueryParams + AuditPage
backend/app/copilot/tools/audit_event.py          ←  Co-pilot audit_event tool
backend/app/terminal/audit.py                     ←  Terminal-specific audit
backend/app/db/models/litellm_key_audit.py        ←  LiteLLM key audit (separate table)
         ↓
apps/forge/lib/audit/data.ts                      ←  AuditRecord + AuditAction + AuditTargetType + AuditActor
         ↓
apps/forge/app/audit/page.tsx                     ←  Audit Center (Step 17 redesign)
apps/forge/components/audit/AuditTimeline.tsx     ←  Action tone map
apps/forge/components/audit/AuditTimelineVirtualized.tsx ←  Virtualized variant
apps/forge/components/audit/AuditDetailPanel.tsx   ←  Detail drawer
apps/forge/components/audit/AuditFilter.tsx       ←  Filter bar
apps/forge/components/audit/AuditExportButton.tsx ←  CSV/JSON export
apps/forge/components/audit/AuditHashChain.tsx    ←  Chain visualization
```

If any link in this chain drifts, the Audit Center breaks silently. Always update all links.

---

## Why this is "append-only + hash-chained"

Two complementary guarantees:

1. **Immutability** — DB-level `_reject_mutation` listener on UPDATE/DELETE raises RuntimeError. Backup DB trigger enforces at the database boundary.
2. **Tamper evidence** — SHA-256 chain means any modification to an existing record breaks every subsequent hash. The "Verify Now" button detects this in O(N) time.

**Together:** You can never silently edit an audit log, and you can always prove tampering happened.

This is the bedrock of R6 (Mandatory Auditability). Every other rule depends on it — R3 (approvals) uses audit to prove who approved what, R7 (observability) uses audit to trace issues, R8 (forensics) uses audit for incident response. **Without R6, no other rule has teeth.**