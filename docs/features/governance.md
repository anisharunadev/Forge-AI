# Feature: Governance Center (Steward Control Plane)

> **Status:** Hybrid — real backend for violations (Step 59 + F-829i); client-side fixtures for policies/guardrails/standards/board/rbac/test (Step 35 rebuild)
> **Routes:** `apps/forge/app/governance-center/page.tsx` (8 tabs) + `apps/forge/app/governance/compliance/page.tsx` (F-829i Steward feed)
> **Backend:** `backend/app/api/v1/governance_violations.py` (4 routes) + `backend/app/api/v1/policies.py` (2 routes)
> **Integration:** `backend/app/integrations/litellm/compliance_feed.py` (LiteLLM Proxy polling)
> **Scheduler:** `backend/app/services/scheduler/jobs/litellm_violation_poll.py` (30s APScheduler tick)
> **Components:** 7 governance + 9 governance-v2 component groups
> **Constitutional rules:** R1 (LiteLLM proxy for guardrails), R2 (multi-tenant), R3 (human approval for policy changes), R6 (auditability), R8 (configurable governance)

---

## Purpose

The Governance Center is the **Enterprise AI control plane**. It surfaces policies, guardrails, standards, LLM control, board decisions, RBAC, and audit — everything a Steward needs to keep an AI-native platform in compliance.

Per PRD §1.4 the Governance Center serves **stewards** (primary audience) and **tech leads** (secondary). It is the **highest-level oversight surface** in Forge.

**Key capabilities:**

**8 tabs (`/governance-center`):**
- **Overview** — KPI summary (compliance score, guardrail status, violations, spend)
- **Policies** — 21 active policies (strict + advisory)
- **Guardrails** — 17 firing in last 24h, 1 in warning state
- **Standards** — 4 of 12 met (33% coverage)
- **LLM Control** — 9 model assignments
- **Board** — 5 decisions pending
- **RBAC** — 6 roles defined
- **Audit** — 87 recent changes

**Steward compliance feed (`/governance/compliance`):**
- **30s polling** of LiteLLM Proxy `/guardrail/violations`
- **Real backend** (not fixtures) — F-829i integration
- **Resolve / Reopen** actions write audit rows
- **Filter** by severity (low / medium / high / critical) + resolved state

**5 keyboard shortcuts:**
- `⌘⇧P` — New policy
- `⌘⇧G` — New guardrail
- `⌘⇧S` — Load standard
- `⌘/` — Show shortcuts
- `⌘K` — Global search

---

## Architecture

```
GovernanceCenterPage (/governance-center)
└── 8-tab shell (governance-v2)
    ├── HeroBand (KPIs + persona + board token status)
    ├── GovernanceTabs (with counts + healthTone)
    ├── Tab bodies:
    │   ├── OverviewTab — KPIs + spend + violations + recent changes
    │   ├── PoliciesTab — 21 policies (strict vs advisory)
    │   ├── GuardrailsTab — 17 guardrails (health indicator)
    │   ├── StandardsTab — 4 of 12 met (33%)
    │   ├── LlmTab — 9 model assignments + per-model spend
    │   ├── BoardTab — 5 pending decisions (persona-gated)
    │   ├── RbacTab — 6 roles
    │   ├── TestTab — policy test playground
    │   └── AuditTab — 87 recent changes
    └── Search + shortcuts overlay

ComplianceFeedPage (/governance/compliance)
└── F-829i Steward feed (real backend)
    ├── Filter bar (severity + resolved state)
    ├── Virtualized list (ViolationCard per item)
    ├── Resolve / Reopen actions
    └── 30s auto-refresh
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/governance-center` | GovernanceCenterShell | 8-tab steward console |
| `/governance/compliance` | ComplianceFeedPage | F-829i violation feed (real) |

### Backend (FastAPI)

#### Violations (`backend/app/api/v1/governance_violations.py`) — 4 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/governance/violations` | List violations (filter by severity + resolved) |
| `POST` | `/api/v1/governance/violations/{id}/resolve` | Mark resolved (Steward acknowledgment) |
| `POST` | `/api/v1/governance/violations/{id}/reopen` | Re-open |
| `POST` | `/api/v1/governance/violations/poll` | Manual trigger (escape hatch) |

#### Policies (`backend/app/api/v1/policies.py`) — 2 routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/policies` | List policies (tenant) |
| `POST` | `/api/v1/policies` | Create policy (201) |

