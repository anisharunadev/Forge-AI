/**
 * Single-tenant auth stub (dev-only persona switcher).
 *
 * FORA-123 (identity-broker + OIDC) owns production auth; this stub
 * exists so the dashboard renders without a real auth flow during the
 * dev quickstart. The seeded tenant is `acme-corp`; the persona is
 * selected via a `?persona=` query param on the home page and stored
 * in a cookie for the rest of the session.
 *
 * Production migration: replace `getPersonaFromRequest` with a real
 * broker JWT claim read, and `PERSONAS` in `lib/types.ts` becomes a
 * role-mapping table instead of a user-facing switcher.
 *
 * M1 T1.7 — dev-only gate
 * ------------------------
 * Track B closed M1 G4 with `apps/forge/middleware.ts` (OIDC gate).
 * With a real Keycloak-backed session present, the persona cookie is
 * redundant — the orchestrator derives persona from the JWT's role
 * claims. To prevent this stub from leaking into production
 * deployments, all of the cookie-reading helpers below short-circuit
 * to the dev default when `NODE_ENV !== 'development'`. The persona
 * switcher UI in `/persona` continues to write the cookie; the
 * helper simply ignores it outside of dev.
 *
 * Public callers that want to gate themselves can read
 * `isPersonaStubActive()`. Test code that needs to exercise the
 * stub path should set `process.env.NODE_ENV = 'development'`
 * (or pass an env override via Jest setup) so the gate opens.
 */

import type { Persona } from './types';
import { PERSONAS } from './types';

export const SEED_TENANT_ID = process.env.FORA_SEED_TENANT_ID ?? 'acme-corp';
export const SEED_TENANT_NAME =
  process.env.FORA_SEED_TENANT_NAME ?? 'Acme Corp (Dev Demo)';

/**
 * Demo-tenant slug for the `acme-corp` seed (Plan F / Plan G).
 *
 * Plan F's `lib/seeds/data.ts` and the Plan G `DemoBanner` use this
 * to decide when to surface the demo-only sticky alert. Matches the
 * `name` field in `backend/seeds/packages/acme-corp/manifest.json`
 * (Plan E) and the slug pinned in `backend/app/services/day_one_bootstrap.py`.
 */
export const SEED_TENANT_SLUG = 'acme-corp';

export const PERSONA_COOKIE_NAME = 'forge.persona';
const COOKIE_NAME = PERSONA_COOKIE_NAME;

/**
 * Dev-only gate. Returns `true` when the persona-cookie stub is
 * permitted to influence auth-related decisions. See the file
 * header for context. Public so callers can branch on it
 * explicitly (e.g. when wiring a "persona" link into a production
 * shell — the link should hide itself when this returns false).
 */
export function isPersonaStubActive(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && PERSONAS.some((p) => p.id === value);
}

export function defaultPersona(): Persona {
  return 'eng-lead';
}

/**
 * Read the persona from a `Cookie` header value (server side) or
 * the current document cookie (client side). Returns the default
 * when the cookie is missing, invalid, OR when the dev stub is
 * inactive (NODE_ENV !== 'development'). The stub gate is what
 * closes M1 G4 — in production we never let an unsigned cookie
 * influence persona selection because the orchestrator already
 * derives persona from the JWT's role claim.
 */
export function readPersonaFromCookieHeader(
  cookieHeader: string | null,
): Persona {
  if (!isPersonaStubActive()) return defaultPersona();
  if (!cookieHeader) return defaultPersona();
  const match = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (!match) return defaultPersona();
  try {
    const value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
    return isPersona(value) ? value : defaultPersona();
  } catch {
    return defaultPersona();
  }
}

export function personaCookie(value: Persona): string {
  // 30-day cookie; the stub does not expire on its own.
  const maxAge = 60 * 60 * 24 * 30;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Permission stub — Plan H (`/admin/seeds`).
//
// The production identity broker (FORA-123) owns real RBAC. Until
// that lands, derive a coarse permission set from the dev persona
// so the admin surfaces can gate their UI. Every persona gets
// `seeds:view`; `steward` (and `eng-lead` / `cto` for dev
// convenience) get `seeds:manage`.
//
// Callers SHOULD treat the return value as best-effort: the
// backend is still the source of truth (Plan C raises 403 for
// missing permissions even if the UI thought the persona was
// allowed). When the dev stub is inactive
// (`isPersonaStubActive() === false`) the permission map still
// returns the same shape — the dev personas are still *known* —
// but `hasPermission()` returns `false` so a cookie-driven
// permission check never authorizes a non-dev request.
// ---------------------------------------------------------------------------

export type Permission = 'seeds:view' | 'seeds:manage';

const PERSONA_PERMISSIONS: Record<Persona, ReadonlySet<Permission>> = {
  pm: new Set<Permission>(['seeds:view']),
  'eng-lead': new Set<Permission>(['seeds:view', 'seeds:manage']),
  steward: new Set<Permission>(['seeds:view', 'seeds:manage']),
  cto: new Set<Permission>(['seeds:view', 'seeds:manage']),
};

/**
 * Resolve the permission set for a persona.
 *
 * Pure over a constant table — always returns the same shape
 * regardless of NODE_ENV, so existing callers don't break. New
 * callers that want to depend on persona-driven permissions in
 * production should branch on `isPersonaStubActive()` first.
 */
export function permissionsForPersona(
  persona: Persona,
): ReadonlySet<Permission> {
  return PERSONA_PERMISSIONS[persona];
}

/**
 * Permission check used by `/admin/*` server components.
 *
 * Reads the persona cookie via Next 15's async `cookies()` API
 * and tests whether it carries `perm`. Returns `false` if the
 * cookie is missing, invalid, OR if the dev stub is inactive —
 * fail-closed so unauthenticated callers are redirected, never
 * granted.
 *
 * The `next/headers` import is dynamic so this module stays
 * importable in non-Next contexts (vitest, scripts). The dynamic
 * import resolves to the same module instance Next.js uses for
 * `cookies()`.
 *
 * @example
 *   if (!hasPermission('seeds:manage')) redirect('/admin');
 */
export async function hasPermission(perm: Permission): Promise<boolean> {
  if (!isPersonaStubActive()) return false;
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const persona = readPersonaFromCookieHeader(cookieHeader);
  return permissionsForPersona(persona).has(perm);
}
