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
  component: ADRComponentId | null;
  impact: number | null;
  authorInitials: string;
  linkedTaskCount: number;
  linkedRiskCount: number;
  linkedApiCount: number;
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
      return ((parts[0] as string)[0] + (parts[1] as string)[0]).toUpperCase();
    }
    return local.slice(0, 2).toUpperCase();
  }
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words[0] && words[1]) {
    return ((words[0] as string)[0] + (words[1] as string)[0]).toUpperCase();
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
  const impact = typeof adr.impact === "number" ? adr.impact : (adr.impact != null ? Number(adr.impact) : DEFAULT_IMPACT);
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

// ---------------------------------------------------------------------------
// Activity feed — Day 2 Track J.
//
// `ArchitectureActivity` is consumed by the Overview tab's Activity feed.
// Source data is the Forge audit log (GET /audit), exposed via
// `useAuditEvents` (Day 2 mocks-removal Track J). The adapter projects
// the verbose audit-row shape onto the tab's narrow UI contract.
// ---------------------------------------------------------------------------

/**
 * Subset of `AuditEventEntry` (from `useLiteLLM.ts`) we need for the
 * adapter. Declared locally so the adapter file has no upward
 * dependency on the hooks layer.
 */
export interface AuditEventLike {
  readonly id: string;
  readonly timestamp?: string;
  readonly occurred_at?: string;
  readonly actor_id?: string | null;
  readonly action: string;
  readonly target_type?: string | null;
  readonly target_id?: string | null;
}

/** Closed set of verbs the Architecture feed recognises. */
type ActivityType = 'adr' | 'api' | 'task' | 'risk' | 'version' | 'diagram';

/** Map known audit `target_type` strings onto the closed activity union. */
const TYPE_MAP: Record<string, ActivityType> = {
  adr: 'adr',
  api: 'api',
  api_contract: 'api',
  task: 'task',
  task_breakdown: 'task',
  risk: 'risk',
  risk_register: 'risk',
  version: 'version',
  architecture_version: 'version',
  diagram: 'diagram',
  architecture_diagram: 'diagram',
};

/** Map known last-segment action verbs to a human past tense. */
const VERB_MAP: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  remove: 'removed',
  approve: 'approved',
  deny: 'denied',
  reject: 'rejected',
  submit: 'submitted',
  complete: 'completed',
  finish: 'finished',
  cancel: 'cancelled',
  publish: 'published',
  unpublish: 'unpublished',
  archive: 'archived',
  restore: 'restored',
  list: 'listed',
  read: 'read',
  query: 'queried',
  serve: 'served',
  supersede: 'superseded',
  rollback: 'rolled back',
  attest: 'attested',
  revoke: 'revoked',
  decide: 'decided',
  request: 'requested',
  generate: 'generated',
  sync: 'synced',
  start: 'started',
  open: 'opened',
  close: 'closed',
  mitigate: 'mitigated',
  promote: 'promoted',
  link: 'linked',
  unlink: 'unlinked',
  snapshot: 'snapshotted',
  invalidate: 'invalidated',
  rotate: 'rotated',
  register: 'registered',
  unregister: 'unregistered',
};

/**
 * Derive a human-readable past-tense verb from an audit `action`
 * (e.g. `architecture.adr.create` → `created`). Falls back to
 * `{verb}ed` when the last segment is a regular verb not in the map.
 */
export function deriveActivityVerb(action: string): string {
  const last = action.split('.').pop() ?? action;
  if (VERB_MAP[last]) return VERB_MAP[last];
  if (last.endsWith('e')) return `${last}d`;
  if (last.endsWith('y') && !/[aeiou]y$/.test(last)) return `${last.slice(0, -1)}ied`;
  return `${last}ed`;
}

/**
 * Project the last segment of a dotted action into the Architecture
 * feed's closed type union. Falls back to `'adr'` when the
 * `target_type` is unknown — the feed prefers a defined type over a
 * runtime string.
 */
export function inferActivityType(
  targetType: string | null | undefined,
): ActivityType {
  if (!targetType) return 'adr';
  const key = targetType.toLowerCase();
  return TYPE_MAP[key] ?? 'adr';
}

/**
 * Project an audit row onto the Architecture Center's Activity shape.
 * Pure function; no I/O, no React.
 *
 *   id      ← auditEvent.id
 *   type    ← mapped from target_type (see `inferActivityType`)
 *   verb    ← past-tense from action (see `deriveActivityVerb`)
 *   subject ← target_id (the page already cross-references ids)
 *   actor   ← actor_id (UUID; display name is a Day 3 concern)
 *   at      ← timestamp / occurred_at (whichever the wire carries)
 */
export function toArchitectureActivity(
  auditEvent: AuditEventLike,
): import('./mock-fixtures').ArchitectureActivity {
  return {
    id: auditEvent.id,
    type: inferActivityType(auditEvent.target_type),
    verb: deriveActivityVerb(auditEvent.action),
    subject: auditEvent.target_id ?? '',
    actor: auditEvent.actor_id ?? 'unknown',
    at: auditEvent.timestamp ?? auditEvent.occurred_at ?? '',
  };
}

// Re-export tab-level types that still live in `mock-fixtures` so the page
// has one canonical adapter import path.
export type { ApiService, ArchitectureActivity } from './mock-fixtures';
