/**
 * RBAC for the Project Intelligence center (FORA-501 §3.4).
 *
 * Project Intelligence is the PM-facing typed-artifact browser. PM is
 * the primary persona (full read). CTO gets an "audit" read-only view
 * (the same surface, but with edit affordances stripped). Eng Lead is
 * allowed because the secondary user of the center is BA + Eng Lead
 * (they triage the open questions and the "Stories in QA" / "Stories
 * in DevOps" tabs).
 *
 * Per Plan 1 §3.4 the secondary owner is BA. BA is not yet hired, so
 * the RBAC table names the persona by role; when BA is hired we add a
 * `ba` persona and the gate keeps working.
 *
 * The empty-state for a blocked persona tells the human who to ask.
 */

export type ProjectIntelligencePersona = "pm" | "eng-lead" | "steward" | "cto";

/**
 * Personas that can view Project Intelligence read-write. Today this is
 * PM only; the center does not edit PRD or Stories in v1.0. CTO can
 * "view as audit" (read-only), and Eng Lead can view to triage.
 */
const VIEW_WRITE: ReadonlyArray<ProjectIntelligencePersona> = ["pm"];

/**
 * Personas that can view Project Intelligence in any capacity
 * (read-write or read-only audit). CTO is allowed as audit-only via
 * `isAuditPersona`. Eng Lead is allowed for triage.
 */
const VIEW_ANY: ReadonlyArray<ProjectIntelligencePersona> = [
  "pm",
  "eng-lead",
  "cto",
];

export function canAccessProjectIntelligence(
  persona: ProjectIntelligencePersona,
): boolean {
  return VIEW_ANY.includes(persona);
}

/**
 * Whether the persona sees the audit (read-only) chrome vs the
 * primary (read-write) chrome. PM is primary; everyone else is audit.
 */
export function isAuditPersona(
  persona: ProjectIntelligencePersona,
): boolean {
  return !VIEW_WRITE.includes(persona);
}

/**
 * The persona to escalate to when a blocked persona (none today, but
 * the function is in place for when we add BA / QA / DevOps personas
 * that may not have access). For v1.0 the answer is always PM.
 */
export function escalationPersona(
  _persona: ProjectIntelligencePersona,
): ProjectIntelligencePersona {
  return "pm";
}

/**
 * Human-readable role label for the escalation persona. Surfaced in
 * the empty-state copy when access is denied.
 */
export function escalationPersonaLabel(
  persona: ProjectIntelligencePersona,
): string {
  return PERSONA_LABEL[escalationPersona(persona)];
}

const PERSONA_LABEL: Record<ProjectIntelligencePersona, string> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  steward: "Steward",
  cto: "CTO",
};