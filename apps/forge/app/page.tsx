/**
 * `/` — workflow-first home page (M16, Sprint 1 revised).
 *
 * Previous behavior:
 *   - first-run browsers redirected to `/welcome`
 *   - authenticated browsers redirected to `/dashboard`
 *
 * New behavior:
 *   - first-run browsers still redirect to `/welcome` (preserves the
 *     existing onboarding funnel)
 *   - authenticated browsers land on the workflow home (`/workflow`)
 *     instead of the legacy grid dashboard
 *
 * Why? The audit repeatedly identified the nine-center grid as the
 * reason new users could not orient themselves. The workflow shell
 * collapses nine entry points into one spine + a single "Continue"
 * CTA. Power users can still reach `/dashboard` via the sidebar
 * (we do not delete it; we de-emphasize it).
 */

import { redirect } from 'next/navigation';

import { PERSONA_COOKIE_NAME } from '@/lib/auth';
import { cookies } from 'next/headers';

export default async function HomePage(): Promise<never> {
  const cookieStore = await cookies();
  const persona = cookieStore.get(PERSONA_COOKIE_NAME)?.value;
  redirect(persona ? '/workflow' : '/welcome');
}