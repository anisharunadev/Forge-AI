# Feature: Command Center (forge-* Command Runner)

> **Status:** Wired to real backend (Step 54+ — `commands.py` replaces fake "simulated success")
> **Route:** `apps/forge/app/forge-command-center/page.tsx` (developer workbench)
> **Backend:** `backend/app/api/v1/commands.py` (4 routes)
> **Service:** `backend/app/services/forge_commands.py` (canonical dispatch surface)
> **Registry:** `FORGE_COMMAND_MAP` (63 commands across 13 categories)
> **Co-pilot tool:** `backend/app/copilot/tools/run_command.py` (validate + estimate only — Rule 3 enforcement)
> **Ledger:** `backend/app/db/models/command_run.py` (`command_runs` table)
> **Constitutional rules:** R1 (provider-agnostic — never imports provider SDKs), R2 (multi-tenant), R3 (human approval for `requires_approval: true`), R4 (typed artifacts), R6 (auditability)

---

## Purpose

The Command Center is the **canonical on-demand dispatch surface** for every `forge-*` command in the platform. A `forge-*` command is a white-labeled wrapper around an internal GSD (Get-Shit-Done) engine call — the UI never sees "GSD," only the friendly `forge-*` name.

Per PRD §1.4 the Command Center serves **all four personas** — engineers (run lint / format / test), tech leads (run architecture / review), operators (run deploy / rollback), stewards (run security / audit).

**Key capabilities:**

**Three modes:**
- **Ticket** (default) — paste a Jira/GitHub/Linear ticket, AI orchestrates the SDLC pipeline end-to-end
- **Spec** — full spec-driven workflow with editor + side panel
- **Catalog** — browse every forge-* skill grouped by GSD phase

**Persistent overlays:**
- **My Work drawer** (right slide-in)
- **Command palette** (⌘K)
- **Shortcuts panel** (⌘/)
- **Phase execution drawer** (live streaming + activity feed)
- **GSD phase widget** (bottom-left beacon)

**Dispatch surface:**
- **63 forge-* commands** across 13 categories
- **3 RBAC tiers** (`user` / `admin` / `system`)
- **Approval-required flag** per command (Architecture / Security / Deployment always require)
- **Typed envelope** — Rule 4 (typed artifacts, never free-form blobs)
- **Co-pilot integration** — `run_command` tool validates + estimates, never executes

---

## Architecture

```
ForgeCommandCenterPage (/forge-command-center)
└── Three modes (Zustand store)
    ├── TicketMode — paste URL/ID, AI orchestrates
    ├── SpecMode — full spec editor
    └── CatalogMode — browse 63 forge-* skills

Persistent overlays
├── CommandPalette (⌘K)
├── ShortcutsPanel (⌘/)
├── MyWorkDrawer (right slide-in)
├── PhaseExecutionDrawer (live streaming)
└── GsdPhaseWidget (bottom-left beacon)

[Co-pilot]
└── run_command tool
    ├── Validates forge-* command exists
    ├── Checks RBAC permission
    ├── Estimates cost via workflow_budget
    └── Returns confirmation envelope
            ↓
    [USER APPROVAL — Rule 3 gate]
            ↓
    [workflow_executor.route_to_gsd() — actual dispatch]

[Workflow executor]
└── Command nodes dispatch via same route_to_gsd()
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/forge-command-center` | ForgeCommandCenterPage | Developer workbench (3 modes) |

### Backend (FastAPI) — `backend/app/api/v1/commands.py` — 4 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/commands/{name}/run` | `commands:run` | Dispatch a forge-* command |
| `GET` | `/api/v1/commands/{name}/artifact` | `commands:read` | Read SKILL.md for a command |
| `PUT` | `/api/v1/commands/{name}/artifact` | `commands:write` | Write SKILL.md (with etag check) |
| `GET` | `/api/v1/commands/{name}/runs` | `commands:read` | List past runs for a command |

