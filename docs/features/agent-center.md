# Feature: Agent Center

> **Status:** Complete — wired to real backend (Step 54 Phase 2)
> **Route:** `apps/forge/app/agent-center/page.tsx`
> **Root component:** `apps/forge/components/agent-center/AgentCenter.tsx`
> **Bento layout:** `apps/forge/components/agent-center/AgentCenterBento.tsx`
> **Adapter:** `apps/forge/lib/agent-center/adapter.ts`
> **Backend:** `backend/app/api/v1/agents.py` + `model_providers.py` + `agent_runtimes.py` + `agent_assignments.py`
> **Schemas:** `backend/app/schemas/agents.py` + `model_providers.py`
> **Constitutional rules:** R1 (LiteLLM proxy), R2 (multi-tenant), R4 (typed artifacts), R6 (auditability), R8 (configurable), R9 (forge-core canonical)

---

## Purpose

The Agent Center is the **registry for AI agents, model providers, runtimes, and assignments** within a Forge tenant. It is the control plane where operators register which AI workers can run, which LLM providers they call (via LiteLLM proxy), which execution sandboxes they use, and which tasks/projects they're assigned to.

Per PRD §1.4 the Agent Center serves **operators** (register + test agents), **tech leads** (assign agents to projects), and **stewards** (audit + governance).

---

## Architecture

```
AgentCenter (root client component, 4 tabs)
├── AgentsTab (default) — Bento grid
│   ├── AgentCenterBento
│   │   ├── Hero "Build your AI workforce"
│   │   ├── KPI tiles (Total / Active / Latency / Success)
│   │   ├── Recent agents (5 rows)
│   │   ├── Activity heatmap (7×24)
│   │   └── Top providers vertical bar chart
│   ├── AgentCard (per agent)
│   ├── CreateAgentDialog
│   ├── AgentDetailPanel
│   └── AgentOnboardingWizard (4-step wizard)
├── ModelProvidersTab
│   ├── ModelProviderList
│   ├── ModelProviderCard (per provider)
│   ├── AddProviderDialog
│   └── "Test connection" → POST /model-providers/{id}/test (real LiteLLM call)
├── AssignmentsTab
│   └── AgentAssignmentMatrix (project × agent grid)
└── RuntimesTab
    ├── RuntimeStatus
    └── AddRuntimeDialog
```

**Cross-cutting concerns:**

- `AgentCenterExplainerHero` — onboarding explanation
- `AgentMentalModelDiagram` — visualizes the agent/provider/runtime model
- `CommonAgentPatterns` — pre-built templates (Code reviewer, Refactor agent, etc.)
- `FirstTimeTooltip` — first-visit guidance
- `AgentCenterEmptyState` — used when no agents registered

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/agent-center` | `AgentCenter` | Main page (client component, 4 tabs) |
| `/agent-center?agent={id}` | query param | Opens `AgentDetailPanel` for the agent |

### Backend (FastAPI)

All routes use `@audit()` decorator and `require_permission(...)` for RBAC. Tenant scoping enforced via `principal.tenant_id`.

#### Agents (`backend/app/api/v1/agents.py`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/agents` | `agents:read` | List agents (optional `?project_id=...`) |
| `GET` | `/api/v1/agents/{id}` | `agents:read` | Get one agent |
| `POST` | `/api/v1/agents` | `agents:write` | Register agent |
| `PATCH` | `/api/v1/agents/{id}` | `agents:write` | Update agent (name, capabilities, status, version) |
| `DELETE` | `/api/v1/agents/{id}` | `agents:write` | Deregister agent |
| `POST` | `/api/v1/agents/{id}/test` | `agents:read` | Test agent reachability (calls LiteLLM proxy) |

