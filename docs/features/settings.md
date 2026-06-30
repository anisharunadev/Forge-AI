# Feature: Settings (21-tab Admin Console)

> **Status:** Step 62 PARTIAL — frontend complete (21 tabs + SDK + hooks + types + schemas); backend NOT yet wired (prompt `/workspace/prompts/step62-settings-real.md` defines the contract; `projects.py` has only bootstrap routes)
> **Route:** `apps/forge/app/admin/page.tsx` (preserved at `/admin` per "Keep route")
> **Sidebar:** `apps/forge/components/admin/settings/SettingsSidebar.tsx` (240px sticky, 3 sections)
> **Frontend SDK:** `apps/forge/lib/settings/data.ts` (~256 lines)
> **Frontend types:** `apps/forge/lib/settings/types.ts`
> **Frontend schemas:** `apps/forge/lib/settings/schemas.ts` (Zod)
> **Frontend hooks:** `apps/forge/lib/hooks/useSettings.ts`
> **Backend (planned per Step 62):** `backend/app/api/v1/projects.py` (extended) + `members.py` (new) + `roles.py` (new) + `env_vars.py` (new) + `agent_configs.py` (new) + `audit.py` (project-scoped)
> **Constitutional rules:** R2 (multi-tenant), R3 (human approval for role changes), R6 (every mutation audited), R8 (env vars Fernet-encrypted at rest)

---

## Purpose

The Settings page (`/admin`) is the **operator console for tenant + project configuration**. It owns 21 tabs grouped into Account / Workspace / Enterprise sections, covering everything from the user's profile to the LLM gateway, SSO, billing, and feature flags.

Per PRD §1.4 the Settings page serves **all four personas** — engineers (env vars + agent configs), tech leads (members + roles), operators (webhooks + audit), stewards (governance + billing + SSO).

**Key capabilities:**

**Workspace section (8 tabs):**
- **General** — Project info (name / slug / description / default branch / visibility)
- **Members** — User list + role assignment + invitations
- **Agents** — 6 registered agents + per-project enable/disable
- **Providers** — LLM providers (Anthropic / OpenAI / Google / Bedrock / Azure / custom) + LiteLLM alias
- **Env Vars** — Encrypted secrets (Fernet) with reveal endpoint + audit row per reveal
- **Integrations** — Cross-cutting connector configurations
- **Workflow** — Workflow defaults (cost ceiling / timeout / notification)
- **Audit** — Project-scoped audit log

**Account section (4 tabs):**
- **Profile** — User display name + avatar
- **Sessions** — Active sessions + revoke
- **Notifications** — Per-channel preferences
- **API Tokens** — Personal access tokens (PATs)

**Enterprise section (9 tabs):**
- **AI Gateway** — LiteLLM health + model registry + virtual keys
- **Seeds** — Re-run seed scripts (admin only)
- **Webhooks** — Outbound webhook subscriptions
- **Connected Apps** — OAuth-installed apps
- **SSO** — SAML / OIDC configuration
- **Branding** — Logo + colors + tenant name
- **Billing** — Plan + usage + invoices
- **Feature Flags** — Per-tenant feature toggles
- **Keyboard** — Keyboard shortcut reference

---

## Architecture

```
AdminSettingsPage (/admin)
└── 240px sticky vertical sidebar + flex-1 right panel
    ├── Account section
    │   ├── Profile · Sessions · Notifications · API Tokens
    ├── Workspace section
    │   ├── General · Members · Agents · Providers · Env Vars
    │   · Integrations · Workflow · Audit
    └── Enterprise section
        ├── AI Gateway · Seeds · Webhooks · Connected Apps
        · SSO · Branding · Billing · Feature Flags · Keyboard
```

