# Feature: Auth (OIDC + Keycloak + PKCE)

> **Status:** Wired to real backend (Phase 1) — fully working
> **Login route:** `apps/forge/app/(auth)/login/page.tsx`
> **Callback route:** `apps/forge/app/(auth)/auth/callback/page.tsx`
> **Layout:** `apps/forge/app/(auth)/layout.tsx`
> **OIDC helper:** `apps/forge/lib/auth/oidc.ts` (PKCE + state generation)
> **Auth store:** `apps/forge/lib/api/auth.ts` (Zustand + persist)
> **Backend:** `backend/app/api/v1/auth.py` (3 routes)
> **Security core:** `backend/app/core/security.py` (`AuthenticatedPrincipal` + JWT decode/mint)
> **Constitutional rules:** R2 (tenant_id from JWT), R6 (login/logout audit events)

---

## Purpose

The Auth surface is the **identity boundary** of Forge. It delegates authentication entirely to **Keycloak** via OIDC (OpenID Connect) with PKCE (Proof Key for Code Exchange), then mints its own internal JWTs that carry Forge-specific claims (`forge.tenant`, `forge.project`, `role`).

Per PRD §1.4 the Auth surface serves **all four personas** — every user authenticates here before any other surface is reachable. The flow is **single sign-on**: Forge keeps no email/password database. Identity provisioning is delegated to Keycloak admins.

**Why no email/password form:**
> Per the Step 53 Zone 7 spec, Forge delegates identity entirely to Keycloak. Keeping an email/password form would mean a parallel credential path that bypasses the IdP, defeats Rule 6 (mandatory auditability of identity events), and confuses users into expecting a recovery flow that doesn't exist.

**Why PKCE (not confidential-client):**
> The SPA cannot keep a client secret — anything bundled in JS is visible. PKCE binds the authorization code to a one-shot verifier generated in the browser. Even if the redirect is intercepted, the code is unusable without the verifier. This is the modern OIDC standard for SPAs (OAuth 2.1, RFC 8252).

**Why Forge issues its own JWTs:**
> 1. Token verification stays symmetric — every endpoint uses `get_current_principal` to decode HS256 tokens, no round-trip to Keycloak per request.
> 2. We can rotate `JWT_SECRET` independently from Keycloak.
> 3. We can revoke a Forge token without affecting the user's Keycloak SSO session.
> 4. Forge JWTs carry `forge.tenant` + `forge.project` + `role` claims that downstream RBAC depends on.

---

## Architecture

```
User clicks "Sign in with Keycloak" on /login
       ↓
startLogin() generates PKCE verifier + state + challenge (apps/forge/lib/auth/oidc.ts)
       ↓
Browser redirects to:
  ${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth
    ?client_id=forge-ui
    &redirect_uri=/auth/callback
    &response_type=code
    &scope=openid+email+profile
    &state={random}
    &code_challenge={base64url(SHA-256(verifier))}
    &code_challenge_method=S256
       ↓
User authenticates at Keycloak (username + password + 2FA)
       ↓
Keycloak redirects to:
  /auth/callback?code={authorization_code}&state={random}
       ↓
Callback page reads verifier from sessionStorage, validates state, POSTs:
  POST /api/v1/auth/oidc/callback
  { code, redirect_uri, code_verifier }
       ↓
Backend exchanges code+verifier with Keycloak:
  POST ${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token
       ↓
Backend decodes ID token signature (JWKS), extracts claims:
  - sub, email, name (from standard OIDC)
  - tenant_id, tenant_slug, tenant_name, role (custom attributes)
       ↓
Backend materializes Tenant + User (idempotent)
       ↓
Backend mints Forge JWTs (access 1h + refresh 7d)
       ↓
Response: { access_token, refresh_token, expires_in: 3600, user, tenant }
       ↓
Frontend stores tokens in Zustand (persisted to localStorage)
       ↓
Redirect to return_url (default /dashboard)
```

---

## Routes

### Frontend (Next.js)

