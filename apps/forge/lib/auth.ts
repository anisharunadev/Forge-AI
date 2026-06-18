/**
 * Single-tenant auth stub.
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
 */

import type { Persona } from './types';
import { PERSONAS } from './types';

export const SEED_TENANT_ID = process.env.FORA_SEED_TENANT_ID ?? 'acme-corp';
export const SEED_TENANT_NAME =
  process.env.FORA_SEED_TENANT_NAME ?? 'Acme Corp (Dev Demo)';

const COOKIE_NAME = 'forge.persona';

export function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && PERSONAS.some((p) => p.id === value);
}

export function defaultPersona(): Persona {
  return 'eng-lead';
}

/**
 * Read the persona from a `Cookie` header value (server side) or the
 * current document cookie (client side). Returns the default when the
 * cookie is missing or invalid.
 */
export function readPersonaFromCookieHeader(cookieHeader: string | null): Persona {
  if (!cookieHeader) return defaultPersona();
  const match = cookieHeader
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (!match) return defaultPersona();
  const value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  return isPersona(value) ? value : defaultPersona();
}

export function personaCookie(value: Persona): string {
  // 30-day cookie; the stub does not expire on its own.
  const maxAge = 60 * 60 * 24 * 30;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}