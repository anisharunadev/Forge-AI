# Feature: Onboarding + Workspace Creation (Step 61)

> **Status:** Step 61 PARTIAL — wizard flow wired (4 routes); StepProvision fake; workspace creation NOT yet wired (per Step 61 prompt, `/auth/me/tenants`, `/tenants`, `/tenants/{id}/switch` are missing)
> **Routes:** `apps/forge/app/project-onboarding/page.tsx` (10-step wizard)
> **TenantSwitcher:** `apps/forge/components/tenant-switcher.tsx` (workspace dropdown)
> **Workspace creation:** `apps/forge/app/onboarding/workspace/page.tsx` (planned per Step 61)
> **Backend — Onboarding:** `backend/app/api/v1/onboarding.py` (4 routes)
> **Backend — Tenants:** `backend/app/api/v1/tenants.py` (NOT YET BUILT)
> **Backend — Auth:** `backend/app/api/v1/auth.py` (3 routes, missing `/me/tenants`)
> **Constitutional rules:** R2 (multi-tenant), R6 (every wizard transition audited), R7 (resumable across page reloads)

---

## Purpose

The Onboarding surface is the **first-run experience** for new tenants and the **workspace switcher** for users with multiple tenants. It covers two flows:

1. **Project Onboarding Wizard** (`/project-onboarding`) — 10-step wizard that sets up a new project: tenant context → AI provider → repos → stack detection → agents → first intel → governance → review → provision.
2. **Workspace Creation** (`/onboarding/workspace`, planned) — Create a new tenant (workspace). The "Create new workspace" CTA in `TenantSwitcher` and the onboarding wizard's Step 2 both route here.

Per PRD §1.4 the Onboarding surface serves **first-time users** and **operators managing multiple tenants**.

---

## Architecture

```
ProjectOnboardingPage (/project-onboarding)
└── WizardShell (10-step layout)
    ├── WizardNav (left rail with step list)
    ├── WizardProgress (top progress bar)
    ├── Step content (right panel — 10 components)
    └── OrchestratorStubBanner (shown if backend stubbed)

TenantSwitcher (header popover)
├── List of tenants (calls /auth/me/tenants)
├── "Create new workspace" CTA → /onboarding/workspace
└── Switch action → /tenants/{id}/switch → reload page

OnboardingWorkspacePage (/onboarding/workspace) — PLANNED
└── Create tenant form
    ├── Name
    ├── Slug
    ├── Plan (free/pro/enterprise)
    ├── Region
    └── Logo URL
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/project-onboarding` | ProjectOnboardingPage | 10-step wizard |
| `/onboarding/workspace` | (planned per Step 61) | Create new workspace |
| Header popover | TenantSwitcher | List + switch + create CTA |

### Backend (FastAPI)

#### Onboarding (`backend/app/api/v1/onboarding.py`) — 4 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/onboarding/sessions` | `onboarding:write` | Start wizard session |
| `GET` | `/api/v1/onboarding/sessions/{id}` | `onboarding:read` | Read session state |
| `POST` | `/api/v1/onboarding/sessions/{id}/advance` | `onboarding:write` | Advance to next step |
| `POST` | `/api/v1/onboarding/sessions/{id}/cancel` | `onboarding:write` | Cancel session |

#### Auth (`backend/app/api/v1/auth.py`) — 3 existing routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/oidc/callback` | OIDC callback (Keycloak) |
| `POST` | `/api/v1/auth/refresh` | Refresh access token |
| `GET` | `/api/v1/auth/me` | Get current principal |

#### Tenant management — NOT YET BUILT (Step 61 plan)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/auth/me/tenants` | (auth required) | List user's tenants (for TenantSwitcher) |
| `POST` | `/api/v1/tenants` | `tenants:write` | Create new tenant (workspace) |
| `POST` | `/api/v1/tenants/{id}/switch` | `tenants:read` (must be member) | Switch active tenant, returns new JWT |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `onboarding_sessions` | Per-user wizard session (status, current_step, state JSONB) |
| `onboarding_steps` | Per-step rows (step_name, status, input, output) |
| `tenants` | Tenant records |
| `tenant_members` | Per-tenant user membership (role: owner / admin / member) |
| `projects` | Project records (created during onboarding) |

