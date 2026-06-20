/**
 * Typed-artifact generation rule engine + RBAC gating — FORA-484 AC #4.
 *
 * Per Plan 3 §7: every event_type maps to zero or more typed artifacts
 * (Requirement, ADR, Deployment Plan, Code Patch, Test/Security Report,
 * Task Breakdown). The rule engine resolves the mapping, the RBAC layer
 * gates emission by role.
 *
 * RBAC table (from FORA-484 scope):
 *   Requirement        — ba-agent, architect, developer
 *   ADR                — architect
 *   Deployment Plan    — architect, deploy-agent
 *   Code Patch         — architect, developer, senior-engineer
 *   Test Report        — qa, developer, security-engineer
 *   Security Report    — security-engineer, qa
 *   Task Breakdown     — ba-agent, architect
 *
 * Default-deny: an event_type that produces a typed-artifact but the
 * actor's role isn't in the allowed list emits an `outcome: 'denied'`
 * audit event with `reason_code: 'rbac_denied'`, no artifact materialises.
 *
 * Every successful emission also emits a corresponding audit event with
 * `artifacts_emitted: [<artifact_id>]` populated, per Plan 3 §7 last
 * paragraph.
 */

import type { ConnectorEvent } from './envelope.js';

/** The typed-artifact registry. Closed-world; add a new entry on schema bump. */
export const ARTIFACT_TYPES = [
  'requirement',
  'adr',
  'deployment_plan',
  'code_patch',
  'test_report',
  'security_report',
  'task_breakdown',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Roles eligible to emit each artifact type. */
export const ARTIFACT_ROLE_REGISTRY: Readonly<Record<ArtifactType, readonly string[]>> = Object.freeze({
  requirement: ['ba-agent', 'architect', 'developer'],
  adr: ['architect'],
  deployment_plan: ['architect', 'deploy-agent'],
  code_patch: ['architect', 'developer', 'senior-engineer'],
  test_report: ['qa', 'developer', 'security-engineer'],
  security_report: ['security-engineer', 'qa'],
  // A merged PR (github.pr.merged) is the source-of-truth trigger for advancing
  // the task breakdown. The merging party (dev / senior-engineer) and the
  // human-side owners (ba-agent / architect) all may emit. This mirrors the
  // Plan 3 §7 spec and the github.ts family catalog note.
  task_breakdown: ['ba-agent', 'architect', 'developer', 'senior-engineer'],
});

/** One rule: which event_types produce this artifact, and any guard conditions. */
export interface ArtifactRule {
  artifact_type: ArtifactType;
  /** Event types that may emit this artifact. */
  trigger_event_types: readonly string[];
  /** Roles that may emit. Looked up in `ARTIFACT_ROLE_REGISTRY`. */
  allowed_roles: readonly string[];
  /** Free-form note for the audit reader. */
  description: string;
}

/**
 * Plan 3 §7 — event_type → artifact_type mapping. RBAC is consulted at
 * emit time, not here. The mapping is the static rule table; gating is
 * `assertRoleMayEmit`.
 */
export const ARTIFACT_RULES: readonly ArtifactRule[] = Object.freeze([
  {
    artifact_type: 'requirement',
    trigger_event_types: ['jira.issue.ingested', 'teams.transcript.received', 'confluence.page.observed'],
    allowed_roles: ARTIFACT_ROLE_REGISTRY.requirement,
    description: 'A Requirement is born when an external source produces a structured ask.',
  },
  {
    artifact_type: 'adr',
    trigger_event_types: ['confluence.page.published'],
    allowed_roles: ARTIFACT_ROLE_REGISTRY.adr,
    description: 'ADRs are published to Confluence by the Architect role only.',
  },
  {
    artifact_type: 'deployment_plan',
    trigger_event_types: ['confluence.page.published'],
    allowed_roles: ARTIFACT_ROLE_REGISTRY.deployment_plan,
    description: 'Deployment Plans are published by Architect or DeployAgent.',
  },
  {
    artifact_type: 'code_patch',
    trigger_event_types: ['github.pr.opened', 'github.pr.merged'],
    allowed_roles: ARTIFACT_ROLE_REGISTRY.code_patch,
    description: 'Code Patches are emitted on PR open/merge; only Architect/Dev/Senior Engineer.',
  },
  {
    artifact_type: 'test_report',
    trigger_event_types: ['github.action.run.completed'],
    allowed_roles: ARTIFACT_ROLE_REGISTRY.test_report,
    description: 'Test Reports ride the GitHub Actions completed webhook.',
  },
  {
    artifact_type: 'security_report',
    trigger_event_types: ['github.action.run.completed'],
    allowed_roles: ARTIFACT_ROLE_REGISTRY.security_report,
    description: 'Security Reports ride the GitHub Actions completed webhook for security jobs.',
  },
  {
    artifact_type: 'task_breakdown',
    trigger_event_types: ['github.pr.merged'],
    allowed_roles: ARTIFACT_ROLE_REGISTRY.task_breakdown,
    description: 'A merged PR advances the Task Breakdown.',
  },
]);

/** Lookup the artifact_types an event_type may produce, in registration order. */
export function rulesForEventType(event_type: string): readonly ArtifactRule[] {
  return ARTIFACT_RULES.filter((r) => r.trigger_event_types.includes(event_type));
}

/** Lookup the event_types an artifact_type may be emitted from. */
export function rulesForArtifactType(artifact_type: ArtifactType): readonly ArtifactRule[] {
  return ARTIFACT_RULES.filter((r) => r.artifact_type === artifact_type);
}

export class RbacDeniedError extends Error {
  constructor(public readonly artifact_type: ArtifactType, public readonly actor_role: string) {
    super(
      `RBAC denied: role '${actor_role}' may not emit artifact_type '${artifact_type}'. ` +
        `Allowed roles: ${ARTIFACT_ROLE_REGISTRY[artifact_type].join(', ')}.`,
    );
    this.name = 'RbacDeniedError';
  }
}

/**
 * True iff `actor_role` is in the allowed list for `artifact_type`.
 * Default-deny: an unknown role or an unmapped artifact_type both return false.
 */
export function mayEmit(artifact_type: ArtifactType, actor_role: string): boolean {
  const allowed = ARTIFACT_ROLE_REGISTRY[artifact_type];
  if (!allowed) return false;
  return allowed.includes(actor_role);
}

/** Throw `RbacDeniedError` when the actor role may not emit. */
export function assertRoleMayEmit(artifact_type: ArtifactType, actor_role: string): void {
  if (!mayEmit(artifact_type, actor_role)) {
    throw new RbacDeniedError(artifact_type, actor_role);
  }
}

/** Mint a fresh artifact id: `art-<uuid16>`. */
export function makeArtifactId(): string {
  const hex = Math.random().toString(16).slice(2, 18).padEnd(16, '0');
  return `art-${hex}`;
}

/**
 * Resolve `event_type` → list of artifact_type → list of (artifact_id, artifact_type)
 * the actor may emit, gated by RBAC. Returns an empty list when no rules match
 * OR when every match is denied.
 */
export interface ResolvedArtifact {
  artifact_id: string;
  artifact_type: ArtifactType;
}

export function resolveArtifacts(
  event_type: string,
  actor_role: string,
): ResolvedArtifact[] {
  const rules = rulesForEventType(event_type);
  const out: ResolvedArtifact[] = [];
  for (const rule of rules) {
    if (mayEmit(rule.artifact_type, actor_role)) {
      out.push({ artifact_id: makeArtifactId(), artifact_type: rule.artifact_type });
    }
  }
  return out;
}

/**
 * Compute the `artifacts_emitted` payload for a connector event. This is
 * the bridge between the rule engine and the envelope.
 *
 * Returns the artifact ids the actor may emit. Callers wire these into
 * `artifacts_emitted` on the emitted audit event so the audit chain
 * carries the artifact lineage.
 */
export function artifactsFor(input: {
  event_type: string;
  actor_role: string;
}): string[] {
  return resolveArtifacts(input.event_type, input.actor_role).map((a) => a.artifact_id);
}

/**
 * Helper: build the audit event for the typed-artifact emission.
 * The caller emits this through the same store pipeline so the audit
 * chain carries the artifact lineage end-to-end.
 */
export function buildArtifactAuditEvent(input: {
  base_event: ConnectorEvent;
  artifact_id: string;
  artifact_type: ArtifactType;
}): Pick<ConnectorEvent, 'artifacts_emitted'> {
  // Sanity-check: refuse to fabricate an emission the actor couldn't have made.
  assertRoleMayEmit(input.artifact_type, input.base_event.actor.role ?? '');
  return { artifacts_emitted: [input.artifact_id] };
}