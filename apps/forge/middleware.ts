/**
 * Next.js middleware — Forge persona header (Pillar 1 Phase 3).
 *
 * Reads the `forge.persona` cookie on every request and exposes it to
 * downstream handlers (the FastAPI orchestrator in particular) via
 * the `X-Forge-Persona` request header. If the cookie is absent the
 * middleware falls back to the tenant default persona (`developer`)
 * — the backend `Tenant.default_persona` column also defaults to
 * `'developer'`, so the two sides stay in lockstep.
 *
 * The middleware does NOT block requests. Persona is a context value,
 * not an auth gate: anonymous tenants still see the same shell.
 *
 * Matching scope is intentionally narrow (`/((?!_next|api|.*\\..*).*)`)
 * to skip Next.js internals (`/_next/...`), the proxy route
 * (`/api/...`), and static assets (`/favicon.ico`, etc).
 */

import { NextResponse, type NextRequest } from 'next/server';

/** Cookie name — same on client (set in `/persona` form) and server. */
export const FORGE_PERSONA_COOKIE = 'forge.persona';

/** Fallback persona when no cookie is set. Mirrors `Tenant.default_persona`. */
export const FORGE_PERSONA_DEFAULT = 'developer';

/** Header name — read by the FastAPI orchestrator (`deps.py`). */
export const FORGE_PERSONA_HEADER = 'X-Forge-Persona';

/**
 * Matcher — run on every page route, skip Next.js internals +
 * static assets + API proxy. The `negative-lookahead` style mirrors
 * the Next.js docs recommendation.
 */
export const config = {
  matcher: ['/((?!_next/|api/|favicon.ico|.*\\..*).*)'],
};

/**
 * Read the persona cookie safely. `request.cookies.get(...)` returns
 * `undefined` when the cookie is absent — we coerce to the
 * `FORGE_PERSONA_DEFAULT` fallback so downstream code never has to
 * handle the missing-cookie case.
 */
export function readPersonaFromRequest(request: NextRequest): string {
  const cookie = request.cookies.get(FORGE_PERSONA_COOKIE)?.value;
  if (typeof cookie !== 'string') return FORGE_PERSONA_DEFAULT;
  const trimmed = cookie.trim();
  return trimmed.length > 0 ? trimmed : FORGE_PERSONA_DEFAULT;
}

export function middleware(request: NextRequest) {
  const persona = readPersonaFromRequest(request);
  // Clone the incoming request headers so we can forward `X-Forge-Persona`
  // to the orchestrator without mutating the read-only `request.headers`.
  const forwarded = new Headers(request.headers);
  forwarded.set(FORGE_PERSONA_HEADER, persona);
  return NextResponse.next({
    request: { headers: forwarded },
  });
}