### Backend enums (`backend/app/db/models/onboarding.py`)

**`OnboardingStatus` (3):**
```python
ACTIVE = "active"
COMPLETED = "completed"
CANCELLED = "cancelled"
```

**`OnboardingStepStatus` (5):**
```python
PENDING = "pending"
IN_PROGRESS = "in_progress"
COMPLETED = "completed"
SKIPPED = "skipped"
FAILED = "failed"
```

### OnboardingSession table

```python
class OnboardingSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "onboarding_sessions"
    tenant_id: UUID          # indexed
    project_id: UUID         # indexed
    user_id: UUID            # indexed
    status: OnboardingStatus # default ACTIVE
    current_step: str        # default "tenant_setup"
    state: dict              # JSONB — wizard-internal state
    completed_at: datetime | None
```

### OnboardingStep table

```python
class OnboardingStep(Base, ...):
    __tablename__ = "onboarding_steps"
    session_id: UUID         # indexed
    step_name: str           # max 64 chars
    step_order: int
    status: OnboardingStepStatus
    input: dict              # JSONB
    output: dict             # JSONB
    error_message: str | None
```

### Pydantic schemas (`backend/app/schemas/onboarding.py`)

```python
class OnboardingStepRead(ForgeBaseModel):
    id: UUID
    step_name: str
    step_order: int
    status: OnboardingStepStatus
    input: dict
    output: dict
    error_message: str | None = None
    created_at: datetime

class OnboardingSessionRead(TenantScopedModel):
    id: UUID
    user_id: UUID
    status: OnboardingStatus
    current_step: str
    state: dict
    completed_at: datetime | None = None
    steps: list[OnboardingStepRead] = Field(default_factory=list)

class OnboardingStartRequest(ForgeBaseModel):
    project_id: UUID

class OnboardingAdvanceRequest(ForgeBaseModel):
    step_input: dict[str, Any] = Field(default_factory=dict)
    mark_complete: bool = True
```

---

## 10 Wizard Steps (`apps/forge/lib/onboarding/data.ts`)

```typescript
export const WIZARD_STEPS = [
  { id: 1,  title: 'Welcome',           description: '...', hint: 'This 5-minute flow configures your tenant, agents, and knowledge graph.' },
  { id: 2,  title: 'Tenant setup',      description: '...', skippable: true, hint: 'Tenant name appears in URL paths and audit logs. Region affects data residency.' },
  { id: 3,  title: 'Connect AI provider', description: '...', skippable: true, hint: "All LLM traffic flows through Forge's provider abstraction layer." },
  { id: 4,  title: 'Connect repos',     description: '...', hint: 'Forge clones shallow copies first; the deep scan runs during the first intel pass.' },
  { id: 5,  title: 'Detect stack',      description: '...', hint: 'Confidence is from the file-extension + manifest heuristic. Override anytime.' },
  { id: 6,  title: 'Configure agents',  description: '...', hint: 'You can assign agents per task type on the Agent Center matrix later.' },
  { id: 7,  title: 'Run first intel',   description: '...', skippable: true, hint: 'The first pass takes 2–5 minutes per repo. You can keep editing in other tabs.' },
  { id: 8,  title: 'Governance',        description: '...', skippable: true, hint: 'These defaults are tuned for safe-rollout; tighten them per project later.' },
  { id: 9,  title: 'Review & confirm',  description: '...', hint: 'Review the summary, then confirm to provision the project.' },
  { id: 10, title: 'Provision',         description: '...', hint: 'You can keep working in other tabs while provisioning runs.' },
];
```

