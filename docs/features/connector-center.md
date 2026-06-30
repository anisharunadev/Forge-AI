# Feature: Connector Center (Integrations + Marketplace)

> **Status:** Wired to real backend (Step 55 Phase 3) + cross-cutting components (Step 31)
> **Route:** `apps/forge/app/connector-center/page.tsx` (index)
> **Detail route:** `apps/forge/app/connector-center/[id]/page.tsx`
> **OAuth callback:** `apps/forge/app/connector-center/oauth/callback/page.tsx`
> **Root components:** 7-tab Connector Center + cross-cutting `ConnectorPicker` / `ConnectorHealthIndicator` / `ConnectorCredentialsBadge` / `ConnectorActionButton`
> **Backend:** `backend/app/api/v1/connectors.py` + `connector_lifecycle.py` + `connector_events.py`
> **State machine:** `backend/app/services/connector_states.py`
> **Manager:** `backend/app/services/connector_manager.py`
> **Constitutional rules:** R2 (multi-tenant), R3 (approval for installation), R6 (auditability), R12 (cross-cutting — ConnectorPicker used everywhere)

---

## Purpose

The Connector Center is the **integration management surface**. A connector is a configured link to an external system — GitHub, Jira, Slack, AWS, etc. — that lets Forge pull data in (issues, PRs, commits) or push data out (status updates, ticket creation).

Per PRD §1.4 the Connector Center serves **tech leads / operators** (install + manage) and **stewards** (audit + governance). The cross-cutting connector components (`<ConnectorPicker>`, `<ConnectorHealthIndicator>`, `<ConnectorActionButton>`, `<ConnectorCredentialsBadge>`) are used by **every other feature** that needs to talk to an external system — Per Rule 12, integration with the outside world is not siloed.

**Key capabilities:**
- **7-tab experience** — Overview / Connected / Marketplace / Credentials / Webhooks / Activity / Settings
- **OAuth round-trip** — Installed connectors that use OAuth redirect via `/connector-center/oauth/callback`
- **Manual sync** — `POST /api/v1/connectors/{id}/sync` triggers an on-demand sync
- **Test connection** — `POST /api/v1/connectors/{id}/test` runs a reachability probe
- **State machine** — connector lifecycle: `PENDING → SYNCING → HEALTHY → STALE → QUARANTINED → FAILED`
- **Cross-cutting primitives** — `ConnectorPicker` (capability-aware combobox), `ConnectorHealthIndicator` (live dot), `ConnectorCredentialsBadge` ("Connect X to use this"), `ConnectorActionButton` (invoke with confirm)
- **Auditability** — every installation, sync, test, rotation logged
- **Marketplace** — discover + install pre-built integrations

---

## Architecture

```
ConnectorCenterPage (/connector-center)
└── 7-tab layout
    ├── Hero band (CONNECTORS eyebrow + "Add connector" CTA)
    ├── Tab strip: Overview | Connected | Marketplace | Credentials | Webhooks | Activity | Settings
    ├── Tab bodies (delegated to ./tabs/*)
    ├── Connections graph (extra view from Overview)
    └── Keyboard shortcuts: ⌘⇧C picker, ⌘⇧K credential, ⌘⇧W webhook

ConnectorDetailPage (/connector-center/[id])
└── DetailPanel
    ├── Header (display name + status pill + "Open in audit" link)
    ├── Health snapshot (last call, p50, p95, error rate, sparkline)
    ├── Scope grant (granted/denied chips)
    ├── Credential envelope (secretRef, fingerprint, expiresAt)
    ├── Rotation deadline callout (within 14d)
    ├── Last 100 audit entries
    └── "Rotate credential" action

ConnectorOAuthCallbackPage (/connector-center/oauth/callback)
└── Validates state → calls /api/v1/connectors/oauth/callback → redirects

[Every page that needs external data]
  └─ ConnectorProvider (in layout)
      └─ <ConnectorPicker capability="..." />     ← cross-cutting
      └─ <ConnectorActionButton />                  ← cross-cutting
      └─ <ConnectorHealthIndicator />               ← cross-cutting
      └─ <ConnectorCredentialsBadge />              ← cross-cutting
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/connector-center` | Connector Center | 7-tab integration management |
| `/connector-center/[id]` | DetailPanel | Single connector detail |
| `/connector-center/oauth/callback` | OAuth Callback | Validates state + completes flow |

