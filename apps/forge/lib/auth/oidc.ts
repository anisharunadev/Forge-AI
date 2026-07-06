/**
 * OIDC / PKCE login helpers — step-53 Zone 5.
 *
 * The SPA acts as a public OIDC client against Keycloak using the
 * Authorization Code flow with PKCE (RFC 7636). The flow:
 *
 *   1. SPA generates a one-shot `code_verifier` (random 43–128 char
 *      base64url string) and derives `code_challenge = base64url(SHA-256(verifier))`.
 *   2. SPA redirects the browser to Keycloak's /auth endpoint with the
 *      challenge; Keycloak stores it against the code it issues.
 *   3. User authenticates at Keycloak; Keycloak redirects back to
 *      `/auth/callback?code=…&state=…`.
 *   4. The callback page reads `?code=`, retrieves the verifier from
 *      sessionStorage, and POSTs both to `/api/v1/auth/oidc/callback`.
 *   5. The backend exchanges the code+verifier with Keycloak, fetches
 *      /userinfo, materializes a Tenant + User, and returns a pair of
 *      Forge JWTs (access + refresh).
 *
 * Why public client + PKCE instead of confidential client?
 *   The SPA cannot keep a client secret — anything bundled in JS is
 *   visible to the user. PKCE binds the code to a one-shot verifier
 *   generated client-side: even if the redirect is intercepted, the
 *   code is unusable without the verifier. This is the modern OIDC
 *   standard for SPAs (OAuth 2.1, RFC 8252).
 *
 * Why do we bounce through our own backend instead of hitting Keycloak
 *   directly from the browser?
 *   - We issue our own JWTs so the rest of the API can validate with
 *     a single symmetric secret (HS256 in dev) without round-tripping
 *     to Keycloak on every request.
 *   - We can mint tokens that carry the Forge-specific claims
 *     (`forge.tenant`, `role`, …) that downstream RBAC depends on.
 *   - The browser never sees a Keycloak access token, so a compromised
 *     Forge token cannot be replayed against Keycloak.
 */

const KEYCLOAK_URL =
  process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080';
const KEYCLOAK_REALM =
  process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'forge';
const CLIENT_ID = 'forge-ui';
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

// sessionStorage keys — kept local to this module so the callback page
// and the login page can read/write without going through the auth
// store (which would re-trigger persist hydration).
const PKCE_VERIFIER_KEY = 'forge_pkce_verifier';
const PKCE_STATE_KEY = 'forge_pkce_state';
const RETURN_URL_KEY = 'forge_return_url';

// ---------------------------------------------------------------------------
// Base64URL helpers
// ---------------------------------------------------------------------------

/**
 * base64url-encode a byte sequence. RFC 4648 §5: replace `+` with `-`,
 * `/` with `_`, and strip `=` padding. `btoa` operates on strings, so
 * we round-trip through `String.fromCharCode`.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Cryptographically random base64url-encoded string, 43 chars long —
 * the minimum recommended length for an OAuth PKCE verifier
 * (RFC 7636 §4.1). 32 bytes of entropy is well above the 256-bit
 * threshold and produces a 43-char string after base64url encoding.
 */
function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Derive the code challenge from the verifier: SHA-256 hash, base64url
 * encoded. This is what Keycloak stores against the code it issues.
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

/**
 * Cryptographically random state string. Cross-checked on the callback
 * to defeat authorization-code injection (an attacker replaces the
 * legitimate `?code=` with their own code).
 */
function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Kick off the OIDC login redirect.
 *
 * Stores the PKCE verifier + state + intended return URL in
 * sessionStorage (cleared on every successful callback), then bounces
 * the browser to Keycloak.
 */
export async function startLogin(returnUrl?: string): Promise<void> {
  if (typeof window === 'undefined') {
    // SSR — nothing to redirect. Callers should guard against this
    // (e.g. button onClick handlers, not module-load effects).
    return;
  }

  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  try {
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    sessionStorage.setItem(PKCE_STATE_KEY, state);
    // Remember where the user was trying to go so the callback can
    // bounce them back. Falls back to /dashboard when there's no
    // explicit return URL.
    sessionStorage.setItem(
      RETURN_URL_KEY,
      returnUrl || window.location.pathname + window.location.search || '/dashboard',
    );
  } catch {
    /* private mode / quota — proceed anyway; the callback will surface the error */
  }

  const redirectUri = `${window.location.origin}/auth/callback`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  window.location.href = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params.toString()}`;
}

/**
 * Read the PKCE verifier + state + return URL from sessionStorage.
 *
 * Exposed for the callback page — kept out of the auth store because
 * the verifier is single-use and must NOT be persisted across reloads.
 */
export function readPKCEState(): {
  verifier: string | null;
  state: string | null;
  returnUrl: string | null;
} {
  if (typeof window === 'undefined') {
    return { verifier: null, state: null, returnUrl: null };
  }
  return {
    verifier: sessionStorage.getItem(PKCE_VERIFIER_KEY),
    state: sessionStorage.getItem(PKCE_STATE_KEY),
    returnUrl: sessionStorage.getItem(RETURN_URL_KEY),
  };
}

/**
 * Drop the PKCE verifier + state + return URL from sessionStorage.
 *
 * Idempotent — safe to call on every callback mount, success or
 * failure. Removes the sensitive verifier immediately after use.
 */
export function clearPKCEState(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(PKCE_STATE_KEY);
    sessionStorage.removeItem(RETURN_URL_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Trade the authorization code + PKCE verifier for Forge JWTs.
 *
 * Returns the parsed `TokenResponse` from the backend on success;
 * throws `Error` with the backend's `detail` on failure so the
 * callback page can show the user a meaningful message.
 */
export async function exchangeCodeForTokens(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  /** step-65: RS256 proxy_token for the LiteLLM Proxy.  Optional in
   * older backends; SPA stays forward-compatible by tolerating ``null``. */
  proxy_token?: string | null;
  token_type?: string;
  expires_in?: number;
  user: {
    id: string;
    email: string;
    name: string;
    avatar_url?: string;
    role: string;
    tenant_id: string;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    region: string;
    logo_url?: string;
  };
}> {
  const response = await fetch(`${API_BASE}/auth/oidc/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  });

  if (!response.ok) {
    let detail = 'Sign-in failed';
    try {
      const body = (await response.json()) as { detail?: string };
      if (body && typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* non-JSON body — keep the default */
    }
    throw new Error(detail);
  }

  return response.json();
}

/**
 * Build the Keycloak SSO logout URL. Redirecting the browser here ends
 * the realm session as well as the Forge session; useful when the user
 * explicitly chooses "sign out everywhere".
 */
export function buildKeycloakLogoutUrl(redirectUri?: string): string {
  if (typeof window === 'undefined') return '';
  const post = redirectUri ?? `${window.location.origin}/login`;
  const params = new URLSearchParams({
    post_logout_redirect_uri: post,
    client_id: CLIENT_ID,
  });
  return `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout?${params.toString()}`;
}

export const __test = {
  base64UrlEncode,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
};

export const OIDC_CONSTANTS = {
  KEYCLOAK_URL,
  KEYCLOAK_REALM,
  CLIENT_ID,
  API_BASE,
} as const;
