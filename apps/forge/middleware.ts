/**
 * Next.js OIDC gate (M1 T1.7).
 *
 * Why this exists
 * ---------------
 * Without a top-level edge gate, every page under `/dashboard`,
 * `/ideation`, `/architecture`, `/runs`, `/audit`, `/knowledge-center`,
 * `/connector-center`, `/copilot`, `/forge-terminal`,
 * `/governance-center`, `/admin/*`, and `/personas/*` is reachable
 * without an OIDC session. The backend itself enforces auth on API
 * calls, but the SPA shell would still render to anyone — exposing
 * UI affordances for routes that 401 the moment a button is
 * clicked.
 *
 * This gate closes G4 (M1 audit §2.2): unauthenticated browsers get
 * 302'd to `/login`, which kicks off the PKCE flow
 * (`startLogin()` in `lib/auth/oidc.ts`); the public surface
 * (`/login`, `/auth/*`, `/api/proxy/*`, `/healthz`, static
 * assets) passes through untouched; and the `x-tenant-id` claim is
 * lifted from the JWT on every protected request so the
 * catch-all `/api/proxy/[...path]` route can forward it to the
 * orchestrator without re-parsing the token per call.
 *
 * File name — `middleware.ts` vs `proxy.ts`
 * -----------------------------------------
 * The Forge stack currently runs Next.js 16.2.x where the
 * convention was renamed from `middleware.ts` to `proxy.ts` (see
 * the sibling `apps/forge/proxy.ts` which owns the same gate on
 * the Next 16 surface). Track B is tasked with authoring
 * `middleware.ts` per the M1 specification — Next.js keeps
 * accepting the legacy name with a deprecation warning, and
 * `proxy.ts` short-circuits any chain run through it on Next 16
 * by calling into the same OIDC gate helper module
 * (`./lib/auth/oidc-gate`). Both files share ONE gate
 * implementation; this file owns the Next.js 15
 * `export function middleware()` shape.
 *
 * Why the gate is cookie-based (and not localStorage)
 * ---------------------------------------------------
 * The browser-side auth store persists tokens in `localStorage`
 * (`forge_token`, `forge_refresh`) — by design, those are NOT
 * readable from the edge runtime. Instead, the OIDC callback
 * writes a single `forge_session` cookie that carries the opaque
 * token plus a serialized projection of its claims (tenant,
 * role). Reading the cookie in edge code lets us gate without a
 * Keycloak round-trip, and lets us lift `tenant_id` into
 * `x-tenant-id` for the proxy.
 *
 * The localStorage tokens remain the source of truth for
 * client-side refreshes; this cookie is purely a
 * server-readable stamp.
 *
 * Dev fallback — `lib/auth.ts` persona-cookie stub
 * ------------------------------------------------
 * When `NODE_ENV === 'development'`, the persona-cookie stub in
 * `apps/forge/lib/auth.ts` can short-circuit the gate so the
 * dashboard renders for engineers running without a Keycloak
 * realm. In production this gate ignores the persona cookie and
 * falls through to the full Keycloak redirect path. See
 * `PERSONA_DEV_FALLBACK_ENABLED` in `lib/auth/oidc-gate.ts`.
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
// entry point or from `proxy.ts` interchangeably.
export {
  FORGE_SESSION_COOKIE,
  PROTECTED_PATHS,
  PROTECTED_PREFIXES,
  PUBLIC_PREFIXES,
  PERSONA_DEV_FALLBACK_ENABLED,
  TENANT_HEADER,
} from '@/lib/auth/oidc-gate';

/**
 * Matcher — same shape used by the existing `proxy.ts`. We run
 * on every page route but explicitly skip Next.js internals, the
 * proxy route, static assets, and anything carrying a file
 * extension (images, CSS, etc). This keeps the middleware cheap.
 */
export const config = {
  matcher: [
    '/((?!_next/|api/proxy|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)',
  ],
};

/**
 * Top-level gate. Next.js 15 calls this on every request matching
 * the `config.matcher` above; we delegate the heavy lifting to
 * `evaluateOidcGate()` so the same logic can be reused by
 * `proxy.ts` when running on Next.js 16.
 *
 * Return shape semantics (per Next.js 15 docs):
 *   - `NextResponse.next()`              → request flows to the
 *                                          matched route/page.
 *   - `NextResponse.redirect(url)`       → browser navigates to
 *                                          the given absolute URL.
 */
export function middleware(request: NextRequest) {
  const decision = evaluateOidcGate({
    pathname: request.nextUrl.pathname,
    forgeSessionCookie:
      request.cookies.get(FORGE_SESSION_COOKIE)?.value ?? null,
    personaCookie: PERSONA_DEV_FALLBACK_ENABLED
      ? request.cookies.get('forge.persona')?.value ?? null
      : null,
    protectedPaths: PROTECTED_PATHS,
    protectedPrefixes: PROTECTED_PREFIXES,
    publicPrefixes: PUBLIC_PREFIXES,
    devFallbackEnabled: PERSONA_DEV_FALLBACK_ENABLED,
  });

  // 1. Pass-through (public route OR authenticated). When the
  //    cookie decoded cleanly we lift `tenant_id` into the
  //    forwarded headers so `/api/proxy/[...path]` can pass it
  //    on to the orchestrator.
  if (decision.outcome === 'pass') {
    return appendTenantHeader(request, decision.tenantId);
  }

  // 2. Protected route with no usable session — redirect to
  //    /login. Preserve the originally requested path in the
  //    `?next=` query so /login can bounce the user back after
  //    the OIDC round trip.
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

/**
 * Build a forwarding response that injects the `x-tenant-id`
 * header when the JWT carries a `tenant_id` claim. We clone the
 * incoming headers because `request.headers` is read-only on
 * Next 15+.
 */
function appendTenantHeader(
  request: NextRequest,
  tenantId: string | null,
): NextResponse {
  const response = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });
  if (tenantId) {
    response.headers.set(TENANT_HEADER, tenantId);
  }
  return response;
}

export default middleware;