### CommandDispatch flow

```python
# backend/app/api/v1/commands.py
@router.post("/{name}/run", response_model=CommandRunResponse)
@audit(action="command.run", target_type="command")
async def run_command(name: str, body: CommandRunRequest, principal: Principal, ...):
    # 1. Resolve forge-* to internal command (404 if unknown)
    try:
        cmd = get_forge_command(name)
    except UnknownForgeCommand as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    # 2. Enrich args with tenant + project + actor (Rule 2)
    enriched_args = {
        **body.args,
        "_tenant_id": str(principal.tenant_id),
        "_project_id": str(principal.project_id),
        "_actor_id": str(principal.user_id),
    }

    # 3. Dispatch (offloaded to thread — GSD can be CPU-bound)
    try:
        output = await asyncio.to_thread(
            route_to_gsd, cmd.internal_cmd, enriched_args
        )
    except Exception as exc:
        # Typed failure envelope
        raise HTTPException(
            status_code=500,
            detail={"error": "command_failed", "command": name, "message": str(exc)},
        )

    # 4. Emit event (Rule 6)
    await bus.publish(
        EventType.COMMAND_RUN,
        {"command": name, "ok": True},
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
    )

    # 5. Return typed envelope (Rule 4)
    return CommandRunResponse(
        name=name,
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        output=output,
    )
```

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `command_runs` | One row per direct invocation (distinct from workflow_runs + ingestion_runs) |
| `audit_events` | Every dispatch logged (via `@audit()` decorator) |
| `cost_entries` | Cost tracking via `workflow_budget` admission control |

### `command_runs` table (`backend/app/db/models/command_run.py`)

```python
class CommandRunStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"


class CommandRun(Base, UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin):
    __tablename__ = "command_runs"
    run_key: str           # idempotency key (200 chars max)
    command_name: str      # forge-* name (120 chars max)
    invoked_by: UUID       # FK to users
    status: CommandRunStatus
    args: dict             # JSONB
    output: dict | None    # JSONB — captured on success
    error: dict | None     # JSONB — captured on failure
    started_at: datetime
    finished_at: datetime | None
    cost_usd: Decimal      # 0.0 if unknown
    duration_ms: int | None
```

> Distinct from `workflow_runs` (multi-step workflows) and `ingestion_runs` (connector pulls). `command_run` is the audit log for **one-shot** command invocations.

### Pydantic schemas (`backend/app/api/v1/commands.py`)

```python
class CommandRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    args: dict[str, Any] = Field(default_factory=dict)

class CommandRunResponse(BaseModel):
    """Typed envelope — Rule 4 (typed artifacts)."""
    name: str
    tenant_id: UUID
    project_id: UUID
    output: Any

class CommandArtifact(BaseModel):
    command: str
    path: str
    content: str
    lastModified: str
    etag: str

class CommandArtifactUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(..., min_length=0, max_length=2_000_000)
```

---

## FORGE_COMMAND_MAP (63 commands)

The canonical map lives in `backend/app/services/forge_commands.py`. **63 commands across 13 categories**, validated at import time:

| Category | Count | Tier mix | Examples |
|---|---|---|---|
| **onboard** | 4 | user (3) + admin (1) | forge-onboard-welcome, forge-onboard-bootstrap (admin), forge-onboard-resume |
| **intel** | 6 | user (all) | forge-intel-scan-repo, forge-intel-summary, forge-intel-graph-build |
| **ideate** | 5 | user (all) | forge-ideate-crystallize, forge-ideate-cluster |
| **arch** | 6 | user (5) + admin (1) | forge-arch-adr (user), forge-arch-adr-approve (admin) |
| **dev** | 7 | user (5) + admin (2) | forge-dev-scaffold, forge-dev-implement, forge-dev-hotfix (admin), forge-dev-migrate (admin) |
| **test** | 5 | user (4) + admin (1) | forge-test-unit, forge-test-integration, forge-test-e2e (admin) |
| **sec** | 5 | admin (4) + system (1) | forge-sec-scan (admin), forge-sec-incident (system) |
| **review** | 4 | user (2) + admin (2) | forge-review-diff, forge-review-approve (admin) |
| **deploy** | 5 | user (1) + admin (3) + system (1) | forge-deploy-prod (admin), forge-deploy-rollback (system) |
| **milestone** | 4 | user (1) + admin (3) | forge-milestone-cut (admin), forge-milestone-tag (admin) |
| **learn** | 4 | user (3) + admin (1) | forge-learn-capture, forge-learn-promote (admin) |
| **flow** | 4 | user (3) + admin (1) | forge-flow-run, forge-flow-cancel (admin) |
| **env** | 4 | user (1) + admin (2) + system (1) | forge-env-sync (system), forge-env-promote (admin) |

### 3 RBAC Tiers (`CommandTier`)

```python
CommandTier = Literal["user", "admin", "system"]
```

- **user** — most commands; engineers + tech leads
- **admin** — destructive / privileged; requires `admin` role
- **system** — automated only (incident, rollback); cannot be invoked by humans

### `requires_approval` flag