| # | Step | Backend step_name | Component | Skippable |
|---|---|---|---|---|
| 1 | Welcome | (client-only) | `StepWelcome.tsx` | — |
| 2 | Tenant setup | `tenant_setup` | `StepTenantSetup.tsx` | ✓ |
| 3 | Connect AI provider | (client-only — provider form) | `StepConnectProviders.tsx` | ✓ |
| 4 | Connect repos | `connect_repos` | `StepConnectRepos.tsx` | — |
| 5 | Detect stack | `detect_stack` | `StepDetectStack.tsx` | — |
| 6 | Configure agents | `configure_agents` | `StepConfigureAgents.tsx` | — |
| 7 | Run first intel | `run_first_intel` | `StepRunFirstIntel.tsx` | ✓ |
| 8 | Governance | (client-only — settings form) | `StepGovernance.tsx` | ✓ |
| 9 | Review & confirm | `review` | `StepReview.tsx` | — |
| 10 | Provision | (triggers backend bootstrap) | `StepProvision.tsx` | — |

> Note: Only 6 of the 10 wizard steps have backend step_names. The others (Welcome, Provider, Governance, Provision) are client-only or post-backend-bootstrap steps.

---

## 6 Backend STEP_ORDER (`backend/app/services/project_onboarding/wizard.py`)

```python
STEP_ORDER: list[str] = [
    "tenant_setup",
    "connect_repos",
    "detect_stack",
    "configure_agents",
    "run_first_intel",
    "review",
]
```

Wizard service (`onboarding_wizard`) manages state machine transitions:
- `start()` — create session + first step
- `get_state()` — read session + steps
- `advance()` — move to next step (validates current step is COMPLETED)
- `cancel()` — mark CANCELLED

`WizardError` raised on invalid transitions → 409 Conflict.

---

## StepProvision — Currently Fake (Step 61 fix pending)

The current `StepProvision` component uses **fake `setInterval` progression**:

```typescript
// apps/forge/components/onboarding/StepProvision.tsx
const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'manifest',    label: 'Submitting tenant manifest' },
  { id: 'graph',       label: 'Spinning up project graph shard' },
  { id: 'connectors',  label: 'Provisioning connectors' },
  { id: 'audit',       label: 'Seeding audit channel' },
  { id: 'ready',       label: 'Project online' },
];

const STAGE_DELAY_MS = 600;  // fake timing

React.useEffect(() => {
  if (state !== 'running') return;
  setCompleted(0);
  let idx = 0;
  const id = window.setInterval(() => {
    idx += 1;
    setCompleted(Math.min(STAGES.length, idx));
    if (idx >= STAGES.length) window.clearInterval(id);
  }, STAGE_DELAY_MS);
  // ...
}, [state]);
```

**Step 61 plan:** Replace with real backend polling:
1. `POST /projects/{id}/bootstrap` → returns 202 with BootstrapResult
2. Poll `GET /projects/{id}/bootstrap/status` every 2s
3. Update stage list from real progress

The wizard's "Final-step hook" (F-507) already calls `DayOneBootstrapService.load_baseline` on session completion — the fix is to wire StepProvision to actually poll the bootstrap status instead of faking it.

---

## TenantSwitcher (Header Popover)

```typescript
// apps/forge/components/tenant-switcher.tsx
// Data flow:
//   1. On open, fetch GET /auth/me/tenants (currently fails — endpoint missing)
//   2. On select, call useAuth.switchTenant(id). Posts to /tenants/{id}/switch,
//      gets back a new access token scoped to selected tenant, reloads page.
//   3. Reload is intentional — simplest way to force tenant-scope reset
//      across all stores.
```

**Empty state:** "No workspaces yet" + "Create your first workspace" CTA → `/onboarding/workspace`.

**After Step 61 lands:** Calls real `/auth/me/tenants`, lists user's tenants.

---

## Tenant Switch Flow (Plan from Step 61)

```
1. User clicks tenant in TenantSwitcher popover
   ↓
2. POST /tenants/{id}/switch
   { } (empty body)
   ↓
3. Backend verifies user is a member of target tenant
   - Query TenantMember for tenant_id + user_id
   - 403 if not_a_member
   ↓
4. Backend mints new JWT with target tenant_id in claim
   ↓
5. Response: { access_token, token_type: "bearer", expires_in: 3600 }
   ↓
6. Frontend replaces stored token + tenant in auth store
   ↓
7. window.location.reload() — forces every TanStack Query + Zustand
   store keyed on tenant-id to refetch with new header
```