**Sidebar visual:**
- 240px sticky
- 3 labeled sections (Account / Workspace / Enterprise)
- Active row: 2px primary left rail (animated via Framer Motion `layoutId="settings-rail"`)
- Count badges on Members / Agents / Env Vars / Providers / Audit
- Footer: "Last change: 12m ago by Arun" with avatar

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/admin` | AdminSettingsPage | 21-tab console |
| `/admin?tab=members` | (deep link to Members tab) | URL-driven tab state |

### Backend (FastAPI)

#### Currently exists (`backend/app/api/v1/projects.py`) — 4 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/projects/{id}/bootstrap` | `projects:write` | Day-one bootstrap (202 + result) |
| `GET` | `/api/v1/projects/{id}/bootstrap` | `projects:read` | Read bootstrap result |
| `GET` | `/api/v1/projects/{id}/bootstrap/status` | `projects:read` | Read bootstrap progress |
| `POST` | `/api/v1/projects/{id}/bootstrap/rerun` | `projects:write` | Re-run bootstrap |

#### Planned per Step 62 — 11 new routes (NOT YET BUILT)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/projects/{id}` | `projects:read` | Read project info |
| `GET` | `/api/v1/projects` | `projects:read` | List projects in tenant |
| `POST` | `/api/v1/projects` | `projects:write` | Create project |
| `PATCH` | `/api/v1/projects/{id}` | `projects:write` | Update project |
| `GET` | `/api/v1/projects/{id}/members` | `members:read` | List members |
| `POST` | `/api/v1/projects/{id}/members/invite` | `members:write` | Invite member |
| `PATCH` | `/api/v1/projects/{id}/members/{member_id}` | `members:write` | Update role |
| `DELETE` | `/api/v1/projects/{id}/members/{member_id}` | `members:write` | Remove member |
| `GET` | `/api/v1/projects/{id}/env-vars` | `envvars:read` | List env vars (metadata only, values masked) |
| `POST` | `/api/v1/projects/{id}/env-vars` | `envvars:write` | Create env var (encrypted at rest) |
| `PATCH` | `/api/v1/projects/{id}/env-vars/{id}` | `envvars:write` | Update env var value |
| `DELETE` | `/api/v1/projects/{id}/env-vars/{id}` | `envvars:write` | Delete env var |
| `POST` | `/api/v1/projects/{id}/env-vars/{id}/reveal` | `envvars:reveal` | Reveal plaintext (writes audit row) |
| `GET` | `/api/v1/projects/{id}/agent-config` | `agents:read` | List 6 agent configs |
| `PATCH` | `/api/v1/projects/{id}/agent-config/{id}` | `agents:write` | Update agent config |
| `GET` | `/api/v1/settings/roles` | `roles:read` | List 4 roles |
| `GET` | `/api/v1/projects/{id}/audit` | `audit:read` | Project-scoped audit log |

> ⚠️ **As of the current state, these endpoints return 404.** The Step 62 prompt defines the contract; the implementation is planned. The frontend SDK + hooks already exist; calls fail until the backend ships.

---

## Data touched

### Tables (planned per Step 62)

| Table | Purpose |
|---|---|
| `projects` | Project info (extended with `description`, `default_branch`, `visibility`, `created_by`) |
| `members` | Per-project user membership + role |
| `invitations` | Pending invitations (token + email + role + expiry) |
| `roles` | 4 seeded roles (Owner / Admin / Developer / Viewer) |
| `env_vars` | Fernet-encrypted key-value pairs (per project) |
| `agent_configs` | Per-project agent enable/disable + custom config |
| `model_providers` | Per-tenant LLM provider configs |
| `audit_events` | Every mutation logged (reuses global audit table) |

### TypeScript mirror (`apps/forge/lib/settings/types.ts`)

