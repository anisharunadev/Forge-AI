# Feature: Admin Hub (Platform Admin + LLM Gateway)

> **Status:** Wired to real backend (F-008 + F-829 Phase B)
> **Routes:** 8 admin pages — `/admin` (Settings hub) + `/admin/seeds` + `/admin/llm-gateway/*` (3 hub + 4 deep)
> **Backend:** `backend/app/api/v1/admin.py` (3 routes) + `backend/app/api/v1/admin_llm_gateway.py` (6 routes) = **9 routes**
> **Service:** `backend/app/services/admin_service.py` (read-only platform diagnostics + cache purge)
> **Integration:** `backend/app/integrations/litellm/` (VirtualKeyManager + TenantSync + GuardrailSync + MCPServerRegistry)
> **Constitutional rules:** R1 (LiteLLM proxy + virtual keys), R2 (multi-tenant), R3 (human approval for cache purge + key revoke), R6 (auditability)

---

## Purpose

The Admin Hub is the **Steward's platform-wide control surface**. It covers platform diagnostics (stats / health / cache purge), LLM Gateway configuration (per-tenant config / virtual keys / MCP / health), and seed management. This is the **highest-privilege area** in Forge — every action is audited and most require explicit Steward role.

Per PRD §1.4 the Admin Hub serves **stewards** (primary) and **operators** (limited read access). It's the only place where cross-tenant data is visible.

**Key capabilities:**

**Platform admin (`/admin`):**
- **Stats** — tenant / project / user / run / cost / connector / artifact counts (last 24h)
- **Health probe** — per-component status (Postgres / Redis / LiteLLM / Keycloak)
- **Cache purge** — operator action with explicit confirmation

**LLM Gateway (`/admin/llm-gateway`):**
- **Tenant config** — per-tenant LLM model + budget + guardrails
- **Virtual Keys** — list / rotate / revoke (LiteLLM virtual keys)
- **MCP servers** — read-only browser of LiteLLM-registered MCP servers
- **Health dashboard** — LiteLLM availability (30s polling)

**Seeds (`/admin/seeds`):**
- **Seed status** — current seed version + drift detection
- **Seed history** — past apply / reset / rollback runs
- **Seed apply / reset / rollback** — with modals

---

## Architecture

```
AdminHub (/admin)
└── 21-tab Settings shell (per settings.md doc)
    ├── Account (4): Profile / Sessions / Notifications / API Tokens
    ├── Workspace (8): General / Members / Agents / Providers / Env Vars / Integrations / Workflow / Audit
    └── Enterprise (9): AI Gateway / Seeds / Webhooks / Connected Apps / SSO / Branding / Billing / Feature Flags / Keyboard

AdminSeeds (/admin/seeds)
└── Steward seed management
    ├── SeedStatusPanel
    ├── SeedHistoryTable
    ├── SeedApplyModal
    ├── SeedResetModal
    └── SeedRollbackModal

AdminLLMGateway (/admin/llm-gateway)
└── 3-card hub
    ├── /tenants — all tenants + per-tenant config
    │   └── /tenants/[id] — single tenant detail
    │       └── /keys — Virtual Key lifecycle
    ├── /mcp-servers — read-only MCP browser
    └── /health — LiteLLM availability
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/admin` | AdminSettingsPage | 21-tab Settings hub |
| `/admin/seeds` | AdminSeeds | Seed management |
| `/admin/llm-gateway` | AdminLLMGatewayPage | 3-card LLM Gateway hub |
| `/admin/llm-gateway/tenants` | TenantsIndex | All tenants list |
| `/admin/llm-gateway/tenants/[id]` | TenantDetail | Single tenant config |
| `/admin/llm-gateway/tenants/[id]/keys` | TenantKeysPage | Virtual Key lifecycle |
| `/admin/llm-gateway/mcp-servers` | MCPServersPage | MCP browser |
| `/admin/llm-gateway/health` | HealthDashboard | LiteLLM availability |

### Backend (FastAPI) — **9 routes total**