#### Model Providers (`backend/app/api/v1/model_providers.py`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/model-providers` | `model_providers:read` | List providers |
| `GET` | `/api/v1/model-providers/{id}` | `model_providers:read` | Get one provider |
| `POST` | `/api/v1/model-providers` | `model_providers:write` | Register provider (API key in `config`) |
| `PATCH` | `/api/v1/model-providers/{id}` | `model_providers:write` | Update provider |
| `DELETE` | `/api/v1/model-providers/{id}` | `model_providers:write` | Deregister provider |
| `POST` | `/api/v1/model-providers/{id}/test` | `model_providers:read` | **Real LiteLLM call** — returns `latency_ms` or real error (401 / 403 / 404 / timeout) |

#### Runtimes (`backend/app/api/v1/agent_runtimes.py`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/runtimes` | `agent_runtimes:read` | List runtimes |
| `GET` | `/api/v1/runtimes/{id}` | `agent_runtimes:read` | Get one runtime |
| `POST` | `/api/v1/runtimes` | `agent_runtimes:write` | Register runtime (local-docker / production-k8s) |
| `PATCH` | `/api/v1/runtimes/{id}` | `agent_runtimes:write` | Update runtime config |
| `DELETE` | `/api/v1/runtimes/{id}` | `agent_runtimes:write` | Deregister runtime |
| `POST` | `/api/v1/runtimes/{id}/restart` | `agent_runtimes:write` | Restart runtime |

#### Assignments (`backend/app/api/v1/agent_assignments.py`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/agent-assignments` | `agent_assignments:read` | List assignments |
| `GET` | `/api/v1/agent-assignments/{id}` | `agent_assignments:read` | Get one |
| `POST` | `/api/v1/agent-assignments` | `agent_assignments:write` | Assign agent to task_type + project |
| `PATCH` | `/api/v1/agent-assignments/{id}` | `agent_assignments:write` | Update strategy |
| `DELETE` | `/api/v1/agent-assignments/{id}` | `agent_assignments:write` | Remove assignment |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `agents` | Agent profiles (name, type, capabilities, status, version) |
| `model_providers` | LLM providers (Anthropic, OpenAI, etc.) with API keys + LiteLLM alias |
| `agent_runtimes` | Execution sandboxes (local-docker, production-k8s) |
| `agent_assignments` | Agent-to-task_type-to-project mapping |
| `audit_events` | Every mutation logged |

### Pydantic schemas

**Agents (`backend/app/schemas/agents.py`):**

- `AgentBase` — `name: str`, `type: AgentType`, `capabilities: dict[str, Any]`, `version: str = "1.0.0"`
- `AgentCreate` — adds `project_id: UUID | None` (NULL = org-level, available to every project)
- `AgentUpdate` — `name | capabilities | status | version` (all optional)
- `AgentRead` — adds `id: UUID`, `status: AgentStatus`
- `AgentAssignmentCreate` — `task_type: str`, `project_id: UUID | None`, `strategy: str`

**Model Providers (`backend/app/schemas/model_providers.py`):**

- `ModelProviderBase` — `name`, `type`, `config: dict[str, Any]` (holds `api_key`), `litellm_model_alias`, `enabled`, `rate_limit_rpm`, `rate_limit_tpm`
- `ModelProviderCreate`, `ModelProviderUpdate`, `ModelProviderRead`, `ModelProviderResolveResult`

### Enums (`backend/app/db/models/agent.py`)

```python
class AgentType(str, enum.Enum):
    CLAUDE_CODE = "claude_code"
    CODEX = "codex"
    GEMINI = "gemini"
    CUSTOM = "custom"

class AgentStatus(str, enum.Enum):
    ENABLED = "enabled"
    DISABLED = "disabled"
    DEPRECATED = "deprecated"
```

### TypeScript types

- `apps/forge/lib/agent-center/data.ts` — UI shape (richer, with defaults for `defaultProvider`, `lastInvokedAt`, `invocations24h`)
- `apps/forge/lib/query/hooks.ts` — backend wire shape (`Agent`, `ModelProvider`, `Runtime`)
- `apps/forge/lib/agent-center/adapter.ts` — bridge between backend wire and UI shape