```typescript
export type ProjectVisibility = 'private' | 'internal' | 'public';

export interface Project {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly defaultBranch: string;
  readonly visibility: ProjectVisibility;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectUpdate {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly defaultBranch?: string;
  readonly visibility?: ProjectVisibility;
}

export interface Member {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly roleId: string;
  readonly roleName: string;
  readonly status: 'active' | 'inactive';
}

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invitation {
  readonly id: string;
  readonly projectId: string;
  readonly email: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly invitedBy: string;
  readonly status: InvitationStatus;
  readonly expiresAt: string;
}

export type EnvVarScope = 'workflow' | 'agent' | 'all';

export interface EnvVar {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly scope: EnvVarScope;
  readonly maskedValue: string;   // e.g. "••••••"
  readonly valueLength: number;
  readonly hashPrefix: string;    // SHA-256 prefix for fingerprinting
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnvVarCreate {
  readonly key: string;
  readonly value: string;
  readonly scope: EnvVarScope;
}

export interface EnvVarReveal {
  readonly key: string;
  readonly value: string;        // plaintext returned ONCE
}

export type ModelProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'bedrock'
  | 'azure_openai'
  | 'custom';

export interface ModelProvider {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly type: ModelProviderType;
  readonly litellmModelAlias: string | null;
  readonly enabled: boolean;
}

export interface Role {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: ReadonlyArray<string>;
}

export type AuditTargetType =
  | 'project'
  | 'member'
  | 'agent'
  | 'model_provider'
  | 'envvar';

export interface AuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: AuditTargetType;
  readonly targetId: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: string;
}
```

---

## 21 Tabs in 3 Sections

```typescript
const SETTINGS_GROUPS: ReadonlyArray<SettingsGroup> = [
  {
    id: 'account',
    label: 'Account',
    sections: [
      { id: 'profile',       label: 'Profile',       icon: UserCircle,       accentVar: 'var(--accent-primary)' },
      { id: 'sessions',      label: 'Sessions',      icon: MonitorSmartphone, accentVar: 'var(--accent-cyan)' },
      { id: 'notifications', label: 'Notifications', icon: Bell,             accentVar: 'var(--accent-amber)' },
      { id: 'api-tokens',    label: 'API Tokens',    icon: Key,              accentVar: 'var(--accent-violet)' },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    sections: [
      { id: 'general',      label: 'General',      icon: Building2, accentVar: 'var(--accent-primary)' },
      { id: 'members',      label: 'Members',      icon: Users,     accentVar: 'var(--accent-emerald)' },
      { id: 'agents',       label: 'Agents',       icon: Bot,       accentVar: 'var(--accent-cyan)' },
      { id: 'providers',    label: 'Providers',    icon: KeyRound,  accentVar: 'var(--accent-violet)' },
      { id: 'env-vars',     label: 'Env Vars',     icon: Eye,       accentVar: 'var(--accent-amber)' },
      { id: 'integrations', label: 'Integrations', icon: PlugZap,   accentVar: 'var(--accent-primary)' },
      { id: 'workflow',     label: 'Workflow',     icon: Workflow,  accentVar: 'var(--accent-cyan)' },
      { id: 'audit',        label: 'Audit',        icon: History,   accentVar: 'var(--accent-emerald)' },
    ],
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    sections: [
      { id: 'ai-gateway',      label: 'AI Gateway',      icon: Cpu,            accentVar: 'var(--accent-violet)' },
      { id: 'seeds',           label: 'Seeds',           icon: Sprout,         accentVar: 'var(--accent-emerald)' },
      { id: 'webhooks',        label: 'Webhooks',        icon: Webhook,        accentVar: 'var(--accent-cyan)' },
      { id: 'connected-apps',  label: 'Connected Apps',  icon: AppWindow,      accentVar: 'var(--accent-primary)' },
      { id: 'sso',             label: 'SSO',             icon: ShieldCheck,    accentVar: 'var(--accent-emerald)' },
      { id: 'branding',        label: 'Branding',        icon: Palette,        accentVar: 'var(--accent-violet)' },
      { id: 'billing',         label: 'Billing',         icon: CreditCard,     accentVar: 'var(--accent-amber)' },
      { id: 'feature-flags',   label: 'Feature Flags',   icon: FlaskConical,   accentVar: 'var(--accent-cyan)' },
      { id: 'shortcuts',       label: 'Keyboard',        icon: KeyboardIcon,   accentVar: 'var(--fg-secondary)' },
    ],
  },
];
```

