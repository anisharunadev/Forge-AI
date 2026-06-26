/**
 * Governance Center — Enterprise AI control plane (Step 35 rebuild).
 *
 * 8 tabs: Overview / Policies / Guardrails / Standards / LLM Control /
 * Board / RBAC / Audit. Mocked LiteLLM integration; mock policy test
 * playground. All data is client-side (governance-v2 fixtures).
 *
 * Reconciles with:
 *   - Rule 1 (model-provider agnostic) — LiteLLM abstraction shown
 *   - Rule 2 (multi-tenant by default) — tenant_id / project_id on every audit entry
 *   - Rule 3 (human approval gates) — Board tab + Convene board
 *   - Rule 4 (typed artifacts) — Policies, Standards, Audit all typed
 *   - Rule 6 (auditability) — full audit log + decision detail drawer
 *   - Rule 8 (configurable everything) — provider/model/route swaps
 *
 * Server boundary: thin. The shell is a client component that renders
 * 8 tabs from local fixtures; the previous Board token lookup is kept
 * to preserve the existing persona → token shape.
 */

import { cookies } from 'next/headers';

import { readPersonaFromCookieHeader } from '@/lib/auth';
import { readBoardTokenForPersona } from '@/lib/governance/data';

import { GovernanceCenterShell } from '@/components/governance-v2/governance-center-shell';

export const dynamic = 'force-dynamic';

type Persona = 'pm' | 'eng-lead' | 'cto' | 'vp-eng' | 'security' | 'customer';

const PERSONA_LABEL: Record<Persona, string> = {
  pm: 'Product Manager',
  'eng-lead': 'Engineering Lead',
  cto: 'CTO',
  'vp-eng': 'VP Engineering',
  security: 'Security',
  customer: 'Customer',
};

export default async function GovernanceCenterPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const persona: Persona = readPersonaFromCookieHeader(cookieHeader) as Persona;
  const boardToken = readBoardTokenForPersona(persona);
  const boardTokenPresent = Boolean(boardToken);

  return (
    <GovernanceCenterShell
      persona={PERSONA_LABEL[persona]}
      boardTokenPresent={boardTokenPresent}
    />
  );
}