**Total: 6 backend routes** (violations + policies). Other governance data is client-side fixtures per Step 35 rebuild.

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `litellm_guardrail_violations` | Per-violation rows from LiteLLM Proxy |
| `policies` | Policy definitions (LiteLLM-style expressions) |
| `audit_events` | Every governance action logged |

### `litellm_guardrail_violations` (`backend/app/db/models/litellm_guardrail_violation.py`)

```python
class GuardrailSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class GuardrailAction(str, Enum):
    BLOCKED = "blocked"      # request denied
    WARNED = "warned"        # passed with redacted content
    PASSED = "passed"        # logged but no action


class LiteLLMGuardrailViolation(Base, UUIDPrimaryKeyMixin, TenantScopedMixin):
    __tablename__ = "litellm_guardrail_violations"
    litellm_team_id: str     # indexed
    guardrail_id: str        # indexed
    sanitized_content: str   # redacted (never raw PII — Rule 6)
    resolved: bool           # Steward acknowledged
```

### `policies` table

```python
class PolicySeverity(str, Enum):
    INFO = "info"
    WARN = "warn"
    BLOCK = "block"

class Policy(Base, ...):
    __tablename__ = "policies"
    name: str              # max 200 chars
    description: str | None
    expression: dict       # LiteLLM-style expression (JSONB)
    severity: PolicySeverity
    enabled: bool          # default True
```

### Pydantic schemas

**Policy:**
```python
class PolicyBase(ForgeBaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    expression: dict[str, Any]
    severity: PolicySeverity = PolicySeverity.WARN
    enabled: bool = True

class PolicyCreate(PolicyBase):
    pass

class PolicyRead(PolicyBase, TenantScopedModel):
    id: UUID
```

**ComplianceViolationView (`backend/app/integrations/litellm/compliance_feed.py`):**
```python
@dataclass
class ComplianceViolationView:
    id: str
    tenant_id: str
    project_id: str
    guardrail_id: str
    severity: str       # 'low' | 'medium' | 'high' | 'critical'
    action_taken: str   # 'blocked' | 'warned' | 'passed'
    sanitized_content: str
    resolved: bool
    occurred_at: datetime

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "guardrail_id": self.guardrail_id,
            "severity": self.severity,
            "action_taken": self.action_taken,
            "sanitized_content": self.sanitized_content,
            "resolved": self.resolved,
            "occurred_at": self.occurred_at.isoformat(),
        }
```

### Frontend types (`apps/forge/lib/governance-v2/types.ts`)

```typescript
export interface GovernanceKpis {
  activePolicies: { total: number; strict: number; advisory: number };
  standards: { met: number; total: number; percent: number };
  guardrailsFiring: { count24h: number; delta: number };
  llmSpend: { today: number; cap: number; delta: number };
  violations: { unresolved: number; critical: number; high: number; medium: number };
  policyCoverage: {
    workflows: { covered: number; total: number };
    agents: { covered: number; total: number };
    commands: { covered: number; total: number };
  };
  complianceByStandard: Array<{ id: string; name: string; score: number }>;
  llmUsageByModel: Array<{ model: string; spend: number; requests: number; color: string }>;
  topViolations: Array<{ policyId: string; policyName: string; count: number; trend: 'up' | 'down' | 'flat' }>;
  recentChanges: Array<{ id: string; timestamp: string; type: string; subject: string; actor: string }>;
  guardrailStatus: 'all-active' | 'warning' | 'critical';
  guardrailStatusCount: number;
  totalComplianceScore: number;
}
```

---

## 8 Tabs with Counts (`apps/forge/components/governance-v2/shared/tab-bar.tsx`)

```typescript
export const DEFAULT_TABS: ReadonlyArray<TabDef> = [
  { id: 'overview',   label: 'Overview',     icon: LayoutDashboard, count: 0 },
  { id: 'policies',   label: 'Policies',     icon: ShieldCheck,     count: 21 },
  { id: 'guardrails', label: 'Guardrails',   icon: ShieldAlert,     count: 17, healthTone: 'amber' },
  { id: 'standards',  label: 'Standards',    icon: FileCheck,       count: 4,  healthTone: 'emerald' },
  { id: 'llm',        label: 'LLM Control',  icon: Cpu,             count: 9 },
  { id: 'board',      label: 'Board',        icon: Gavel,           count: 5 },
  { id: 'rbac',       label: 'RBAC',         icon: Users,           count: 6 },
  { id: 'audit',      label: 'Audit',        icon: History,         count: 87 },
];
```

