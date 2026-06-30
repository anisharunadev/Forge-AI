# Feature: Co-pilot (Chat + Tool Execution, F-800)

> **Status:** Wired to real backend (Step 24 polish, F-800 multi-phase plan)
> **Routes:** `apps/forge/app/copilot/page.tsx` (fullscreen), global `CopilotPanel` (right-side sheet)
> **Global launcher:** `CopilotLauncher` (FAB, mounted in `ShellProvider`)
> **One-time tooltip:** `FirstRunNudge` (⌘J hint)
> **Backend:** `backend/app/api/v1/copilot.py` + `backend/app/copilot/` package
> **Tools:** `backend/app/copilot/tools/` — 11 V1 tools
> **Constitutional rules:** R1 (LiteLLM proxy), R2 (multi-tenant), R3 (RBAC per tool), R6 (auditability), R12 (cross-cutting — available everywhere via FAB)

---

## Purpose

The Co-pilot is the **always-available AI assistant** that helps users navigate, query, and act on Forge content via natural language. It is the **AI-native surface** of the application — everything else is a UI for data, the Co-pilot is a UI for action.

Per PRD §1.4 the Co-pilot serves **all four personas** — engineers, tech leads, operators, stewards — by adapting to the user's current page context and role.

**Key capabilities:**
- Chat grounded in **page context** (knows which page you're on + what's selected)
- **11 typed tools** (search KG, get ADR, run command, draft artifact, etc.) — model decides when to call them
- **Citations** — every response cites sources (services, ADRs, standards, templates, docs, KG nodes, commands)
- **Tool-call transcript** — visible to user as collapsible cards
- **Suggested actions** — clickable next steps (`navigate` / `run_command` / `draft` / `open_modal`)
- **Conversations** — multi-turn with persistent history, pin, delete
- **Cost tracking** — every message logged with USD + token counts
- **Feedback** — 👍 / 👎 per message, used for training
- **Budget enforcement** — per-conversation USD ceiling (default $1.00)
- **Available everywhere** — ⌘J FAB on every page (R12 cross-cutting)

---

## Architecture

```
[Every page]
  └─ ShellProvider
      ├─ CopilotLauncher (FAB, 60×60 bottom-right)     ← always visible
      ├─ CopilotPanel (right-side sheet)               ← opened by FAB / ⌘J
      └─ FirstRunNudge (one-time ⌘J tooltip)           ← dismissed after first use

/copilot (fullscreen route)
  └─ 3-pane layout: ConversationList | MessageList | About-this
      + ComposerInput at bottom
```

**Two Co-pilot surfaces in one:**
1. **Global panel** — slides from right edge, FAB-launched, every page gets it
2. **Fullscreen `/copilot`** — 3-pane layout, more screen real estate for long conversations

When on `/copilot`, the global panel returns `null` so the fullscreen instance owns the UI (avoids dual rendering).

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/copilot` | `CopilotPanel` (mode="fullscreen") | 3-pane chat experience |
| (every page) | `CopilotPanel` (mode="panel") | Right-side sheet via FAB or ⌘J |

### Backend (FastAPI)

All routes use `@audit()` decorator. Tenant scoping enforced via `principal.tenant_id`.

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/copilot/conversations` | `copilot:use` | Send a message (start or continue conversation) |
| `GET` | `/api/v1/copilot/conversations` | `copilot:use` | List user's conversations |
| `GET` | `/api/v1/copilot/conversations/{id}` | `copilot:use` | Get one conversation + messages |
| `DELETE` | `/api/v1/copilot/conversations/{id}` | `copilot:use` | Soft-delete conversation |
| `POST` | `/api/v1/copilot/messages/{message_id}/feedback` | `copilot:use` | Submit 👍/👎 on a message |
| `GET` | `/api/v1/copilot/conversations/{id}/cost` | `copilot:use` | Get cost breakdown for conversation |
| `GET` | `/api/v1/copilot/tools` | `copilot:admin` | List tools (Steward only — for admin UI) |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `copilot_conversations` | Conversation row (tenant_id, user_id, title, last_message_at, pin flag) |
| `copilot_messages` | Per-message rows (role, content, citations JSONB, tool_calls JSONB, cost_usd, tokens) |
| `copilot_feedback` | 👍/👎 rows per message (training data) |
| `workflow_budgets` | Per-conversation USD ceiling (synthetic row created on conversation open) |
| `cost_entries` | Per-call cost records (joined for cost summary) |
| `audit_events` | Every Co-pilot action logged (send, delete, feedback) |

