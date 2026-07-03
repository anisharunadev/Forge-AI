# Step 72 — Phase 11 Governance + Audit: Hook Module

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~1 week
> **Phase:** 11 — Governance + Audit (currently `Planned` in `built-features.yaml`); Centers rows 21 + 22 currently `Beta`
> **Goal:** Ship a single `useGovernance()` hook module that consolidates the 9 scattered frontend calls; flip all 3 rows to `Production`

## /goal

Current `built-features.yaml`:

```yaml
- area: Lifecycle
  order: 21
  feature: Governance
  steps: ["35"]
  status: Beta                          # ← flip to Production
  docs: lifecycle/governance

- area: Lifecycle
  order: 22
  feature: Audit
  steps: ["17", "6"]
  status: Beta                          # ← flip to Production
  docs: lifecycle/audit

- area: Integration
  order: 50
  feature: "Phase 11 — Governance + Audit"
  steps: []
  status: Planned                       # ← flip to Production
  docs: lifecycle/governance
```

The **honest** state (verified this session):

| Layer | State |
|---|---|
| **Backend: 4 routes** in `backend/app/api/v1/governance_violations.py` (`GET /violations`, `POST /violations/{id}/resolve`, `POST /violations/{id}/reopen`, `POST /violations/poll`) | ✅ Built |
| **Backend: 1 route** in `backend/app/api/v1/audit.py` (`GET ""` — list audit page) | ✅ Built |
| **Backend: 6 routes** in `orchestrator-stub.py` for `/v1/governance/{policies, approvals, rbac-roles, board-confirmations}` | ⚠️ Stub only (orchestrator-stub is dev-only) |
| **Backend: real governance routes** (policies, approvals, rbac-roles, board-confirmations) | 🔴 **Missing**. The 9 scattered frontend calls all hit the orchestrator-stub |
| **Frontend: `apps/forge/app/governance/`** — pages exist (`compliance`, etc.) | ✅ Built |
| **Frontend: `apps/forge/app/governance-center/page.tsx`** — uses `readBoardTokenForPersona` from `lib/governance/data` | ✅ Built |
| **Frontend: 11 components** in `apps/forge/components/governance/` (`ApprovalCard`, `ConfirmationHistory`, `KpiTileRow`, `PoliciesTable`, `RbacRolesList`, `ViolationCard`, etc.) | ✅ Built |
| **Frontend: 9 scattered calls** to `/api/proxy/v1/governance/*` (policies, approvals, rbac-roles, board-confirmations, etc.) — all going to orchestrator-stub | ⚠️ Real path is missing; calls hit a stub |
| **Frontend: TanStack hooks** for governance | 🔴 **Missing** — components import types from `lib/governance/data` but no hook module exists |

**Goal:** ship `useGovernance()` hook module + 4 backend routes (`policies`, `approvals`, `rbac-roles`, `board-confirmations`) that the stub currently serves; consolidate the 9 scattered calls into typed hooks; flip 3 rows to `Production`.

## What you'll see after this step

- Open `/governance-center` → loads real policies, real approvals, real RBAC roles, real board confirmations
- Open `/governance/compliance` → loads real violation list from `GET /api/v1/governance/violations`
- Open `/audit` → audit page renders real `AuditPage` from `GET /api/v1/audit`
- Resolving a violation → POST `/violations/{id}/resolve` → list refreshes
- `pytest tests/api/ -k "governance\|audit"` — passes
- `built-features.yaml` reads `Production` on rows 21, 22, 50

## What you'll NOT see

- **No real-time violation push.** The `/violations/poll` endpoint exists; we don't add a frontend subscription (use polling 60s).
- **No migration from orchestrator-stub.** The stub stays for dev; production calls go to real backend.
- **No policy authoring UI.** View-only.
- **No RBAC role editor.** View-only.

## Files to read FIRST

1. `backend/app/api/v1/governance_violations.py` — 4 routes
2. `backend/app/api/v1/audit.py` — 1 route
3. `backend/bin/orchestrator-stub.py` lines 599-708 — see the stub responses for policies/approvals/rbac-roles/board-confirmations
4. `apps/forge/lib/governance/data.ts` — current `readBoardTokenForPersona` and types
5. `apps/forge/components/governance/ApprovalCard.tsx` — see how `ApprovalRequest` is used
6. `apps/forge/components/governance/ConfirmationHistory.tsx` — `BoardConfirmation`
7. `apps/forge/components/governance/PoliciesTable.tsx` — `Policy`
8. `apps/forge/components/governance/RbacRolesList.tsx` — `RbacRole`
9. `apps/forge/app/api/proxy/[...path]/route.ts` lines 8-9 — proxy to orchestrator-stub
10. `/workspace/docs/features/governance.md` and `/workspace/docs/features/audit.md`