### Backend (FastAPI)

All routes use `@audit()` decorator. Tenant scoping enforced via `principal.tenant_id`.

#### Core CRUD (`backend/app/api/v1/connectors.py`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/connectors` | `connectors:read` | List installed connectors |
| `GET` | `/api/v1/connectors/{id}` | `connectors:read` | Get one connector |
| `POST` | `/api/v1/connectors` | `connectors:write` | Install a connector |
| `PATCH` | `/api/v1/connectors/{id}` | `connectors:write` | Update name / config / status |
| `DELETE` | `/api/v1/connectors/{id}` | `connectors:write` | Uninstall |
| `POST` | `/api/v1/connectors/{id}/sync` | `connectors:run` | Trigger a manual sync |
| `GET` | `/api/v1/connectors/{id}/history` | `connectors:read` | List sync history (last N) |
| `POST` | `/api/v1/connectors/{id}/test` | `connectors:run` | Test reachability (returns `ConnectorTestResult`) |

#### Lifecycle (`backend/app/api/v1/connector_lifecycle.py`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/connectors/install` | `connectors:write` | Install from marketplace |
| `POST` | `/api/v1/connectors/{id}/rotate` | `connectors:write` | Rotate credentials |
| `POST` | `/api/v1/connectors/{id}/test` | `connectors:run` | Test connection (alias) |

#### Events (`backend/app/api/v1/connector_events.py`)

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/connectors/observed` | `connectors:write` | Report an externally-observed event (webhook) |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `connectors` | Installed connector records (config JSONB, status, last_sync) |
| `connector_sync_history` | Per-sync attempt rows (started_at, finished_at, items_synced) |
| `connector_credentials` | Encrypted credential blobs (Fernet) |
| `connector_webhooks` | Outbound webhook subscriptions |
| `webhook_deliveries` | Per-delivery audit |
| `audit_events` | Every connector mutation logged |

### Pydantic schemas (`backend/app/schemas/connectors.py`)

- `ConnectorBase` — `{name, type: ConnectorType, config: dict}`
- `ConnectorCreate` — `ConnectorBase + {project_id}`
- `ConnectorUpdate` — `{name?, config?, status?}`
- `ConnectorRead` — `ConnectorBase + TenantScopedModel + {id, status, last_sync_at, last_error, created_by}`
- `ConnectorSyncHistoryRead` — `{id, connector_id, started_at, finished_at, status, items_synced}`
- `ConnectorTestResult` — `{connector_id, ok: bool, latency_ms, detail, checked_at}`

### Backend enums (`backend/app/db/models/connector.py`)

**`ConnectorType` (12 kinds):**

```python
class ConnectorType(str, enum.Enum):
    GITHUB = "github"
    JIRA = "jira"
    CONFLUENCE = "confluence"
    FIGMA = "figma"
    AWS = "aws"
    SLACK = "slack"
    SONARQUBE = "sonarqube"
    DATABRICKS = "databricks"
    AZURE_DEVOPS = "azure_devops"
    CLICKUP = "clickup"
    ZENDESK = "zendesk"
    SECRETS = "secrets"
```

**`ConnectorStatus` (6 states — matches `connector_states.ConnectorState`):**

```python
class ConnectorStatus(str, enum.Enum):
    PENDING = "pending"
    SYNCING = "syncing"
    HEALTHY = "healthy"
    STALE = "stale"
    QUARANTINED = "quarantined"
    FAILED = "failed"
