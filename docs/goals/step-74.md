# Step 74 — Phase 13 Onboarding: Real Provisioning

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~1 week
> **Phase:** 13 — Onboarding (currently `Planned` in `built-features.yaml`)
> **Goal:** Replace `setInterval` fake provisioning with real backend progress; ship real `WizardSession` API; flip `Planned` → `Production`

## /goal

Current `built-features.yaml`:

```yaml
- area: Integration
  order: 52
  feature: "Phase 13 — Onboarding (10-step wizard — 4 wired + 6 pending)"
  steps: ["61"]
  status: Planned                       # ← flip to Production
  docs: lifecycle/onboarding
```

The **honest** state (verified this session):

| Layer | State |
|---|---|
| **Backend: 4 routes** in `backend/app/api/v1/onboarding.py` (`POST /sessions`, `GET /sessions/{id}`, `POST /sessions/{id}/advance`, `POST /sessions/{id}/cancel`) | ✅ Built |
| **Backend: `OnboardingWizard`** service in `backend/app/services/project_onboarding/wizard.py` with `STEP_ORDER` constant | ✅ Built (per `test_onboarding_wizard.py`) |
| **Backend test** `test_onboarding_wizard.py` covers start, advance, cancel, persistence | ✅ Built |
| **Frontend: 10 wizard step components** in `apps/forge/components/onboarding/` (`StepWelcome`, `StepTenantSetup`, `StepConnectProviders`, `StepConnectRepos`, `StepDetectStack`, `StepConfigureAgents`, `StepProvision`, `StepRunFirstIntel`, `StepGovernance`, `StepReview`) | ✅ Built |
| **Frontend: `WizardShell` + `WizardProgress`** | ✅ Built |
| **Frontend: `StepProvision`** uses `window.setInterval` to fake 5 stages (`manifest`, `graph`, `connectors`, `audit`, `ready`) at 600ms each | 🔴 **FAKE** — the visual ticking is independent of any backend progress |
| **Frontend: backend wiring for the wizard state machine** | ⚠️ 4 of 10 steps wired (`StepWelcome`, `StepTenantSetup`, `StepReview`, `StepRunFirstIntel`); 6 are static |
| **`useWizardSession()` hook** | 🔴 Missing — the wizard state is local-only |

**Goal:** ship `useWizardSession()` hook module that polls the backend; replace `StepProvision`'s `setInterval` with real progress events; wire the 6 remaining step components; flip `Planned` → `Production`.

## What you'll see after this step

- Onboarding wizard at `/onboarding` reflects real backend session state
- `StepProvision` shows progress that matches what the orchestrator is actually doing (not faked)
- If provisioning fails, the UI shows the real error
- Refreshing mid-wizard restores the session from backend (resumability)
- `pytest tests/test_onboarding_wizard.py -v` still passes
- `built-features.yaml` reads `Production` on row 52

## What you'll NOT see

- **No new wizard steps** (10 is the locked count)
- **No branching paths** (linear wizard only)
- **No "skip step" UI** (linear advance only)
- **No backend changes** (the service is complete)

## Files to read FIRST

1. `backend/app/api/v1/onboarding.py` — 4 routes
2. `backend/app/services/project_onboarding/wizard.py` — `OnboardingWizard`, `STEP_ORDER`, `WizardError`
3. `backend/tests/test_onboarding_wizard.py` — current test coverage
4. `apps/forge/components/onboarding/StepProvision.tsx` — the `setInterval` fake
5. `apps/forge/components/onboarding/WizardShell.tsx` — top-level orchestrator
6. `apps/forge/components/onboarding/WizardProgress.tsx` — progress bar
7. `apps/forge/components/onboarding/StepWelcome.tsx` — wired (reference)
8. `apps/forge/components/onboarding/StepTenantSetup.tsx` — wired (reference)
9. `apps/forge/components/onboarding/StepReview.tsx` — wired (reference)
10. `/workspace/prompts/step61-onboarding-real.md` — what Step 61 already shipped
11. `/workspace/docs/features/onboarding.md` — feature doc

