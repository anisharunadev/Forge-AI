/**
 * Architecture data adapters (Day 1 mock-removal Track F).
 *
 * Pure functions that project backend API shapes into the richer UI shapes
 * the Architecture Center consumes. `ADRWithMeta` extends `ADR` with
 * metadata the API doesn't return directly (`component`, `impact`,
 * `authorInitials`, `linkedTaskCount`, `linkedRiskCount`, `linkedApiCount`,
 * `owner`, `markdown`, `updatedAt`). Health is computed from real arrays.
 *
 * No React imports — adapters stay pure, hooks live elsewhere.
 */

import type { ADR, APIContract, RiskRegister, TaskBreakdown } from './types';

// ADRComponent['id'] union duplicated here so adapters don't depend on
// mock-fixtures at runtime (mock-fixtures still exports the source list).
export type ADRComponentId =
  | 'backend'
  | 'frontend'
  | 'infra'
  | 'data'
  | 'mobile'
  | 'ai';

const DEFAULT_COMPONENT: ADRComponentId = 'backend';
const DEFAULT_IMPACT = 5;
const DEFAULT_OWNER = 'arun@acme-corp.com';

export interface ADRWithMeta extends ADR {
  component: ADRComponentId;
  impact: number;
  authorInitials: string;
  linkedTaskCount: number;
  linkedRiskCount: number;
  linkedApiCount: number;
  owner: string;
  markdown: string;
  updatedAt: string;
}

/** Minimal link counts shape — matches Track C's `ADRLinks` fields. */
export interface ADRLinkCounts {
  task_breakdown_count?: number | null;
  risk_count?: number | null;
  api_contract_count?: number | null;
}

/** Derive 2-letter author initials from an email or display name. */
export function deriveAuthorInitials(value: string | null | undefined): string {
  if (!value) return 'XX';
  if (value.includes('@')) {
    const local = value.split('@')[0] ?? '';
    const parts = local.split(/[._-]/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return local.slice(0, 2).toUpperCase();
  }
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0] && words[1]) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return value.slice(0, 2).toUpperCase();
}

/** Project an `ADR` (API row) into the richer `ADRWithMeta` UI shape. */
export function toADRWithMeta(
  adr: ADR,
  links?: ADRLinkCounts | null,
): ADRWithMeta {
  const component: ADRComponentId =
    (adr.component as ADRComponentId | null | undefined) ?? DEFAULT_COMPONENT;
  const impact = adr.impact ?? DEFAULT_IMPACT;
  const initialsSource = adr.approved_by ?? adr.reviewed_by ?? adr.generated_by ?? null;
  return {
    ...adr,
    component,
    impact,
    authorInitials: deriveAuthorInitials(initialsSource),
    linkedTaskCount: links?.task_breakdown_count ?? 0,
    linkedRiskCount: links?.risk_count ?? 0,
    linkedApiCount: links?.api_contract_count ?? 0,
    owner: DEFAULT_OWNER,
    markdown: '',
    updatedAt: adr.updated_at ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Health snapshot — mirrors `mock-fixtures.computeHealth` shape so the page
// can switch from a module-level mock-driven constant to a memoised,
// live-data-driven computation without touching the consumers.
// ---------------------------------------------------------------------------

export interface HealthSnapshot {
  overall: number;
  adrs: number;
  apis: number;
  tasks: number;
  risks: number;
  coverage: number;
}

const ZERO_HEALTH: HealthSnapshot = {
  overall: 0,
  adrs: 0,
  apis: 0,
  tasks: 0,
  risks: 0,
  coverage: 0,
};

function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 100);
}

/** Compute health percentages from real API arrays. */
export function computeHealthFromArrays(
  adrs: ReadonlyArray<ADRWithMeta>,
  contracts: ReadonlyArray<APIContract>,
  breakdowns: ReadonlyArray<TaskBreakdown>,
  registers: ReadonlyArray<RiskRegister>,
  traceability: { nodes: ReadonlyArray<unknown>; edges: ReadonlyArray<unknown> },
): HealthSnapshot {
  const approvedAdrs = adrs.filter((a) => a.status === 'approved').length;
  const publishedContracts = contracts.filter((c) => c.status === 'published').length;

  const allTasks = breakdowns.flatMap((b) => b.tasks);
  const doneTasks = allTasks.filter(
    (t) => t.status === 'completed' || t.status === 'done',
  ).length;

  const allRisks = registers.flatMap((r) => r.risks);
  const openRisks = allRisks.filter((r) => r.status !== 'closed').length;

  const adrs_pct = pct(approvedAdrs, adrs.length);
  const apis_pct = pct(publishedContracts, contracts.length);
  const tasks_pct = pct(doneTasks, allTasks.length);
  const risks_pct = pct(allRisks.length - openRisks, allRisks.length);
  const coverage = pct(traceability.edges.length, traceability.nodes.length * 1.5);

  if (
    !adrs.length &&
    !contracts.length &&
    !allTasks.length &&
    !allRisks.length &&
    !traceability.nodes.length
  ) {
    return ZERO_HEALTH;
  }

  const overall = Math.round((adrs_pct + apis_pct + tasks_pct + risks_pct + coverage) / 5);
  return { overall, adrs: adrs_pct, apis: apis_pct, tasks: tasks_pct, risks: risks_pct, coverage };
}

// Re-export tab-level types that still live in `mock-fixtures` so the page
// has one canonical adapter import path.
export type { ApiService, ArchitectureActivity } from './mock-fixtures';
