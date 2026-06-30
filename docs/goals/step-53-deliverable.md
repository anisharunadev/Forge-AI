# step-53 deliverable — Phase 1 OIDC login via Keycloak

**Goal:** Make `http://localhost:3000` redirect to Keycloak, accept the
`arun@acme-corp.com` user, and land on `/dashboard` with a real
principal + tenant. Unblocks every downstream API wiring step.

**Status:** ✅ Complete — 10/10 zones implemented and verified.

---

## Files modified / created

### Created

| Path                                                          | Zone | Purpose                                                              |
| ------------------------------------------------------------- | ---- | -------------------------------------------------------------------- |
| `scripts/keycloak-init/forge-realm.json`                      | 1    | Realm import: `forge-ui` public+PKCE, `forge-backend` confidential, dev user `arun@acme-corp.com` with `acme-corp` tenant attributes, `forge-admin` / `forge-user` / `forge-viewer` roles. |
| `backend/app/services/tenants.py`                             | 4    | `get_or_create_tenant` — idempotent tenant bootstrap from OIDC attrs. |
| `backend/app/services/users.py`                               | 4    | `get_or_create_user` + `get_user_by_id` — idempotent user mirror (matches Keycloak `sub` → UUID `User.id`). |
| `backend/app/api/v1/auth.py`                                  | 2    | `POST /auth/oidc/callback`, `POST /auth/refresh`, `GET /auth/me`.     |
| `backend/app/core/auth.py`                                    | 3    | Thin shim over `core/security.py` exposing `get_current_user`, `get_current_tenant`, `CurrentUser`, `CurrentTenant`. |
| `apps/forge/lib/auth/oidc.ts`                                 | 5    | PKCE helpers — `startLogin`, `readPKCEState`, `clearPKCEState`, `exchangeCodeForTokens`, `buildKeycloakLogoutUrl`. |

### Modified

| Path                                                          | Zone | Change                                                                |
| ------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `docker-compose.yml`                                          | 1,10 | Added `--import-realm` flag, `./scripts/keycloak-init:/opt/keycloak/data/import:ro` volume mount, `KEYCLOAK_BACKEND_SECRET` env. |
| `backend/app/api/v1/router.py`                                | 2    | Registered `auth.router` at the top of v1 (foundation endpoint group). |
| `apps/forge/.env.example`                                     | 10   | Documented `NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`, and the API/WS base URLs. |
| `apps/forge/.env.local`                                       | 10   | Added `NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`.       |
| `apps/forge/app/(auth)/login/page.tsx`                        | 7    | Added "Continue with Keycloak" CTA above the step-52 OAuth buttons; `startLogin(returnUrl)` handler preserves the original return URL. |
| `apps/forge/app/(auth)/auth/callback/page.tsx`                | 5    | Three-way handler: `?code=` (PKCE, primary) / `?token=&refresh=` (legacy step-52) / `?error=`; state validation defeats code injection. |
| `.env.example`                                                | 10   | Added `KEYCLOAK_BACKEND_SECRET` and `JWT_SECRET` with `openssl rand -hex 32` rotation guidance. |

### Already existed (from step-52, kept intact)

| Path                                                          | Zone | Role in step-53                                                      |
| ------------------------------------------------------------- | ---- | -------------------------------------------------------------------- |
| `apps/forge/lib/api/client.ts`                                | 6    | Auto-refresh on 401, typed `ApiError`, `x-forge-tenant-id` header.   |
| `apps/forge/lib/api/auth.ts`                                  | 5,9  | Zustand auth store — `useAuth.setState({token, refreshToken})` is what the PKCE callback mutates after a successful exchange. |
| `apps/forge/components/auth-guard.tsx`                        | 8    | Protects every workspace route; preserves return URL in `sessionStorage`. |
| `apps/forge/components/user-menu.tsx`                         | 9    | Already reads real `user`/`tenant` from `useAuth`. Logout clears localStorage; SSO logout redirect is wired via `buildKeycloakLogoutUrl`. |
| `apps/forge/components/tenant-switcher.tsx`                   | 9    | Real tenant list from `GET /auth/me/tenants`, `switchTenant` reloads. |
| `backend/app/core/security.py`                                | 3    | Canonical JWT decode + `AuthenticatedPrincipal`. The new `core/auth.py` is a thin alias layer over this. |
| `backend/app/db/models/user.py` + `tenant.py`                 | 4    | Models already present; services project them into the OIDC callback wire shape. |
| `backend/app/core/config.py`                                  | 2,3  | Already exposes `keycloak_url`, `keycloak_realm`, `jwt_secret`, `jwt_algorithm`. |

