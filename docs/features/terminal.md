# Feature: Forge Terminal (PTY + Cost Tracking + Governance)

> **Status:** Wired to real backend (Step 36 canvas-first + Step 59 governance reorientation)
> **Route:** `apps/forge/app/forge-terminal/page.tsx` (Step 36 canvas-first layout)
> **Backend:** `backend/app/api/v1/terminal_*.py` (5 sub-routers, 18 routes) + `backend/app/api/v1/policies.py` (2 routes) + `backend/app/api/v1/governance_violations.py` (4 routes) + `backend/app/api/ws/terminal.py` (WebSocket)
> **LLM Gateway (admin):** `apps/forge/app/admin/llm-gateway/page.tsx` + 3 deep surfaces (tenants / health / mcp-servers)
> **Constitutional rules:** R1 (LiteLLM proxy — terminal cost data), R2 (multi-tenant), R3 (approval gates), R6 (auditability), R7 (real-time SSE/WS)

---

## Purpose

The Forge Terminal is the **PTY-based command surface** where operators launch AI agents (Claude Code / Codex / Gemini) against a workspace and watch live execution. It pairs with **cost tracking** (per-session USD rollup), **governance** (policies + violations), and **LLM Gateway admin** (per-tenant LiteLLM config).

Per PRD §1.4 the Terminal serves **operators** (launch + monitor), **tech leads** (debug + optimize), and **stewards** (audit + governance). The Terminal is the "where the work happens" surface — every other surface feeds into it (agents, connectors, knowledge graph).

**Key capabilities:**

**Terminal canvas:**
- **Multi-session tabs** — open many agent sessions in parallel
- **PTY WebSocket** — bidirectional proxy to the sidecar (base64-encoded frames)
- **Live cost tracking** — USD/hour burn rate per session
- **Inline context** — KG-derived context items injected into the prompt
- **Audit rail** — left/right rails with command history + audit events
- **Focus mode** — Esc to exit, Ctrl+Shift+M to toggle
- **9 keyboard shortcuts** — Ctrl+Shift+T (new tab), Ctrl+Shift+W (close), ⌘1-5 (rails), etc.

**Cost tracking (F-412):**
- **Per-session USD rollup** — one row per (session, model)
- **Burn rate** — USD/hour derived from last N seconds of activity
- **Exact + heuristic estimation** — exact token counts from CLI NDJSON streams, byte-based fallback (`bytes / 4`)
- **Per-command cost** — surfaced in audit rail

**Governance (Step 59 reorientation):**
- **Policies** — LiteLLM-style policy definitions (severity + expression)
- **Guardrails** — PII masking, prompt injection detection, content moderation, secret detection
- **Violations** — recorded by LiteLLM proxy, surfaced in Governance Center

**LLM Gateway (admin):**
- **Tenant config** — per-tenant model assignment + budget + guardrails
- **Virtual keys** — LiteLLM virtual key lifecycle (issue / rotate / revoke)
- **MCP servers** — read-only browser of LiteLLM-registered MCP servers
- **Health** — LiteLLM availability dashboard (auto-refresh 30s)

---

## Architecture

```
ForgeTerminalPage (/forge-terminal)
└── Step 36 canvas-first layout
    ├── SidecarBanner (when disconnected)
    ├── LeftRail (56/320px) — sessions + workspaces + agents
    ├── TerminalPanel (hero)
    │   ├── SessionTabs (44px)
    │   ├── Toolbar (44px)
    │   ├── Pane host (flex, xterm.js canvas)
    │   └── StatusBar (32px)
    └── AuditRail (56/360px) — command history + cost

AdminLLMGatewayPage (/admin/llm-gateway)
└── Steward landing for F-829 integration
    ├── 3 hub cards: Tenants / MCP / Health
    └── Per-card drill-down

WebSocket: ws://api/ws/terminal (F-405)
└── PTY proxy between browser and sidecar
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/forge-terminal` | ForgeTerminalPage | Canvas-first terminal |
| `/admin/llm-gateway` | AdminLLMGatewayPage | LLM Gateway hub (3 cards) |
| `/admin/llm-gateway/tenants` | TenantsIndex | All tenants + virtual keys |
| `/admin/llm-gateway/tenants/[id]` | TenantDetail | One tenant config |
| `/admin/llm-gateway/tenants/[id]/keys` | KeysPage | Virtual key lifecycle |
| `/admin/llm-gateway/mcp-servers` | MCPServers | Read-only MCP browser |
| `/admin/llm-gateway/health` | HealthDashboard | LiteLLM availability (30s refresh) |