Each section has:
- **lucide icon** (16px in semantic color)
- **label**
- **accentVar** (CSS custom property for hover/active states)

Active row: 2px primary left rail + tinted bg `rgba(99,102,241,0.10)`.

---

## Env Vars: Encryption Contract (Step 62 R8)

Per Step 62, env vars are **Fernet-encrypted at rest** using a key derived from `JWT_SECRET`:

```python
# Pseudo-code from prompt
from cryptography.fernet import Fernet

def encrypt_value(plaintext: str, jwt_secret: str) -> bytes:
    key = derive_key(jwt_secret)  # SHA-256 → Fernet-compatible 32-byte key
    f = Fernet(key)
    return f.encrypt(plaintext.encode())

def decrypt_value(ciphertext: bytes, jwt_secret: str) -> str:
    key = derive_key(jwt_secret)
    f = Fernet(key)
    return f.decrypt(ciphertext).decode()
```

**API contract:**
- `GET /projects/{id}/env-vars` → metadata only (no plaintext)
  ```json
  {
    "id": "env-uuid",
    "key": "GITHUB_TOKEN",
    "scope": "workflow",
    "maskedValue": "••••••",
    "valueLength": 40,
    "hashPrefix": "abc12345"
  }
  ```
- `POST /projects/{id}/env-vars` → encrypts at rest
- `POST /projects/{id}/env-vars/{id}/reveal` → decrypts + writes audit row `envvar.reveal`
- **NEVER** render the full plaintext in any list view

**Security guarantees:**
- Values never appear in list responses
- `reveal` is a one-shot call that writes an audit row
- `hashPrefix` (SHA-256 first 8 chars) lets you fingerprint without revealing
- `valueLength` reveals only the byte count

---

## useProjectId() — Central Seam

The project scope is centralized in one hook:

```typescript
// apps/forge/lib/hooks/useSettings.ts
export function useProjectId(): string {
  return SEED_PROJECT_ID;  // 'project-forge-demo' — TODO: migrate to useTenantProject()
}
```

Every other settings hook depends on `useProjectId()`. The Step 62 migration plan replaces this with `useTenantProject()` that reads from auth context — no call-site changes required.

---

## 17 TanStack Query Hooks

| Hook | Purpose |
|---|---|
| `useProject()` | Read project info |
| `useUpdateProject()` | Update project |
| `useMembers()` | List members + pending invitations |
| `useInviteMember()` | Invite member (email + role) |
| `useAcceptInvite()` | Accept invite (token) |
| `useUpdateMemberRole()` | Change role |
| `useRemoveMember()` | Remove member |
| `useEnvVars()` | List env vars (metadata) |
| `useCreateEnvVar()` | Create env var (encrypted) |
| `useUpdateEnvVar()` | Update env var value |
| `useDeleteEnvVar()` | Delete env var |
| `useRevealEnvVar()` | Reveal plaintext (writes audit) |
| `useAgentConfig(agentId)` | Read one agent config |
| `useUpdateAgentConfig()` | Update agent config |
| `useProviders()` | List model providers |
| `useCreateProvider()` | Add provider |
| `useUpdateProvider()` | Update provider |
| `useRoles()` | List 4 roles |
| `useAuditSettings(projectId, filters)` | List project-scoped audit |

Each mutation invalidates its query key so UI re-renders automatically.

---

## Seed Data (Step 62 plan)

The seed script `seed_settings.py` inserts (per Step 62 acceptance criteria):

| Artifact | Count |
|---|---|
| Roles | 4 (Owner / Admin / Developer / Viewer) |
| Env vars | 12 (per project, including GITHUB_TOKEN, JIRA_API_TOKEN, etc.) |
| Agent configs | 6 (one per registered agent) |

---