| Path | Component | Description |
|---|---|---|
| `/login` | LoginPage | Single sign-in CTA |
| `/auth/callback` | OAuthCallbackPage | PKCE callback handler |
| `(auth)/layout.tsx` | Layout | Auth-only layout (no sidebar) |
| `/legal/terms` | (legal) | Terms of service |

### Backend (FastAPI) — `backend/app/api/v1/auth.py` — 3 routes

| Method | Path | Permission | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/oidc/callback` | (public) | Exchange Keycloak code + PKCE verifier for Forge JWTs |
| `POST` | `/api/v1/auth/refresh` | (public, requires refresh token) | Trade refresh token for fresh access token |
| `GET` | `/api/v1/auth/me` | (requires bearer) | Return principal backing the current bearer token |

### Plan from Step 61 — 3 routes NOT YET BUILT

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/auth/me/tenants` | List user's tenants (TenantSwitcher dependency) |
| `POST` | `/api/v1/auth/logout` | Invalidate refresh token + clear session |
| `GET` | `/api/v1/auth/keycloak-config` | Public client config (Keycloak URL + realm) |

---

## Data touched

### Tables

| Table | Purpose |
|---|---|
| `tenants` | Tenant materialized from Keycloak user attributes |
| `users` | User row (FK to tenant + keycloak_sub) |
| `tenant_members` | User-tenant membership (role + status) |
| `audit_events` | Every login / logout / refresh logged |

### Keycloak user attributes

Forge reads these custom Keycloak user attributes during OIDC callback:

| Attribute | Required | Fallback |
|---|---|---|
| `tenant_id` | No | `00000000-0000-0000-0000-000000000000` (default tenant) |
| `tenant_slug` | No | `default` |
| `tenant_name` | No | `Default Tenant` |
| `role` | No | `viewer` |

Standard OIDC claims always used:
- `sub` — Keycloak user UUID (required)
- `email` — User email (required)
- `given_name` + `family_name` — Display name (falls back to email)

### `_coerce_tenant_id()` quirk

> Keycloak's `tenant_id` attribute may be either a real UUID (production) or a slug like `acme-corp` (dev realm). `_coerce_tenant_id` resolves slugs via `uuid5` to a stable UUID, so downstream code never has to special-case either format.

### Schemas (`backend/app/api/v1/auth.py`)

```python
class OIDCCallbackRequest(BaseModel):
    code: str = Field(..., min_length=1)
    redirect_uri: str = Field(..., min_length=1)
    code_verifier: str = Field(..., min_length=43, max_length=128)  # PKCE spec


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 3600  # _ACCESS_TOKEN_TTL.total_seconds()
    user: dict[str, Any]   # {id, email, name, role}
    tenant: dict[str, Any] # {id, slug, name, plan, region}


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600
```

### TypeScript mirror (`apps/forge/lib/api/auth.ts`)

```typescript
export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role: UserRole;
}

export type TenantPlan = 'free' | 'pro' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  plan: TenantPlan;
  region: string;
  logo_url?: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface SwitchTenantResponse {
  tenant: Tenant;
  access_token: string;
}
```

---

## JWT Token Shape (`backend/app/core/security.py`)

### Access Token

```python
_ACCESS_TOKEN_TTL = timedelta(hours=1)
_TOKEN_TYPE_ACCESS = "access"

# Claims:
{
  "sub": str,                    # user_id (UUID)
  "email": str,                  # user email
  "forge.tenant": str,           # tenant_id (UUID) — required
  "forge.project": str | None,   # project_id (UUID, optional)
  "type": "access",
  "iat": int,                    # issued at
  "exp": int,                    # expires at (iat + 3600)
  "iss": settings.jwt_issuer,
  "aud": settings.jwt_audience | None,
  "realm_access": { "roles": [] } # from Keycloak
}
```

### Refresh Token

```python
_REFRESH_TOKEN_TTL = timedelta(days=7)
_TOKEN_TYPE_REFRESH = "refresh"

# Same claims except `type` = "refresh"
```

**Token type enforcement:** The refresh endpoint refuses to mint new tokens from a leaked access token (and vice versa). `type` claim is the discriminator.