```

**`SyncStatus` (4 outcomes):**

```python
class SyncStatus(str, enum.Enum):
    STARTED = "started"
    SUCCESS = "success"
    FAILURE = "failure"
    TIMEOUT = "timeout"
```

### TypeScript mirror (`apps/forge/lib/connectors/types.ts`)

Mirrors all wire-format shapes. **Two parallel type systems** exist:

| Layer | Use case | Status |
|---|---|---|
| `lib/connectors/types.ts` (`ConnectorWire`) | New — typed fetcher ↔ backend | Canonical |
| `lib/connectors/data.ts` (`Connector`) | Legacy mock layer for offline / storybook | Use only when wire layer unavailable |

When the API is reachable, use `wireToConnector()` adapter to convert `ConnectorWire` → `Connector` for components that haven't migrated.

---

## Cross-Cutting Primitives (R12)

Four components are mounted across the app wherever external integrations matter:

### `<ConnectorPicker>`

Capability-aware combobox. Lists installed connectors that support a requested capability.

```tsx
<ConnectorPicker capability="send_message" onSelect={(c) => sendVia(c)} />
<ConnectorPicker capability="pull_issues" defaultOpen showSearch />
```

- Reads installed connectors via `useConnectors()` (from `ConnectorProvider`)
- Falls back to `<ConnectorCredentialsBadge>` linking to marketplace if no match
- Short-circuits to hint pill if used outside a provider

### `<ConnectorHealthIndicator>`

Tiny live status dot (used in: run detail, idea cards, workflow node inspector).

```tsx
<ConnectorHealthIndicator
  connectorId="github"
  status="healthy"
  displayName="GitHub"
  showLabel
  size="sm"
/>
```

**Status dot colors:**

```typescript
const DOT_CLASS = {
  healthy: 'bg-[var(--accent-emerald)] shadow-[0_0_6px_var(--accent-emerald)]',
  syncing: 'bg-[var(--accent-cyan)] shadow-[0_0_6px_var(--accent-cyan)] animate-pulse',
  stale: 'bg-[var(--accent-amber)]',
  failed: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)]',
  quarantined: 'bg-[var(--accent-rose)] shadow-[0_0_6px_var(--accent-rose)] animate-pulse',
  paused: 'bg-[var(--fg-tertiary)]',
};
```

All motion gated by `prefers-reduced-motion`.

### `<ConnectorCredentialsBadge>`

"Connect X to use this" prompt.

```tsx
<ConnectorCredentialsBadge connectorSlug="jira" />
```

Renders a small chip with "Connect Jira" CTA → routes to `/connector-center/marketplace?slug=jira`.

### `<ConnectorActionButton>`

Invoke an action on a connector with confirmation.

```tsx
<ConnectorActionButton
  connectorSlug="slack"
  action="send_message"
  params={{ channel: "#deploys", text: "Deploy started" }}
  requiresConfirmation
  confirmationTitle="Send to #deploys?"
/>
```

Uses `ConnectorProvider.invoke()` which dispatches to the real orchestrator endpoint (per Rule 1, no direct SDK imports).

---

## 12 Connector Capabilities (`apps/forge/lib/connectors/data.ts`)

```typescript
export type ConnectorCapability =
  | 'pull_issues'         // Jira, Linear, Asana, ClickUp, Zendesk
  | 'pull_prs'            // GitHub, GitLab, Bitbucket, Azure DevOps
  | 'pull_commits'        // GitHub, GitLab, Bitbucket
  | 'create_ticket'       // Jira, Linear, Asana, ClickUp, Azure DevOps
  | 'update_ticket'       // Same as create_ticket
  | 'send_message'        // Slack
  | 'send_email'          // SendGrid, SES
  | 'query_database'      // Databricks, Snowflake, BigQuery
  | 'read_warehouse'      // Same
  | 'push_metrics'        // Datadog, Grafana
  | 'read_alerts'         // PagerDuty, OpsGenie
  | 'read_design';        // Figma