## ZONE 1 — `lib/api/onboarding.ts` (types + query keys)

```typescript
export type WizardStepId =
  | 'welcome'
  | 'tenant-setup'
  | 'connect-providers'
  | 'connect-repos'
  | 'detect-stack'
  | 'configure-agents'
  | 'governance'
  | 'provision'
  | 'run-first-intel'
  | 'review';

export type WizardStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface WizardSession {
  id: string;
  status: WizardStatus;
  current_step: WizardStepId;
  completed_steps: WizardStepId[];
  tenant_id: string;
  project_id: string | null;
  started_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  // Per-step payloads (collected during the wizard)
  data: {
    tenant?: { name: string; slug: string };
    providers?: { provider_id: string; api_key_fingerprint: string }[];
    repos?: { url: string; default_branch: string }[];
    detected_stack?: { language: string; framework: string };
    agents?: { name: string; role: string }[];
    governance?: { accepted_policies: string[]; board_confirmed: boolean };
    provision?: {
      status: 'pending' | 'running' | 'succeeded' | 'failed';
      stages: { id: string; status: 'pending' | 'running' | 'succeeded' | 'failed'; ts?: string }[];
      error?: string;
    };
    first_run?: { idea_id: string; status: string };
  };
}

export const queryKeys = {
  onboarding: {
    session: (id: string) => ['onboarding', 'session', id] as const,
    active: () => ['onboarding', 'active-session'] as const,
  },
};
```

## ZONE 2 — `lib/api/onboarding-hooks.ts`

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys, type WizardSession, type WizardStepId } from './onboarding';

// Start (creates new session)
export function useStartWizard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<WizardSession>('/onboarding/sessions', {}),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.onboarding.session(session.id), session);
      qc.setQueryData(queryKeys.onboarding.active(), session);
    },
  });
}

// Read session (with optional polling)
export function useWizardSession(
  sessionId: string | null,
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: queryKeys.onboarding.session(sessionId ?? ''),
    queryFn: () => api.get<WizardSession>(`/onboarding/sessions/${sessionId}`),
    enabled: Boolean(sessionId),
    refetchInterval: options?.refetchInterval ?? false,
  });
}

// Advance to next step (sends the data payload for the current step)
export function useAdvanceWizard(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      step: WizardStepId;
      data: Record<string, unknown>;
    }) =>
      api.post<WizardSession>(
        `/onboarding/sessions/${sessionId}/advance`,
        payload,
      ),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.onboarding.session(sessionId), session);
    },
  });
}

// Cancel
export function useCancelWizard(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<WizardSession>(`/onboarding/sessions/${sessionId}/cancel`, {}),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.onboarding.session(sessionId), session);
    },
  });
}

// Helper: poll while in 'provision' step
export function useProvisionProgress(sessionId: string) {
  return useWizardSession(sessionId, {
    refetchInterval: (query) => {
      const status = query.state.data?.data?.provision?.status;
      if (status === 'running' || status === 'pending') return 2000;
      return false;
    },
  });
}
```

## ZONE 3 — Replace `StepProvision.tsx` fake progress

**Before:**

```typescript
React.useEffect(() => {
  setCompleted(0);
  let idx = 0;
  const id = window.setInterval(() => {
    idx += 1;
    setCompleted(Math.min(STAGES.length, idx));
    if (idx >= STAGES.length) {
      window.clearInterval(id);
    }
  }, STAGE_DELAY_MS);
  return () => window.clearInterval(id);
}, [state]);
```

**After:**

```typescript
import { useProvisionProgress } from '@/lib/api/onboarding-hooks';

const { data: session } = useProvisionProgress(sessionId);
const stages = session?.data?.provision?.stages ?? [];
const completed = stages.filter(s => s.status === 'succeeded').length;
const failed = stages.find(s => s.status === 'failed');

