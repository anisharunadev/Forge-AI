/**
 * Knowledge Center RBAC + persona gate (FORA-502.2).
 *
 * Per Plan 1 §3.3 the Knowledge Center has "no privileged read" — the
 * Knowledge Layer is the source of truth, every agent and every
 * persona can browse. v1.0 GA keeps the read posture simple: every
 * persona gets the browser; the PM persona gets a softer "what this
 * is" intro line because the PM is more likely to land here for the
 * first time and need the framing.
 *
 * v1.1 (Plan 1 §5.1) adds the glossary-PR affordance behind the
 * `evaluateBoardAccess` token gate (mirrors FORA-507 / Governance
 * Center). v1.0 ships no edit affordances — see the FORA-502.1
 * renderers which surface a `data-edit-affordance` of `none`.
 */
import type { Persona } from "../types";

export type KnowledgeCenterPersona = Persona;

const PERSONA_LABEL: Record<KnowledgeCenterPersona, string> = {
  pm: "Product Manager",
  "eng-lead": "Engineering Lead",
  steward: "Steward",
  cto: "CTO",
};

/**
 * Every persona can browse the Knowledge Center (Plan 1 §3.3 — "Any
 * agent or human. There is no privileged read; the Knowledge Layer
 * is the source of truth"). The gate stays explicit so a future v1.1
 * affordance (glossary PR) can flip a persona off without an audit
 * trail rewrite.
 */
export function canAccessKnowledgeCenter(
  _persona: KnowledgeCenterPersona,
): boolean {
  return true;
}

/**
 * The PM persona gets a softer intro line — the PM is the most likely
 * first-time visitor. CTO / Eng Lead skip the intro and go straight
 * to the file tree. The renderer reads the boolean, not the persona,
 * so a future copy edit doesn't need a code change.
 */
export function isFirstTimeVisitor(persona: KnowledgeCenterPersona): boolean {
  return persona === "pm";
}

export function knowledgeCenterPersonaLabel(
  persona: KnowledgeCenterPersona,
): string {
  return PERSONA_LABEL[persona];
}