**Health tones:**
- `emerald` — healthy (e.g. 4 standards met)
- `amber` — needs attention (e.g. 17 guardrails firing, 1 in warning)

---

## KPIs (`apps/forge/lib/governance-v2/fixtures.ts`)

```typescript
export const KPIS: GovernanceKpis = {
  activePolicies: { total: 21, strict: 14, advisory: 7 },
  standards: { met: 4, total: 12, percent: 33 },
  guardrailsFiring: { count24h: 521, delta: 12 },
  llmSpend: { today: 387.50, cap: 500, delta: -8 },
  violations: { unresolved: 23, critical: 3, high: 5, medium: 9 },
  policyCoverage: {
    workflows: { covered: 23, total: 28 },
    agents: { covered: 11, total: 12 },
    commands: { covered: 47, total: 52 },
  },
  complianceByStandard: [
    { id: 'iso-27001', name: 'ISO 27001', score: 94 },
    { id: 'iso-27002', name: 'ISO 27002', score: 88 },
    { id: 'soc2-type2', name: 'SOC 2 Type II', score: 92 },
    { id: 'gdpr', name: 'GDPR', score: 96 },
  ],
  llmUsageByModel: [
    { model: 'Claude Sonnet 4', spend: 187.20, requests: 12450, color: 'emerald' },
    { model: 'GPT-4o', spend: 98.40, requests: 6230, color: 'cyan' },
    { model: 'GPT-4o (Azure)', spend: 67.80, requests: 4520, color: 'amber' },
    { model: 'Claude Sonnet 4 (Bedrock)', spend: 48.20, requests: 3200, color: 'indigo' },
    { model: 'Claude Opus 4', spend: 64.20, requests: 4280, color: 'rose' },
  ],
  topViolations: [
    { policyId: 'pol-rate-limit-user', policyName: 'User Rate Limit (100 req/hr)', count: 23, trend: 'up' },
    { policyId: 'pol-output-scrub', policyName: 'Output PII Scrubber', count: 22, trend: 'up' },
    { policyId: 'pol-content-filter', policyName: 'Content Filter', count: 18, trend: 'flat' },
    { policyId: 'pol-citation-required', policyName: 'Citation Required', count: 31, trend: 'down' },
    { policyId: 'pol-model-restrict', policyName: 'Model Restriction', count: 14, trend: 'flat' },
  ],
  guardrailStatus: 'warning',
  guardrailStatusCount: 1,
  totalComplianceScore: 93,
};
```

**Top violations by policy:**
- `pol-citation-required` — 31 hits (down trend) — most-fired
- `pol-rate-limit-user` — 23 hits (up trend)
- `pol-output-scrub` — 22 hits (up trend)
- `pol-content-filter` — 18 hits (flat)
- `pol-model-restrict` — 14 hits (flat)

**Recent changes** (10 most recent): version updates, enforcements, creations, deletions, archives.

---

## LiteLLM Compliance Feed Integration (F-829i)

### `backend/app/integrations/litellm/compliance_feed.py`

Polls the LiteLLM Proxy `/guardrail/violations` endpoint on a 30s schedule.

```python
@dataclass
class ViolationIngestResult:
    ingested: int
    skipped_duplicates: int
    since: datetime
    until: datetime

_MAX_PER_POLL: int = 500  # hard ceiling to prevent runaway flooding

def _dedupe_key(
    litellm_team_id: str,
    guardrail_id: str,
    occurred_at: datetime,
) -> str:
    """Stable dedupe key — sha256 of the natural composite."""
    raw = f"{litellm_team_id}|{guardrail_id}|{occurred_at.isoformat()}".encode()
    return hashlib.sha256(raw).hexdigest()


class ComplianceFeed:
    """LiteLLM guardrail violation ingest + read service (F-829i)."""

    def __init__(self) -> None:
        self._session_factory = get_session_factory()
        # Track dedupe keys in-process between polls
        self._seen: set[str] = set()

    async def poll_violations(self) -> ViolationIngestResult:
        # Fetches from LiteLLM, dedupes, ingests
        ...

    async def list_violations(
        self,
        tenant_id: UUID | str,
        *,
        severity: str | None = None,
        resolved: bool | None = None,
        limit: int = 100,
    ) -> list[ComplianceViolationView]:
        # Mirrors GET /api/v1/governance/violations
        ...
```