### Pydantic schemas (`backend/app/schemas/copilot.py`)

- `CopilotPageContext` — `{current_page: str, current_center: str | None, current_artifact_id: UUID | None, recent_actions: list[str]}` — sent on every chat to ground the response
- `CopilotChatRequest` — `{conversation_id: UUID | None, project_id: UUID | None, message: str, page_context: CopilotPageContext}`
- `CopilotChatResponse` — full response: `{conversation_id, message, citations: list[CopilotCitation], tool_calls: list[CopilotToolCall], suggested_actions: list[CopilotSuggestedAction], cost_usd, latency_ms}`
- `CopilotCitation` — `{type: "service"\|"adr"\|"standard"\|"template"\|"doc"\|"kg_node"\|"command", id: str, label: str, snippet: str, url: str}`
- `CopilotToolCall` — `{tool: str, args: dict, result_status: "success"\|"error", duration_ms: int, error: str | None}`
- `CopilotSuggestedAction` — `{label: str, action_type: "navigate"\|"run_command"\|"draft"\|"open_modal", payload: dict}`
- `CopilotMessageRead` — `{id, role: "user"\|"assistant"\|"system"\|"tool", content, citations, tool_calls, confidence, cost_usd, latency_ms, created_at}`
- `CopilotConversationSummary` — `{id, title, last_message_at, message_count, pin: bool}`
- `CopilotConversationRead` — `CopilotConversationSummary + {messages: list[CopilotMessageRead]}`
- `CopilotCostRead` — `{conversation_id, total_usd, prompt_tokens, completion_tokens, by_model: dict, message_count}`
- `CopilotFeedbackRequest` — `{rating: "up"\|"down"}`
- `CopilotToolRead` — `{name, description, permission, rate_limit_per_min}` (for admin UI)

### TypeScript mirror (`apps/forge/lib/api/copilot.ts`)

Mirrors all Pydantic shapes exactly. If you change one, change the other.

---

## 11 V1 Tools (`backend/app/copilot/tools/`)

Every tool is a `Tool` Protocol implementation registered at import time via `tool_registry.register(...)`. The registry is the **only** dispatcher — it does RBAC checks + tenant scoping + rate limiting.

| Tool | Permission | Description |
|---|---|---|
| `search_knowledge` | `copilot:tool:search_knowledge` | Hybrid search over project knowledge graph |
| `get_service` | `copilot:tool:get_service` | Get a service node's properties |
| `get_adr` | `copilot:tool:get_adr` | Get an Architecture Decision Record |
| `list_recent_adrs` | `copilot:tool:list_recent_adrs` | List most recent ADRs (limit param) |
| `get_standards` | `copilot:tool:get_standards` | Get coding/design/architecture standards |
| `get_template` | `copilot:tool:get_template` | Get an artifact template (ADR, PRD, story, etc.) |
| `draft_artifact` | `copilot:tool:draft_artifact` | Draft an artifact (ADR/PRD/note) for user review |
| `run_command` | `copilot:tool:run_command` | Run a forge-* command via existing command runner |
| `navigate_to` | `copilot:tool:navigate_to` | Navigate user to a page (returns URL; client handles) |
| `check_budget` | `copilot:tool:check_budget` | Get current budget state for scope (tenant/conversation/command) |
| `audit_event` | `copilot:tool:audit_event` | Write a custom audit event (compliance use case) |

### Tool structure (canonical example)