### Backend (FastAPI)

#### Terminal — 5 sub-routers, **18 routes**

All prefix `/api/v1/terminal`:

**`terminal_commands.py` (3):**
| Method | Path | Description |
|---|---|---|
| `POST` | `/terminal/commands/launch` | Launch a CLI command in a session (201) |
| `POST` | `/terminal/sessions/{id}/inject` | Inject a command mid-session |
| `GET` | `/terminal/sessions/{id}/output` | Poll session output (recent) |

**`terminal_costs.py` (4):**
| Method | Path | Description |
|---|---|---|
| `GET` | `/terminal/sessions/{id}/cost` | Per-session cost summary |
| `GET` | `/terminal/costs` | List all session costs (tenant) |
| `GET` | `/terminal/costs/burn-rate` | USD/hour burn rate |
| `POST` | `/terminal/sessions/{id}/cost/estimate` | Estimate cost (heuristic) |

**`terminal_context.py` (3):**
| Method | Path | Description |
|---|---|---|
| `GET` | `/terminal/sessions/{id}/context` | List inline context items |
| `POST` | `/terminal/sessions/{id}/context/refresh` | Force-refresh cache |
| `GET` | `/terminal/sessions/{id}/context/{item_id}` | Get one context item |

**`terminal_broadcast.py` (3):**
| Method | Path | Description |
|---|---|---|
| `GET` | `/terminal/sessions/{id}/broadcasters` | List active broadcasters |
| `POST` | `/terminal/sessions/{id}/broadcast/grant` | Grant broadcast permission |
| `POST` | `/terminal/sessions/{id}/broadcast/revoke` | Revoke broadcast permission |

**`terminal_export.py` (3):**
| Method | Path | Description |
|---|---|---|
| `GET` | `/terminal/sessions/{id}/export` | Export session (download) |
| `POST` | `/terminal/sessions/{id}/export/upload` | Upload export to storage |
| `GET` | `/terminal/sessions/{id}/export/history` | List past exports |

#### Governance — `policies.py` (2) + `governance_violations.py` (4)

**`policies.py`:**
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/policies` | List policies (tenant) |
| `POST` | `/api/v1/policies` | Create policy (201) |

**`governance_violations.py`:**
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/governance/violations` | List violations (filter by severity) |
| `POST` | `/api/v1/governance/violations/{id}/resolve` | Mark resolved (Steward) |
| `POST` | `/api/v1/governance/violations/{id}/reopen` | Re-open |
| `POST` | `/api/v1/governance/violations/poll` | Force poll for new violations |

#### WebSocket — `backend/app/api/ws/terminal.py`

| Path | Description |
|---|---|
| `ws://api/ws/terminal` | PTY proxy (auth via first frame JWT) |

**Wire format (client → server):**
```json
{"type": "auth", "token": "<jwt>"}                  // first frame
{"type": "input", "data": "<base64>"}              // stdin
{"type": "resize", "rows": 24, "cols": 80}
```

**Wire format (server → client):**
```json
{"type": "ready"}                                   // post-auth
{"type": "output", "data": "<base64>"}              // PTY stdout
{"type": "exit", "code": 0}
{"type": "error", "message": "..."}
```

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `terminal_session_costs` | Per-session, per-model cost rollup (F-412) |
| `cost_entries` | Append-only LLM cost ledger |
| `policies` | Policy definitions (LiteLLM-style) |
| `litellm_guardrail_violations` | PII / prompt injection / moderation / secret detection |
| `audit_events` | Every terminal + governance action logged |

### `terminal_session_costs` (`backend/app/db/models/terminal_cost.py`)

