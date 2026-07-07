/**
 * Shared OIDC gate vocabulary + evaluator — M1 T1.7.
 *
 * Pure module (no Next.js imports) so the same logic is callable
 * from `apps/forge/middleware.ts` (Next.js 15) AND from
 * `apps/forge/proxy.ts` (Next.js 16 rename). Next 16 still accepts
 * `middleware.ts` with a deprecation warning but prefers the
 * renamed `proxy.ts`, so the gate is structured to be
 * host-agnostic.
 *
 * Decision tree
 * -------------
 *   1. Path matches a PUBLIC_PREFIX (e.g. `/api/proxy`, `/_next`) →
 *      `pass` (no tenant header — proxy route already injects its
 *      own `X-Forge-Persona`).
 *   2. Path matches a PROTECTED_PATH or PROTECTED_PREFIX AND
 *      `forge_session` cookie is present AND decodes to a JWT with
 *      a `tenant_id` claim → `pass` with `tenantId` set, so the
 *      caller can forward `x-tenant-id`.
 *   3. Path matches a protected route, cookie is missing OR cannot
 *      be decoded → `redirect` so the caller 302's the browser to
 *      `/login`.
 *   4. Path matches a protected route, NODE_ENV=development,
 *      `forge.persona` cookie is present (legacy dev stub) → `pass`
 *      with whatever default tenant the persona routes to. This
 *      keeps the developer dashboard rendering without a real
 *      Keycloak realm.
 *
 * Cookie format
 * -------------
 * `forge_session` is set by `/auth/callback` after a successful
 * PKCE token exchange. The cookie value is the opaque Forge access
 * token (`forge_token`) which is itself a JWT in dev. We do not
 * verify the signature here — that happens at the orchestrator.
 * We only decode the payload so we can lift `tenant_id` into
 * `x-tenant-id` for the proxy.
 *
 * Why a permissive decoder?
 *   An expired token still tells us the cookie *was* issued by
 *   Keycloak recently; the orchestrator will return 401 if the
 *   token is actually bad. Treating an undecodable payload as
 *   "no session" keeps the cookie write small and avoids pulling
 *   a JWT verifier into the edge runtime.
 */

// ---------------------------------------------------------------------------
// Public constants — re-exported by middleware.ts + proxy.ts so other
// modules can import them from either entry point.
// ---------------------------------------------------------------------------

/** Cookie written by the OIDC callback after a successful login. */
export const FORGE_SESSION_COOKIE = 'forge_session';

/**
 * Header lifted from the JWT's `tenant_id` claim and forwarded to the
 * orchestrator by the `/api/proxy/[...path]` catch-all route.
 */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * Set to `true` ONLY in dev so the legacy persona-cookie stub
 * (`apps/forge/lib/auth.ts`) can short-circuit the gate. In
 * `production` / `preview` (or any non-`development` value), the
 * stub is bypassed — unauthenticated users are redirected to
 * Keycloak via the standard OIDC dance.
 */
export const PERSONA_DEV_FALLBACK_ENABLED = process.env.NODE_ENV === 'development';

/**
 * Subset of the protected surface. The gate falls through to a
 * Keycloak redirect when a request hits a matching path AND no
 * `forge_session` cookie is present.
 */
export const PROTECTED_PATHS: ReadonlyArray<string> = [
  '/dashboard',
  '/ideation',
  '/architecture',
  '/runs',
  '/audit',
  '/knowledge-center',
  '/connector-center',
  '/copilot',
  '/forge-terminal',

];

/**
 * Subset of protected prefix-style paths. A request matches when
 * the URL pathname is exactly the prefix OR starts with the
 * prefix + `/`. Keep this list tight — over-broad prefixes
 * accidentally gate static assets and the public API surface.
 */
export const PROTECTED_PREFIXES: ReadonlyArray<string> = [
  '/admin',

];

/**
 * Path prefixes that always pass through. Static assets, framework
 * internals, and the proxy are intentionally excluded so the gate
 * does not gate the gate (recursion loops on click).
 */