## Sidebar Count Badges

The sidebar shows live counts for: Members, Agents, Env Vars, Providers, Audit. Until the backend ships, counts come from `useSettings` hooks (which return 0 / errors until endpoints exist).

After Step 62 lands:
- `Members: N` = `useMembers().data?.members.length`
- `Agents: N` = `useAgentConfig().data?.length`
- `Env Vars: N` = `useEnvVars().data?.length`
- `Providers: N` = `useProviders().data?.length`
- `Audit: N` = `useAuditSettings().data?.total`

---

## Zod Validation (`apps/forge/lib/settings/schemas.ts`)

Client-side validation mirrors Pydantic:

```typescript
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export const projectUpdateSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z.string().min(2).max(64).regex(SLUG_RE),
  description: z.string().max(2000).optional().or(z.literal('')),
  defaultBranch: z.string().min(1).max(64),
  visibility: z.enum(['private', 'internal', 'public']),
});
```

Server is always authoritative — Zod schemas are UX, not security.

---

## Edge cases

| State | Treatment |
|---|---|
| **404 on /projects/{id}** | Settings page shows "404 Not Found" error state (current state pre-Step 62) |
| **No members** | Empty state + "Invite your first member" CTA |
| **No env vars** | Empty state + "Add your first env var" CTA |
| **Env var reveal** | Confirm modal: "Reveal plaintext? This action is logged." |
| **Reveal audit row written** | Toast + audit tab updates with new event |
| **Member invite sent** | Toast + pending invitation row in Members tab |
| **Invite expired (>7 days)** | Status flips to `expired` + muted badge |
| **Role change to Owner** | Confirm modal: "Promoting to Owner grants full access." |
| **Env var value too long** (>1KB) | Client validation error |
| **Provider LiteLLM alias invalid** | Server returns 422 + form field error |
| **Agent config conflict** | Optimistic concurrency check returns 409 |
| **Concurrent settings edit** | Optimistic locking via `updated_at` |
| **Tenant switch** | All hooks refetch with new tenant context |
| **`prefers-reduced-motion`** | Rail animation disabled; transitions instant |

---

## Forbidden patterns

AI agents modifying Settings MUST NOT:

- ❌ Render env var plaintext in any list view — only `maskedValue` + reveal endpoint
- ❌ Skip audit logging on env var reveal — every reveal writes an `envvar.reveal` audit row
- ❌ Skip tenant scoping on any settings query — Rule 2
- ❌ Skip role check on member mutations — only Owner / Admin can change roles (R3)
- ❌ Skip Fernet encryption on env var create/update — Rule 8
- ❌ Bypass JWT secret derivation — stable key derivation is mandatory
- ❌ Use direct SDK imports for LLM providers — Rule 1 (via LiteLLM proxy)
- ❌ Hardcode project IDs — use `useProjectId()` hook (central seam)
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist (Step 62 acceptance criteria)

- [ ] `seed_settings.py` inserts 4 roles + 12 env vars + 6 agent configs
- [ ] `test_settings_api.py` shows 10/10 passed
- [ ] `curl .../projects` returns at least 1 project
- [ ] `curl .../projects/{id}` returns project info
- [ ] `curl .../projects/{id}/members` returns at least 1 member (Arun)
- [ ] `curl .../projects/{id}/env-vars` returns 12 env vars (metadata only)
- [ ] `curl -X POST .../projects/{id}/env-vars/{id}/reveal` returns the decrypted value
- [ ] `curl .../projects/{id}/agent-config` returns 6 agent configs
- [ ] `curl .../settings/roles` returns 4 roles
- [ ] `curl .../projects/{id}/audit` returns project-scoped audit log
- [ ] Settings page no longer shows the "404 Not Found" error state
- [ ] General tab loads real project info
- [ ] Members tab "Invite member" calls POST and shows pending invitation
- [ ] EnvVars tab shows 12 env vars with scope/visibility badges
- [ ] EnvVars tab "Reveal" button calls POST /reveal and shows decrypted value
- [ ] Agents tab shows 6 agents with per-project toggles
- [ ] Sidebar counts reflect real numbers (Members / Agents / Env Vars / Providers / Audit)
- [ ] When switching tenants, the project + counts refetch
- [ ] `useProjectId()` returns real project ID (not hardcoded seed)
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — settings rail tokens
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R2 + R3 + R6 + R8
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md)
- [DB schema](../reference/db-schema.md)
- [Dashboard](./dashboard.md)
- [Projects](./projects.md) — Settings owns per-project config; Projects owns the resource
- [Agent Center](./agent-center.md) — Agent configs surface
- [Audit](./audit.md) — Every settings mutation logged
- [Co-pilot](./copilot.md) — `audit_event` tool used for env var reveals
- [Auth](./auth.md) — SSO + sessions

