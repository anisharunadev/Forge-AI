# Feature: Workspaces (Tenant Switching + Status)

> **Status:** **Frontend-only surface** (no `/workspaces` backend route — workspaces are a UI pattern in the Sidebar's `WorkspaceSwitcher`)
> **Implementation:** `apps/forge/components/shell/Sidebar.tsx` (lines 162-258 = `WorkspaceSwitcher`; lines 273-356 = `TenantStatusFooter`)
> **Backend support:** Tenant model (`backend/app/db/models/tenant.py`) + slug coercion (`backend/app/services/tenants.py:_coerce_tenant_id`)
> **Auth integration:** `apps/forge/lib/api/auth.ts` (Zustand store — `tenant` is the active workspace)
> **Constitutional rules:** R2 (multi-tenant — `tenant` is "never optional" in auth store), R12 (cross-cutting concern — WorkspaceSwitcher is global chrome)

---

## Honest framing: workspaces are not a feature page

Unlike the other docs in this tree, **Workspaces is not a dedicated page or center**. It is a **cross-cutting UI pattern** that:

1. **Pins to the top of every sidebar** — `WorkspaceSwitcher` lives in `ShellChrome`, visible on every authenticated page
2. **Pins to the bottom of every sidebar** — `TenantStatusFooter` shows health + settings shortcut
3. **Persists across sessions** — `localStorage` (sidebar collapse) + JWT cookie (tenant)
4. **Drives the active tenant** — the `X-Forge-Tenant` header sent on every API call

This doc captures the **UI pattern + backend tenant model** that make "switching workspaces" work. It is honest about the gap: **there is no `GET /api/v1/workspaces` route** — workspaces are derived from the user's Keycloak `tenant_id` claim + the dev demo seed.

**Key capabilities:**

- **Workspace switcher (top of sidebar)** — avatar + name + chevron + `⌘\` hint
- **3 demo workspaces** hardcoded (Acme Corp / Beta Industries / Cosmic Labs)
- **Tenant status footer (bottom of sidebar)** — pulsing emerald dot + "Healthy" + settings gear
- **Sidebar collapse** — 256px ↔ 64px, persists to localStorage
- **3 nav groups** — Workspace / Centers / Lifecycle
- **Multi-tenant auth gate** — every API call carries tenant context

---

## Architecture

```
ShellChrome (every page)
└── <aside> sidebar
    ├── <WorkspaceSwitcher collapsed={...}>  ← Top of sidebar
    │   ├── Avatar tile (gradient bg, initials)
    │   ├── Tenant name + slug
    │   ├── ChevronDown (rotates on open)
    │   ├── kbd hint (⌘\ on Mac, Ctrl\ on others)
    │   └── DropdownMenu
    │       ├── "Switch workspace" label
    │       ├── [Acme Corp / Beta / Cosmic] items
    │       └── "+ New workspace" item
    │
    ├── <NavList>  ← Middle (scrollable)
    │   ├── Group: Workspace
    │   │   ├── Dashboard
    │   │   └── Co-pilot
    │   ├── Group: Centers
    │   │   ├── Agents / Projects / Stories / Workflows
    │   │   ├── Knowledge / Artifacts
    │   │   ├── Ideation / Architecture / Connectors
    │   └── Group: Lifecycle
    │       ├── Onboarding / Governance / Audit / Analytics
    │       ├── Terminal / Runs / Command (legacy)
    │       └── Settings (footer entry)
    │
    └── <TenantStatusFooter collapsed={...}>  ← Bottom of sidebar
        ├── Pulsing emerald dot (animate-ping)
        ├── "Healthy" label
        ├── Tenant slug ("· acme-corp")
        └── Settings gear icon (→ /admin)

Backend (Tenant foundation)
└── Tenant model (UUID PK + slug + status + settings)
    ├── _coerce_tenant_id (slug → UUID via uuid5 namespace)
    ├── get_or_create_tenant
    └── TenantDirectory service (slug cache)

Auth store
└── Zustand `useAuth` (tenant is NEVER optional — Rule 2)
```

---

## Workspace Switcher (Sidebar top)

### Component contract

```typescript
// apps/forge/components/shell/Sidebar.tsx (verbatim)
interface WorkspaceSwitcherProps {
  readonly collapsed: boolean;
}

function WorkspaceSwitcher({ collapsed }: WorkspaceSwitcherProps) {
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPod|iPhone|iPad/.test(navigator.platform));
    }
  }, []);

  const tenant = {
    name: 'Acme Corp',
    id: 'acme-corp',
  };
  // ... avatar + dropdown rendering
}
```

### 4 visual states

**1. Collapsed mode (64px sidebar):**
- Avatar tile (40x40 hit area, gradient bg)
- Tooltip on hover: "Acme Corp"
- `aria-label="Workspace: Acme Corp. Press ⌘\ to switch."`

**2. Expanded trigger (256px sidebar):**
- Avatar + tenant name + slug + ChevronDown + `<kbd>⌘\</kbd>` hint
- Hover bg: `rgba(255,255,255,0.04)`
- Focus ring: 2px `var(--accent-primary)` with offset
- `aria-label="Workspace: Acme Corp. Click to switch."`

**3. Dropdown (open state):**
- Width: `w-64` (256px)
- Background: `var(--bg-elevated)`
- Header: "Switch workspace" (uppercase 10px label)
- 3 demo tenant rows (Acme / Beta / Cosmic)
- Active tenant marked with emerald `<Check>` + `aria-label="Active"`
- Separator + "+ New workspace" item

**4. Hotkey hint (`⌘\`):**
- Detected via `navigator.platform` regex (`/Mac|iPod|iPhone|iPad/`)
- Mac: `⌘\`
- Others: `Ctrl\`
- Hidden below `md` breakpoint (`hidden ... md:inline-block`)

### 3 hardcoded demo workspaces

```typescript
// From Sidebar.tsx WorkspaceSwitcher dropdown (verbatim)
[
  { name: 'Acme Corp', id: 'acme-corp', active: true },
  { name: 'Beta Industries', id: 'beta-ind', active: false },
  { name: 'Cosmic Labs', id: 'cosmic', active: false },
]
```

> **⚠️ Honest gap:** These 3 workspaces are **hardcoded literals** in the Sidebar — there is no backend route that returns them. The dropdown currently does NOT switch tenants on click (it's a visual mock awaiting the FORA-123 broker). The active tenant is always `acme-corp` (the dev demo seed).

### Avatar generation

```typescript
const avatar = (
  <div
    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md
               bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-violet)]
               text-xs font-bold text-white shadow-[var(--shadow-glow-primary)]"
    aria-hidden="true"
  >
    AC
  </div>
);
```

**Per-row avatar in dropdown:**
```typescript
{t.name.split(' ').map((w) => w[0]).join('')}
// "Acme Corp" → "AC"
// "Beta Industries" → "BI"
// "Cosmic Labs" → "CL"
```

---

## Tenant Status Footer (Sidebar bottom)

### Component contract

```typescript
// apps/forge/components/shell/Sidebar.tsx (verbatim)
function TenantStatusFooter({ collapsed }: { collapsed: boolean }) {
  const pulseDot = (
    <span
      aria-hidden="true"
      className="relative inline-flex h-2 w-2 shrink-0 items-center justify-center"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-emerald)] opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent-emerald)]" />
    </span>
  );
  // ... collapsed + expanded renderings
}
```

### 2 visual states

**1. Collapsed mode:**
- Stack: pulse dot button + settings gear button
- Each: 40x40 hit area with hover bg
- Tooltip: "Healthy · acme-corp" / "Workspace settings"
- `aria-label="Tenant healthy"` / `aria-label="Workspace settings"`

**2. Expanded mode:**
- Rounded container: `border-subtle bg-inset px-2.5 py-2`
- Layout: pulse dot + "Healthy" (uppercase emerald) + "· acme-corp" + settings gear (ml-auto)
- Gear link → `/admin`
- `aria-label="Workspace settings"` on gear

### Status semantics

The footer shows **"Healthy"** as a hardcoded label. There is **no backend health endpoint** wired here today — this is also a visual mock awaiting the FORA-123 broker. The pulsing emerald dot is decorative.

---

## Sidebar Width + Collapse

### Width tokens

```typescript
const SIDEBAR_WIDTH_EXPANDED = 'w-[256px]';
const SIDEBAR_WIDTH_COLLAPSED = 'w-[64px]';
const SIDEBAR_TRANSITION = 'transition-[width] duration-200 ease-out-soft';
```

**2 widths:**
- **Expanded:** 256px (avatar + name + chevron + kbd hint)
- **Collapsed:** 64px (avatar tile only)

**Transition:** 200ms `ease-out-soft` — matches `--motion-standard` from `app/globals.css`.

### Persist to localStorage

```typescript
// apps/forge/components/shell/ShellProvider.tsx (verbatim)
const [sidebarCollapsed, setSidebarCollapsedState] = React.useState(false);