### `AuthenticatedPrincipal` dataclass

```python
@dataclass(frozen=True)
class AuthenticatedPrincipal:
    user_id: str
    email: str | None
    tenant_id: str      # required — from `forge.tenant` claim
    project_id: str | None  # optional — from `forge.project` claim
    roles: list[str]    # from `realm_access.roles`
    raw_claims: dict[str, Any]
```

Built by `principal_from_token(token)` — used by every endpoint via `Depends(get_current_principal)`.

### Token validation

```python
def decode_token(token: str) -> dict[str, Any]:
    """Decode + verify a JWT, raising HTTPException on failure."""
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],  # HS256 in dev, RS256 in prod
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
        options={"verify_aud": settings.jwt_audience is not None},
    )
```

JWT secret is HS256 (dev) or JWKS-fetched RS256 (prod). Token signature must verify AND `forge.tenant` claim must be present (403 otherwise).

---

## OIDC Error Codes (Per Route)

### `POST /auth/oidc/callback`

| Failure mode | Status | `detail` |
|---|---|---|
| Keycloak rejects code (expired/already used) | 401 | `oidc_code_exchange_failed` |
| ID token signature invalid | 401 | `invalid_id_token` |
| Missing required claims (`sub` / `email`) | 401 | `oidc_userinfo_missing_claims` |
| Keycloak network error | 502 | `oidc_provider_unavailable` |
| Keycloak 5xx | 502 | `oidc_provider_unavailable` |

### `POST /auth/refresh`

| Failure mode | Status | `detail` |
|---|---|---|
| Refresh token missing/expired | 401 | `not_a_refresh_token` |
| Refresh token signature invalid | 401 | `invalid_refresh_token` |
| Wrong token type (access used as refresh) | 401 | `not_a_refresh_token` |

### `GET /auth/me`

| Failure mode | Status | `detail` |
|---|---|---|
| Missing/bad bearer | 401 | `Bearer token required` |
| Token valid but user row deleted | 401 | `user_not_found` (kicks to /login) |
| Token missing `forge.tenant` | 403 | `Token missing tenant_id claim` |

---

## PKCE Flow (`apps/forge/lib/auth/oidc.ts`)

```typescript
const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL || 'http://localhost:8080';
const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'forge';
const CLIENT_ID = 'forge-ui';

// sessionStorage keys (NOT localStorage — cleared on tab close)
const PKCE_VERIFIER_KEY = 'forge_pkce_verifier';
const PKCE_STATE_KEY = 'forge_pkce_state';
const RETURN_URL_KEY = 'forge_return_url';

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);  // 32 random bytes
  return base64UrlEncode(bytes);  // 43-char base64url string
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);  // Web Crypto API
  return base64UrlEncode(new Uint8Array(hash));
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);  // 16 random bytes
  return base64UrlEncode(bytes);
}
```

**Why sessionStorage (not localStorage) for verifier + state:**
> Verifier + state must be cleared when the tab closes. A leaked verifier from a closed tab would let an attacker redeem a stolen code. sessionStorage is scoped to the tab.

### OIDC helper functions

```typescript
export async function startLogin(returnUrl?: string): Promise<void>;
export function readPKCEState(): { verifier: string; state: string };
export function clearPKCEState(): void;
export async function exchangeCodeForTokens(input: {
  code: string;
  state: string;
}): Promise<TokenResponse>;
export function buildKeycloakLogoutUrl(redirectUri?: string): string;
```

---

## OIDC Callback Page (`/auth/callback`)

The callback page handles **3 return URL shapes** in priority order:

1. **PKCE flow (preferred)** — `?code=…&state=…`
   - Read PKCE verifier from sessionStorage
   - **Validate state matches sessionStorage** (CSRF protection)
   - POST `code + code_verifier` to `/api/v1/auth/oidc/callback`
   - Store Forge JWTs in auth store
   - Redirect to return URL

2. **Token-in-redirect (legacy)** — `?token=…&refresh=…`
   - Persist tokens directly
   - Hydrate user
   - Redirect