### Dedupe strategy

> Idempotency: violations are deduped on `(litellm_team_id, guardrail_id, occurred_at)` — LiteLLM re-emits the same payload when queried twice, so we need a stable key. When the natural composite key collides we keep the first row and ignore subsequent ingests.

### Scheduler (`backend/app/services/scheduler/jobs/litellm_violation_poll.py`)

```python
async def poll_litellm_violations() -> None:
    """Scheduler entry point — runs every 30s, fans out to ComplianceFeed.

    Failure isolation: any exception raised inside the polling service
    is caught here so APScheduler does not enter its retry/backoff
    state and silently skip subsequent ticks.
    """
    try:
        from app.integrations.litellm.compliance_feed import compliance_feed
        result = await compliance_feed.poll_violations()
        if result.ingested > 0 or result.skipped_duplicates > 0:
            logger.info(
                "litellm.violation_poll.tick",
                ingested=result.ingested,
                skipped_duplicates=result.skipped_duplicates,
            )
    except Exception as exc:  # noqa: BLE001 — loop must never die
        logger.warning(
            "litellm.violation_poll.failed",
            error=f"{type(exc).__name__}: {exc}",
        )
```

**Survives restart:** Registered during `scheduler/service.py::start()` which runs from `app.main.lifespan` — every process boot re-arms the 30s interval. APScheduler `replace_existing=True` so duplicate registration is safe.

### Failure modes

| Mode | Behavior |
|---|---|
| LiteLLM `/guardrail/violations` unreachable | Log warning, leave cached state untouched, return `[]` |
| Redis down | Degrade to direct SQL path (same as `usage_query`) |
| LiteLLM emits duplicates | Deduped on `(team_id, guardrail_id, occurred_at)` SHA-256 |
| Runaway proxy | Capped at `_MAX_PER_POLL = 500` rows per tick |

### Event emission

Each ingested violation emits `EventType.COMPLIANCE_VIOLATION` so Pulse + audit subscribers can react. Steward feed polls every 30s for near-real-time alerts.

---

## Compliance Feed Frontend (`/governance/compliance`)

```typescript
// apps/forge/app/governance/compliance/page.tsx
const SEVERITIES: ReadonlyArray<string> = ['all', 'low', 'medium', 'high', 'critical'];

const refresh = React.useCallback(async () => {
  if (!tenantId) return;
  const data = await listViolations(tenantId, {
    severity: severity === 'all' ? undefined : severity,
    resolved: resolved === 'all' ? undefined : resolved === 'resolved',
  });
  // ... render ViolationCard per item
}, [tenantId, severity, resolved]);

React.useEffect(() => {
  refresh();
  const id = window.setInterval(refresh, 30_000);  // 30s poll
  return () => window.clearInterval(id);
}, [refresh]);
```

**State:** `severity` filter (default: 'all'), `resolved` filter (default: 'open'), 30s auto-refresh.

**Violations are NEVER rendered with raw PII** — only `sanitized_content` from backend.

---

## Board Tab (Persona-Gated)

The Board tab surfaces **decisions pending** that need Steward approval. Persona-aware:

- `pm` — read-only view of product decisions
- `eng-lead` — read-only view of engineering decisions
- `cto` — full access (veto + decide)
- `vp-eng` — full access (escalation)
- `security` — full access (security-related decisions)
- `customer` — read-only view

Persona read from cookie via `readPersonaFromCookieHeader()`.

**Board token** (separate from user JWT) determines cross-org access. `boardTokenPresent` flag drives UI chrome (e.g., "Connect board" CTA when missing).

---

## 16 Governance Components

### 7 governance components (`apps/forge/components/governance/`)
| Component | Lines | Purpose |
|---|---|---|
| `ApprovalCard.tsx` | 264 | Approval decision card |
| `PoliciesTable.tsx` | 306 | Policies table with filters |
| `GovernanceBoardStatus.tsx` | 194 | Board status widget |
| `KpiTileRow.tsx` | 184 | KPI tiles row |
| `RbacRolesList.tsx` | 170 | RBAC roles list |
| `ViolationCard.tsx` | 163 | Violation card with sanitized content |
| `ConfirmationHistory.tsx` | 137 | Decision history |
| **Total** | 1,418 | |