// Hydrate persisted collapse state from localStorage. Defaults to
// expanded on first load.
React.useEffect(() => {
  if (typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === 'true') setSidebarCollapsedState(true);
  } catch {
    /* localStorage unavailable — keep default */
  }
}, []);
```

**Persistence key:** `SIDEBAR_COLLAPSED_KEY` (defined in ShellProvider).
**Default:** `false` (expanded on first load).
**Failure mode:** localStorage unavailable → keeps default (no crash).

### Collapse toggle

```typescript
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggleSidebar}
      aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="h-8 w-full text-xs text-[var(--fg-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--fg-primary)]"
    >
      <CollapseIcon className="h-3.5 w-3.5" aria-hidden="true" />
      {!sidebarCollapsed && <span className="ml-1.5">Collapse</span>}
    </Button>
  </TooltipTrigger>
  <TooltipContent side="right" sideOffset={8}>
    <span className="font-medium">{sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
    <span className="ml-2 text-[var(--fg-tertiary)]">{`[`} {sidebarCollapsed ? ']' : '['}</span>
  </TooltipContent>
</Tooltip>
```

Collapse icon flips: `ChevronsLeft` (expanded → can collapse) ↔ `ChevronsRight` (collapsed → can expand).

---

## 3 Nav Groups (`apps/forge/components/shell/nav-config.ts`)

```typescript
export const GROUP_LABELS: Record<NavGroup, string> = {
  workspace: 'Workspace',
  centers: 'Centers',
  lifecycle: 'Lifecycle',
};
```

### Group: Workspace (2 items)

| href | label | iconName | Notes |
|---|---|---|---|
| `/dashboard` | Dashboard | `Home` | First item, no group header above |
| `/copilot` | Co-pilot | `Sparkles` | Also reachable via `⌘J` (see ShellProvider) |

### Group: Centers (10 items)

| href | label | iconName | Notes |
|---|---|---|---|
| `/agent-center` | Agents | `Bot` | Agent registry |
| `/project-intelligence` | Projects | `Layers` | Step 44 — separate from Stories |
| `/stories` | Stories | `FileText` | Top-level route (Step 63 fix) |
| `/workflows` | Workflows | `Workflow` | SDLC workflows |
| `/knowledge-center` | Knowledge | `Library` | KG explorer |
| `/organization-knowledge` | Artifacts | `Database` | Org Knowledge |
| `/ideation` | Ideation | `Lightbulb` | Idea intake → PRD |
| `/architecture` | Architecture | `Network` | ADR capture |
| `/connector-center` | Connectors | `PlugZap` | OAuth + API keys |

### Group: Lifecycle (7 items + 3 legacy)

| href | label | iconName | Legacy? |
|---|---|---|---|
| `/project-onboarding` | Onboarding | `ClipboardList` | — |
| `/governance-center` | Governance | `Shield` | — |
| `/audit` | Audit | `Wrench` | — |
| `/analytics` | Analytics | `LineChart` | — |
| `/forge-terminal` | Terminal | `TerminalSquare` | ✅ legacy |
| `/runs` | Runs | `Activity` | ✅ legacy |
| `/forge-command-center` | Command | `Compass` | ✅ legacy |
| `/admin` | Settings | `Settings` | — (footer entry) |

> **Note on `legacy: true`:** These items still ship in the nav but are flagged for the next IA cleanup. They duplicate newer surfaces (Workflows / Runs / Command Center) but ship for backward compat.

### NavItem shape

```typescript
export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly iconName: IconName;
  readonly group: NavGroup;
  readonly keywords?: readonly string[];
  readonly legacy?: boolean;
}
```

**`keywords`** — powers the `⌘K` command palette fuzzy search. E.g. `['ai', 'chat', 'assistant', 'cmd+j', '⌘j']` for Co-pilot.

---

## Tenant Backend Foundation

### Tenant model (`backend/app/db/models/tenant.py`)

```python
class Tenant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A Forge tenant (organization).

    `slug` is the URL-safe identifier used in JWT `forge.tenant` claims.
    `settings` holds per-tenant feature flags and limits; default empty
    dict at the application layer.
    """

    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    def __repr__(self) -> str:  # pragma: no cover — trivial
        return f"<Tenant id={self.id} slug={self.slug!r}>"
```

**4 columns:**
- `id` (UUID PK) — primary key
- `name` (str 200) — display name (e.g. "Acme Corp")
- `slug` (str 64, unique, indexed) — URL-safe identifier (e.g. `acme-corp`)
- `status` (str 32, default `active`) — tenant lifecycle
- `settings` (JSONB, default `{}`) — per-tenant feature flags + limits

### `_coerce_tenant_id` — slug → UUID

```python
# backend/app/services/tenants.py (verbatim)
def _coerce_tenant_id(value: str) -> UUID:
    """Accept a UUID-shaped string OR a slug and return a UUID.

    Keycloak's ``tenant_id`` user attribute can be either a real UUID
    (production) or a human-readable slug like ``acme-corp`` (dev demo
    realm). We must coerce the latter into a UUID so the rest of the
    ...
    """
```

This is the **slug bridge** — the WorkspaceSwitcher shows `acme-corp` (slug), but every backend query needs a UUID. `_coerce_tenant_id` handles the mapping via `uuid5` namespace derivation (deterministic).

### Tenant directory (`backend/app/services/tenant_directory.py`)

```python
async def get_tenant_slug(tenant_id: UUID | str | None) -> str | None:
    """Resolve ``tenant_id`` to its slug. Returns None when unknown."""
    if tenant_id is None or tenant_id == "":
        return None
    key = str(tenant_id)
    if key in _TENANT_SLUG_CACHE:
        ...
```

**In-process cache** (`_TENANT_SLUG_CACHE`) — slug lookups cached for hot path (every API call needs slug → display name).

### Auth store tenant contract (`apps/forge/lib/api/auth.ts`)

```typescript
/**
 * Holds the four pieces of state every authenticated page depends on:
 *
 *   - `user`     — current principal
 *   - `tenant`   — active workspace (Rule 2: never optional)
 *   - `token`    — short-lived bearer token (localStorage)
 *   - `refreshToken` — long-lived refresh token (localStorage)
 */
```

**`tenant` is NEVER optional** — Rule 2 compliance. Every API call carries the tenant context.

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| (none) | `<WorkspaceSwitcher>` | Sidebar top — global chrome |
| (none) | `<TenantStatusFooter>` | Sidebar bottom — global chrome |
| (none) | `<NavList>` | Sidebar middle — 19 nav items in 3 groups |

### Backend (FastAPI) — **0 dedicated workspace routes**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}` | Get tenant LLM config (admin only) |
| `GET` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys` | List virtual keys for tenant (admin only) |
| `POST` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys/rotate` | Rotate tenant's virtual key (admin only) |
| `POST` | `/api/v1/admin/llm-gateway/tenants/{tenant_id}/keys/{key_id}/revoke` | Revoke a specific virtual key (admin only) |

> **Honest gap:** There are **no `GET /api/v1/workspaces` or `GET /api/v1/tenants` routes** that return the workspace list. The Sidebar's 3 hardcoded tenants are a visual mock. The tenant data the system needs comes from:
> - **JWT `forge.tenant` claim** (from Keycloak) — current user's tenant
> - **`tenants` table** (Postgres) — for admin views
> - **`x-forge-tenant-id` header** — propagated on every API call

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `tenants` | Source of truth for tenant name + slug + status + settings |

### Header propagation

| Header | Direction | Purpose |
|---|---|---|
| `x-forge-tenant-id` | client → API | Every API call carries tenant UUID |
| `forge.tenant` (JWT claim) | Keycloak → backend | Tenant slug from OIDC token |
| `X-Forge-Persona` | proxy → backend | Active persona (separate from tenant) |

### Auth store fields

```typescript
interface AuthState {
  user: User | null;
  tenant: { id: string; name: string; slug: string } | null;  // Rule 2: never optional
  token: string | null;
  refreshToken: string | null;
}
```

**`tenant` is the active workspace** — every page reads from this store to know which tenant the user is operating in.

---

## WorkspaceSwitcher Edge cases

| State | Treatment |
|---|---|
| **Collapsed sidebar** | Avatar tile only + tooltip + `⌘\` hint in aria-label |
| **Expanded sidebar** | Avatar + name + slug + chevron + visible kbd hint |
| **Mac vs others** | `⌘\` on Mac, `Ctrl\` on Windows/Linux (regex-detected) |
| **Below md breakpoint** | kbd hint hidden (`hidden ... md:inline-block`) |
| **Active tenant** | Emerald `<Check>` + `aria-label="Active"` |
| **Sidebar SSR** | Avatar + name render (no `localStorage` on server) |
| **Hotkey not wired** | The `⌘\` hint is **NOT yet wired** to a real handler — visual only |
| **localStorage unavailable** | Sidebar stays at default (expanded); collapse state lost on refresh |
| **`prefers-reduced-motion`** | `animate-ping` on pulse dot still renders (cosmetic only) |

## TenantStatusFooter Edge cases

| State | Treatment |
|---|---|
| **Collapsed** | Stack: pulse dot + gear (each 40x40) |
| **Expanded** | Rounded container with full label |
| **Settings gear click** | Navigates to `/admin` (admin only) |
| **Pulse animation** | `animate-ping` 60% opacity halo + solid center |
| **No backend health** | "Healthy" is hardcoded — no API call |

---

## Forbidden patterns

AI agents modifying Workspaces MUST NOT:

- ❌ Add a new top-level nav item without updating `nav-config.ts` (single source of truth)
- ❌ Skip the `keywords` array on `NavItem` (powers `⌘K` palette)
- ❌ Skip the `group` field — every item belongs to one of 3 groups
- ❌ Add a 4th tenant to the WorkspaceSwitcher dropdown without a backend route to support it
- ❌ Hardcode tenant UUIDs in components — always read from `useAuth().tenant`
- ❌ Skip the `aria-label` on `WorkspaceSwitcher` button (screen reader nav)
- ❌ Use `bg-black` — use `var(--bg-surface)` / `var(--bg-elevated)` / `var(--bg-inset)`
- ❌ Use emoji as UI icons — `lucide-react` only (`Home`, `Bot`, `Layers`, etc.)
- ❌ Animate the sidebar with framer-motion — must use CSS `transition-[width]` (matches token)
- ❌ Persist collapse state to anything but `localStorage` (no cookie, no server)
- ❌ Skip `prefers-reduced-motion` for the pulse dot (cosmetic but should respect)

---

## Verification checklist

- [ ] Sidebar renders at 256px on first load
- [ ] Collapse toggle shrinks sidebar to 64px with 200ms transition
- [ ] Collapse state persists to `localStorage` (`SIDEBAR_COLLAPSED_KEY`)
- [ ] `WorkspaceSwitcher` avatar shows tenant initials (`AC` for Acme Corp)
- [ ] `WorkspaceSwitcher` dropdown opens with 3 demo tenants
- [ ] Active tenant (`acme-corp`) shows emerald `<Check>` + `aria-label="Active"`
- [ ] `⌘\` hint shows on Mac, `Ctrl\` on others
- [ ] kbd hint hides below `md` breakpoint
- [ ] `TenantStatusFooter` shows pulsing emerald dot + "Healthy"
- [ ] Settings gear in footer navigates to `/admin`
- [ ] `NavList` shows 3 groups with correct labels (Workspace / Centers / Lifecycle)
- [ ] Active nav item has 2px left rail + indigo wash + semibold
- [ ] `NavItem.legacy` items still render (Terminal / Runs / Command)
- [ ] `NavItem.keywords` powers `⌘K` palette (test: type "ai" → Co-pilot matches)
- [ ] Tenant UUID propagates via `x-forge-tenant-id` header on every API call
- [ ] Slug → UUID coercion works via `_coerce_tenant_id`
- [ ] SSR-safe (no `localStorage` access during server render)
- [ ] Lighthouse Accessibility ≥ 90 (aria-labels on every interactive element)
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — `--motion-standard` + `--bg-*` tokens
- [API conventions](../standards/api-conventions.md) — `x-forge-tenant-id` header
- [Data model](../standards/data-model.md) — `tenants` table
- [Architecture rules](../standards/architecture-rules.md) — R2 + R12
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — 4 tenant-related routes (admin_llm_gateway only)
- [DB schema](../reference/db-schema.md) — `tenants` (slug uniqueness)
- [Auth](./auth.md) — Auth store + tenant claim
- [Personas & Dashboards](./personas-dashboards.md) — Persona vs Tenant distinction
- [Onboarding](./onboarding.md) — `SEED_TENANT_SLUG` constant
- [Seeds Admin](./seeds-admin.md) — Per-tenant seed management
- [Admin Hub](./admin-hub.md) — Workspace settings live at `/admin`
- [Command Center](./command-center.md) — `⌘K` palette reads from `nav-config.ts`
- [Co-pilot](./copilot.md) — `⌘J` panel + global hotkey supervisor

---

## Maintenance notes

**When to update this doc:**

- A new nav group added → update 3-group table
- A new nav item added → update Workspace/Centers/Lifecycle list
- A new tenant dropdown entry added → update 3-workspace hardcoded list
- `legacy: true` flag changed → update Lifecycle list
- `⌘\` hotkey wired up → update WorkspaceSwitcher contract

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/db/models/tenant.py                ←  Tenant model (UUID PK + slug + status + settings)
backend/app/services/tenants.py                ←  _coerce_tenant_id (slug → UUID)
backend/app/services/tenant_directory.py       ←  In-process slug cache
         ↓
apps/forge/lib/api/auth.ts                     ←  Zustand store (tenant is Rule 2)
apps/forge/lib/api/client.ts                   ←  x-forge-tenant-id propagation
         ↓
apps/forge/components/shell/nav-config.ts      ←  19 nav items in 3 groups (pure data + helpers)
apps/forge/components/shell/ShellProvider.tsx  ←  sidebarCollapsed state + ⌘K + ⌘J supervisors
apps/forge/components/shell/Sidebar.tsx        ←  WorkspaceSwitcher + TenantStatusFooter + NavList
apps/forge/app/globals.css                     ←  --motion-standard + --bg-* tokens
```

If any link in this chain drifts, the Workspace chrome breaks silently. Always update all links.

---

## Why workspaces are "chrome, not a feature"

The other 24 docs in this tree document **features** — pages with their own backend routes, schemas, and components. Workspaces is different: it's the **chrome that surrounds every page**. The Sidebar lives in the root layout, persists across navigation, and carries tenant context that every feature page depends on.

This is intentional architecture. Per **Rule 12 (cross-cutting concerns)**, Workspaces + Co-pilot FAB + `⌘K` Command are always available. They're not optional. They're the **substrate** that features build on.

When the FORA-123 broker lands (replacing the dev cookie stub), the hardcoded 3-workspace dropdown becomes dynamic. When the tenant health endpoint ships, the pulsing "Healthy" dot becomes a real signal. Until then, both are visual mocks — but **the chrome works today** and every page benefits from consistent tenant context.

**The hardcoded dropdown is not a bug — it's a stub.** The pattern is in place; the data source swaps in when the broker lands. This is exactly how Plan H (Step 62) framed the seed management page: **gated by RBAC, but data shape ready for the real backend**.