---

## Maintenance notes

**When to update this doc:**

- A new settings tab added → update 21-tab list
- A new role added → update 4-role list
- A new env var scope added → update `EnvVarScope` enum
- A new model provider type added → update `ModelProviderType` enum
- Step 62 backend ships → remove "NOT YET BUILT" callouts

**Files to keep in sync (the lock-step rectangle):**

```
apps/forge/lib/settings/types.ts          ←  TypeScript types (canonical shape)
apps/forge/lib/settings/data.ts           ←  REST SDK
apps/forge/lib/settings/schemas.ts        ←  Zod validation
apps/forge/lib/hooks/useSettings.ts       ←  19 TanStack Query hooks + useProjectId seam
         ↓
apps/forge/components/admin/settings/     ←  27 tab components (21 tabs + 6 dialogs)
apps/forge/components/admin/settings/SettingsSidebar.tsx ←  240px sidebar + 3 sections
         ↓
apps/forge/app/admin/page.tsx             ←  Tab router + sidebar
```

**Backend (planned per Step 62):**
```
backend/app/api/v1/projects.py           ←  Extend with 4 CRUD + 4 sub-routers
backend/app/api/v1/members.py            ←  NEW: 5 routes
backend/app/api/v1/roles.py              ←  NEW: 1 route
backend/app/api/v1/env_vars.py           ←  NEW: 6 routes (Fernet-encrypted)
backend/app/api/v1/agent_configs.py      ←  NEW: 2 routes
backend/app/services/crypto.py           ←  NEW: Fernet helper + key derivation
backend/app/scripts/seed_settings.py     ←  NEW: 4 roles + 12 env vars + 6 agent configs
backend/app/scripts/test_settings_api.py ←  NEW: 10 endpoint tests
```

If any link in this chain drifts, the Settings page breaks silently. Always update all links.

---

## Current state (honest)

**Frontend:** ✅ Complete
- 21 tabs across 3 sections
- Full TypeScript types (13+ interfaces)
- Full REST SDK in `lib/settings/data.ts`
- 19 TanStack Query hooks
- Zod validation schemas
- All UI components built

**Backend:** ❌ NOT YET BUILT
- `projects.py` only has 4 bootstrap routes
- The 11+ endpoints documented above return 404
- General tab shows the "404 Not Found" error state mentioned in the Step 62 prompt
- `useProjectId()` hardcodes `'project-forge-demo'` seed
- Sidebar counts return 0 / errors

**What's blocking:**
- `seed_settings.py` script doesn't exist
- `test_settings_api.py` script doesn't exist
- `crypto.py` helper doesn't exist
- `members.py`, `roles.py`, `env_vars.py`, `agent_configs.py` route files don't exist

**The Step 62 prompt (`/workspace/prompts/step62-settings-real.md`) defines the exact contract.** Running that prompt will wire the backend end-to-end. Until then, this doc describes the **planned state** for the backend sections.

AI agents must distinguish between **frontend-complete** (the SDK/hooks/UI all work) and **backend-pending** (the API calls return 404). Do not assume the backend is live.