```python
class TerminalSessionCost(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "terminal_session_costs"
    session_id: str           # indexed
    tenant_id: UUID           # indexed
    project_id: UUID
    model: str                # max 128 chars
    prompt_tokens: int        # default 0
    completion_tokens: int    # default 0
    cost_usd: Decimal(18, 8)  # high precision
    recorded_at: datetime     # indexed
    command_count: int        # default 0
    duration_seconds: float   # default 0.0

    __table_args__ = (
        Index("ix_tsc_session_model", "session_id", "model"),
        Index("ix_tsc_tenant_recorded", "tenant_id", "recorded_at"),
    )
```

> A given session may have multiple rows when the user switches between Claude Code, Codex, and Gemini mid-session. The dashboard groups by model; the per-session total sums all rows.

### `LiteLLMGuardrailViolation` (`backend/app/db/models/litellm_guardrail_violation.py`)

```python
class GuardrailAction(str, Enum):
    BLOCKED = "blocked"      # request denied
    WARNED = "warned"        # passed with redacted content
    PASSED = "passed"        # logged but no action

class LiteLLMGuardrailViolation(Base, ...):
    __tablename__ = "litellm_guardrail_violations"
    litellm_team_id: str     # indexed
    guardrail_id: str        # indexed
    sanitized_content: str   # redacted text (never raw PII — Rule 6)
    resolved: bool           # Steward acknowledged
```

### Backend enums

**`PolicySeverity` (3):**
```python
INFO = "info"
WARN = "warn"
BLOCK = "block"
```

### Frontend `SessionStatus` (4 values, `apps/forge/lib/store.ts`)

```typescript
export type SessionStatus =
  | 'creating'    // WS opening, no output yet
  | 'active'      // connected, receiving output
  | 'closed'      // session ended cleanly
  | 'error';      // connection lost / sidecar down
```

### Pydantic schemas

**Policy:**
```python
class PolicyBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    expression: dict[str, Any]   # LiteLLM-style expression
    severity: PolicySeverity = PolicySeverity.WARN
    enabled: bool = True

class PolicyRead(PolicyBase, TenantScopedModel):
    id: UUID
```

**Cost (per session):**
```python
class CostSummaryResponse(BaseModel):
    session_id: str
    total_usd: Decimal
    by_model: dict[str, Decimal]
    prompt_tokens: int
    completion_tokens: int
    command_count: int
    duration_seconds: float
```

**Burn rate:**
```python
class BurnRateResponse(BaseModel):
    usd_per_hour: Decimal
    window_seconds: int        # last N seconds
    sample_size: int           # # of commands in window
```

---

## Cost Tracking (F-412)

### `record_usage` (exact tokens from CLI)

```python
# Claude Code / Codex / Gemini all return usage in their NDJSON streams
async def record_usage(
    self,
    handle: CostTrackerHandle,
    prompt_tokens: int,
    completion_tokens: int,
    model: str,
) -> None:
    handle.prompt_tokens += int(prompt_tokens)
    handle.completion_tokens += int(completion_tokens)
    handle.command_count += 1
    handle.last_activity_at = datetime.now(timezone.utc)
    cost = cost_for(model, prompt_tokens, completion_tokens)
    handle.cost_usd += cost
    await self._record_ledger_row(...)  # also writes to cost_entries
```

### `estimate_from_output` (byte-based heuristic fallback)

```python
# Heuristic: roughly 4 chars per token for English-language LLM output
_OUTPUT_BYTES_PER_TOKEN = 4
_PROMPT_OVERHEAD_TOKENS = 50
_DEFAULT_MODEL_COST_PER_1K = 0.003  # USD per 1k completion tokens

async def estimate_from_output(
    self,
    handle: CostTrackerHandle,
    output_bytes: int,
    *,
    command_count_delta: int = 1,
) -> float:
    # Used by the PTY hook that watches every N bytes of CLI output.
    # Returns the cost incurred (USD) so callers can surface it
    # without re-querying.
    ...
```

### `get_burn_rate` (USD/hour)

```python
# USD/hour, derived from cost over the last window_seconds of activity,
# so a session that just finished a $0.02 command shows up immediately
# on the dashboard.
async def get_burn_rate(self, session_id: str, window_seconds: int = 300) -> Decimal:
    ...
```