### 9 governance-v2 component groups (`apps/forge/components/governance-v2/`)
- `governance-center-shell.tsx` — main shell
- `shared/` — HeroBand, GovernanceTabs, TabBar
- `overview/` — OverviewTab
- `policies/` — PoliciesTab
- `guardrails/` — GuardrailsTab
- `standards/` — StandardsTab
- `llm/` — LlmTab
- `board/` — BoardTab
- `rbac/` — RbacTab
- `test/` — TestTab (policy test playground)
- `audit/` — AuditTab

---

## 5 Keyboard Shortcuts (Step 35)

```typescript
const KEYBOARD_SHORTCUTS = [
  { keys: ['⌘', '⇧', 'P'], description: 'New policy' },
  { keys: ['⌘', '⇧', 'G'], description: 'New guardrail' },
  { keys: ['⌘', '⇧', 'S'], description: 'Load standard' },
  { keys: ['⌘', '/'],      description: 'Show shortcuts' },
  { keys: ['⌘', 'K'],      description: 'Global search' },
];
```

---

## Policy Coverage (KPIS)

```typescript
policyCoverage: {
  workflows: { covered: 23, total: 28 },   // 82%
  agents:    { covered: 11, total: 12 },   // 92%
  commands:  { covered: 47, total: 52 },   // 90%
}
```

**Coverage gap analysis:** 5 workflows + 1 agent + 5 commands lack policy coverage. Governance Center surfaces these as remediation items.

---

## Compliance Standards

4 standards tracked:

| Standard | Score |
|---|---|
| ISO 27001 | 94 |
| ISO 27002 | 88 |
| SOC 2 Type II | 92 |
| GDPR | 96 |

Average: 92.5. Goal: maintain all > 85.

---

## Edge cases

| State | Treatment |
|---|---|
| **No violations** | Empty state + "All clear" |
| **High-severity violation open** | Red banner + Resolve CTA |
| **LiteLLM unreachable** | Banner + retry button + last-sync timestamp |
| **Redis down** | Auto-degrade to direct SQL |
| **Duplicate violations (LiteLLM re-emits)** | Dedupe on `(team_id, guardrail_id, occurred_at)` |
| **Resolve race** | 404 on stale violation_id |
| **Board token missing** | "Connect board" CTA in HeroBand |
| **Persona = customer** | Board tab read-only |
| **Audit log overflow (87+)** | Virtualized table |
| **Policy severity = BLOCK** | (future) Force pause + Steward override required |
| **`prefers-reduced-motion`** | Pulse animations disabled |

---

## Forbidden patterns

AI agents modifying Governance MUST NOT:

- ❌ Import direct LiteLLM SDKs — Rule 1 (use `compliance_feed` integration)
- ❌ Skip tenant scoping on violation queries — Rule 2
- ❌ Skip audit logging on resolve / reopen / poll — Rule 6
- ❌ Render raw PII in `sanitized_content` — backend redacts, UI must not override
- ❌ Auto-resolve CRITICAL violations — requires Steward acknowledgment
- ❌ Skip `@audit()` decorator on policy mutations
- ❌ Skip permission checks (`require_principal()`)
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it
- ❌ Modify in-process `_seen` dedupe set from outside ComplianceFeed
- ❌ Bypass 30s scheduler interval — manual poll is for escape hatch only

---

## Verification checklist