## ZONE 1 — Backend: 4 governance routes

Create `backend/app/api/v1/governance_core.py` (or extend the existing `governance_violations.py`):

```python
"""Governance core routes (F-829i compliance, RBAC, approvals).

Surface:
  GET    /api/v1/governance/policies
  POST   /api/v1/governance/policies/{id}/accept      (audit event)
  GET    /api/v1/governance/approvals
  POST   /api/v1/governance/approvals/{id}/accept
  POST   /api/v1/governance/approvals/{id}/decline
  GET    /api/v1/governance/rbac-roles
  GET    /api/v1/governance/board-confirmations
  POST   /api/v1/governance/board-confirmations       (board ack)

Pattern: tenant-scoped via Principal; permission-gated via
require_permission("governance:read" | "governance:manage"); audit
emitted on every mutating action.
"""

# (Implementation pattern follows admin_llm_gateway.py — the closest
# precedent for tenant-scoped CRUD routes.)
```

## ZONE 2 — `lib/api/governance.ts` (types + query keys)

Create the typed client + query keys:

```typescript
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export interface ApprovalRequest {
  id: string;
  kind: 'policy' | 'connector' | 'agent' | 'budget' | 'deployment';
  target_id: string;
  requested_by: string;
  status: ApprovalStatus;
  label: string;
  reason?: string;
  created_at: string;
  decided_at?: string;
}

export type PolicySeverity = 'low' | 'medium' | 'high' | 'critical';
export interface Policy {
  id: string;
  name: string;
  category: 'security' | 'compliance' | 'cost' | 'privacy';
  severity: PolicySeverity;
  description: string;
  enabled: boolean;
  accepted_at?: string;
  accepted_by?: string;
}

export interface RbacRole {
  id: string;
  name: string;
  permissions: string[];
  member_count: number;
  builtin: boolean;
}

export interface BoardConfirmation {
  id: string;
  topic: string;
  summary: string;
  board_members: string[];
  confirmed_at?: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  tenant_id: string;
  project_id: string;
  metadata: Record<string, unknown>;
}

export interface AuditPage {
  items: AuditEvent[];
  total: number;
  page: number;
  page_size: number;
}

export interface Violation {
  id: string;
  policy_id: string;
  detected_at: string;
  severity: PolicySeverity;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'REOPENED';
  resolved_by?: string;
  resolved_at?: string;
}

export const queryKeys = {
  governance: {
    all: ['governance'] as const,
    policies: () => [...queryKeys.governance.all, 'policies'] as const,
    approvals: () => [...queryKeys.governance.all, 'approvals'] as const,
    rbacRoles: () => [...queryKeys.governance.all, 'rbac-roles'] as const,
    boardConfirmations: () =>
      [...queryKeys.governance.all, 'board-confirmations'] as const,
    violations: () => [...queryKeys.governance.all, 'violations'] as const,
    audit: (page: number) =>
      [...queryKeys.governance.all, 'audit', page] as const,
  },
};
```

## ZONE 3 — `lib/api/governance-hooks.ts` (TanStack hooks)

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  queryKeys,
  type ApprovalRequest, type Policy, type RbacRole,
  type BoardConfirmation, type AuditPage, type Violation,
} from './governance';

// Policies (1 read + 1 mutation)
export function usePolicies() { /* GET /governance/policies */ }
export function useAcceptPolicy() { /* POST /governance/policies/{id}/accept */ }

// Approvals (1 read + 2 mutations)
export function useApprovals() { /* GET /governance/approvals */ }
export function useAcceptApproval() { /* POST /governance/approvals/{id}/accept */ }
export function useDeclineApproval() { /* POST /governance/approvals/{id}/decline */ }

// RBAC roles (1 read)
export function useRbacRoles() { /* GET /governance/rbac-roles */ }

// Board confirmations (1 read + 1 mutation)
export function useBoardConfirmations() { /* GET */ }
export function useConfirmBoard() { /* POST */ }