3. **Error** — `?error=…&error_description=…`
   - Show user-facing error message
   - Bounce to /login

**State validation enforces fail-closed semantics:**
> We compare `?state=` to the value we stored in sessionStorage before redirecting to Keycloak. A mismatch means the response came from a different flow than the one we initiated — possible authorization-code injection. Fail closed.

---

## Login Page (`/login`)

Single CTA: "Sign in with Keycloak"

```typescript
const handleSignIn = React.useCallback(() => {
  const returnUrl =
    searchParams.get('return_url') ||
    sessionStorage.getItem('return_url') ||
    '/dashboard';
  setIsRedirecting(true);
  startLogin(returnUrl).catch((err) => {
    setIsRedirecting(false);
    toast.error(err instanceof Error ? err.message : 'Could not start sign-in.');
  });
}, [searchParams]);
```

**If already signed in** (`user` exists in Zustand), bounce to `return_url` or `/dashboard`.

**Spinner state:** Local `isRedirecting` flag toggles between "Sign in with Keycloak" (KeyRound icon) and "Redirecting…" (Loader2 spinner).

---

## Auth Store (Zustand + persist)

```typescript
// apps/forge/lib/api/auth.ts
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tenant: null,
      token: null,
      
      login: async (tokens) => {
        safeWrite(TOKEN_KEY, tokens.access_token);
        safeWrite(REFRESH_KEY, tokens.refresh_token);
        set({ token: tokens.access_token });
        await get().fetchCurrentUser();
      },
      
      switchTenant: async (tenantId) => {
        const res = await api.post(`/tenants/${tenantId}/switch`);
        safeWrite(TOKEN_KEY, res.access_token);
        safeWrite(TENANT_KEY, JSON.stringify(res.tenant));
        set({ tenant: res.tenant, token: res.access_token });
        if (typeof window !== 'undefined') window.location.reload();
      },
      
      fetchCurrentUser: async () => {
        const me = await api.get('/auth/me');
        set({ user: me.user, tenant: me.tenant });
      },
    }),
    { name: 'forge-auth' }  // localStorage key
  )
);
```

**Persisted fields:** `user`, `tenant`, `token` — written to `localStorage` under key `forge-auth`.

**SSR-safe:** Server renders see `null` and rehydrate after mount.

**Bind auth accessor:** `bindAuthAccessor()` registers this store with `client.ts` so the request loop can refresh tokens on 401 automatically.

---

## Refresh Token Rotation

When the access token expires (1h):

1. Client request returns 401
2. `client.ts` interceptor catches 401
3. Posts `/auth/refresh` with stored refresh token
4. Receives new access token (refresh token unchanged)
5. Retries original request with new token
6. If refresh fails → clears store + redirects to `/login`

**Refresh token lifetime:** 7 days. After 7 days, user must re-authenticate through Keycloak.

---

## OIDC User Provisioning (Idempotent)

The callback endpoint materializes Tenant + User rows on first login:

```python
async with factory() as session:
    tenant = await get_or_create_tenant(
        session,
        tenant_id=str(tenant_uuid),
        slug=tenant_slug,
        name=tenant_name,
        settings={"plan": "free", "region": "us-east-1"},
    )
    user = await get_or_create_user(
        session,
        keycloak_id=keycloak_sub,
        email=email,
        name=display_name,
        tenant_id=str(tenant_uuid),
        role=role,
    )
```

**Idempotency:** Subsequent logins find existing rows, update last_login_at + Keycloak claims that may have changed.

---

## ID Token Verification (`_decode_keycloak_id_token`)

> Why ID-token instead of /userinfo?
> The Keycloak 26 /userinfo endpoint validates the access token's `iss` against the realm's currently configured issuer. When the browser authenticates via `localhost:8080` but the backend exchanges the code via the internal `keycloak:8080` hostname, the access token's `iss` ends up as `http://keycloak:8080/...` — and Keycloak's /userinfo rejects it with `invalid_token`. The ID token is signed by the same Keycloak realm, has all the claims we need, and is verified purely from its signature + standard claims. No second HTTP round-trip to /userinfo, no issuer mismatch.

