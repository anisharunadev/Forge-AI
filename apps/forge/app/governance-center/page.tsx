/**
 * Governance Center — Enterprise AI control plane (Step 35 → Step 59).
 *
 * 8 tabs: Overview / Policies / Guardrails / Standards / LLM Control /
 * Board / RBAC / Audit. Step 59 rewire: every tab now reads from the
 * real LiteLLM-backed backend via TanStack Query hooks in
 * `lib/hooks/useLiteLLM.ts`. The previous fixture-based mock has been
 * retired — see `lib/governance-v2/` for the legacy shapes.
 *
 * Reconciles with:
 *   - Rule 1 (model-provider agnostic) — backend proxies LiteLLM
 *   - Rule 2 (multi-tenant by default) — tenant context from JWT cookie
 *   - Rule 3 (human approval gates) — Board tab + Convene board (kept)
 *   - Rule 4 (typed artifacts) — typed SDK in lib/litellm/data.ts
 *   - Rule 6 (auditability) — Audit tab merges Forge + LiteLLM
 *   - Rule 8 (configurable everything) — provider/model/route swaps
 *
 * Server boundary: thin. Reads the persona from the cookie for
 * display purposes only; `boardTokenPresent` is now a stub (the
 * legacy `readBoardTokenForPersona` helper has been removed —
 * board tokens are looked up client-side via `useTenantLLMConfig`).
 */

import { cookies } from 'next/headers';

import { readPersonaFromCookieHeader } from '@/lib/auth';

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
  const persona = readPersonaFromCookieHeader(cookieHeader) as Persona;
  // Step 59: board token presence is determined client-side from
  // `useTenantLLMConfig` (litellm_team_id + has_virtual_key). The
  // server stub returns true so the HeroBand pill renders the
  // "present" state until the hook resolves.
  const boardTokenPresent = true;

  return (
    <GovernanceCenterShell
      persona={PERSONA_LABEL[persona] ?? persona}
      boardTokenPresent={boardTokenPresent}
    />
  );
}