#### Platform Admin (`backend/app/api/v1/admin.py`) — 3 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/admin/stats` | `admin:read` | Platform-wide stats (24h window) |
| `GET` | `/api/v1/admin/health` | `admin:read` | Deep health probe per component |
| `POST` | `/api/v1/admin/cache/purge` | `admin:write` | Purge platform cache (operator action) |

#### LLM Gateway (`backend/app/api/v1/admin_llm_gateway.py`) — 6 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/api/v1/admin/llm-gateway/tenants/{id}` | `admin:read` | Per-tenant LLM config |
| `GET` | `/api/v1/admin/llm-gateway/tenants/{id}/keys` | `admin:read` | List virtual keys |
| `POST` | `/api/v1/admin/llm-gateway/tenants/{id}/keys/rotate` | `admin:write` | Rotate virtual key |
| `POST` | `/api/v1/admin/llm-gateway/tenants/{id}/keys/{key_id}/revoke` | `admin:write` | Revoke virtual key |
| `GET` | `/api/v1/admin/llm-gateway/mcp-servers` | `admin:read` | List MCP servers (read-only) |
| `GET` | `/api/v1/admin/llm-gateway/health` | `admin:read` | Cached LiteLLM health snapshot |

---

## Data touched

### Tables (queried)

| Table | Purpose |
|---|---|
| `tenants` | Tenant count |
| `users` | User count |
| `connectors` | Connector count |
| `artifacts` | Artifact count |
| `audit_events` | Run count (last 24h) |
| `cost_entries` | Cost USD (last 24h) |
| `litellm_key_audit` | Virtual Key history (per-tenant) |

### Tables (written)

| Table | Purpose |
|---|---|
| `litellm_key_audit` | New audit rows on rotate / revoke |
| `litellm_guardrail_violations` | Guardrail state sync |
| `audit_events` | Every admin action logged |

### Pydantic schemas (`backend/app/schemas/admin.py`)

```python
class ComponentHealth(ForgeBaseModel):
    name: str
    status: str           # 'healthy' | 'degraded' | 'down'
    detail: str | None = None
    checked_at: datetime

class AdminHealthReport(ForgeBaseModel):
    overall: str          # 'healthy' | 'degraded' | 'down'
    components: list[ComponentHealth]
    checked_at: datetime

class AdminStats(ForgeBaseModel):
    tenant_count: int
    project_count: int
    user_count: int
    run_count_24h: int
    cost_usd_24h: float
    connector_count: int
    artifact_count: int
    checked_at: datetime

class CachePurgeResult(ForgeBaseModel):
    purged_keys: int
    purged_at: datetime
    scope: str = "all"
```

### LLM Gateway schemas (`backend/app/api/v1/admin_llm_gateway.py`)

```python
class TenantLLMConfig(BaseModel):
    """Per-tenant LLM gateway configuration surface."""
    tenant_id: str
    project_id: str
    litellm_team_id: str | None = None
    litellm_team_status: str | None = None
    has_virtual_key: bool
    last_key_rotated_at: str | None = None
    budget_max_usd: float | None = None
    budget_period: str | None = None
    budget_spend_usd: float | None = None
    guardrail_ids: list[str] = Field(default_factory=list)
    model_alias: str | None = None


class VirtualKeyMetadata(BaseModel):
    """Public-facing Virtual Key metadata — value NEVER exposed."""
    id: str
    tenant_id: str
    alias: str
    created_at: str
    last_used_at: str | None = None
    status: str           # 'active' | 'rotated' | 'revoked'
    fingerprint: str      # sha256 prefix for correlation


class MCPBrowserEntry(BaseModel):
    id: str
    name: str
    transport: str
    command: str
    url: str
    scopes: list[str] = Field(default_factory=list)
    status: str


class HealthReport(BaseModel):
    healthy: bool
    last_check_at: str | None = None
    last_ok_at: str | None = None
    last_fail_at: str | None = None
    consecutive_failures: int
    last_error: str | None = None
```

### TypeScript mirror (`apps/forge/lib/litellm/data.ts`)