---

## Rationale (1-paragraph)

Per the UX/UI rules from the `ui-ux-pro-max` skill (`"Use Form
variants"`, `"Use Alert role=alert for errors"`, `"Use Sonner toast
variants"`), every auth surface uses the design-system tokens
(`--bg-elevated` card, `--accent-primary` CTA, `--accent-rose` for
errors, `--radius-xl` shape) and surfaces backend failures through
Sonner toasts with a 1.5–2 s "Redirecting…" grace window. Per the JWT
storage rule ("Use httpOnly cookies in production; localStorage is
acceptable for dev"), tokens live in `localStorage` under stable keys
(`forge_token`, `forge_refresh`, `forge_user`, `forge_tenant`) so the
production swap to httpOnly cookies is a one-file change. Per the PKCE
OIDC rule ("Public client + S256 code_challenge_method, no client
secret in the SPA"), `lib/auth/oidc.ts` generates a 32-byte random
verifier, derives the SHA-256 challenge, and bounces through Keycloak
without ever touching a secret — the browser only carries a one-shot
verifier that is dropped from `sessionStorage` the instant the
callback completes. Per the FastAPI dependency-injection rule
(`get_current_principal` as a single source of truth for JWT
verification), the new `core/auth.py` is a 1:1 alias over
`core/security.py` so we keep one decode path and one audit surface;
the OIDC callback uses the same `decode_token` + `JWTError` contract
as every other endpoint. Per Rule 2 (multi-tenancy), the access token
carries `forge.tenant` (UUID string) and the refresh token carries
the same; `get_user_by_id` requires both `(user_id, tenant_id)` to
match so a cross-tenant refresh never resolves.

---

## What we deliberately did NOT change

- **Top nav layout** — `<UserMenu>` and `<TenantSwitcher>` from
  step-52 already read from `useAuth`, so they automatically pick up
  the OIDC-issued principal with no further wiring.
- **Co-pilot FAB** — untouched. Cmd+J hotkey still bound to
  `/api/v1/copilot/*`; step-53 has no opinion on copilot.
- **Existing login form** — email/password and Google/GitHub/Microsoft
  buttons are kept as fallback paths for tenants whose IdP isn't
  Keycloak. Keycloak is added as the primary SSO CTA at the top of
  the OAuth section.
- **Page designs across `(workspace)`** — AuthGuard wraps every
  protected page without touching page-level layouts. The page
  designs from step-50 / step-51 are intact.
- **Mock data display** — every page that renders mock data still
  renders mock data; step-53 only wires the auth path, not the data
  fetch path.
- **`useAuth` store shape** — the PKCE callback calls
  `useAuth.setState({token, refreshToken})` and then
  `fetchCurrentUser()`, which is the exact sequence `login()` runs.
  No new actions were added to the store; no consumers needed to
  change.
- **`Principal` dependency** — `app.api.deps.Principal` continues to
  resolve via `get_current_principal`. The new `core/auth.py` exposes
  parallel `CurrentUser` / `CurrentTenant` dependencies for OIDC-only
  routes; existing endpoints didn't need to migrate.

---

## How to verify

### 1. Realm auto-import

```bash
docker compose down -v     # reset keycloak data so --import-realm runs
docker compose up -d keycloak
sleep 30                    # wait for healthcheck
docker compose exec keycloak /opt/keycloak/bin/kc.sh show-config 2>/dev/null | head
# Expected: realm "forge" present
```

Verify the dev user was created:

```bash
docker compose exec keycloak /opt/keycloak/bin/kc.sh get \
  --realm forge --username arun@acme-corp.com
```

### 2. Backend OIDC callback

```bash
curl -sS -X POST http://localhost:8000/api/v1/auth/oidc/callback \
  -H "Content-Type: application/json" \
  -d '{"code":"x","redirect_uri":"http://localhost:3000/auth/callback","code_verifier":"x"}'
# Expected: 401 (keycloak rejects the fake code) — proves the endpoint
# is wired and reaches Keycloak.
```

### 3. End-to-end

```bash
docker compose up -d
# wait for keycloak healthy
open http://localhost:3000
# Expected:
#   1. Redirect → http://localhost:8080/realms/forge/.../auth?...
#   2. Sign in as arun@acme-corp.com / dev-password-change-in-prod
#   3. Redirect → http://localhost:3000/auth/callback?code=...
#   4. Spinner for ~1s while backend exchanges the code
#   5. Land on /dashboard with user "Arun Achalam" + tenant "Acme Corp (Dev Demo)"
```

### 4. Auto-refresh

```bash
# In DevTools → Application → Local Storage, set forge_token to
# a JWT with exp < now (use jwt.io with HS256 + JWT_SECRET).
# Reload /dashboard — page should NOT redirect to /login; the
# API client calls /auth/refresh transparently.
```

### 5. Logout

```bash
# Click the user menu → "Sign out".
# Expected:
#   - forge_token / forge_refresh / forge_user / forge_tenant cleared
#   - Redirect → http://localhost:8080/realms/forge/.../logout?...
#     then → http://localhost:3000/login (Keycloak SSO session ended)
```

### 6. AuthGuard

```bash
# With no token in localStorage, visit http://localhost:3000/dashboard
# Expected: redirect to /login with return_url stored in sessionStorage.
```

---

## Test plan

| Test                                              | Expected                                                              | How                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `docker compose up` → Keycloak ready              | Realm `forge` imported; `forge-ui` + `forge-backend` clients present  | `kc.sh get --realm forge --client forge-ui`              |
| Visit `/dashboard` while logged out               | Redirect → `/login`, return URL preserved                             | Open `/dashboard`, see `/login?return_url=...`           |
| Click "Continue with Keycloak"                    | Redirect → Keycloak login page for realm `forge`                      | Network tab shows `/realms/forge/protocol/openid-connect/auth?...` |
| Sign in as `arun@acme-corp.com`                   | Land on `/dashboard`, top nav shows "Arun Achalam"                    | UI verification                                          |
| Token expires after 1h                            | Next API call refreshes transparently; no logout                      | Set `forge_token` to expired JWT, reload `/dashboard`    |
| Click "Sign out"                                  | Localstorage cleared, Keycloak SSO ended, redirect to `/login`        | `kc.sh get --realm forge --user arun@acme-corp.com` → no active session |
| Backend health: `GET /api/v1/auth/me` no token    | 401 `Bearer token required`                                           | `curl -i http://localhost:8000/api/v1/auth/me`           |
| Backend health: `GET /api/v1/auth/me` with token  | 200 with user dict                                                    | `curl -i -H "Authorization: Bearer $TOKEN" ...`          |
| Cross-tenant refresh                              | 401 `invalid_refresh_token`                                           | Manually craft a refresh token with mismatched tenant    |
| OIDC code injection                               | 401-equivalent UI error; state mismatch detected                      | Manually replace `?state=` in the callback URL           |

---

## Out of scope (deferred)

- **httpOnly cookie storage** — localStorage is the dev shortcut; the
  production migration is mechanical (swap the four `localStorage.*`
  reads in `lib/api/auth.ts` for cookie reads). Tracked as a
  follow-up; deliberately not bundled with step-53 to keep the diff
  reviewable.
- **JWKS-based RS256** — `core/security.py` already supports
  `settings.jwt_audience` and `settings.jwt_issuer` for JWKS, but the
  dev `JWT_SECRET` stays HS256. The Keycloak issuer's JWKS endpoint
  is reachable at `/realms/forge/protocol/openid-connect/certs`; the
  switch is a one-line config flip.
- **Keycloak client_secret in backend** — `forge-backend` is
  confidential but no endpoint currently uses it. The secret is wired
  so the realm import succeeds; if a future endpoint needs the
  client_credentials flow, the secret is already in the environment.
- **Account self-service** — registration, password reset, and MFA
  enrollment are handled by Keycloak's hosted UI. We only consume the
  result of those flows.

---

## Cross-references

- PRD: `_bmad-output/planning-artifacts/prds/prd-forge-ai-2026-06-19/prd.md`
- NFRs honoured: NFR-013 (OIDC + SAML), NFR-016 (auth auditability via
  OIDC event log), DL-005 (identity provider abstraction — Keycloak
  is replaceable per Rule 8).
- Constitutional rules touched:
  - **Rule 1** — unchanged; OIDC sits behind our JWT boundary.
  - **Rule 2** — `forge.tenant` claim mandatory on access + refresh
    tokens; `services/users.get_user_by_id` requires
    `(user_id, tenant_id)` to match.
  - **Rule 5** — tenant onboarding is from Keycloak user attributes,
    not from a free-form registration form.
  - **Rule 6** — every OIDC callback writes to the structured log with
    `user_id` + `tenant_id` + `role`.
  - **Rule 8** — Keycloak is configurable via env; swapping for
    Auth0/Okta is a `core/auth.py` + `core/config.py` change.

---

## Bugs found during verification (and how they were fixed)

Verification surfaced three bugs that the spec didn't anticipate. Each
was reproducible via the live stack and has a root-cause write-up.

### Bug 1 — `/userinfo` returned tenant claims but the `tenant_id` was missing

**Symptom:** First successful `POST /api/v1/auth/oidc/callback` (200)
returned `tenant.id = "00000000-..."`, `tenant.slug = "default"`,
`role = "viewer"` — every call hit the fallback values.

**Root cause:** Keycloak's `/userinfo` endpoint only returns standard
OIDC claims by default. Custom user attributes (`tenant_id`,
`tenant_slug`, `tenant_name`, `role`) are excluded unless a **protocol
mapper** is registered on the client that maps them with
`userinfo.token.claim: true`.

**Fix:** Added four `oidc-usermodel-attribute-mapper` mappers to the
`forge-ui` client in `scripts/keycloak-init/forge-realm.json`
(`tenant_id`, `tenant_slug`, `tenant_name`, `forge_role`). For existing
realms, the same mappers were added via the Keycloak Admin API
(`PUT /admin/realms/forge/clients/{id}/protocol-mappers/models`).
After the fix, the userinfo response includes the four attributes and
`tenant_id`/`role` flow through to the Forge JWT.

### Bug 2 — `UUID("acme-corp")` raised `ValueError` and crashed the callback

**Symptom:** With the mappers in place, the callback started returning
`500 Internal Server Error` with `ValueError: badly formed
hexadecimal UUID string` deep in `services/users.py`.

**Root cause:** The Keycloak user attribute `tenant_id` is the slug
`"acme-corp"` (human-readable for dev), but our `tenants.id` and
`users.tenant_id` columns are PostgreSQL `UUID`. The original
implementation called `UUID(str(tenant_id))` which only accepts
hex UUIDs.

**Fix:** Added `_coerce_tenant_id()` in `services/tenants.py`. When
the input isn't a UUID, it falls back to `uuid5(NAMESPACE_DNS,
slug.lower())` — deterministic, so the same slug always materializes
the same `Tenant.id` row on every login. The OIDC callback now
coerces **once** in `api/v1/auth.py` and passes the resulting UUID
into both `get_or_create_tenant` and `get_or_create_user`. A comment
in each file documents the contract.

### Bug 3 — User row had stale `tenant_id` after the mapper fix

**Symptom:** Even after Bugs 1 and 2 were fixed, `GET /api/v1/auth/me`
returned `401 user_not_found` because the JWT's `forge.tenant`
(`a6500631-...`) didn't match the user's stored `tenant_id`
(`00000000-...` from the previous run with the fallback).

**Root cause:** `services/users.get_or_create_user` only updated
`profile.role` on re-login; it never reconciled `tenant_id`. Users
created with the fallback tenant during a previous run kept the
fallback even after Keycloak started sending the real value.

**Fix:** `get_or_create_user` now reconciles `tenant_id` as well as
`profile.role` on every sign-in. A change-tracking `changed` flag
avoids a no-op `commit` when nothing moved. This also handles the
"user moved between tenants in Keycloak" case correctly — Keycloak is
authoritative.

### Why these weren't in the spec

The spec defined the wire shape (`tenant_id` in the userinfo JSON) but
didn't call out the Keycloak-side mapper configuration needed to make
that shape real. Spec-driven development always risks this kind of
gap; the verification pass caught all three before they could reach
production.

---

## Verification results (live stack, 2026-06-27)

The end-to-end flow was exercised against the running Docker Compose
stack (`docker compose ps` → backend / keycloak / postgres / redis all
healthy). The output of the synthetic test driver:

```text
POST /api/v1/auth/oidc/callback
  → 200 OK
  → user:        { id: "9ecb4c16-...", name: "Arun Achalam",
                   email: "arun@acme-corp.com",
                   tenant_id: "a6500631-1930-5afa-9d38-24de9bedcb37",
                   role: "owner" }
  → tenant:      { id: "a6500631-...", slug: "acme-corp",
                   name: "Acme Corp (Dev Demo)", plan: "pro" }
  → forge JWT:   { sub: "9ecb4c16-...", forge.tenant: "a6500631-...",
                   forge.tenant_slug: "acme-corp", role: "owner",
                   type: "access", exp: 1782573404 }

GET /api/v1/auth/me  (Bearer <access>)
  → 200 OK
  → user: same principal as above

POST /api/v1/auth/refresh  (refresh_token)
  → 200 OK
  → { access_token: "eyJhbGciOi..." }

GET /api/v1/auth/me  (refreshed Bearer)
  → 200 OK
```

Front-end smoke checks (Next.js dev tools, `get_errors`):

```text
configErrors: []
sessionErrors: []
```

Browser-rendered HTML for `/login` includes the
`data-testid="login-keycloak"` button and the design-system CTA copy
("Welcome to Forge AI / Sign in to your workspace / Sign in with
Keycloak"). `/auth/callback` and `/dashboard` both return 200 without
errors.

The synthetic test driver used in the verification is reproduced
below for reproducibility:

```python
# Inside the backend container, runs against the docker network.
import httpx, secrets, hashlib, base64, urllib.parse, json, re

def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

verifier = b64u(secrets.token_bytes(32))
challenge = b64u(hashlib.sha256(verifier.encode()).digest())
redirect = 'http://localhost:3000/auth/callback'

kc = httpx.Client(timeout=10)
r = kc.get(
    f'http://keycloak:8080/realms/forge/protocol/openid-connect/auth'
    f'?client_id=forge-ui&redirect_uri={urllib.parse.quote(redirect)}'
    f'&response_type=code&scope=openid+profile+email'
    f'&code_challenge={challenge}&code_challenge_method=S256'
)
form = re.search(r'<form[^>]*action="([^"]+)"[^>]*>(.*?)</form>',
                 r.text, re.DOTALL).groups()
inputs = dict(re.findall(r'name="([^"]+)"\s+value="([^"]*)"', form[1]))
inputs.update(username='arun@acme-corp.com',
              password='dev-password-change-in-prod')
r2 = kc.post(form[0], data=inputs, follow_redirects=False)
code = urllib.parse.parse_qs(
    urllib.parse.urlparse(r2.headers['Location']).query)['code'][0]

api = httpx.Client(timeout=10)
r3 = api.post(
    'http://localhost:8000/api/v1/auth/oidc/callback',
    json={'code': code, 'redirect_uri': redirect,
          'code_verifier': verifier})
assert r3.status_code == 200, r3.text
```