```python
# backend/app/copilot/tools/check_budget.py
class CheckBudgetTool:
    name = "check_budget"
    description = "Get the current budget state for the requested scope..."
    permission = COPILOT_PERMISSION_TOOL_CHECK_BUDGET
    rate_limit_per_min = 10
    parameters_schema = {
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": ["tenant", "conversation", "command"]},
        },
        "required": ["scope"],
    }

    async def execute(self, args, *, principal, tenant_id, project_id):
        scope = args.get("scope")
        if scope not in ("tenant", "conversation", "command"):
            raise ToolArgumentInvalid(f"invalid scope: {scope}")
        ...
        return {"spent_usd": 0.42, "ceiling_usd": 1.00, "headroom_usd": 0.58}

tool_registry.register(CheckBudgetTool())
```

**Tool execution flow:**
```
1. Model generates tool_call in response
2. Runtime layer validates args against parameters_schema (JSON Schema)
3. registry.dispatch(name, args, principal):
   a. Look up tool by name
   b. Check principal has tool.permission (RBAC)
   c. Check rate limit (default 10/min)
   d. tool.execute(args, principal=..., tenant_id=..., project_id=...)
   e. Catch ToolDenied / ToolError / ToolArgumentInvalid / ToolDownstreamFailed
   f. Return ToolResult with is_error flag if needed
4. Tool result fed back to model in next turn
5. Model either calls another tool, or generates final response
6. Final response streamed to client (citations + tool_calls + suggested_actions)
```

---

## Feature flag (COPILOT_ENABLED)

The Co-pilot is gated behind a feature flag. Per `backend/app/core/config.py`:

```python
copilot_enabled: bool = Field(
    default=False,
    description="COPILOT_ENABLED env var. Master toggle for the Co-pilot surface.",
)
```

Per-tenant overrides planned for next iteration (via existing `tenants` config table). Frontend reads `useCopilotEnabled()` from `lib/feature-flags.ts` — when `false`, FAB + panel + `/copilot` all return `null`.

---

## Budget Enforcement

Every conversation gets a synthetic `workflow_budget` row on creation with `COPILOT_DEFAULT_BUDGET_USD` (default **$1.00**). The budget service blocks calls that would exceed the ceiling.

```python
# backend/app/core/config.py
copilot_default_budget_usd: float = Field(
    default=1.00,
    description="COPILOT_DEFAULT_BUDGET_USD. Per-conversation budget ceiling.",
)
```

**Hard cap on tool-call turns** (prevents runaway loops):

```python
copilot_max_tool_turns: int = Field(
    default=8,
    description="COPILOT_MAX_TOOL_TURNS. Hard cap on tool-call turns per agent_loop invocation.",
)
```

When the model hits the cap or budget ceiling:
- Runtime returns a synthetic assistant message: "I've reached my budget limit for this conversation. Start a new conversation or increase the ceiling."
- The conversation's `workflow_budget` row is updated with `status=exhausted`

---

## Page Context Grounding

Every chat sends `CopilotPageContext` so the model knows where the user is:

```typescript
{
  current_page: "/workflows/abc-123",
  current_center: "workflows",
  current_artifact_id: "uuid-of-selected-workflow",
  recent_actions: ["node-click:approval", "save-button-click"]
}
```

This lets the Co-pilot answer questions like:
- "What does this workflow do?" — reads current artifact
- "What's on this page?" — reads recent actions + visible content
- "Show me services that depend on X" — uses KG with current context

---

## Co-pilot Store (Zustand, `apps/forge/lib/store/copilot.ts`)

```typescript
interface CopilotState {
  open: boolean;
  activeConversationId: string | null;
  draft: string;
  lastError: string | null;
  permissionDenied: boolean;  // 403 → PermissionDeniedBanner
  firstRunDismissed: boolean; // persisted to localStorage
  streaming: boolean;         // drives FAB thinking gradient
  unreadCount: number;        // badge on FAB
  isPinned: boolean;          // local-only UI state

  setOpen, toggle, setActiveConversation, setDraft, appendDraft, clearDraft,
  setError, setPermissionDenied, dismissFirstRun, setStreaming,
  incrementUnread, clearUnread, setPinned
}

export const useCopilotStore = create<CopilotState>(...);
```