Mirrors all 4 LLM Gateway shapes.

---

## AdminStats Query (`backend/app/services/admin_service.py`)

```python
async def stats(self) -> AdminStats:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    async with factory() as session:
        tenant_count = await session.scalar(select(func.count(Tenant.id))) or 0
        user_count = await session.scalar(select(func.count(User.id))) or 0
        connector_count = await session.scalar(select(func.count(Connector.id))) or 0
        artifact_count = await session.scalar(select(func.count(Artifact.id))) or 0
        run_count_24h = (
            await session.scalar(
                select(func.count(AuditEvent.id)).where(AuditEvent.occurred_at >= since)
            ) or 0
        )
        cost_usd_24h = (
            await session.scalar(
                select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
                    CostEntry.recorded_at >= since
                )
            ) or 0.0
        )
        project_count = 0  # Projects are a future table; default to zero for now.

    return AdminStats(
        tenant_count=int(tenant_count),
        project_count=int(project_count),
        ...
    )
```

**Project count is currently hardcoded to 0** — Projects are a "future table" per the service docstring. When the project_count query lands, this becomes a real count.

---

## AdminHealth Probe

Per-component health check:

```python
class ComponentHealth(ForgeBaseModel):
    name: str
    status: str           # 'healthy' | 'degraded' | 'down'
    detail: str | None = None
    checked_at: datetime
```

**Components checked:**
- Postgres (DB ping)
- Redis (cache ping)
- LiteLLM Proxy (`/health/liveliness`)
- Keycloak (`/realms/{realm}/.well-known/openid-configuration`)
- (planned) S3 / artifact storage

---

## Cache Purge (Operator Action)

`POST /api/v1/admin/cache/purge` purges the platform-wide cache.

**Requires:** `admin:write` permission + confirmation modal in UI.

**What gets purged:**
- Redis cache entries (default: all)
- In-process LRU caches (per-tenant)
- Compliance feed dedupe set (`_seen`)
- KG query caches

**Auditable:** Always writes an `audit_event` with `action="admin.cache.purge"`.

> **Why no auto-purge:** Per Rule 3, destructive actions require explicit human approval. Cache purge can cause transient spikes in DB load + LiteLLM throttling, so it MUST be intentional.

---

## Virtual Key Lifecycle

### Critical rule (per F-829 plan)

> **"Critical rules: never display a Virtual Key VALUE in any UI surface"**

The key value is intentionally **never** in the response of any route. The only way to obtain a key value is the internal hot path (`VirtualKeyManager.get_key`).

### Fingerprint (sha256 prefix)

```python
def _redact_value(value: str) -> str:
    """Best-effort fingerprint for an arbitrary key value.

    Used to populate :attr:`VirtualKeyMetadata.fingerprint` so the
    UI can show a stable correlation token without ever exposing the
    key value itself.
    """
    import hashlib
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:12]}"
```

12-char SHA-256 prefix lets Steward correlate a key across logs without revealing the value.

### Rotate

`POST /admin/llm-gateway/tenants/{id}/keys/rotate`:

1. Generate new virtual key in LiteLLM Proxy
2. Mark old key as `rotated` in `litellm_key_audit`
3. Insert new audit row with `action=ROTATED`
4. Update tenant's `last_key_rotated_at`
5. Return `VirtualKeyMetadata` for the new key (without value)

### Revoke

`POST /admin/llm-gateway/tenants/{id}/keys/{key_id}/revoke`:

1. Delete key from LiteLLM Proxy
2. Mark audit row as `revoked`
3. Insert new audit row with `action=REVOKED`
4. Tenant can no longer use this key
5. Return `VirtualKeyMetadata` with `status='revoked'`

### Status derivation

```python
# from admin_llm_gateway.py
def _derive_status(action: LiteLLMKeyAction) -> str:
    if action == LiteLLMKeyAction.REVOKED: return "revoked"
    if action == LiteLLMKeyAction.ROTATED: return "rotated"
    return "active"
```