Signature verification steps:
1. Fetch Keycloak's JWKS (cached)
2. Locate the key whose `kid` matches the ID token header's `kid`
3. Verify the signature using `python-jose` against that key
4. Reject if `aud` doesn't include `forge-ui` (defends against token-substitution attacks)
5. Bad signature → 401 `invalid_id_token`

---

## Environment Variables

```bash
# Frontend (NEXT_PUBLIC_* — bundled into client JS)
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
NEXT_PUBLIC_KEYCLOAK_REALM=forge
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1

# Backend
KEYCLOAK_URL=http://keycloak:8080  # internal hostname for code exchange
KEYCLOAK_REALM=forge
JWT_SECRET=<long-random-string>
JWT_ALGORITHM=HS256  # or RS256 in prod
JWT_ISSUER=forge-api
JWT_AUDIENCE=forge-ui  # or None
KEYCLOAK_CLIENT_ID=forge-ui  # public client (no secret)
```

**`KEYCLOAK_URL` differs frontend vs backend:** The browser hits `localhost:8080` (or the public DNS), but the backend exchanges the code via `keycloak:8080` (internal Docker network hostname) to avoid the `/userinfo` issuer mismatch bug.

---

## Edge cases

| State | Treatment |
|---|---|
| **Already signed in** | Bounce to `return_url` or `/dashboard` |
| **sessionStorage blocked** | Toast: "Could not start sign-in." |
| **State mismatch** | Fail closed (callback error) |
| **Keycloak 5xx during callback** | 502 → "Identity provider unavailable" |
| **Code already used** | 401 → "Authentication failed" |
| **Missing `forge.tenant` claim** | 403 — cannot mint Forge JWT without tenant |
| **User row deleted mid-session** | `/auth/me` returns 401 → clears store → redirects to /login |
| **Refresh token expired (>7d)** | `/auth/refresh` 401 → redirect to /login |
| **TenantSwitcher while signed in** | `switchTenant()` mints new JWT + page reload |
| **Multiple tabs** | localStorage shared → all tabs see new tokens |
| **`prefers-reduced-motion`** | Spinner spin disabled (CSS transition) |

---

## Forbidden patterns

AI agents modifying Auth MUST NOT:

- ❌ Add email/password form — Forge delegates identity entirely to Keycloak
- ❌ Skip state validation in callback — fail-closed on state mismatch
- ❌ Store PKCE verifier in localStorage — sessionStorage only (tab-scoped)
- ❌ Skip ID token signature verification — JWKS check is mandatory
- ❌ Trust any claim without signature verification
- ❌ Bypass tenant scoping — `forge.tenant` claim is required for every endpoint
- ❌ Skip audit logging on login / logout / refresh — Rule 6
- ❌ Use direct SDK calls — Keycloak interaction via OIDC standard endpoints only
- ❌ Use `bg-black` — use `--bg-base` and layered surfaces
- ❌ Use emoji as UI icons — `lucide-react` only
- ❌ Use spinners for loading beyond redirect-in-flight — use skeleton with shimmer
- ❌ Skip `prefers-reduced-motion` — every animated component must respect it

---

## Verification checklist

