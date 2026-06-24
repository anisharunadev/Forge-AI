/**
 * Type contracts for the Forge console.
 *
 * These mirror `the FastAPI backend/src/types.ts` but are kept independent
 * so the console can be built, type-checked, and shipped without a
 * cross-package workspace dep. Field names track the orchestrator JSON
 * envelope exactly (snake_case); keep them in sync if the upstream
 * types change.
 */

export type RunId = string;
export type TenantId = string;

/** The seven canonical stages from FORA-50 §3.2. */
export const STAGES_IN_ORDER = [
  'ideation',
  'architect',
  'dev',
  'qa',
  'security',
  'devops',
  'docs',
] as const;

export type Stage = (typeof STAGES_IN_ORDER)[number];

/** Run status (FORA-50 §2.2). */
export type RunStatus =
  | 'created'
  | 'running'
  | 'waiting_approval'
  | 'paused'
  | 'aborted'
  | 'finished'
  | 'done';

/** Stage status (FORA-50 §3.2). */
export type StageStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'skipped';

/** Lifecycle verb the Orchestrator exposes. */
export type LifecycleVerb = 'pause' | 'resume' | 'cancel';

export interface RunRecord {
  id: RunId;
  tenant_id: TenantId;
  goal_id: string;
  project_id: string;
  status: RunStatus;
  current_stage: Stage | 'done';
  triggered_by: {
    type: 'manual' | 'slack' | 'email' | 'schedule' | 'api';
    actor: string;
    payload_ref?: string;
  };
  cost_ceiling_usd: string;
  cost_spent_usd: string;
  started_at: string | null;
  finished_at: string | null;
  deleted_at: string | null;
  archived_at: string | null;
}

export interface StageRecord {
  id: string;
  run_id: RunId;
  stage: Stage;
  status: StageStatus;
  decision: {
    by: string;
    at: string;
    reason?: string;
    artefact_refs?: ReadonlyArray<{ kind: string; url: string; sha256?: string }>;
  } | null;
  started_at: string | null;
  finished_at: string | null;
}

/** API error envelope from the orchestrator (FORA-50 §4.1). */
export interface OrchestratorError {
  code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'IDEMPOTENCY_CONFLICT' | 'VALIDATION' | 'INTERNAL';
  message: string;
  request_id: string;
}

/** The persona a human is currently "logged in" as. */
export type Persona = 'pm' | 'eng-lead' | 'cto';

export interface PersonaMeta {
  id: Persona;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
}

export const PERSONAS: ReadonlyArray<PersonaMeta> = [
  {
    id: 'pm',
    label: 'Product Manager',
    shortLabel: 'PM',
    description: 'PRDs, roadmap, capacity. Read-only over orchestrator + memory layer.',
    href: '/personas/pm',
  },
  {
    id: 'eng-lead',
    label: 'Engineering Lead',
    shortLabel: 'Eng Lead',
    description: 'Runs in flight, blocked work, cost. Read + approve (pause/resume/cancel).',
    href: '/personas/eng-lead',
  },
  {
    id: 'cto',
    label: 'CTO / VP Eng',
    shortLabel: 'CTO',
    description: 'Throughput, MTTR, audit log, cost by team. Read-only.',
    href: '/personas/cto',
  },
];

/**
 * UI view-model for the demo seed (Plan F / Plan G).
 *
 * Derived from `SeedStatusRead` by the Plan F hook suite; the shape
 * is kept here so `DemoBanner` and any per-Center demo-state surface
 * (Plan G commit 4) can import it without pulling the full seeds
 * data seam.
 */
export interface DemoSeedStatus {
  isDemoTenant: boolean;
  seedName: string;
  applied: boolean;
  rowCount: number;
  checksumStatus: 'match' | 'drift' | 'unknown';
  lastRunAt: string | null;
}