**Status enum:** `active` / `rotated` / `revoked`.

---

## Per-Tenant LLM Config Composition

`_collect_tenant_config` composes `TenantLLMConfig` from 3 sub-services:

```python
async def _collect_tenant_config(
    tid: str,
    pid: str,
    *,
    tenant_sync_svc: TenantSync,
    key_mgr: VirtualKeyManager,
    guardrail_svc: GuardrailSync,
) -> TenantLLMConfig:
    """Each sub-call is best-effort — if any one fails, the rest still
    populate, and the caller can render the partial state."""
    
    # 1. Team ID + status
    team_id = await tenant_sync_svc.get_team_id(tid)  # may fail → None
    
    # 2. Has virtual key?
    kv = await key_mgr.get_key(tid)
    has_key = kv is not None
    
    # 3. Guardrails
    guardrail_ids = await guardrail_svc.get_for_tenant(tid)
    
    return TenantLLMConfig(...)
```

**Best-effort composition:** If any one sub-call fails, the others still populate. Caller renders partial state with warning.

---

## MCP Servers (Read-Only)

`GET /admin/llm-gateway/mcp-servers` returns the LiteLLM Proxy's registered MCP servers.

Per OQ-34: **The LiteLLM admin UI is the surface for managing MCP server config; Forge only renders the read view.**

```python
class MCPBrowserEntry(BaseModel):
    id: str
    name: str
    transport: str          # 'stdio' | 'sse' | 'http'
    command: str
    url: str
    scopes: list[str]
    status: str
```

Rendered as read-only card grid in `MCPServerCard.tsx`.

---

## Health Dashboard

`GET /admin/llm-gateway/health` returns the cached snapshot from `LiteLLMHealthMonitor`:

```python
class HealthReport(BaseModel):
    healthy: bool
    last_check_at: str | None = None
    last_ok_at: str | None = None
    last_fail_at: str | None = None
    consecutive_failures: int
    last_error: str | None = None
```

The frontend `useLiteLLMHealth` polls every 30s. Auto-degrades gracefully if LiteLLM is unreachable.

The global `LLMUnavailableBanner` lives at app root — uniform status across all pages.

---

## Seeds (`/admin/seeds`)

Plan H seed management surface (per Step 62 plan). Composes `components/seeds/*` UI:

| Component | Purpose |
|---|---|
| `SeedStatusPanel` | Current seed version + drift detection |
| `SeedHistoryTable` | Past apply / reset / rollback runs |
| `SeedApplyModal` | Apply a seed (with confirmation) |
| `SeedResetModal` | Reset to baseline |
| `SeedRollbackModal` | Rollback to previous seed |

**RBAC:** `seeds:view` permission required (enforced server-side via `hasPermission`). Missing permission → redirect to `/admin`.

**Target seed:** Pinned to `acme-corp` (the demo seed slug from `SEED_TENANT_SLUG`).

### 8 TanStack Query hooks (`apps/forge/lib/hooks/useSeeds.ts`)

```typescript
export function useSeedsList():       // list all seeds
export function useSeed(name):        // one seed
export function useSeedStatus(name):  // status + drift
export function useSeedDiff(name):    // diff vs current
export function useSeedRuns(name):    // past runs
export function useApplySeed(name):   // mutation
export function useResetSeed(name):   // mutation
export function useRollbackSeed(name):// mutation
```

---

## 8 TanStack Query hooks (`apps/forge/lib/hooks/useLiteLLM.ts`)

```typescript
export function useLiteLLMHealth(): UseQueryResult<LiteLLMHealthSnapshot>
export function useAdminLLMHealth(): UseQueryResult<AdminLLMHealth>
export function useMCPServers(): UseQueryResult<MCPBrowserEntry[]>
export function useTenantLLMConfig(tenantId): UseQueryResult<TenantLLMConfig>
export function useTenantKeys(tenantId): UseQueryResult<VirtualKeyMetadata[]>
export function useRotateTenantKey(): UseMutationResult<VirtualKeyMetadata>
export function useRevokeTenantKey(): UseMutationResult<VirtualKeyMetadata>
```

