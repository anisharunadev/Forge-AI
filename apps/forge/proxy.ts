/**
 * Next.js proxy — Forge OIDC gate + persona header (M1 T1.7).
 *
 * In Next.js 16, the `middleware` file convention is renamed to
 * `proxy` (same shape, new name, runs on the same Edge runtime).
 * This file is the Next.js 16 surface for the OIDC gate authored
 * in `apps/forge/middleware.ts` (Next.js 15 surface).
 *
 * Two concerns, one proxy
 * -----------------------
 *   1. **OIDC gate** — close M1 G4. Unauthenticated requests for
 *      protected routes (`/dashboard`, `/ideation`, `/architecture`,
 *      `/runs`, `/audit`, `/knowledge-center`, `/connector-center`,
 *      `/copilot`, `/forge-terminal`, `/governance-center`,
 *      `/admin/*`, `/personas/*`) get 302'd to `/login`. The
 *      shared evaluator lives in `lib/auth/oidc-gate.ts` so the
 *      legacy `middleware.ts` runs the SAME policy.
 *
 *   2. **Persona header** — preserve the prior Pillar 1 Phase 3
 *      behavior. The proxy reads the `forge.persona` cookie and
 *      exposes it to downstream handlers via `X-Forge-Persona`. If
 *      the cookie is absent the proxy falls back to the tenant
 *      default persona (`developer`) — the backend
 *      `Tenant.default_persona` column also defaults to
 *      `'developer'`, so the two sides stay in lockstep.
 *
 *   3. **Tenant header** — when the `forge_session` cookie carries
 *      a JWT with a `tenant_id` claim, the proxy lifts it into the
 *      `x-tenant-id` request header so the `/api/proxy/[...path]`
 *      catch-all route can forward it to the orchestrator without
 *      re-parsing the token on every call.
 *
 * Public routes pass through: `/login`, `/auth/*`, `/api/proxy/*`,
 * `/healthz`, `/_next/*`, and the standard static assets
 * (`favicon.ico`, `robots.txt`, `sitemap.xml`, anything with a
 * file extension).
 *
 * Matching scope
 * --------------
 * The `config.matcher` mirrors the one in `middleware.ts`: skip
 * Next.js internals (`/_next/...`), the proxy route (`/api/...`),
 * and static assets (anything carrying a `.`). Same
 * negative-lookahead regex, kept in sync via the shared logic.
 */

import { NextResponse, type NextRequest } from 'next/server';

import {
  evaluateOidcGate,
  FORGE_SESSION_COOKIE,
  PROTECTED_PATHS,
  PROTECTED_PREFIXES,
  PUBLIC_PREFIXES,
  PERSONA_DEV_FALLBACK_ENABLED,
  TENANT_HEADER,
} from '@/lib/auth/oidc-gate';

// Re-export the gate vocabulary so other modules (server
// components, tests) can pull the canonical constants from this
// entry point or from `middleware.ts` interchangeably.
export {
  FORGE_SESSION_COOKIE,
  PROTECTED_PATHS,
  PROTECTED_PREFIXES,
  PUBLIC_PREFIXES,
  PERSONA_DEV_FALLBACK_ENABLED,
  TENANT_HEADER,
} from '@/lib/auth/oidc-gate';

// ---------------------------------------------------------------------------
// Persona header constants — preserved from the prior proxy.ts.
// ---------------------------------------------------------------------------

/** Cookie name — same on client (set in `/persona` form) and server. */
export const FORGE_PERSONA_COOKIE = 'forge.persona';

/** Fallback persona when no cookie is set. Mirrors `Tenant.default_persona`. */
export const FORGE_PERSONA_DEFAULT = 'developer';

/** Header name — read by the FastAPI orchestrator (`deps.py`). */
export const FORGE_PERSONA_HEADER = 'X-Forge-Persona';

/**
 * Matcher — run on every page route, skip Next.js internals +
 * static assets + API proxy. Mirrors the `middleware.ts`
 * matcher so a request that triggers one triggers the other.
 */
export const config = {
  matcher: [
    '/((?!_next/|api/proxy|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)',
  ],
};

/**
 * Read the persona cookie safely. `request.cookies.get(...)`
 * returns `undefined` when the cookie is absent — we coerce to
 * the `FORGE_PERSONA_DEFAULT` fallback so downstream code never
 * has to handle the missing-cookie case.
 */
export function readPersonaFromRequest(request: NextRequest): string {
  const cookie = request.cookies.get(FORGE_PERSONA_COOKIE)?.value;
  if (typeof cookie !== 'string') return FORGE_PERSONA_DEFAULT;
  const trimmed = cookie.trim();
  return trimmed.length > 0 ? trimmed : FORGE_PERSONA_DEFAULT;
}

/**
 * Next.js 16 proxy entry point. Delegates the OIDC gate to the
 * shared `evaluateOidcGate` helper (so `middleware.ts` and
 * `proxy.ts` enforce the SAME policy), then layers the persona
 * header on top — regardless of whether the request passed
 * through or was redirected, downstream handlers need the
 * persona context to render correctly.
 */
export function proxy(request: NextRequest) {
  // 1. OIDC gate.
  const decision = evaluateOidcGate({
    pathname: request.nextUrl.pathname,
    forgeSessionCookie:
      request.cookies.get(FORGE_SESSION_COOKIE)?.value ?? null,
    personaCookie: PERSONA_DEV_FALLBACK_ENABLED
      ? request.cookies.get(FORGE_PERSONA_COOKIE)?.value ?? null
      : null,
    protectedPaths: PROTECTED_PATHS,
    protectedPrefixes: PROTECTED_PREFIXES,
    publicPrefixes: PUBLIC_PREFIXES,
    devFallbackEnabled: PERSONA_DEV_FALLBACK_ENABLED,
  });

  if (decision.outcome === 'redirect') {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    if (request.nextUrl.pathname !== '/login') {
      loginUrl.searchParams.set(
        'next',
        request.nextUrl.pathname + request.nextUrl.search,
      );
    }
    return NextResponse.redirect(loginUrl);
  }

  // 2. Persona header (legacy Pillar 1 Phase 3 behavior).
  const persona = readPersonaFromRequest(request);

  // 3. Clone the incoming request headers, layer on persona +
  //    tenant.
  const forwarded = new Headers(request.headers);
  forwarded.set(FORGE_PERSONA_HEADER, persona);
  if (decision.tenantId) {
    forwarded.set(TENANT_HEADER, decision.tenantId);
  }

  return NextResponse.next({
    request: { headers: forwarded },
  });
}

/**
 * Legacy `middleware()` re-export for callers still expecting the
 * Next.js 15 export shape. Functionally identical to `proxy()` —
 * both delegate to `evaluateOidcGate`.
 *
 * @deprecated in Next.js 16; will be removed once all dynamic
 *             routes migrate to the `proxy()` shape.
 */
export const middleware = proxy;

export default proxy;