**Mounted once in `ShellProvider`** so FAB, panel, hotkey, and `/copilot` all stay in sync via the same store.

---

## FAB Visual States (`CopilotLauncher`)

| State | Visual |
|---|---|
| **Idle** | Gentle scale pulse (1 → 1.04 → 1, 3s), brand gradient (indigo → cyan), cyan Sparkles icon |
| **Hover** | Scale 1.08, glow intensifies |
| **Active (panel open)** | Scale 0.96 (morphs into panel) |
| **Thinking** | Gradient shifts (indigo → violet → cyan), thinking-dot indicator below |
| **Unread** | Rose badge top-right, "Forge Co-pilot: N new messages" tooltip |
| **Drag** | Cursor grab, FAB grows 1.1×, subtle trail |

**Size:** 60×60 px (Step 24 spec bump from 56)
**Position:** `bottom-6 right-6`
**Z-index:** z-50
**Hidden on:** `/copilot`

---

## Three Modal Surfaces

Three modals are triggered by suggested actions:

| Modal | Trigger | Content |
|---|---|---|
| `CommandConfirmModal` | `action_type === "run_command"` | Command name + inputs + estimated cost + duration + side effects → "Run" / "Cancel" |
| `DraftReviewModal` | `action_type === "draft"` | Draft title + body (plain text) + source citations → "Save as draft" / "Discard" |
| (Nav handled inline) | `action_type === "navigate"` | `router.push(payload.url)` — no modal |
| (Modal handled inline) | `action_type === "open_modal"` | Open existing app modal by name |

Per Rule 3 (human approval gates), `run_command` actions MUST go through `CommandConfirmModal` before execution. The Co-pilot cannot auto-run commands.

---

## Conversation Persistence

- **Multi-tenant scoped** — every query carries `tenant_id`
- **Per-user** — `user_id` from JWT, never visible to other users
- **Soft delete** — `DELETE /conversations/{id}` sets `deleted_at`, retains for audit
- **Pinnable** — local UI flag (not persisted server-side yet)
- **Auto-titled** — backend derives title from first message (or user can edit)

---

## Suggested Actions

The model can emit `CopilotSuggestedAction[]` in its response. Four action types:

```typescript
type CopilotActionType = 'navigate' | 'run_command' | 'draft' | 'open_modal';

interface CopilotSuggestedAction {
  label: string;                          // "Open Workflow"
  action_type: 'navigate' | 'run_command' | 'draft' | 'open_modal';
  payload: Record<string, any>;           // {url: "/workflows/abc"} or {command_id, inputs}
}
```

Rendered as clickable chips below the assistant message. Click triggers the corresponding modal or navigation.

---

## Citations

Every response includes `CopilotCitation[]` to ground the answer:

```typescript
type CopilotCitationType = 'service' | 'adr' | 'standard' | 'template' | 'doc' | 'kg_node' | 'command';

interface CopilotCitation {
  type: CopilotCitationType;
  id: string;
  label: string;
  snippet: string;  // max 200 chars
  url: string;
}
```

Rendered as small `CitationChip` components below the message text. Click opens the source in a side panel.

---

## Feedback

`POST /copilot/messages/{message_id}/feedback` with `{rating: "up" | "down"}`. Drives:
- A training dataset for fine-tuning
- Future quality dashboards on the analytics page
- Tool-call quality scoring

---

## Edge cases