The reload is **intentional** — documented as the simplest way to force a tenant-scope reset across all stores. No cross-store coordination needed.

---

## Workspace Creation Flow (Step 61 plan)

```
1. User clicks "Create new workspace" CTA in TenantSwitcher
   ↓
2. Navigate to /onboarding/workspace
   ↓
3. Form: name + slug + plan + region + logo_url
   ↓
4. POST /tenants
   { name, slug, plan, region, logo_url }
   ↓
5. Backend validates:
   - slug uniqueness (409 if taken)
   - slug pattern: ^[a-z0-9-]+$
   ↓
6. Backend creates Tenant row + TenantMember row (creator=owner)
   ↓
7. Backend syncs to LiteLLM:
   await ensure_team_for_tenant(tenant_id, name, max_budget=100.0)
   - Creates LiteLLM team for tenant
   - Sets initial budget = $100
   - LiteLLM failure logged but doesn't fail tenant creation
   ↓
8. Response: TenantRead { id, name, slug, plan, region, logo_url, role: "owner", is_current: false }
   ↓
9. Frontend redirects to new tenant:
   POST /tenants/{id}/switch → get new JWT → reload page
```

---

## TenantForm shape (`apps/forge/lib/onboarding/data.ts`)

```typescript
export interface TenantForm {
  tenantName: string;
  region: string;
  defaultTimezone: string;
  costCeilingUsd: string;
  enableSandbox: boolean;
  enableQuarantine: boolean;
  theme: 'dark' | 'light';
  defaultModel: string;
  logoDataUrl?: string;
  tenantSlug?: string;
}
```

Used by `StepTenantSetup` (Step 2).

---

## Provider Catalog (`PROVIDER_CATALOG`)

6 supported AI providers:

| ID | Name | Icon |
|---|---|---|
| `anthropic` | Anthropic (Claude Opus / Sonnet / Haiku) | Sparkles |
| `openai` | OpenAI | Cpu |
| `google` | Google AI | Cloud |
| `bedrock` | AWS Bedrock | Triangle |
| `azure_openai` | Azure OpenAI | Hexagon |
| `custom` | Custom endpoint | Plug |

Each card has `name`, `description`, `placeholder` (API key prefix), `docsUrl`.

---

## 3 Skippable Steps

The wizard allows skipping for users who want minimal setup:

- **Step 2: Tenant setup** (use defaults)
- **Step 3: Connect AI provider** (use system default)
- **Step 7: Run first intel** (defer to later)
- **Step 8: Governance** (use defaults)

Each skippable step leaves the form values as defaults and writes a `SKIPPED` step row.

---

## Zustand Onboarding Store

The wizard uses Zustand for cross-component state:

```typescript
// apps/forge/lib/store/index.ts
useOnboardingStore = {
  currentStep: number;
  // ... per-step form state
  // pushStepToUrl() / syncStepFromUrl() — deep linking
};
```

URL syncing: `?step=3` deep links to a specific wizard step.

---

## WizardShell (`apps/forge/components/onboarding/WizardShell.tsx`)

The 864-line orchestrator. Provides:

- Left rail (`WizardNav`) with step list + completion checkmarks
- Top progress bar (`WizardProgress`)
- Right panel (current step component)
- `prefers-reduced-motion` detection (avoids framer-motion if reduced)
- `OrchestratorStubBanner` (shown when backend stub is in use)
- AI reasoning callouts (`AI_REASONING` constant)

---

## Seed Data (Step 61 plan)

The seed creates:

| Artifact | Count |
|---|---|
| Tenants | 1 (`acme-corp`) |
| TenantMember rows | 1 (Arun as owner) |
| LiteLLM team | 1 (synced from tenant) |