### CostTrackerHandle (opaque)

```python
@dataclass
class CostTrackerHandle:
    _lock: asyncio.Lock
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: Decimal = Decimal(0)
    command_count: int = 0
    last_activity_at: datetime
```

---

## 9 Keyboard Shortcuts (Step 32 + Step 36)

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New terminal session |
| `Ctrl+Shift+W` | Close current session |
| `Ctrl+Tab` | Switch to next session |
| `Ctrl+1-9` | Switch to session N |
| `⌘1..5` | Toggle rail visibility (left / right / etc.) |
| `⌘0` | Hide all rails |
| `⌘⇧0` | Focus mode (full canvas) |
| `Ctrl+Shift+M` | Toggle focus mode |
| `⌘?` | Help overlay |

Focus mode exits on `Esc`.

---

## Inline Context (KG-derived)

Per the F-405 design, each terminal session surfaces **inline context items** — KG-derived snippets (services, ADRs, stories) injected into the prompt for grounding.

```python
class ContextItemResponse(BaseModel):
    id: str
    kind: str            # 'service' | 'adr' | 'story' | 'idea' | ...
    label: str
    snippet: str         # max 200 chars
    relevance: float     # 0-1
    href: str            # link to source
```

3 routes: list / refresh / get one. Per Rule 5 (KG-backed knowledge).

---

## 18 Terminal Components (`apps/forge/components/forge-terminal/`)

| Component | Lines | Purpose |
|---|---|---|
| `TerminalPanel.tsx` | 616 | Main panel orchestrator |
| `LeftRail.tsx` | 591 | Sessions + workspaces + agents |
| `AuditRail.tsx` | 342 | Command history + cost |
| `HelpOverlay.tsx` | 359 | Keyboard shortcut help |
| `SessionTabs.tsx` | 378 | Multi-session tab strip |
| `SidecarBanner.tsx` | 293 | Disconnect warning + retry |
| `NewSessionDialog.tsx` | 257 | New session wizard |
| `TicketPreviewCard.tsx` | 130 | Preview ticket creation |
| `TerminalToolbar.tsx` | 241 | Action toolbar |
| `StatusBar.tsx` | 206 | Connection + cost status |
| `TerminalPane.tsx` | 186 | xterm.js canvas wrapper |
| `TerminalLayout.tsx` | 180 | Canvas-first layout |
| `TerminalHero.tsx` | 108 | Optional hero band |
| `TerminalTabs.tsx` | 64 | Tab strip variant |
| `LayoutSwitcher.tsx` | 63 | Layout mode toggle |
| `AuditPanel.tsx` | 182 | Audit log panel |
| `AgentSelector.tsx` | 37 | Quick agent switch |
| `WorkspaceSelector.tsx` | 37 | Quick workspace switch |

---

## LLM Gateway Admin (Step 59 + F-829)

The Steward's view of the LiteLLM Proxy integration. Three hub cards:

### 1. Tenants (`/admin/llm-gateway/tenants`)
- List all tenants with model assignment + budget + guardrails
- Drill-down: per-tenant config
- Virtual key lifecycle (issue / rotate / revoke)

### 2. MCP Servers (`/admin/llm-gateway/mcp-servers`)
- Read-only card grid of LiteLLM-registered MCP servers
- Per OQ-34, the LiteLLM admin UI is the surface for managing MCP config; Forge only renders the read view

### 3. Health (`/admin/llm-gateway/health`)
- Cached health snapshot from `LiteLLMHealthMonitor`
- Auto-refresh every 30s
- Drill-down: consecutive failures + last probe timestamp + source

Global `LLMUnavailableBanner` lives at app root — uniform status across all pages.

---

## Policies + Governance

**Policies** are LiteLLM-style expressions evaluated by the proxy. Per the Step 59 reorientation:

> Forge = LiteLLM frontend. Policies live in LiteLLM; Forge surfaces them via `/api/v1/policies` proxy route.

```python
class PolicyBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    expression: dict[str, Any]    # LiteLLM expression
    severity: PolicySeverity = PolicySeverity.WARN
    enabled: bool = True
```