| State | Treatment |
|---|---|
| **Co-pilot disabled (COPILOT_ENABLED=false)** | FAB + panel + `/copilot` all return `null` |
| **No active conversation** | Empty state + suggested prompts ("What can you do?") |
| **First visit** | `FirstRunNudge` shows "Press ⌘J" tooltip; dismissed via `dismissFirstRun()` (localStorage) |
| **403 from tool call** | `PermissionDeniedBanner` (distinct from generic errors) |
| **Tool call returns error** | `ToolCallCard` shows ✗ with error message; conversation continues |
| **Tool call rate limited** | Tool returns error message; model retries with backoff |
| **Budget exhausted** | Runtime returns synthetic "I've reached my budget limit" message; conversation ends |
| **Tool-call turn cap (default 8)** | Runtime returns synthetic "I've made too many tool calls. Try a more specific question." |
| **Streaming response** | FAB shows "thinking" gradient; panel shows typing indicator; messages stream via TanStack Query mutation |
| **Panel closed while response in flight** | `streaming=true` on store; FAB gradient; unread badge increments on settle |
| **Network disconnect** | `lastError` set; banner appears; auto-retry on next message |
| **User navigates away mid-response** | Mutation continues in background; on return, conversation shows updated messages |
| **Empty conversation title** | Backend derives from first message (truncated to 60 chars) |
| **Token overflow (8000+ char message)** | API rejects with 422; UI shows "Message too long" error |
| **Tenant switch** | Active conversation cleared (different tenant); new chat starts |
| **`prefers-reduced-motion`** | FAB pulse + thinking gradient disabled; animations minimal |

---

## Forbidden patterns

AI agents modifying Co-pilot MUST NOT:

- ❌ Add a tool without `register(...)` in `backend/app/copilot/tools/__init__.py` side-effect import
- ❌ Skip the `tool_registry.dispatch()` RBAC check — every tool call MUST verify permission
- ❌ Skip tenant scoping — `tenant_id` comes from `AuthenticatedPrincipal`, NEVER from client
- ❌ Skip audit logging — every chat + delete + feedback writes an `audit_event`
- ❌ Add a new `CopilotCitationType` without updating both `schemas/copilot.py` AND `lib/api/copilot.ts` AND `CitationChip` rendering
- ❌ Bypass budget enforcement — every conversation gets a synthetic `workflow_budget` row
- ❌ Bypass the `copilot_max_tool_turns` cap — runaway loops are forbidden
- ❌ Auto-run `run_command` actions — MUST go through `CommandConfirmModal` (Rule 3)
- ❌ Auto-save `draft` actions — MUST go through `DraftReviewModal`
- ❌ Show Co-pilot UI when `COPILOT_ENABLED=false`
- ❌ Skip `firstRunDismissed` hydration from localStorage (causes flash of nudge for returning users)
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer or typing-indicator dots
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Persist conversation state outside the backend — all messages + feedback + cost go through the API

---

## Verification checklist

- [ ] `apps/forge/app/copilot/page.tsx` renders 3-pane fullscreen layout
- [ ] `CopilotLauncher` (FAB) appears on every page except `/copilot`
- [ ] ⌘J (or Ctrl+J) hotkey opens/closes the panel
- [ ] `Esc` closes the panel
- [ ] `POST /copilot/conversations` creates a new conversation + returns first message
- [ ] `POST /copilot/conversations` with existing `conversation_id` continues it
- [ ] `GET /copilot/conversations` lists user's conversations
- [ ] `GET /copilot/conversations/{id}` returns full conversation with messages
- [ ] `DELETE /copilot/conversations/{id}` soft-deletes (404 thereafter)
- [ ] `POST /copilot/messages/{id}/feedback` with `rating: "up"` writes feedback row
- [ ] `POST /copilot/messages/{id}/feedback` with `rating: "down"` writes feedback row
- [ ] `GET /copilot/conversations/{id}/cost` returns total USD + token counts
- [ ] `GET /copilot/tools` returns 11 tools (Steward only)
- [ ] Tool call cards render collapsible JSON for `search_knowledge`, `get_adr`, etc.
- [ ] Citation chips render with type icon + label
- [ ] Suggested action chips appear below assistant messages
- [ ] `run_command` action opens `CommandConfirmModal` (does NOT auto-run)
- [ ] `draft` action opens `DraftReviewModal` (does NOT auto-save)
- [ ] `navigate` action calls `router.push(payload.url)`
- [ ] Budget exceeded → synthetic "budget limit" message
- [ ] Tool-turn cap exceeded → synthetic "too many tool calls" message
- [ ] FAB shows rose badge when new messages arrive while panel closed
- [ ] FAB shows "thinking" gradient while streaming
- [ ] `FirstRunNudge` shows once; dismissal persists to localStorage
- [ ] Page context (`CopilotPageContext`) sent on every chat
- [ ] Tenant switch clears active conversation
- [ ] `COPILOT_ENABLED=false` → FAB + panel + page all hidden
- [ ] Empty state renders when no conversation exists
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — FAB tokens, panel sheet
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R6 + R12
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list
- [DB schema](../reference/db-schema.md) — `copilot_conversations`, `copilot_messages`, `copilot_feedback`
- [Dashboard](./dashboard.md) — Co-pilot entry from quick-actions
- [Agent Center](./agent-center.md) — Co-pilot can dispatch to registered agents
- [Workflows](./workflows.md) — `draft_artifact` tool can draft workflow updates
- [Stories](./stories.md) — `run_command` tool can run story refinement
- [Runs](./runs.md) — `run_command` tool can start workflow runs
- [Settings](./settings.md) — per-tenant Co-pilot toggle
- [Audit](./audit.md) — every chat + delete + feedback logged
- [Connector Center](./connector-center.md) — KG-backed `search_knowledge` searches connectors