---

## 7 LLM Gateway Components (`apps/forge/components/admin/llm-gateway/`)

| Component | Lines | Purpose |
|---|---|---|
| `KeyListTable.tsx` | 240 | Virtual Key table (Rotate / Revoke actions) |
| `GuardrailSelector.tsx` | 211 | Per-tenant guardrail picker |
| `BudgetGauge.tsx` | 166 | Budget consumption gauge |
| `DriftTable.tsx` | 141 | Drift detection between Forge + LiteLLM |
| `MCPServerCard.tsx` | 126 | MCP server card (read-only) |
| `ReconcileButton.tsx` | 117 | Reconcile drift (with confirmation) |
| `BudgetDisplay.tsx` | 109 | Budget display |
| **Total** | **1,110** | |

---

## 8 Admin Pages

| Path | Component | Lines (approx) |
|---|---|---|
| `/admin` | `AdminSettingsPage` | (per settings.md — 21 tabs) |
| `/admin/seeds` | `AdminSeeds` | ~250 |
| `/admin/llm-gateway` | `AdminLLMGatewayPage` | ~100 |
| `/admin/llm-gateway/tenants` | `TenantsIndex` | ~150 |
| `/admin/llm-gateway/tenants/[id]` | `TenantDetail` | ~200 |
| `/admin/llm-gateway/tenants/[id]/keys` | `TenantKeysPage` | ~100 |
| `/admin/llm-gateway/mcp-servers` | `MCPServersPage` | ~80 |
| `/admin/llm-gateway/health` | `HealthDashboard` | ~150 |

---

## Edge cases

| State | Treatment |
|---|---|
| **No tenants** | Empty state + "No tenants configured" |
| **Tenant without virtual key** | `has_virtual_key: false` + "Generate key" CTA |
| **Tenant team not synced to LiteLLM** | `litellm_team_status: "missing"` + Reconcile button |
| **Virtual key revoked** | Status badge "revoked" + audit row visible |
| **LiteLLM unreachable** | Health snapshot shows `consecutive_failures: N` |
| **Cache purge in progress** | Toast + disable button until completion |
| **Permission denied (non-Steward)** | 403 + redirect to `/admin` (seeds) |
| **`project_count: 0`** | Always — Projects are "future table" per admin_service.py docstring |
| **Project count query fails** | Returns 0 (graceful default) |
| **MCP server transport = stdio** | Renders command + args, not URL |
| **`prefers-reduced-motion`** | Pulse animations disabled |

---

## Forbidden patterns

AI agents modifying Admin Hub MUST NOT:

- ❌ Render Virtual Key VALUE in any UI surface — fingerprint only
- ❌ Skip tenant scoping on admin routes — audit must show tenant_id
- ❌ Skip audit logging on cache purge / key revoke / key rotate
- ❌ Skip `require_permission("admin:write")` for destructive actions
- ❌ Auto-purge cache without explicit human confirmation (Rule 3)
- ❌ Use direct LiteLLM SDK imports — Rule 1 (via `app.integrations.litellm`)
- ❌ Skip best-effort composition in `_collect_tenant_config` — partial state is OK
- ❌ Hardcode `project_count: 0` outside `admin_service.py` (use the schema)
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist

- [ ] `/admin` renders 21-tab Settings shell
- [ ] `/admin/seeds` renders seed management UI
- [ ] `/admin/llm-gateway` renders 3-card hub
- [ ] `/admin/llm-gateway/tenants` lists all tenants
- [ ] `/admin/llm-gateway/tenants/[id]` shows tenant config
- [ ] `/admin/llm-gateway/tenants/[id]/keys` lists virtual keys
- [ ] `/admin/llm-gateway/mcp-servers` shows MCP browser (read-only)
- [ ] `/admin/llm-gateway/health` shows health dashboard
- [ ] `curl .../admin/stats` returns 7 counts + `checked_at`
- [ ] `curl .../admin/health` returns per-component status
- [ ] `POST /admin/cache/purge` purges + writes audit row
- [ ] `curl .../admin/llm-gateway/tenants/{id}` returns TenantLLMConfig
- [ ] `curl .../admin/llm-gateway/tenants/{id}/keys` returns key list (NO value field)
- [ ] `POST /admin/llm-gateway/tenants/{id}/keys/rotate` rotates
- [ ] `POST /admin/llm-gateway/tenants/{id}/keys/{id}/revoke` revokes
- [ ] `curl .../admin/llm-gateway/mcp-servers` returns MCP servers
- [ ] `curl .../admin/llm-gateway/health` returns HealthReport
- [ ] Virtual Key VALUE never appears in any response body
- [ ] All mutations write audit rows
- [ ] Permission denied (non-admin) returns 403
- [ ] Empty state renders when no tenants
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — admin tokens
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (9 routes)
- [DB schema](../reference/db-schema.md) — `litellm_key_audit`, `tenants`, `users`
- [Dashboard](./dashboard.md) — "Platform health" widget
- [Settings](./settings.md) — Admin page owns Settings
- [Terminal](./terminal.md) — LLM Gateway health shared
- [Governance](./governance.md) — Policies + Guardrails surface
- [Audit](./audit.md) — Every admin action logged
- [Co-pilot](./copilot.md) — Virtual Key used by Co-pilot proxy
- [Onboarding](./onboarding.md) — Tenant creation via `ensure_team_for_tenant`

---

## Maintenance notes

**When to update this doc:**

- A new admin route added → update 9-route breakdown
- A new component health check added → update AdminHealth section
- A new LiteLLM integration module added → update `_collect_tenant_config`
- Virtual Key status enum extended → update `_derive_status`
- A new seed operation added → update Seeds section

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/admin.py                       ←  3 platform routes
backend/app/api/v1/admin_llm_gateway.py          ←  6 LLM Gateway routes
backend/app/services/admin_service.py            ←  AdminService (stats + health + cache)
backend/app/integrations/litellm/                ←  VirtualKeyManager + TenantSync + GuardrailSync + MCPServerRegistry + LiteLLMHealthMonitor
backend/app/db/models/litellm_key_audit.py       ←  LiteLLMKeyAction enum
backend/app/schemas/admin.py                     ←  AdminStats + AdminHealthReport + CachePurgeResult + ComponentHealth
         ↓
apps/forge/lib/hooks/useSeeds.ts                  ←  8 TanStack Query hooks
apps/forge/lib/hooks/useLiteLLM.ts                ←  7 TanStack Query hooks
apps/forge/lib/litellm/data.ts                    ←  Wire-format types
         ↓
apps/forge/app/admin/                            ←  8 admin pages
apps/forge/app/admin/llm-gateway/                 ←  4 LLM Gateway deep pages
apps/forge/components/admin/AdminShell.tsx        ←  Pass-through wrapper
apps/forge/components/admin/llm-gateway/          ←  7 components (1110 lines)
apps/forge/components/admin/settings/             ←  27 components (per settings.md)
apps/forge/components/seeds/                      ←  Seed management components
```

If any link in this chain drifts, the Admin Hub breaks silently. Always update all links.

---

## Why virtual keys are admin-only

Per the F-829 plan: **"Critical rules: never display a Virtual Key VALUE in any UI surface"**. The Virtual Key is the **only credential that can incur cost** — if leaked, an attacker can spend the tenant's budget in minutes. By restricting to:

1. **Steward-only routes** — `admin:read` minimum, `admin:write` for mutating
2. **No value in response** — fingerprint (12-char SHA-256 prefix) only
3. **Best-effort composition** — partial state if any sub-call fails (no fallback to leak value)
4. **Audit every rotation / revocation** — full chain of custody

…we ensure that even a compromised admin session can't extract the raw key. The fingerprint gives correlation, never leak.

This is the bedrock of cost-control R7 (observability). Without it, a Steward with a screen recorder could leak credentials. With it, even the Steward needs Secrets Manager access to mint a key.