// Render: each stage from backend has {id, status, ts}
// - succeeded: green check
// - running: spinner
// - failed: red X with error message
// - pending: gray dash
```

The component becomes **purely a view** over backend state. No `setInterval`. No fake delays.

## ZONE 4 — Wire 6 remaining step components

For each of: `StepConnectProviders`, `StepConnectRepos`, `StepDetectStack`, `StepConfigureAgents`, `StepGovernance`, `StepProvision`:

```typescript
// At the top of each step component
const advance = useAdvanceWizard(sessionId);

const handleNext = async () => {
  await advance.mutateAsync({
    step: STEP_ID,
    data: { /* step-specific data */ },
  });
};
```

Replace any `setLocalState(...)` calls that simulate completion with `advance.mutateAsync(...)`.

## ZONE 5 — `WizardShell` orchestrator

In `apps/forge/components/onboarding/WizardShell.tsx`:

```typescript
const startWizard = useStartWizard();
const { data: session } = useWizardSession(
  sessionId ?? (await startWizard.mutateAsync()).id,
  { refetchInterval: 5_000 },
);

// Navigate based on session.current_step
React.useEffect(() => {
  if (session?.status === 'COMPLETED') {
    router.push('/forge-ideation');
  }
}, [session?.status]);
```

If the user refreshes mid-wizard, the session is restored from backend; they resume at `current_step`.

## ZONE 6 — Tests + YAML

### `apps/forge/__tests__/onboarding-hooks.test.tsx`

Vitest for the hooks module — MSW mocks `/onboarding/sessions/{id}` with a session that progresses through stages.

### `apps/forge/__tests__/step-provision-real.test.tsx`

Vitest that verifies `StepProvision` no longer calls `window.setInterval` and renders backend-supplied stage states.

### `built-features.yaml` flip

```yaml
- area: Integration
  order: 52
  feature: "Phase 13 — Onboarding (10-step wizard — 4 wired + 6 pending)"
  steps: ["61", "74"]
  status: Production
  docs: lifecycle/onboarding
```

## CONSTRAINTS

- **No backend changes.** The wizard service is complete.
- **No new wizard steps.** 10 is the locked count.
- **Tenant scoping (Rule 2)** — every hook URL passes through `api`.
- **Don't change the wizard visual layout.** Adapter at the page level.
- **No fake timers.** Real progress only.
- **Audit emission** — `wizard.advance`, `wizard.complete`, `wizard.cancel` (already in backend).

## DELIVERABLE

Modified:
- [ ] `apps/forge/lib/api/onboarding.ts` (NEW) — types + query keys
- [ ] `apps/forge/lib/api/onboarding-hooks.ts` (NEW) — 4 hooks
- [ ] `apps/forge/components/onboarding/StepProvision.tsx` — replaced with real backend-driven view
- [ ] 6 step components wired (`StepConnectProviders`, `StepConnectRepos`, `StepDetectStack`, `StepConfigureAgents`, `StepGovernance`, `StepProvision`)
- [ ] `apps/forge/components/onboarding/WizardShell.tsx` — orchestrator wired to hooks
- [ ] `built-features.yaml` — Planned → Production

Created:
- [ ] `apps/forge/__tests__/onboarding-hooks.test.tsx` (NEW)
- [ ] `apps/forge/__tests__/step-provision-real.test.tsx` (NEW)

Verify:
- [ ] `pytest tests/test_onboarding_wizard.py -v` — still passes
- [ ] `npx vitest run __tests__/onboarding-hooks` — passes
- [ ] `npx vitest run __tests__/step-provision-real` — passes
- [ ] `npx tsc --noEmit` — 0 new errors
- [ ] End-to-end: open `/onboarding`, walk through 10 steps, verify state persists across refresh

## "What we deliberately did NOT do"

- **Did not add new wizard steps** (10 is the locked count)
- **Did not add branching paths** (linear wizard only)
- **Did not add "skip step" UI** (linear advance only)
- **Did not change the backend** (service is complete)
- **Did not change the wizard visual layout** (adapter at the page level)

---

**Total scope:** ~1 week for 1 engineer. ~600 lines frontend + ~200 lines tests + 50 lines YAML.

Tell me to ship it. Or name a zone to inspect first.