---

## The Adapter Pattern (CRITICAL)

The backend `AgentRead` is **sparse**: `name`, `type`, `version`, `capabilities`, `status`. The UI components expect a **richer shape** with `defaultProvider`, `lastInvokedAt`, `invocations24h` for sparklines + KPIs.

The adapter in `apps/forge/lib/agent-center/adapter.ts` fills gaps with **explicit defaults** (`"—"` or `0`) so the user can tell what is real vs. placeholder. Per Rule 10 (project intelligence precedes automation): **never fabricate metrics**; if you don't have it, show `0` not `42`.

```typescript
// Backend shape
interface Agent {
  id: string;
  name: string;
  type: AgentType;
  version: string;
  capabilities: Record<string, unknown>;
  status: AgentStatus;
}

// UI shape (richer)
interface UiAgent extends Agent {
  defaultProvider: string;   // "—" if unknown
  lastInvokedAt: string;     // "" if unknown
  invocations24h: number;     // 0 if unknown
}
```

---

## 4-Step Onboarding Wizard

When the user clicks "Register Agent" the wizard walks them through:

1. **Connect a model provider** — Anthropic / OpenAI / AWS Bedrock / Google Vertex. Test connection calls `POST /model-providers/{id}/test` which hits the real LiteLLM proxy (returns real latency or real error).
2. **Register agent** — pick template (Claude Code / Codex / Aider / Custom) or build custom. Fills form on right.
3. **Configure runtime** — local-docker (default) or production-k8s. CPU + memory sliders.
4. **Assign to project** — pick project + role (Default / Reviewer / Approver).

`AgentOnboardingWizard` component handles all 4 steps. State persists in `useOnboardingStore` (Zustand). Step state syncs with URL (`?step=N`).

---

## Seed Data (Step 54)

The seed script `backend/scripts/seed_agents.py` inserts:

- **6 agents**: Code reviewer, Refactor agent, Sync agent, Test runner, Doc generator, Security auditor
- **4 model providers**: Anthropic, OpenAI, AWS Bedrock, Google Vertex
- **2 runtimes**: `local-docker`, `production-k8s`
- **Multiple assignments** linking agents to projects

Run with: `docker compose exec backend python -m scripts.seed_agents`

---

## Edge cases

| State | Treatment |
|---|---|
| **No agents registered** | `AgentCenterEmptyState` + `AgentOnboardingWizard` CTA |
| **No model providers** | Wizard step 1 disabled with "Connect a provider first" hint |
| **Provider test fails (401)** | Toast: "Invalid API key (401 Unauthorized)" with retry button |
| **Provider test fails (timeout)** | Toast: "Timeout after 10s — check API base URL" |
| **Agent capability not configured** | Card shows capability chip as muted/gray + tooltip "Not configured" |
| **Assignment to deleted project** | Backend returns 404; frontend refetches assignments |
| **Org-level agent vs project-scoped** | `project_id IS NULL` = available to every project; specific `project_id` = scoped |
| **Deprecated agent** | Status badge shows "Deprecated" with strikethrough; new assignments blocked |
| **Concurrent registration (race)** | Backend uses `INSERT ... ON CONFLICT DO NOTHING` on `(tenant_id, name)` unique constraint |
| **Tenant switch** | Every query key carries `tenant_id`; switching forces refetch via TanStack Query invalidation |

---

## Forbidden patterns

AI agents modifying the Agent Center MUST NOT:

- ❌ Bypass `adapter.ts` — UI components MUST go through the adapter, never import backend `Agent` directly
- ❌ Add fake metrics to the UI shape — defaults are explicit `0` or `"—"`, never invented numbers
- ❌ Skip `@audit()` on any backend mutation — every create/update/delete MUST be audited
- ❌ Skip `require_permission("agents:write")` / `("model_providers:write")` on mutations
- ❌ Skip tenant scoping — every query carries `tenant_id` from JWT, never from client input
- ❌ Use direct SDK imports for LLM calls — every call goes through LiteLLM proxy (R1)
- ❌ Call upstream provider APIs directly from Forge backend — use `litellm_admin.py` or proxy
- ❌ Hardcode agent types — use the `AgentType` enum (4 values: `claude_code`, `codex`, `gemini`, `custom`)
- ❌ Skip the 4-step wizard when registering — UX rule: never let users skip steps that configure defaults
- ❌ Use `bg-black` — use `--bg-base` and the layered surface system
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Add new fields to `AgentRead` without updating `schemas/agents.py` + `lib/query/hooks.ts` + `lib/agent-center/data.ts` + `adapter.ts` (4-way lock-step)

---

## Verification checklist

- [ ] `apps/forge/app/agent-center/page.tsx` renders with all 4 tabs (Agents / Model Providers / Assignments / Runtimes)
- [ ] `curl .../agents` returns 6 seeded agents with valid Bearer token + tenant scope
- [ ] `curl .../model-providers` returns 4 seeded providers (Anthropic, OpenAI, AWS Bedrock, Google Vertex)
- [ ] `curl .../runtimes` returns 2 seeded runtimes
- [ ] `curl .../agent-assignments` returns N assignments linking agents to projects
- [ ] `POST /model-providers/{id}/test` returns real latency or real error (not fake "Reachable as arun@acme.com")
- [ ] Agent bento shows real KPIs (Total: 24, Active: 7, Latency: 342ms, Success: 97.2%)
- [ ] Top providers chart shows real data from LiteLLM `/spend/models`, not zeros
- [ ] CreateAgentDialog → POST /agents → new agent appears in list with optimistic UI
- [ ] Delete agent → optimistic removal → rollback on error
- [ ] Test agent → POST /agents/{id}/test → toast with result
- [ ] Provider test → POST /model-providers/{id}/test → real latency in toast
- [ ] Wizard step 1 (Connect provider) blocks step 2 until provider exists
- [ ] Assignments grid shows project × agent matrix
- [ ] Filter bar (status pills, type chips) updates query in real-time
- [ ] Empty states render when API returns `[]`
- [ ] Loading states render during fetch (skeleton, not spinners)
- [ ] Tenant switch refetches all 4 tabs
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — agent state colors (idle / thinking / executing / reviewing / completed / failed)
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R6 + R9
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list
- [DB schema](../reference/db-schema.md) — `agents`, `model_providers`, `agent_runtimes`, `agent_assignments`
- [LiteLLM integration](../standards/litellm-integration.md) — how `POST /test` proxies to upstream
- [Settings](./settings.md) — Settings > Workspace > Agents tab reuses these hooks
- [Dashboard](./dashboard.md) — Dashboard > Your Agents tile reads from same `agents` table

---

## Maintenance notes

**When to update this doc:**

- A new agent type added (e.g. `LOCAL_LLM`) → update `AgentType` enum + seed script + adapter
- A new model provider type added → update `ModelProviderType` enum + seed script
- A new runtime kind added (e.g. `LAMBDA`) → update `RuntimeKind` enum
- A new field on `AgentRead` → update lock-step: schemas → hooks types → data.ts → adapter.ts
- A new test endpoint (e.g. `POST /agents/{id}/benchmark`) → update routes table
- A new wizard step → update 4-step section

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/schemas/agents.py             ←  source of truth (Pydantic)
backend/app/db/models/agent.py            ←  Agent / AgentType / AgentStatus
         ↓
apps/forge/lib/query/hooks.ts             ←  TanStack Query hooks (wire types)
         ↓
apps/forge/lib/agent-center/data.ts       ←  UI shape (richer)
         ↓
apps/forge/lib/agent-center/adapter.ts    ←  bridge
         ↓
apps/forge/components/agent-center/       ←  UI components
```

If any link in this chain drifts, the Agent Center breaks silently. Always update all four.