Every command has a `requires_approval: bool` flag. When `True`:
- Co-pilot `run_command` tool returns confirmation envelope (doesn't execute)
- Workflow executor pauses at the command node for human approval (Rule 3)
- Direct API call still works but logs to audit + requires recent approval

**Always approval-required:** Architecture / Security / Deployment categories.

### Validation at import time

```python
_FORGE_NAME_RE = re.compile(r"^forge-[a-z][a-z0-9-]*$")

# Validate every entry up front — fail loud, fail early.
_VALIDATED: list[ForgeCommand] = []
for _forge, _internal, _desc, _tier, _approval in _ENTRIES:
    if not _FORGE_NAME_RE.match(_forge):
        raise ValueError(f"bad forge command name: {_forge!r}")
    if not _internal.startswith("gsd:"):
        raise ValueError(
            f"internal cmd {_internal!r} for {_forge!r} must be opaque 'gsd:...' form"
        )
```

If any entry is malformed, the backend **refuses to start**. This is intentional — adding a new command that doesn't fit is a design smell.

---

## DL-024: White-Labeling Principle

> **Users of Forge AI must NEVER see "GSD" anywhere in the UI, in logs, or in API responses.** Every internal engine command is exposed under a `forge-*` name.

The mapping is opaque:

```
Forge UI  →  forge-* command  →  GSDWrapper  →  gsd-core (internal)
                                       \\→  gsd:phase:discovery (opaque)
```

The internal command names use the `gsd:<area>:<verb>` form (opaque `:`-separated triples) rather than the friendlier `gsd-discover` form **so that any leaked reference (log line, error message, audit record) still does not advertise the underlying engine to a customer reading their own audit trail.**

---

## 7 ForgePhases (`apps/forge/lib/forge-core/manifest.ts`)

```typescript
export const FORGE_PHASES: ReadonlyArray<{
  id: ForgePhase;
  label: string;
  short: string;
  description: string;
  icon: string;
  accent: 'cyan' | 'indigo' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
}> = [
  { id: 'discovery',    label: 'Discovery',    short: 'Spike',  icon: 'Compass',      accent: 'violet' },
  { id: 'planning',     label: 'Planning',     short: 'Plan',   icon: 'ClipboardList', accent: 'cyan' },
  { id: 'execution',    label: 'Execution',    short: 'Execute', icon: 'Hammer',      accent: 'indigo' },
  { id: 'verification', label: 'Verification', short: 'Verify', icon: 'CheckCircle2', accent: 'emerald' },
  { id: 'deployment',   label: 'Deployment',   short: 'Deploy', icon: 'Rocket',      accent: 'amber' },
  { id: 'audit',        label: 'Audit',        short: 'Audit',  icon: 'ShieldCheck', accent: 'rose' },
  { id: 'maintenance',  label: 'Maintenance',  short: 'Polish', icon: '...',         accent: 'slate' },
];
```

Each forge-* command maps to one phase via its category (e.g. `forge-dev-*` → `execution`).

---

## SKILL.md Artifact Read/Write

The Command Center's "View" + inline edit surfaces the SKILL.md for each command.

### Path safety

```python
FORGE_CORE_ROOT = Path(
    os.environ.get(
        "FORGE_CORE_ROOT",
        str(Path(__file__).resolve().parents[4] / "packages" / "forge-core"),
    )
)

def _skill_path(name: str) -> Path:
    """Resolve and validate the SKILL.md path for a forge-* command."""
    if not name.startswith("forge-"):
        raise HTTPException(status_code=400, detail="command name must start with forge-")
    safe = name[len("forge-"):].strip("/")
    if not safe or "/" in safe or ".." in safe or not all(
        c.isalnum() or c in "-_" for c in safe
    ):
        raise HTTPException(status_code=400, detail="invalid command name")
    candidate = (FORGE_CORE_ROOT / "skills" / name / "SKILL.md").resolve()
    root = FORGE_CORE_ROOT.resolve()
    if not str(candidate).startswith(str(root)):
        raise HTTPException(status_code=400, detail="path traversal blocked")
    return candidate
```

**Three guards:**
1. Name must start with `forge-`
2. No `/`, no `..`, only `[a-zA-Z0-9_-]`
3. Resolved path must stay within `FORGE_CORE_ROOT` (prevents directory traversal)

### ETag-based optimistic concurrency

```python
content = path.read_text(encoding="utf-8")
etag = hashlib.sha1(content.encode("utf-8")).hexdigest()
```

ETag returned with `GET /commands/{name}/artifact`. Client must include `If-Match` header on `PUT` to prevent overwrites. Returns 412 Precondition Failed on mismatch.

---

## Co-pilot `run_command` Tool (Rule 3 Enforcement)

```python
# backend/app/copilot/tools/run_command.py
class RunCommandTool:
    """Validate + estimate a forge-* command run. Never executes."""
    
    name = "run_command"
    description = (
        "Propose running a forge-* command (e.g. forge-arch-adr, "
        "forge-dev-lint). Returns a confirmation envelope the user "
        "must approve. The command is NEVER executed from this tool — "
        "approval is required so the model loop cannot cross "
        "Architecture / Security / Deployment boundaries unilaterally."
    )
    permission = COPILOT_PERMISSION_TOOL_RUN_COMMAND
    rate_limit_per_min = 10
```

**Per-tool tier-based cost estimate:**

```python
_TIER_COST_ESTIMATE_USD: dict[str, Decimal] = {
    "user": Decimal("0.10"),
    "admin": Decimal("1.00"),
    "system": Decimal("5.00"),
}
```

### Tool execution flow

```
1. Model generates run_command tool call
   ↓
2. Tool validates:
   - command_id matches ^forge-[a-z][a-z0-9-]*$
   - principal has commands:run permission
   - workflow_budget.check_budget(estimated_cost) → OK
   ↓
3. Tool returns CONFIRMATION ENVELOPE (does NOT execute):
   { command_id, inputs, estimated_cost_usd, estimated_duration_sec, side_effects, ... }
   ↓
4. UI shows CommandConfirmModal
   ↓
5. User clicks "Run" or "Cancel"
   ↓
6. ONLY on Run: workflow_executor.route_to_gsd() called
```

> **Constitutional guarantee:** The Co-pilot model can NEVER reach an executing path without explicit human approval captured outside the model loop.

---

## 13 Command Center Components

| Component | Purpose |
|---|---|
| `CommandCenterHeader.tsx` | Top header with mode tabs + actions |
| `ModeSwitcher.tsx` | Ticket / Spec / Catalog switcher |
| `TicketMode.tsx` | Paste URL/ID, AI orchestration |
| `SpecMode.tsx` | Full spec editor + side panel |
| `CatalogMode.tsx` | Browse 63 forge-* skills |
| `CommandPalette.tsx` | ⌘K palette |
| `ShortcutsPanel.tsx` | ⌘/ shortcuts help |
| `MyWorkDrawer.tsx` | Right slide-in personal work |
| `PhaseExecutionDrawer.tsx` | Live streaming + activity feed |
| `GsdPhaseWidget.tsx` | Bottom-left beacon |
| `ForgeSkillCard.tsx` | Skill card (catalog mode) |
| `SpecTemplateDialog.tsx` | Spec template picker |
| `FirstRunState.tsx` | First-visit welcome |

---

## Zustand Store (`apps/forge/lib/command-center/store.ts`)

```typescript
export type CommandCenterMode = 'ticket' | 'spec' | 'catalog';

export type OrchestrationEventKind =
  | 'agent-invoked'
  | 'file-changed'
  | 'connector-call'
  | 'reasoning'
  | 'ticket-status'
  | 'pr-opened';

export const useCommandCenter = create<CommandCenterState>((set) => ({
  mode: 'ticket',
  // ... selectedTicket, selectedSpec, activePhase
  // ... drawer visibility, palette open, shortcuts panel
}));
```

**Scope:** mode + selections + drawer state. **Not here:** server data — that flows through TanStack Query + WebSocket (Rule 7).

---

## Seed Data

> The acme-corp demo seeds **50 historical command runs** per `command_run.py` docstring.

Each forge-* command has a SKILL.md in `packages/forge-core/skills/<name>/SKILL.md`.

---

## Edge cases

| State | Treatment |
|---|---|
| **Unknown forge-* command** | 404 `UnknownForgeCommand` |
| **Permission denied** | 403 — `commands:run` required |
| **Budget exceeded** | Workflow_budget blocks — run_command returns error |
| **Command not in registry** | Startup fails (import-time validation) |
| **Path traversal in SKILL.md path** | 400 `path traversal blocked` |
| **ETag mismatch on PUT** | 412 Precondition Failed |
| **Command times out** | `TIMED_OUT` status row written + audit |
| **Command cancelled** | `CANCELLED` status row written + audit |
| **Co-pilot run_command without approval** | Returns confirmation envelope only — never executes |
| **Tiers wrong** | Import-time validation fails |
| **`prefers-reduced-motion`** | Pulse animations disabled |

---

## Forbidden patterns

AI agents modifying Command Center MUST NOT:

- ❌ Import direct LLM / provider SDKs — Rule 1 (via orchestrator)
- ❌ Add a `forge-*` command that bypasses FORGE_COMMAND_MAP — must be registered
- ❌ Add a command without the regex validation matching `^forge-[a-z][a-z0-9-]*$`
- ❌ Expose `gsd:*` names in UI / logs / API responses — DL-024 white-labeling
- ❌ Skip tenant scoping on command args — Rule 2 (`_tenant_id` + `_project_id` enriched)
- ❌ Skip `@audit()` decorator on `/run` — Rule 6
- ❌ Skip `require_permission("commands:run")` — RBAC enforcement
- ❌ Auto-execute `requires_approval: true` commands without human approval — Rule 3
- ❌ Skip the SKILL.md path traversal guards — security critical
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist

- [ ] `/forge-command-center` renders 3-mode layout (ticket / spec / catalog)
- [ ] `curl .../commands/forge-dev-lint/runs` returns past runs
- [ ] `POST /commands/forge-dev-lint/run` returns typed envelope
- [ ] Unknown command returns 404 `UnknownForgeCommand`
- [ ] Permission denied returns 403
- [ ] Command exceeding budget returns error
- [ ] `GET /commands/forge-arch-adr/artifact` returns SKILL.md + etag
- [ ] `PUT /commands/forge-arch-adr/artifact` requires If-Match header
- [ ] `PUT /commands/forge-arch-adr/artifact` with stale etag returns 412
- [ ] Path traversal attempt returns 400
- [ ] Co-pilot `run_command` tool returns confirmation envelope only
- [ ] Co-pilot `run_command` tool NEVER executes (Rule 3)
- [ ] Direct API call to run command still works (bypasses Co-pilot gate)
- [ ] `@audit(action="command.run")` writes audit row
- [ ] COMMAND_RUN event published on success
- [ ] 63 commands visible in Catalog mode
- [ ] 7 phases visible in GSD phase widget
- [ ] MyWorkDrawer shows live runs
- [ ] CommandPalette opens on ⌘K
- [ ] ShortcutsPanel opens on ⌘/
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — phase accents
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R4 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (4 routes)
- [DB schema](../reference/db-schema.md) — `command_runs`
- [Dashboard](./dashboard.md) — "Recent commands" widget
- [Agent Center](./agent-center.md) — `forge-*` commands can dispatch to agents
- [Workflows](./workflows.md) — Workflow `command` nodes use same `route_to_gsd`
- [Terminal](./terminal.md) — Terminal launches CLI agents with similar approval gates
- [Co-pilot](./copilot.md) — `run_command` tool is the canonical Co-pilot entrypoint
- [Audit](./audit.md) — Every command logged
- [Settings](./settings.md) — Command Center defaults tab

---

## Maintenance notes

**When to update this doc:**

- A new `forge-*` command added → update FORGE_COMMAND_MAP table (63 currently)
- A new category added → update CATEGORIES tuple
- A new RBAC tier added → update `CommandTier` literal
- A new `requires_approval` rule changed → update approval-required list
- FORGE_PHASES rebalanced → update 7-phase list

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/commands.py                 ←  4 routes (run + artifact GET/PUT + runs list)
backend/app/services/forge_commands.py        ←  FORGE_COMMAND_MAP (63) + 3 tiers + route_to_gsd
backend/app/copilot/tools/run_command.py       ←  Co-pilot tool (validate + estimate only)
backend/app/db/models/command_run.py           ←  CommandRun + 6-status enum
backend/app/services/workflow_executor.py      ←  Reuses route_to_gsd for command nodes
         ↓
apps/forge/lib/forge-core/manifest.ts          ←  FORGE_PHASES (7) + ForgeSkill type
apps/forge/lib/command-center/store.ts         ←  Zustand store (3 modes)
apps/forge/lib/hooks/useForgeCommands.ts       ←  TanStack Query hooks (run + list)
         ↓
apps/forge/app/forge-command-center/page.tsx   ←  Developer workbench (3 modes + 5 overlays)
apps/forge/components/command-center/          ←  13 components
apps/forge/components/copilot/CommandConfirmModal.tsx ←  Approval gate for run_command
```

If any link in this chain drifts, the Command Center breaks silently. Always update all links.

---

## Why DL-024 matters (White-Labeling)

> **Without DL-024, every audit row, every log line, every error message advertises "GSD" to a customer reading their own data.** A leak is not just embarrassing — it's a competitive differentiator given away for free.

The mapping is intentionally **opaque** (`gsd:<area>:<verb>` rather than `gsd-<verb>`) so even if a string slips through, it doesn't reveal the underlying engine. This is enforced at three layers:

1. **Import-time validation** — `if not _internal.startswith("gsd:")` raises
2. **Route handlers** — only `forge-*` names exposed via `/commands/{name}`
3. **UI** — only `forge-*` names rendered in catalog, palette, history

Every forge-* command flows through `route_to_gsd(internal_cmd, args)` — the only place where the internal name is dereferenced. This is the single point of truth.