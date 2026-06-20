/**
 * RBAC for the Connector Center (FORA-578 §5).
 *
 * Only Eng Lead and CTO personas can audit the connector list. PM is
 * intentionally blocked — the persona surfaces product requirements and
 * cannot rotate credentials or grant scopes. The empty-state on the list
 * page tells the PM who to ask.
 */

export type ConnectorCenterPersona = "pm" | "eng-lead" | "cto";

const ALLOWED: ReadonlyArray<ConnectorCenterPersona> = ["eng-lead", "cto"];

export function canAccessConnectorCenter(persona: ConnectorCenterPersona): boolean {
  return ALLOWED.includes(persona);
}

/**
 * The persona to display when the user is denied access — the one to
 * escalate to. Currently always the Eng Lead because the Eng Lead is
 * the on-call operator; CTO is read-only.
 */
export function escalationPersona(persona: ConnectorCenterPersona): ConnectorCenterPersona {
  return "eng-lead";
}

/**
 * The human-readable role label for the escalation persona, surfaced in
 * the PM empty-state copy. Given the current persona, returns the label
 * of the persona they should escalate to.
 */
export function escalationPersonaLabel(persona: ConnectorCenterPersona): string {
  return PERSONA_LABEL[escalationPersona(persona)];
}

const PERSONA_LABEL: Record<ConnectorCenterPersona, string> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  cto: "CTO",
};