```

ConnectorPicker groups connectors by capability. Marketplace lists items by category.

---

## OAuth Round-Trip

```
1. User clicks "Install Jira" on Marketplace tab
2. Frontend redirects to upstream OAuth provider with:
   - CSRF `state` (UUID, stored in sessionStorage)
   - `redirect_uri=/connector-center/oauth/callback`
   - `scope=read:jira-work write:jira-work`
3. User authenticates on Jira
4. Jira redirects back: /connector-center/oauth/callback?code=…&state=…&slug=jira
5. Callback page validates:
   - state === sessionStorage.oauth_state
   - state not expired
6. POST /api/v1/connectors/oauth/callback { code, state, slug }
7. Backend exchanges code for access_token + refresh_token
8. Backend encrypts tokens via Fernet → stores in connector_credentials table
9. Connector row created with status=HEALTHY
10. Frontend redirects to /connector-center?tab=connected&highlight=jira
```

SessionStorage keys:
- `forge.oauth.state` — CSRF state
- `forge.oauth.slug` — which connector is being installed

---

## State Machine (`backend/app/services/connector_states.py`)

```
PENDING → SYNCING → HEALTHY
                      ↓
                  STALE (no sync for >N hours)
                      ↓
                  FAILED (sync error)
                      ↓
                  QUARANTINED (repeated failures → manual review)