// Violations (1 read + 3 mutations)
export function useViolations() { /* GET /governance/violations */ }
export function useResolveViolation() { /* POST /violations/{id}/resolve */ }
export function useReopenViolation() { /* POST /violations/{id}/reopen */ }
export function usePollViolations() { /* POST /violations/poll */ }

// Audit (1 read, paginated)
export function useAuditPage(page: number = 0) { /* GET /audit?page=N */ }
```

Total: **12 hooks** across 8 backend routes.

## ZONE 4 — Wire governance-center + governance/compliance

In `apps/forge/app/governance-center/page.tsx`:

Replace `readBoardTokenForPersona` calls with `useBoardConfirmations()`. Replace inline `fetch('/api/proxy/v1/governance/...')` with the typed hooks.

In `apps/forge/app/governance/compliance/page.tsx`:

Replace fixture data with `useViolations()`. The `ViolationCard` component already takes the right shape; just pass real data.

## ZONE 5 — Wire `/audit` page

In `apps/forge/app/audit/page.tsx` (or wherever):

```typescript
const PAGE_SIZE = 50;
const [page, setPage] = React.useState(0);
const { data: auditPage } = useAuditPage(page);
// Render auditPage.items in a table; pagination controls
```

## ZONE 6 — Tests + YAML

### `backend/tests/api/v1/test_governance.py`

Tests for the 4 new routes + the existing 4 violation routes + 1 audit route = **9 tests**.

### `backend/tests/api/v1/test_audit.py`

Tests for the audit listing (pagination, tenant isolation, RBAC).

### `apps/forge/__tests__/governance-hooks.test.tsx`

Vitest for the hook module — MSW mocks.

### `built-features.yaml` flip (3 rows)

```yaml
- area: Lifecycle
  order: 21
  feature: Governance
  steps: ["35", "72"]
  status: Production
  docs: lifecycle/governance

- area: Lifecycle
  order: 22
  feature: Audit
  steps: ["17", "6", "72"]
  status: Production
  docs: lifecycle/audit

- area: Integration
  order: 50
  feature: "Phase 11 — Governance + Audit"
  steps: ["72"]
  status: Production
  docs: lifecycle/governance
```

## CONSTRAINTS

- **No schema migration** to existing tables. New tables for policies/RBAC are okay.
- **Tenant scoping (Rule 2)** — every query carries tenant_id.
- **Audit emission** — every mutation emits a `governance.*` audit event (Rule 6).
- **Permission gates** — `useAcceptApproval`, `useResolveViolation`, etc. require `governance:manage`; queries require `governance:read`.
- **Don't change the stub.** It still serves dev; production goes to the real backend.
- **Don't change the 11 existing components** — adapter at the page level.

## DELIVERABLE

Modified:
- [ ] `backend/app/api/v1/governance_core.py` (NEW) — 4 routes
- [ ] `apps/forge/lib/api/governance.ts` (NEW) — types + query keys
- [ ] `apps/forge/lib/api/governance-hooks.ts` (NEW) — 12 hooks
- [ ] `apps/forge/app/governance-center/page.tsx` — wired to hooks
- [ ] `apps/forge/app/governance/compliance/page.tsx` — wired to hooks
- [ ] `apps/forge/app/audit/page.tsx` — wired to audit hook
- [ ] `built-features.yaml` — flip 3 rows to Production

Created:
- [ ] `backend/tests/api/v1/test_governance.py` (NEW)
- [ ] `backend/tests/api/v1/test_audit.py` (NEW)
- [ ] `apps/forge/__tests__/governance-hooks.test.tsx` (NEW)

Verify:
- [ ] `pytest tests/api/v1/test_governance.py -v` — passes
- [ ] `pytest tests/api/v1/test_audit.py -v` — passes
- [ ] `npx vitest run __tests__/governance-hooks` — passes
- [ ] `npx tsc --noEmit` — 0 new errors
- [ ] End-to-end: open `/governance-center`, `/governance/compliance`, `/audit`; verify real data

## "What we deliberately did NOT do"

- **Did not add real-time violation push** (polling 60s is enough)
- **Did not migrate from orchestrator-stub** (it stays for dev)
- **Did not add policy authoring UI** (view-only)
- **Did not add RBAC role editor** (view-only)
- **Did not change the 11 existing components**

---

**Total scope:** ~1 week for 1 engineer. ~700 lines backend + ~600 lines frontend + ~250 lines tests + 50 lines YAML.

Tell me to ship it. Or name a zone to inspect first.