The `/auth/me/tenants` endpoint should return this one tenant for `arun@acme-corp.com`.

---

## Edge cases

| State | Treatment |
|---|---|
| **First visit, no tenants** | "No workspaces yet" + "Create your first workspace" CTA |
| **Session in ACTIVE** | Resume from `current_step` |
| **Session in COMPLETED** | Read-only summary + "Start new project" CTA |
| **Session in CANCELLED** | Read-only summary + "Restart wizard" CTA |
| **Step PENDING** | Render "Continue" button |
| **Step IN_PROGRESS** | Render "Working..." + cancel button |
| **Step COMPLETED** | Render green checkmark + "Next step" button |
| **Step SKIPPED** | Render muted + "Skip again" link |
| **Step FAILED** | Render red + error message + "Retry" button |
| **Wizard advance fails (409 WizardError)** | Toast + stay on current step |
| **StepProvision fake 5 stages** | Tick through with `setInterval` (current state pre-Step 61 fix) |
| **StepProvision real (Step 61 fixed)** | Poll `/projects/{id}/bootstrap/status` every 2s |
| **Bootstrap fails** | Wizard session rolls back to ACTIVE + error on review step |
| **Wizard abandonment** | Session persists in DB — user can resume by URL `?step=N` |
| **TenantSwitcher empty** | "No workspaces yet" + create CTA |
| **Switch to non-member tenant** | 403 + toast |
| **`prefers-reduced-motion`** | Wizard transitions + StepProvision animations disabled |

---

## Forbidden patterns

AI agents modifying Onboarding MUST NOT:

- ❌ Skip audit logging on wizard transitions — Rule 6
- ❌ Skip tenant scoping — Rule 2 (every query carries `tenant_id`)
- ❌ Use fake `setInterval` after Step 61 — must poll real backend
- ❌ Bypass the wizard service for state machine transitions — direct DB writes break invariants
- ❌ Auto-advance past approval gates in the wizard
- ❌ Skip "You can keep working in other tabs" UX — wizard is async-friendly
- ❌ Use direct SDK imports for AI provider calls — Rule 1 (via LiteLLM)
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Hardcode tenant IDs — read from JWT

---

## Verification checklist (Step 61 acceptance criteria)

- [ ] `seed_onboarding.py` inserts 1 tenant + 1 tenant_member
- [ ] `curl -H "Authorization: Bearer $TOKEN" .../auth/me/tenants` returns acme-corp tenant for arun@acme-corp.com
- [ ] `curl -X POST .../tenants -d '{"name":"My Workspace","slug":"my-ws",...}'` creates new tenant
- [ ] New tenant appears in TenantSwitcher dropdown
- [ ] `curl -X POST .../tenants/{id}/switch` returns new JWT scoped to target tenant
- [ ] After switch, page reloads with new tenant context (TanStack Queries refetch)
- [ ] `curl .../onboarding/sessions` creates session, returns session_id
- [ ] `POST .../onboarding/sessions/{id}/advance` moves to next step
- [ ] `POST .../onboarding/sessions/{id}/cancel` marks cancelled
- [ ] StepProvision polls `/projects/{id}/bootstrap/status` (after Step 61 fix)
- [ ] StepProvision shows 5 real stages (manifest / graph / connectors / audit / ready)
- [ ] Wizard session persists in DB (resumable)
- [ ] URL `?step=3` deep-links to step 3
- [ ] Skippable steps leave defaults + write SKIPPED row
- [ ] TenantSwitcher empty state shows "No workspaces yet"
- [ ] TenantSwitcher "Create new workspace" routes to `/onboarding/workspace`
- [ ] Workspace creation form validates slug pattern + uniqueness
- [ ] Workspace creation syncs to LiteLLM (creates team)
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — wizard nav tokens
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R2 + R6 + R7
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (7 routes)
- [DB schema](../reference/db-schema.md) — `onboarding_sessions`, `onboarding_steps`, `tenants`, `tenant_members`
- [Dashboard](./dashboard.md) — "Tenant status" footer
- [Auth](./auth.md) — JWT carries tenant_id claim
- [Projects](./projects.md) — Created during onboarding StepProvision
- [Connector Center](./connector-center.md) — Step 4 connects repos
- [Agent Center](./agent-center.md) — Step 6 assigns agents
- [Settings](./settings.md) — Tenant setup config
- [Audit](./audit.md) — Every wizard transition logged
- [Co-pilot](./copilot.md) — `audit_event` tool for StepProvision stages