```

Transitions are validated by `connector_state_machine.transition()` which raises on invalid moves.

**Health refresh:** `sync_interval_minutes` per connector (default 60). When `now - last_sync_at > sync_interval_minutes`, status flips to `STALE` (background job).

---

## Seed Data (Step 55 v2 — assumed running)

The default tenant ships with **6 installed connectors** (assumed — there's no dedicated `seed_connectors.py` script; connectors may be seeded via the `seed_data` flow or a future dedicated script). All 6 are TIER_1 (commonly used):

| # | Slug | Type | Auth | Status | Capabilities |
|---|---|---|---|---|---|
| 1 | github | source-control | api_key | healthy | pull_prs, pull_commits |
| 2 | jira | project-mgmt | oauth | healthy | pull_issues, create_ticket, update_ticket |
| 3 | confluence | project-mgmt | api_key | healthy | pull_issues |
| 4 | figma | design | oauth | stale | read_design |
| 5 | aws | cloud | service_account | healthy | query_database (via Athena) |
| 6 | slack | comms | oauth | healthy | send_message |

If your local env doesn't have all 6, run `/connector-center/marketplace` to install any missing pieces. The marketplace catalog is in-memory (`RECOMMENDED` constant in `lib/connectors/data.ts`).

---

## Health Snapshot (Detail Panel)

For each connector, the detail panel surfaces:

| Metric | Source |
|---|---|
| Last call timestamp | `last_sync_at` |
| p50 latency (ms) | computed from `connector_sync_history` |
| p95 latency (ms) | same |
| Error rate (24h) | `error_count_24h / (error_count_24h + success_count_24h)` |
| Call count 24h | `error_count_24h + success_count_24h` |
| Sparkline | last 24 sync attempts |

A `ConnectorHealthIndicator` sits in the header for instant visual feedback.

---

## Credential Envelope (Per FORA-128)

The detail panel renders a redacted credential envelope:

```typescript
{
  secretRef: "forge://connectors/{id}/credentials/{cred_id}",
  fingerprint: "sha256:abc123…",     // truncated, NEVER full hash
  valueLen: 64,                       // length only, never the value
  lastRotatedAt: "2026-05-12T10:30:00Z",
  expiresAt: "2026-08-10T10:30:00Z",
}
```

**NEVER** render the full credential value in any UI surface. Use `POST /api/v1/connectors/{id}/credentials/{cred_id}/reveal` to view it (which writes an audit row).

---

## Rotation Deadline Callout

When `expiresAt < now + 14 days`, the detail panel shows a warning callout:

> ⚠️ Credential expires in {N} days. [Rotate now]

`POST /api/v1/connectors/{id}/rotate` re-issues the credential and writes an audit row.

---

## Activity Feed (Tab 6)

`GET /api/v1/connectors/activity` returns recent sync events across all connectors:

```typescript
interface ConnectorSyncEventWire {
  id: string;
  connector_id: string;
  event_type: 'pull' | 'push' | 'webhook' | 'test';
  status: 'success' | 'partial' | 'failed';
  records: number;
  duration_ms: number;
  started_at: string;
  error?: string;
}
```

Polled every 10s via TanStack Query. Rendered as a virtualized list.

---

## Edge cases

| State | Treatment |
|---|---|
| **No connectors installed** | Empty state + "Install your first connector" CTA + featured marketplace items |
| **Connector in PENDING** | Spinner in ConnectorHealthIndicator; "Setting up..." copy |
| **Connector in SYNCING** | Pulsing cyan dot; progress bar if sync duration > 5s |
| **Connector in HEALTHY** | Emerald dot; "Healthy" label |
| **Connector in STALE** | Amber dot; "Stale — last synced {N}h ago"; "Sync now" button |
| **Connector in FAILED** | Rose dot; error banner with last_error message; "View logs" link |
| **Connector in QUARANTINED** | Pulsing rose dot; "Quarantined — needs review"; "Re-enable" action with confirmation modal |
| **OAuth state mismatch** | Render error card: "Security check failed. Try connecting again from the Marketplace." |
| **OAuth code expired (>10min)** | Same as state mismatch |
| **Sync timeout** | `SyncStatus.TIMEOUT` row written; UI shows partial result with "Sync timed out — try again" |
| **Manual sync during quarantine** | Button disabled with tooltip "Resolve quarantine first" |
| **Concurrent sync attempts** | Server returns 409; UI shows "Sync already in progress" |
| **Permission denied (cross-tenant)** | Returns 404 (tenant scoping — never leak existence) |
| **`prefers-reduced-motion`** | Pulse animations disabled; status dots static |

---

## Forbidden patterns

AI agents modifying Connectors MUST NOT:

- ❌ Add a new `ConnectorType` without updating both backend enum AND `lib/connectors/data.ts` AND `lib/connectors/types.ts` (3-way lock-step)
- ❌ Skip OAuth `state` validation — CSRF protection is mandatory
- ❌ Render full credential values in any UI — only envelope + reveal endpoint
- ❌ Skip audit logging on install / uninstall / rotate / sync / test
- ❌ Bypass `connector_state_machine` for status transitions — invalid transitions MUST raise
- ❌ Skip `requires_confirmation` on destructive actions (rotate, uninstall)
- ❌ Skip tenant scoping — every query carries `tenant_id` from JWT
- ❌ Use direct SDK imports in `ConnectorProvider.invoke()` — Rule 1: proxy via orchestrator
- ❌ Add a capability without updating `ConnectorCapability` type + marketplace data
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Implement OAuth state in URL params — sessionStorage only

---

## Verification checklist

- [ ] `/connector-center` renders 7 tabs
- [ ] `curl .../connectors` returns 6 seeded connectors with valid Bearer token + tenant scope
- [ ] `POST /connectors` installs a new connector (status=PENDING then HEALTHY)
- [ ] `PATCH /connectors/{id}` updates name / config
- [ ] `DELETE /connectors/{id}` soft-deletes
- [ ] `POST /connectors/{id}/sync` triggers sync + returns `ConnectorSyncHistoryRead`
- [ ] `POST /connectors/{id}/test` returns `ConnectorTestResult` with `ok: true` for healthy connectors
- [ ] OAuth callback page validates state + calls `/api/v1/connectors/oauth/callback`
- [ ] `<ConnectorPicker capability="pull_issues" />` lists Jira + Linear + Asana
- [ ] `<ConnectorHealthIndicator>` shows correct dot color for each status
- [ ] `<ConnectorCredentialsBadge>` routes to marketplace with `slug` query param
- [ ] `<ConnectorActionButton requiresConfirmation>` opens confirmation modal before invoke
- [ ] Rotation deadline callout shows when expiresAt < now + 14d
- [ ] Sync history list shows last N attempts with status icons
- [ ] Empty state renders when API returns `[]`
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Tenant switch refetches connectors
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — status dot colors, marketplace tiles
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R12
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list
- [DB schema](../reference/db-schema.md) — `connectors`, `connector_sync_history`, `connector_credentials`
- [Dashboard](./dashboard.md) — "Connectors" widget shows health rollup
- [Copilot](./copilot.md) — `search_knowledge` queries connectors via KG
- [Ideation Center](./ideation-center.md) — Sources tab uses ConnectorPicker
- [Architecture Center](./architecture-center.md) — Service map pulls service catalog
- [Audit](./audit.md) — every connector action logged
- [Settings](./settings.md) — connector defaults tab

---

## Maintenance notes

**When to update this doc:**

- A new `ConnectorType` added → update 12-kind table + types + data layer
- A new capability added → update 12-capability list + ConnectorPicker grouping
- A new state added → update state machine diagram + STATUS_DOT_CLASS
- A new marketplace category added → update CATEGORY_ORDER
- A new cross-cutting primitive added → update R12 section

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/connectors.py                ←  CRUD routes
backend/app/api/v1/connector_lifecycle.py       ←  Install + rotate
backend/app/api/v1/connector_events.py          ←  Webhook ingest
backend/app/db/models/connector.py              ←  12 ConnectorType + 6 ConnectorStatus + 4 SyncStatus
backend/app/services/connector_manager.py       ←  CRUD + sync orchestration
backend/app/services/connector_states.py        ←  State machine validator
         ↓
apps/forge/lib/connectors/api.ts                ←  Typed fetcher
apps/forge/lib/connectors/types.ts              ←  TypeScript mirror
apps/forge/lib/connectors/data.ts               ←  Legacy mock layer (still used for offline)
apps/forge/lib/connectors/provider.tsx          ←  ConnectorProvider (R12 cross-cutting)
apps/forge/lib/connectors/rbac.ts               ←  Permission gates
apps/forge/lib/hooks/useConnectors.ts           ←  TanStack Query hooks
         ↓
apps/forge/components/connectors/ConnectorPicker.tsx          ←  R12 combobox
apps/forge/components/connectors/ConnectorHealthIndicator.tsx  ←  R12 dot
apps/forge/components/connectors/ConnectorCredentialsBadge.tsx ←  R12 prompt
apps/forge/components/connectors/ConnectorActionButton.tsx    ←  R12 invoke
apps/forge/app/connector-center/page.tsx                       ←  7-tab index
apps/forge/app/connector-center/[id]/page.tsx                 ←  Detail
apps/forge/app/connector-center/oauth/callback/page.tsx       ←  OAuth callback
```

If any link in this chain drifts, the Connector Center breaks silently. Always update all links.

---

## ⚠️ NOTE: Mock layer coexistence

`lib/connectors/data.ts` contains a legacy in-memory `CONNECTORS` array used for offline / storybook. The wire-format layer (`lib/connectors/api.ts`) is canonical when the API is reachable. The `wireToConnector()` adapter converts between them.

**Rule of thumb:**
- Real backend reachable → use `useConnectors()` (TanStack Query hook) → `ConnectorWire`
- Offline / storybook → use `ConnectorProvider` with `overrides={CONNECTORS}`
- Never mix both in the same component tree

The marketplace catalog is also in-memory (`RECOMMENDED` in `data.ts`) until the marketplace API ships. AI agents must NOT assume marketplace items come from the backend — they come from the static array.