---

## Maintenance notes

**When to update this doc:**

- A new tool added → update the 11-tool table + `__init__.py` import list
- A new `CopilotCitationType` added → update citation type union
- A new `CopilotActionType` added → update suggested action types
- A budget rule changes → update Budget Enforcement section
- A new modal added → update Three Modal Surfaces section

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/copilot.py                    ←  7 routes
backend/app/schemas/copilot.py                   ←  Pydantic source of truth
backend/app/copilot/tools/base.py                ←  Tool Protocol
backend/app/copilot/tools/registry.py            ←  Dispatcher (RBAC + rate limit)
backend/app/copilot/tools/*.py                   ←  11 tool implementations
backend/app/db/models/copilot.py                 ←  Conversation + Message + Feedback
         ↓
apps/forge/lib/api/copilot.ts                    ←  TypeScript mirror + REST SDK
apps/forge/lib/store/copilot.ts                  ←  Zustand client state
apps/forge/hooks/use-copilot.ts                  ←  TanStack Query hooks
         ↓
apps/forge/components/copilot/CopilotLauncher.tsx  ←  FAB
apps/forge/components/copilot/CopilotPanel.tsx     ←  Panel + fullscreen
apps/forge/components/copilot/CommandConfirmModal.tsx ←  Approval for run_command
apps/forge/components/copilot/DraftReviewModal.tsx    ←  Approval for draft
apps/forge/components/copilot/FirstRunNudge.tsx       ←  Tooltip
apps/forge/components/copilot/MessageBubble.tsx       ←  Citations + tool calls
apps/forge/components/copilot/ToolCallCard.tsx       ←  Tool call transcript
apps/forge/components/copilot/CitationChip.tsx       ←  Citation UI
apps/forge/components/copilot/SlashCommandPopover.tsx ←  /command palette
apps/forge/app/copilot/page.tsx                      ←  Fullscreen route
apps/forge/components/shell/ShellProvider.tsx        ←  Mounts global panel + FAB + nudge
```

If any link in this chain drifts, the Co-pilot breaks silently. Always update all links.

---

## Why this is "AI-Native"

The Co-pilot is **the only surface** in Forge where the AI has agency to act (via tools) rather than just display data. Everything else — dashboard, agent center, stories, runs — is a UI for structured data the user already knows about. The Co-pilot is the UI for **unknown unknowns**: the user asks "what's blocking my deploy?" and the Co-pilot searches the KG, reads recent audit events, queries budget state, and synthesizes an answer with citations — all without the user navigating away from their current page.

This is why Rule 12 (cross-cutting concerns) puts the Co-pilot FAB on every page: it's not a feature, it's the **keyboard**.