- [ ] `/governance-center` renders 8 tabs with counts + healthTone
- [ ] ⌘⇧P switches to Policies tab
- [ ] ⌘⇧G switches to Guardrails tab
- [ ] ⌘⇧S switches to Standards tab
- [ ] ⌘/ shows shortcuts overlay
- [ ] ⌘K shows global search
- [ ] HeroBand shows correct persona + board token status
- [ ] `/governance/compliance` renders ViolationCard list
- [ ] 30s polling refreshes list (verify in DevTools Network)
- [ ] Severity filter (low / medium / high / critical) works
- [ ] Resolved filter (all / open / resolved) works
- [ ] Resolve button calls `POST /violations/{id}/resolve`
- [ ] Reopen button calls `POST /violations/{id}/reopen`
- [ ] Manual poll button calls `POST /violations/poll`
- [ ] `curl .../policies` returns policies
- [ ] `POST /policies` creates new policy
- [ ] `curl .../governance/violations` returns 100 max
- [ ] `curl .../governance/violations?severity=critical` filters
- [ ] `curl .../governance/violations?resolved=false` filters
- [ ] LiteLLM unreachable → banner shows + Retry
- [ ] Person cookie gates Board tab access
- [ ] Virtualized table handles 87+ audit rows smoothly
- [ ] Empty state renders when no violations
- [ ] Loading state renders during fetch (skeleton, not spinners)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — health tone mapping
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R1 + R2 + R3 + R6 + R8
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (6 routes)
- [DB schema](../reference/db-schema.md) — `litellm_guardrail_violations`, `policies`
- [Dashboard](./dashboard.md) — "Compliance score" widget
- [Terminal](./terminal.md) — Cost tracking + burn rate feeds LLM Control
- [Audit](./audit.md) — Every governance action logged
- [Co-pilot](./copilot.md) — `run_command` tool respects BLOCK severity
- [Settings](./settings.md) — Per-tenant guardrail toggle
- [Auth](./auth.md) — Persona cookie + board token

---

## Maintenance notes

**When to update this doc:**

- A new governance tab added → update 8-tab list
- A new violation severity added → update 4-severity enum
- A new guardrail seeded → update 4-guardrail list (in terminal.md)
- LiteLLM endpoint path changes → update `_VIOLATIONS_PATH` constant
- A new keyboard shortcut added → update 5-shortcut list
- Persona list expands → update 6-persona table

**Files to keep in sync (the lock-step rectangle):**

```
backend/app/api/v1/governance_violations.py    ←  4 violation routes
backend/app/api/v1/policies.py                ←  2 policy routes
backend/app/integrations/litellm/compliance_feed.py ←  Polling + read service
backend/app/services/scheduler/jobs/litellm_violation_poll.py ←  30s scheduler
backend/app/db/models/litellm_guardrail_violation.py ←  GuardrailSeverity + GuardrailAction enums
backend/app/db/models/policy.py               ←  PolicySeverity enum
         ↓
apps/forge/lib/governance-v2/                 ←  Types + fixtures (KPIS) + index
apps/forge/lib/litellm/usage.ts               ←  listViolations + resolveViolation + reopenViolation + triggerViolationPoll
         ↓
apps/forge/app/governance-center/page.tsx     ←  8-tab shell
apps/forge/app/governance/compliance/page.tsx ←  F-829i Steward feed (real backend)
apps/forge/components/governance/             ←  7 components (1418 lines)
apps/forge/components/governance-v2/          ←  9 component groups (Step 35)
```

If any link in this chain drifts, the Governance Center breaks silently. Always update all links.

---

## Why this is "Steward-only"

The Governance Center is gated to **stewards** by persona. Other personas see limited or read-only views. The reasoning:

> **AI platforms need human stewards to keep them honest.** The 21 policies + 17 guardrails + 4 standards + board decisions are how stewards translate their organization's compliance posture into enforceable rules. Without this surface, the platform would be a black box — every LLM call would happen without audit, every guardrail would be configurable but invisible.

The compliance feed (`/governance/compliance`) is the **Steward's radar** — they see every guardrail violation in real-time (30s polling) and can resolve/reopen with one click. This is the human-in-the-loop enforcement that Rule 3 demands at scale.

---

## Current state (honest)

**Real backend (F-829i):**
- 4 violation routes (list / resolve / reopen / poll)
- LiteLLM Proxy integration with 30s scheduler polling
- `compliance_feed.py` with dedupe + max-per-poll cap

**Client-side fixtures (Step 35 rebuild):**
- 8 tabs of UI use `lib/governance-v2/fixtures.ts`
- Policies / Guardrails / Standards / LLM Control / Board / RBAC / Audit / Test
- Per the docstring: *"Mocked LiteLLM integration; mock policy test playground. All data is client-side"*

**Backend LiteLLM Admin SDK** is planned but not yet shipped (per Step 59 plan: `backend/app/services/litellm_admin.py`). When that ships, the fixture-driven tabs can flip to real TanStack Query hooks backed by the SDK.

**The compliance feed is the only fully-real surface today.** It uses `listViolations`, `resolveViolation`, `reopenViolation`, `triggerViolationPoll` from `lib/litellm/usage.ts` which proxy the backend routes above.

AI agents must distinguish between **violations-real** (F-829i) and **policies-fixture** (Step 35 client-side). Do not assume all governance data is live.