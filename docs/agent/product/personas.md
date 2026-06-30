# Product: Personas

> **Status:** ✅ Canonical — drives all UI surfaces + RBAC
> **Doc owner:** Product team
> **Source of truth:** `apps/forge/lib/auth.ts` (PERSONA_PERMISSIONS) + `apps/forge/components/personas/`
> **Last updated:** 2026-06-30
> **Related:** [Features: Personas & Dashboards](../features/personas-dashboards.md)

---

## Overview

Forge serves **4 primary personas** in the enterprise SDLC. Each persona has:

- A **job-to-be-done** (what they're trying to accomplish)
- A **dashboard** (their home page)
- A **permission set** (RBAC scopes they hold)
- A **default landing page** (where they land after login)

Persona is **context, not auth**. The proxy sets `X-Forge-Persona`; the backend is the source of truth for RBAC (R5, R6).

---

## The 4 personas

### Persona 1: PM (Product Manager)

**Job-to-be-done:** "Help me see project health, surface risks, drive alignment, and track delivery without micromanaging engineers."

**Goals:**
- Know what's blocked and unblock it
- Track sprint velocity + roadmap progress
- See cost vs. value across projects
- Communicate status to stakeholders

**Dashboard (PM Dashboard):**
- Project health overview (status, burndown, velocity)
- Open risks + escalations
- Recent approvals awaiting decision
- Cost summary per project
- Roadmap progress (which PRDs are in flight)

**Permissions (default):**
- `seeds:view`
- Read access to most Centers

**Default landing:** `/dashboard` (PM Dashboard)

**Key surfaces:**
- Dashboard (Bento with PM-relevant KPIs)
- Stories (kanban — what engineers are working on)
- Ideation (PRDs in flight)
- Architecture (decisions awaiting approval)

---

### Persona 2: Eng Lead (Engineering Lead)

**Job-to-be-done:** "Help me plan sprints, balance capacity, ship quality code, and unblock my team."

**Goals:**
- Plan + track sprint velocity
- Identify bottlenecks (slow reviews, stale PRs, blocked workflows)
- Ensure quality gates are met (validator, code review)
- Manage team capacity and on-call

**Dashboard (Eng Lead Dashboard):**
- Sprint burndown + velocity
- Active workflows + their state
- Code review queue (stale PRs)
- Validator findings (critical / high)
- Team activity feed

**Permissions:**
- `seeds:view`
- `seeds:manage` (dev convenience)
- Read + write access to most Centers
- Workflow management

**Default landing:** `/stories` (kanban — sprint board)

**Key surfaces:**
- Stories (sprint planning + execution)
- Workflows (active runs)
- Runs (workflow execution history)
- Validator (quality gate status)
- Connector Center (manage team integrations)
- Seeds (apply + reset dev data)

---

### Persona 3: Steward (Standards & Governance Owner)

**Job-to-be-done:** "Help me maintain org standards, enforce compliance, govern LLM spend, and protect the tenant from drift."

**Goals:**
- Curate Org Knowledge (standards, templates, policies)
- Enforce compliance (SOC2, ISO 27001, GDPR)
- Govern LLM usage + cost
- Manage virtual keys + RBAC scopes
- Detect drift (seed checksums, schema drift)

**Dashboard (Steward Dashboard):**
- Tenant health (drift indicators)
- LLM cost + burn rate
- Compliance feed (F-829i guardrail firings)
- Recent audit events (suspicious activity)
- Org Knowledge coverage (% of repos with standards applied)

**Permissions:**
- `seeds:view` + `seeds:manage` + `seeds:reset:all`
- All governance permissions
- Admin Hub access (virtual key lifecycle)
- Audit log access

**Default landing:** `/admin` (Admin Hub)

**Key surfaces:**
- Admin Hub (LLM Gateway, virtual keys)
- Audit (forensic timeline)
- Governance (policies + guardrails)
- Seed Management (drift detection)
- Settings (org-wide config)
- Analytics (cost + burn rate)

---

### Persona 4: CTO (Chief Technology Officer)

**Job-to-be-done:** "Help me see the org-wide picture — strategic direction, portfolio health, cost trajectory, and architectural coherence."

**Goals:**
- Portfolio health (project status across all projects)
- Strategic direction (architecture coherence, standards coverage)
- Cost trajectory (org-wide LLM spend vs. budget)
- Risk surface (high-severity findings, stale PRs)

**Dashboard (CTO Dashboard):**
- Org portfolio (project health grid)
- Cost trend (org-wide, 30/60/90 day)
- Architecture coverage (which projects have current ADRs)
- Top risks (severity-sorted)
- Strategic metrics (velocity, adoption, ROI)

**Permissions:**
- All permissions (full read + write)
- Tenant admin (virtual keys, RBAC, billing)
- Cross-project visibility

**Default landing:** `/dashboard` (CTO Dashboard)

**Key surfaces:**
- All Centers (full access)
- Admin Hub (tenant-level settings)
- Audit (org-wide forensic view)
- Analytics (org-wide cost + adoption)
- Architecture Center (org-wide ADR coverage)

---

## Permission matrix

### Read access

| Center | PM | Eng Lead | Steward | CTO |
|---|:-:|:-:|:-:|:-:|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Stories | ✅ | ✅ | ✅ | ✅ |
| Workflows | ✅ | ✅ | ✅ | ✅ |
| Runs | ✅ | ✅ | ✅ | ✅ |
| Knowledge Center | ✅ | ✅ | ✅ | ✅ |
| Ideation | ✅ | ✅ | ✅ | ✅ |
| Architecture | ✅ | ✅ | ✅ | ✅ |
| Connector Center | ✅ | ✅ | ✅ | ✅ |
| Validator | ✅ | ✅ | ✅ | ✅ |
| Analytics | ✅ (project) | ✅ (project) | ✅ (tenant) | ✅ (org) |
| Audit | ✅ (own actions) | ✅ (team) | ✅ (tenant) | ✅ (org) |
| Governance | — | ✅ | ✅ | ✅ |
| Settings | — | ✅ (project) | ✅ (tenant) | ✅ (org) |
| Terminal | ✅ | ✅ | ✅ | ✅ |
| Command Center | ✅ | ✅ | ✅ | ✅ |
| Admin Hub | — | — | ✅ | ✅ |
| Co-pilot | ✅ | ✅ | ✅ | ✅ |

### Write access

| Action | PM | Eng Lead | Steward | CTO |
|---|:-:|:-:|:-:|:-:|
| Apply seed (demo_only) | — | ✅ | ✅ | ✅ |
| Apply seed (all) | — | — | ✅ | ✅ |
| Reset seed (demo_only) | — | ✅ | ✅ | ✅ |
| Reset seed (all) | — | — | ✅ | ✅ |
| Rollback seed | — | ✅ | ✅ | ✅ |
| Create workflow | — | ✅ | ✅ | ✅ |
| Pause / resume / cancel run | — | ✅ | ✅ | ✅ |
| Create connector | ✅ | ✅ | ✅ | ✅ |
| OAuth flow (per connector) | ✅ | ✅ | ✅ | ✅ |
| Rotate virtual key | — | — | ✅ | ✅ |
| Revoke virtual key | — | — | ✅ | ✅ |
| Decide approval | — | — | ✅ | ✅ |
| Update settings (org) | — | — | ✅ | ✅ |
| Update settings (project) | — | ✅ | ✅ | ✅ |
| Trigger Co-pilot tool | ✅ | ✅ | ✅ | ✅ |

---

## Persona switching

### Frontend (Zustand store)

```typescript
// apps/forge/lib/personas/store.ts
import { create } from 'zustand';

export type Persona = 'pm' | 'eng-lead' | 'steward' | 'cto';

interface PersonaState {
  persona: Persona;
  setPersona: (p: Persona) => void;
}

export const usePersonaStore = create<PersonaState>((set) => ({
  persona: 'eng-lead',
  setPersona: (persona) => {
    // 30-day cookie, SameSite=Lax, propagated by proxy
    document.cookie = `forge.persona=${persona}; path=/; max-age=${
      60 * 60 * 24 * 30
    }; SameSite=Lax`;
    set({ persona });
  },
}));
```

### Proxy header propagation

```python
# proxy middleware (Next.js or reverse proxy)
@app.middleware("http")
async def propagate_persona(request, call_next):
    persona = request.cookies.get("forge.persona") or "eng-lead"
    request.headers["X-Forge-Persona"] = persona
    response = await call_next(request)
    return response
```

### Backend read

```python
# backend/app/api/deps.py
async def get_current_persona(principal: Principal) -> str:
    return principal.headers.get("X-Forge-Persona", "eng-lead")
```

**Persona is for UI context (which dashboard, which sidebar items, which CTAs).** Real authorization is still RBAC scopes checked at the route level (R5).

---

## 6 memory keys (per persona)

Personas store user-context in 6 keys for fast personalization:

| Key | Lifetime | Purpose |
|---|---|---|
| `forge.persona` | 30 days | Active persona |
| `forge.tenant` | session | Active tenant slug (from JWT) |
| `forge.dashboard.layout` | 90 days | Bento layout per persona |
| `forge.command.recent` | 30 days | Recently used forge commands |
| `forge.sidebar.collapsed` | persistent | Sidebar collapsed/expanded |
| `forge.theme` | persistent | Dark/light theme preference |

**Storage:** `localStorage` for client-side prefs; cookies for cross-cutting (persona, tenant).

---

## Persona dashboards (3 distinct views)

### PM Dashboard

**Layout:** Bento grid with PM-relevant widgets
- Top: 4 KPI cards (Active Projects / Open Risks / Awaiting Approvals / Sprint Velocity)
- Middle: Burndown + Recent Activity
- Bottom: Cost per project + Roadmap progress

**Sources:** All Centers filtered by `owner = current actor + collaborators`.

### Eng Lead Dashboard

**Layout:** Operational focus
- Top: 4 KPI cards (Active Runs / Velocity / Validator Findings / Stale PRs)
- Middle: Active workflows + Code review queue
- Bottom: Team activity + Capacity

**Sources:** Stories, Workflows, Validator, Runs.

### Steward Dashboard

**Layout:** Compliance + governance focus
- Top: 4 KPI cards (Tenant Health / Drift Detected / Cost MTD / Compliance Score)
- Middle: Compliance feed + Recent audit events
- Bottom: Org knowledge coverage + LLM burn rate

**Sources:** Audit, Governance, Settings, Analytics, Seed Management.

### CTO Dashboard

**Layout:** Org-wide portfolio
- Top: 4 KPI cards (Projects Health / Cost Trend / Architecture Coverage / Top Risks)
- Middle: Portfolio grid + Cost trajectory
- Bottom: Adoption metrics + Strategic roadmap

**Sources:** All Centers, filtered by org-wide visibility.

---

## Persona-aware UX rules

### Hide vs. disable

For actions the persona CAN'T perform:

```tsx
// ❌ Show disabled button (visual clutter)
{!hasPermission('seeds:manage') && (
  <Button disabled>Apply seed</Button>
)}

// ✅ Hide entirely (cleaner)
{hasPermission('seeds:manage') && (
  <Button>Apply seed</Button>
)}
```

### Show only relevant nav items

The sidebar adapts to persona. PMs don't see `Admin Hub`; Stewards see all.

```tsx
const NAV_ITEMS_BY_PERSONA: Record<Persona, NavItem[]> = {
  pm: ['dashboard', 'stories', 'ideation', 'architecture', 'copilot'],
  'eng-lead': [...pm, 'workflows', 'runs', 'validator', 'connectors', 'seeds', 'command'],
  steward: [...'eng-lead', 'governance', 'audit', 'analytics', 'admin'],
  cto: [...'steward'], // full access
};
```

### Default landing pages

```typescript
const PERSONA_DEFAULT_LANDING: Record<Persona, string> = {
  pm: '/dashboard',         // PM dashboard
  'eng-lead': '/stories',  // Sprint board
  steward: '/admin',        // Admin Hub (their home)
  cto: '/dashboard',        // CTO dashboard
};
```

---

## Persona onboarding

### First-time login flow

1. **Keycloak login** → JWT with `forge.tenant` claim
2. **Default persona** → from `forge.persona` cookie or "eng-lead"
3. **Welcome banner** (Plan G) → if demo tenant, show `<DemoBanner>`
4. **Default landing** → per persona mapping above
5. **Persona switcher** → accessible from top-right avatar menu

### Persona switch UX

```tsx
<DropdownMenu>
  <DropdownMenuTrigger>
    <Avatar>{currentPersona.avatar}</Avatar>
    <ChevronDown />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    {PERSONAS.map((p) => (
      <DropdownMenuItem key={p.id} onClick={() => switchPersona(p.id)}>
        <Avatar>{p.avatar}</Avatar>
        <div>
          <p>{p.label}</p>
          <p>{p.subtitle}</p>
        </div>
        {p.id === currentPersona && <Check />}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Common anti-patterns

### ❌ Treating persona as auth

```python
# ❌ Wrong: persona-based authz (skips real RBAC)
if request.headers.get("X-Forge-Persona") == "steward":
    allow_sensitive_action()  # Bypasses real RBAC

# ✅ Correct: persona for UI, RBAC for security
if has_permission(principal, "seeds:manage"):
    allow_sensitive_action()
```

### ❌ Hardcoding persona defaults

```typescript
// ❌ Wrong: hardcoded for eng-lead
const defaultDashboard = 'eng-lead-dashboard';

// ✅ Correct: from cookie / persona store
const defaultDashboard = `${persona}-dashboard`;
```

### ❌ Showing nav items the persona can't use

```tsx
// ❌ Wrong: shows everything
<NavList items={ALL_NAV_ITEMS} />

// ✅ Correct: filtered by persona + permissions
<NavList items={NAV_ITEMS_BY_PERSONA[persona].filter(hasPermission)} />
```

---

## Future personas

Not yet shipped, but on the roadmap:

| Persona | Job | ETA |
|---|---|---|
| **Security** | SOC2 compliance + threat modeling | Q3 2026 |
| **Customer** | Customer-facing demo / sandbox | Q4 2026 |
| **VP Eng** | Portfolio strategy + hiring | Q1 2027 |

For these, the persona infrastructure (cookie + header + Zustand store + dashboard shell) is already in place — only the dashboard content + permission set needs to be added.

---

## Where to go next

- [Features: Personas & Dashboards](../features/personas-dashboards.md) — Implementation details
- [Vision](./vision.md) — Mission + the 8 rules
- [Standards: Architecture rules](../standards/architecture-rules.md) — R5 (Layer isolation) + R6 (Auditability)
- [Features: Auth](../features/auth.md) — How OIDC + JWT carry persona claims
- [Features: Workspaces](../features/workspaces.md) — Tenant vs Persona distinction
- [Features: Admin Hub](../features/admin-hub.md) — Steward's home

---

**Personas are the lens through which every UI surface is built. If you're shipping a new feature, ask: "Which personas see this? What changes for each?"**