- [ ] `/login` shows single "Sign in with Keycloak" CTA
- [ ] Click triggers PKCE flow + redirect to Keycloak
- [ ] Callback page validates state from sessionStorage
- [ ] `POST /auth/oidc/callback` returns 200 with Forge JWTs
- [ ] Tokens stored in Zustand (persisted to localStorage)
- [ ] User redirected to return_url (default /dashboard)
- [ ] `GET /auth/me` returns user + tenant
- [ ] `POST /auth/refresh` returns fresh access token (refresh unchanged)
- [ ] Refresh token rotation works on 401 from API
- [ ] `signOut` clears store + redirects to /login
- [ ] Logout URL built via `buildKeycloakLogoutUrl()` clears Keycloak session
- [ ] `_coerce_tenant_id` handles UUIDs + slugs (uuid5 fallback)
- [ ] Tenant materialization is idempotent (re-login doesn't create duplicates)
- [ ] User materialization is idempotent (re-login updates last_login_at)
- [ ] `_decode_keycloak_id_token` verifies JWKS signature
- [ ] `forge.tenant` claim present in every issued Forge JWT
- [ ] Audit rows written for login + logout + refresh (Rule 6)
- [ ] Empty state renders when API returns `[]` (rarely applicable here)
- [ ] Loading state during redirect-in-flight (Loader2 spinner)
- [ ] Lighthouse Accessibility ≥ 90
- [ ] No console errors

---

## Related docs

- [Coding standards](../standards/coding-standards.md)
- [Design system](../standards/design-system.md) — login card tokens
- [API conventions](../standards/api-conventions.md)
- [Data model](../standards/data-model.md)
- [Architecture rules](../standards/architecture-rules.md) — R2 + R6
- [The 8 rules](../reference/8-rules.md)
- [API catalog](../reference/api-catalog.md) — full route list (3 auth routes)
- [DB schema](../reference/db-schema.md) — `tenants`, `users`, `tenant_members`
- [Onboarding](./onboarding.md) — TenantSwitcher depends on `/auth/me/tenants` (Step 61 plan)
- [Audit](./audit.md) — Every login / logout / refresh logged
- [Settings](./settings.md) — User preferences tab
- [Dashboard](./dashboard.md) — First surface after login

---

## Maintenance notes

**When to update this doc:**

- A new auth route added → update 3-route table
- A new token TTL → update `_ACCESS_TOKEN_TTL` / `_REFRESH_TOKEN_TTL`
- A new Keycloak attribute added → update Keycloak user attributes table
- PKCE state length changed → update `generateCodeVerifier` / `generateState`
- `forge.tenant` claim renamed → update every reference (CRITICAL — breaks Rule 2)

**Files to keep in sync (the lock-step rectangle):**

```
apps/forge/lib/auth/oidc.ts                 ←  PKCE + state helpers (verifier 32B / state 16B)
apps/forge/lib/api/auth.ts                 ←  Auth store + Tenant type + switchTenant
apps/forge/app/(auth)/login/page.tsx       ←  Single sign-in CTA
apps/forge/app/(auth)/auth/callback/page.tsx ←  PKCE callback handler (3 return URL shapes)
apps/forge/app/(auth)/layout.tsx           ←  Auth-only layout (no sidebar)
         ↓
backend/app/api/v1/auth.py                 ←  3 routes (oidc/callback + refresh + me)
backend/app/core/security.py               ←  AuthenticatedPrincipal + JWT decode/mint
backend/app/services/users.py              ←  get_or_create_user
backend/app/services/tenants.py            ←  get_or_create_tenant + _coerce_tenant_id
         ↓
backend/app/db/models/tenant.py            ←  Tenant table
backend/app/db/models/user.py              ←  User table
backend/app/db/models/tenant_member.py     ←  TenantMember table
```

If any link in this chain drifts, Auth breaks silently. Always update all links.

---

## Security Properties

| Property | Mechanism |
|---|---|
| **No passwords stored** | All credentials live in Keycloak only |
| **CSRF protection** | PKCE state validation in callback (fail-closed on mismatch) |
| **Code interception** | PKCE binds code to one-shot verifier (code useless without verifier) |
| **Token rotation** | Refresh tokens last 7d, access tokens 1h |
| **Token type confusion** | `type: "access"` / `type: "refresh"` discriminator |
| **Signature verification** | JWKS-fetched public key, python-jose |
| **Tenant isolation (R2)** | `forge.tenant` claim required on every endpoint |
| **Independent revocation** | Forge JWT can be revoked without affecting Keycloak SSO |
| **Secret rotation** | `JWT_SECRET` rotatable independently from Keycloak |
| **Audit (R6)** | Every login + logout + refresh writes an `audit_event` |

This is the bedrock of Rule 6 (Mandatory Auditability) for identity events. Every other rule depends on knowing **who** the user is — Auth is where that gets established.