/**
 * Onboarding wizard REST types — step-74.
 *
 * Typed mirror of the locked Pydantic schemas served by
 * `backend/app/api/v1/onboarding.py` and `backend/app/schemas/onboarding.py`.
 * The Pydantic schemas are the source of truth; if you change one side,
 * change the other.
 *
 * The backend `STEP_ORDER` in
 * `backend/app/services/project_onboarding/wizard.py` is the **only** legal
 * source for wizard step ids — there are exactly six:
 *
 *     tenant_setup, connect_repos, detect_stack, configure_agents,
 *     run_first_intel, review
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — every field that originates from
 *     tenant-scoped data carries `tenant_id` + `project_id`.
 *   - **Typed artifacts (Rule 4)** — no free-form blobs; every shape
 *     here is a structured payload the UI can render directly.
 *   - **R3 / R6** — wizard lifecycle transitions are server-emitted
 *     audit rows (`onboarding.start`, `onboarding.advance`, etc.);
 *     client never invents those.
 */

// ---------------------------------------------------------------------------
// Wizard session lifecycle (mirrors `OnboardingStatus` + `OnboardingStepStatus`
// in `backend/app/db/models/onboarding.py`)
// ---------------------------------------------------------------------------

/**
 * Snake-case wizard step ids — the locked set defined by
 * `STEP_ORDER` in `wizard.py`. The frontend's 10 UI components map to
 * these 6 steps; see `UI_TO_BACKEND_STEP` in
 * `app/project-onboarding/page.tsx`.
 */
export type WizardStepId =
  | 'tenant_setup'
  | 'connect_repos'
  | 'detect_stack'
  | 'configure_agents'
  | 'run_first_intel'
  | 'review';

export type WizardStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type OnboardingStepStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED';

// ---------------------------------------------------------------------------
// Per-step audit row
// ---------------------------------------------------------------------------

export interface OnboardingStep {
  id: string;
  /** Forward-compat: tolerate strings the backend adds later. */
  step_name: WizardStepId | string;
  step_order: number;
  status: OnboardingStepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Wizard session
// ---------------------------------------------------------------------------

export interface WizardSession {
  id: string;
  tenant_id: string;
  project_id: string;
  user_id: string;
  status: WizardStatus;
  /** Forward-compat: backend may add steps later. */
  current_step: WizardStepId | string;
  /** Collected per-step inputs, keyed by `step_name`. */
  state: Record<string, unknown>;
  completed_at: string | null;
  steps: OnboardingStep[];
}

// ---------------------------------------------------------------------------
// Provisioning job progress (`GET /onboarding/provision/status`)
// ---------------------------------------------------------------------------

export interface ProvisionProgress {
  job_id: string | null;
  status: 'idle' | 'running' | 'done' | 'failed';
  current_stage: string | null;
  completed_stages: string[];
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** Body of `POST /onboarding/provision`. */
export interface StartProvisionResponse {
  job_id: string;
  status: 'running';
}

// ---------------------------------------------------------------------------
// Advance payload (input to `useAdvanceWizard`)
// ---------------------------------------------------------------------------

export interface AdvanceWizardInput {
  step: WizardStepId | string;
  step_input: Record<string, unknown>;
  mark_complete?: boolean;
}

// ---------------------------------------------------------------------------
// Query keys (TanStack Query invalidation targets)
// ---------------------------------------------------------------------------

export const queryKeys = {
  onboarding: {
    all: ['onboarding'] as const,
    session: (id: string) => [...queryKeys.onboarding.all, 'session', id] as const,
    active: () => [...queryKeys.onboarding.all, 'active-session'] as const,
    provisionStatus: () =>
      [...queryKeys.onboarding.all, 'provision-status'] as const,
  },
};