export const PUBLIC_PREFIXES: ReadonlyArray<string> = [
  '/_next',
  '/api/proxy',
  '/healthz',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

// ---------------------------------------------------------------------------
// Decision types + evaluator
// ---------------------------------------------------------------------------

export type GateOutcome = 'pass' | 'redirect';

export interface GateDecision {
  outcome: GateOutcome;
  /**
   * Tenant UUID when the JWT decoded cleanly and we can forward
   * `x-tenant-id`. `null` for unauthenticated public routes.
   */
  tenantId: string | null;
  /**
   * For diagnostics / logging — which rule short-circuited. Helpful
   * when a request unexpectedly passes through the gate.
   */
  matchedBy:
    | 'public-prefix'
    | 'protected-exact'
    | 'protected-prefix'
    | 'dev-persona-fallback'
    | 'unauthenticated-redirect';
}

export interface EvaluateGateInput {
  pathname: string;
  forgeSessionCookie: string | null;
  personaCookie: string | null;
  protectedPaths: ReadonlyArray<string>;
  protectedPrefixes: ReadonlyArray<string>;
  publicPrefixes: ReadonlyArray<string>;
  devFallbackEnabled: boolean;
}

/**
 * Pure decision function. The middleware/proxy host shells call
 * this and translate the returned `GateDecision` into the
 * Next.js-specific response (pass / redirect / rewrite).
 */
export function evaluateOidcGate(input: EvaluateGateInput): GateDecision {
  const {
    pathname,
    forgeSessionCookie,
    personaCookie,
    protectedPaths,
    protectedPrefixes,
    publicPrefixes,
    devFallbackEnabled,
  } = input;

  // 1. Public prefixes always pass through.
  for (const prefix of publicPrefixes) {
    if (matchesPrefix(pathname, prefix)) {
      return { outcome: 'pass', tenantId: null, matchedBy: 'public-prefix' };
    }
  }

  const protectedHit =
    protectedPaths.includes(pathname) ||
    protectedPrefixes.some((p) => matchesPrefix(pathname, p));

  // Non-protected, non-public routes (e.g. /, /welcome, /about) — pass.
  if (!protectedHit) {
    return { outcome: 'pass', tenantId: null, matchedBy: 'public-prefix' };
  }

  // 2. Authenticated path: try the forge_session cookie.
  const sessionClaims = decodeJwtPayload(forgeSessionCookie);
  if (sessionClaims && typeof sessionClaims.tenant_id === 'string') {
    return {
      outcome: 'pass',
      tenantId: sessionClaims.tenant_id as string,
      matchedBy: pathnameIsExact(pathname, protectedPaths)
        ? 'protected-exact'
        : 'protected-prefix',
    };
  }

  // 3. Dev-only fallback: legacy persona-cookie stub.
  if (devFallbackEnabled && personaCookie && personaCookie.trim().length > 0) {
    // No real tenant is provable from the persona alone; pass with
    // null so the proxy route can fall back to its default. The
    // backend still rejects if it cannot resolve the persona.
    return {
      outcome: 'pass',
      tenantId: null,
      matchedBy: 'dev-persona-fallback',
    };
  }

  // 4. Default — redirect to /login.
  return {
    outcome: 'redirect',
    tenantId: null,
    matchedBy: 'unauthenticated-redirect',
  };
}

/**
 * Path-prefix matcher that requires a `/` boundary. A naive
 * `startsWith('/admin')` would match `/admin-secret-public-route`
 * too; this one only matches `/admin` or `/admin/...`.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
}

function pathnameIsExact(
  pathname: string,
  protectedPaths: ReadonlyArray<string>,
): boolean {
  return protectedPaths.includes(pathname);
}

/**
 * Decode the payload of a JWT without verifying its signature. The
 * edge runtime cannot validate HS256 / RS256 cheaply, and the
 * signature is checked at the orchestrator anyway. We just want
 * the `tenant_id` claim for `x-tenant-id` injection.
 *
 * Returns the parsed claims object on success and `null` on any
 * structural error (empty cookie, wrong number of segments,
 * non-base64url payload, non-JSON). Never throws — the gate
 * MUST be total.
 */
function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length < 2) return null;
  const payloadSegment = segments[1];
  if (!payloadSegment) return null;
  try {
    // base64url → base64 → atob for ASCII.
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4;
    const base64 = pad ? padded + '='.repeat(4 - pad) : padded;
    // atob is available on the edge runtime; `globalThis.btoa` is
    // present as well.
    const json = typeof atob === 'function' ? atob(base64) : '';
    if (!json) return null;
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