**Severity drives behavior:**
- `INFO` — logged, no action
- `WARN` — surfaced in audit rail, doesn't block
- `BLOCK` — request denied, Steward must override

---

## Guardrails (4 seeded per Step 59)

Per `backend/app/services/litellm_admin.py` + Step 59 seed:

| Guardrail | Action |
|---|---|
| `pii_masking` | Redacts PII (emails, SSNs, credit cards) before logging |
| `prompt_injection_detection` | Blocks obvious prompt-injection patterns |
| `content_moderation` | Warns on toxic content (OpenAI moderation API) |
| `secret_detection` | Detects API keys / tokens / passwords in payloads |

Each violation creates a `LiteLLMGuardrailViolation` row with `sanitized_content` (redacted, never raw — Rule 6).

---

## Sidecar Banner (Disconnected State)

When the PTY sidecar is down (e.g., user forgot to run `pnpm dev:terminal`):

```typescript
const SidecarBanner = ({ state, onRetry }) => {
  const failed = state === 'failed';
  return (
    <div data-state={failed ? 'failed' : 'reconnecting'}>
      ⚠ Sidecar disconnected. Start it with `pnpm dev:terminal`.
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
};
```

State machine: `connecting` → `connected` ↔ `reconnecting` → `failed`.

---

## Seed Data (Step 59)

| Artifact | Count | Notes |
|---|---|---|
| Guardrails | 4 | pii_masking, prompt_injection_detection, content_moderation, secret_detection |
| Policies | 2-4 | 1 default + tenant-specific |
| Cost entries | 0 | Live-tracked only |

---

## Edge cases

| State | Treatment |
|---|---|
| **Sidecar disconnected** | Banner + Retry button + "Start with `pnpm dev:terminal`" hint |
| **WS auth fail** | Error frame, retry with new token |
| **Session in creating** | Spinner overlay + cyan dot + "Connecting..." text |
| **Session in active** | Live cost ticker + burn rate badge |
| **Session in closed** | Muted badge + "Reopen" button |
| **Session in error** | Rose badge + reconnect button |
| **Cost budget exceeded** | (planned) Block new commands + Steward notification |
| **Guardrail BLOCKED** | Request denied + red banner + Steward audit row |
| **Guardrail WARNED** | Audit row + content redacted in display |
| **Cost tracker handle leak** | Auto-cleanup after 1h inactivity |
| **Burn rate window empty** | Show "$0.00/hr" + "No recent activity" |
| **MCP server down** | LiteLLM-side error propagated + retry CTA |
| **`prefers-reduced-motion`** | Pulse animations disabled; status dots static |

---

## Forbidden patterns

AI agents modifying Terminal MUST NOT:

- ❌ Import direct LLM SDKs — Rule 1: route through LiteLLM proxy
- ❌ Skip tenant scoping on any cost / policy / violation query — Rule 2
- ❌ Skip audit logging on terminal events — Rule 6
- ❌ Render raw PII / secrets in guardrail violations — `sanitized_content` only
- ❌ Auto-override `BLOCK` severity policies — Steward must approve
- ❌ Skip WS auth (first frame JWT) — reject unauthenticated connections
- ❌ Use direct cost computation — `cost_for()` from LiteLLM pricing
- ❌ Skip `auth.audit()` decorator on terminal mutations
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer or xterm cursor
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist

- [ ] `/forge-terminal` renders canvas-first layout (3 zones)
- [ ] `POST /terminal/commands/launch` creates a new session (201)
- [ ] WS connects at `ws://api/ws/terminal` with first-frame JWT auth
- [ ] `GET /terminal/sessions/{id}/output` returns recent output
- [ ] `POST /terminal/sessions/{id}/inject` injects a command
- [ ] `GET /terminal/sessions/{id}/cost` returns USD + token breakdown
- [ ] `GET /terminal/costs` lists all sessions' costs
- [ ] `GET /terminal/costs/burn-rate` returns USD/hour
- [ ] `POST /terminal/sessions/{id}/cost/estimate` returns estimate
- [ ] `GET /terminal/sessions/{id}/context` returns KG-derived context
- [ ] `POST /terminal/sessions/{id}/context/refresh` updates cache
- [ ] `GET /terminal/sessions/{id}/export` downloads session log
- [ ] `GET /policies` returns 2-4 seeded policies
- [ ] `POST /policies` creates a policy
- [ ] `GET /governance/violations?severity=block` returns BLOCK violations
- [ ] `POST /governance/violations/{id}/resolve` marks resolved
- [ ] `POST /governance/violations/poll` triggers poll
- [ ] Sidecar banner appears when disconnected
- [ ] AuditRail shows command history with cost
- [ ] StatusBar shows live burn rate
- [ ] Focus mode (Ctrl+Shift+M) toggles full-canvas view
- [ ] Help overlay (⌘?) shows all 9 shortcuts
- [ ] LiteLLM health auto-refreshes every 30s on admin page
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — terminal tokens + xterm theme
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R6 + R7
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (24 routes)
- [DB schema](../reference/db-schema.md) — `terminal_session_costs`, `policies`, `litellm_guardrail_violations`
- [Dashboard](./dashboard.md) — "Sessions by cost" + "Burn rate" widgets
- [Agent Center](./agent-center.md) — Terminal launches registered agents
- [Workflows](./workflows.md) — Workflow sessions are also tracked for cost
- [Copilot](./copilot.md) — Alternative AI surface (chat vs PTY)
- [Audit](./audit.md) — Every terminal action logged
- [Settings](./settings.md) — Terminal defaults + LLM Gateway config
- [Auth](./auth.md) — JWT used in WS first-frame auth

---

## Maintenance notes

**When to update this doc:**

- A new terminal route added → update 18-route breakdown
- A new keyboard shortcut added → update 9-shortcut table
- A new guardrail seeded → update 4-guardrail list
- A new policy severity added → update `PolicySeverity` enum

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/terminal_broadcast.py    ←  3 broadcast routes
backend/app/api/v1/terminal_commands.py     ←  3 command routes
backend/app/api/v1/terminal_context.py      ←  3 context routes
backend/app/api/v1/terminal_costs.py        ←  4 cost routes
backend/app/api/v1/terminal_export.py       ←  3 export routes
backend/app/api/v1/policies.py              ←  2 policy routes
backend/app/api/v1/governance_violations.py ←  4 violation routes
backend/app/api/ws/terminal.py              ←  PTY WebSocket
backend/app/db/models/terminal_cost.py      ←  TerminalSessionCost table
backend/app/db/models/litellm_guardrail_violation.py ←  GuardrailAction enum
backend/app/services/terminal/cost_tracker.py         ←  record_usage + estimate_from_output
backend/app/services/litellm_admin.py                 ←  LiteLLM Proxy SDK
         ↓
apps/forge/lib/store.ts                     ←  SessionStatus type + TerminalSession
apps/forge/hooks/use-terminal.ts            ←  xterm.js wrapper
apps/forge/lib/hooks/useLiteLLM.ts          ←  TanStack Query hooks for LLM Gateway
         ↓
apps/forge/app/forge-terminal/page.tsx      ←  Step 36 canvas-first
apps/forge/components/forge-terminal/       ←  18 components (4270 lines total)
apps/forge/app/admin/llm-gateway/           ←  Steward landing + 3 deep surfaces
```

If any link in this chain drifts, the Terminal surface breaks silently. Always update all links.

---

## Why this is "where the work happens"

The Terminal is the **execution surface** where AI work actually runs. Every other surface feeds into it:
- **Agents** — registered here, launched from Terminal tabs
- **Workflows** — execute through the workflow executor (similar PTY-based runner)
- **Connectors** — pull data into the workspace before Terminal launches
- **Knowledge Graph** — inline context grounded in KG (per Rule 5)
- **Copilot** — alternative AI surface (chat vs PTY)

This is the surface where **Rule 1 (LiteLLM proxy) is most visible** — every command flows through the proxy, every cost is metered, every guardrail is enforced, every policy is evaluated. Without the Terminal, Forge would be just dashboards; with it, Forge is a **runnable AI workbench**.