---

## Maintenance notes

**When to update this doc:**

- A new wizard step added → update 10-step list
- A new backend `STEP_ORDER` value added → update 6-step backend list
- Step 61 backend ships (`/auth/me/tenants`, `/tenants`, `/tenants/{id}/switch`) → remove "NOT YET BUILT" callouts
- `StepProvision` rewired to real backend → update fake-stage notes

**Files to keep in sync (the lock-step rectangle):**

```
apps/forge/lib/onboarding/data.ts          ←  WIZARD_STEPS + PROVIDER_CATALOG + TenantForm
apps/forge/lib/store/index.ts              ←  useOnboardingStore + URL sync
apps/forge/lib/api/auth.ts                 ←  Tenant type + switchTenant + fetchTenants
apps/forge/components/onboarding/         ←  13 components (10 steps + WizardShell + WizardNav + WizardProgress)
apps/forge/components/tenant-switcher.tsx  ←  Header popover
apps/forge/app/project-onboarding/page.tsx ←  Wizard route
apps/forge/app/onboarding/workspace/page.tsx ←  Workspace creation (planned)
         ↓
backend/app/api/v1/onboarding.py           ←  4 wizard routes
backend/app/api/v1/auth.py                 ←  3 auth routes (missing /me/tenants)
backend/app/api/v1/tenants.py              ←  NEW: 2 routes (Step 61 plan)
backend/app/services/project_onboarding/wizard.py ←  State machine + 6 backend STEP_ORDER
backend/app/services/team_sync.py          ←  ensure_team_for_tenant (LiteLLM bridge)
backend/app/db/models/onboarding.py        ←  OnboardingSession + OnboardingStep + 2 enums
backend/app/schemas/onboarding.py          ←  4 Pydantic schemas
```

If any link in this chain drifts, the Onboarding surface breaks silently. Always update all links.

---

## Current state (honest)

**Wizard flow:** ✅ Complete
- 10 frontend steps wired
- Zustand store + URL sync working
- 4 backend routes (sessions CRUD) working
- 6 backend STEP_ORDER values persisted

**TenantSwitcher:** ❌ BROKEN (per Step 61 prompt)
- Calls `/auth/me/tenants` which doesn't exist
- Shows "No workspaces yet" even when user has tenants
- "Create your first workspace" link points to `/onboarding/workspace` which doesn't exist

**Workspace creation:** ❌ NOT YET BUILT
- No `/api/v1/tenants` endpoint
- No `/api/v1/auth/me/tenants` endpoint
- No `/api/v1/tenants/{id}/switch` endpoint
- No `/onboarding/workspace` page

**StepProvision:** ❌ FAKE
- Uses `setInterval(STAGE_DELAY_MS = 600)` to tick through 5 stages
- No real backend round-trip
- The `DayOneBootstrapService.load_baseline` F-507 hook IS in the wizard service — the UI just doesn't poll it

**What's blocking:**
- `backend/app/api/v1/tenants.py` doesn't exist
- `TenantMember` model needs verification
- `/onboarding/workspace/page.tsx` doesn't exist
- `StepProvision` needs rewrite to use TanStack Query polling

**The Step 61 prompt (`/workspace/prompts/step61-onboarding-real.md`) defines the exact contract.** Running that prompt will wire workspace creation + TenantSwitcher + StepProvision. Until then, this doc describes the **planned state** for the workspace section.

AI agents must distinguish between **wizard-working** (the 10-step flow advances, persists, resumes) and **workspace-broken** (TenantSwitcher is empty, workspace creation is not implemented). Do not assume the full Onboarding surface is live.