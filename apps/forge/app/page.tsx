/**
 * `/` — first-run entry point (Plan G commit 1).
 *
 * Replaces the previous hard redirect to `/dashboard` with a small
 * first-run check:
 *
 *   - If no `forge.persona` cookie is present (a brand-new browser
 *     that has never loaded Forge), redirect to `/welcome`.
 *   - Otherwise, the user is on a known session and we send them
 *     straight to `/dashboard`.
 *
 * The persona cookie is set when the user first picks a persona on
 * `/persona`. The cookie name matches `lib/auth.ts:PERSONA_COOKIE_NAME`
 * (`'forge.persona'`). The redirect logic intentionally does NOT
 * depend on the acme-corp seed being applied — the demo banner
 * (Plan G commit 2/3) handles the in-tenant visibility of seed
 * state. `/welcome` itself is the only place that gates on
 * first-run UX (Load Demo vs Start Empty).
 */

import { redirect } from 'next/navigation';

import { PERSONA_COOKIE_NAME } from '@/lib/auth';
import { cookies } from 'next/headers';

export default async function HomePage(): Promise<never> {
  const cookieStore = await cookies();
  const persona = cookieStore.get(PERSONA_COOKIE_NAME)?.value;
  redirect(persona ? '/dashboard' : '/welcome');
}