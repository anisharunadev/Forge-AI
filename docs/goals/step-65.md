# Step 65 — Keycloak ↔ LiteLLM Proxy JWT Auth Bridge

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~2-3 days
> **Phase:** 1 (OIDC) + DL-025 (Provider Abstraction Layer) hardening
> **Reference:** https://docs.litellm.ai/docs/proxy/jwt_auth_arch

## /goal

Today the forge backend calls LiteLLM using **two parallel auth schemes** and they don't talk to each other:

1. **Internal Forge JWT** (HS256 / RS256, signed with `JWT_SECRET`) — issued by `POST /auth/oidc/callback`, validated by `app.core.security.get_current_principal`. This is what every `/api/v1/*` endpoint reads.
2. **LiteLLM Virtual Key** (LiteLLM `sk-*` keys via `/key/generate`, stored as SHA-256 fingerprints in `litellm_key_audit`). This is what the backend forwards to LiteLLM Proxy as `Authorization: Bearer sk-...`.

The two never meet. **Step 65 makes them meet** so that a Forge user's tenant + role claims propagate into LiteLLM Proxy and the proxy enforces model access + spend limits per-tenant — without us having to pre-provision per-tenant Virtual Keys.

This is the canonical LiteLLM pattern (`JWT_PUBLIC_KEY_URL`, `enable_jwt_auth`, `litellm_jwtauth.team_id_jwt_field = "tenant_id"`). It **decouples** LiteLLM auth from our internal JWT issuance.

## Files to read FIRST (in this order)

1. **LiteLLM doc** — `https://docs.litellm.ai/docs/proxy/jwt_auth_arch` (already fetched; key facts captured here)
2. **`/workspace/docs/features/auth.md`** — what we built in Step 53 (OIDC, JWT issuance, principal model)
3. **`backend/app/api/v1/auth.py`** — current OIDC routes (`/auth/oidc/callback`, `/auth/refresh`, `/auth/me`)
4. **`backend/app/core/security.py`** — `decode_token()` + `get_current_principal()` — what claims we put into the access token today
5. **`backend/app/integrations/litellm/key_manager.py`** — `VirtualKeyManager` — what we currently do (Virtual Keys only, not JWT trust)
6. **`backend/app/services/litellm_client.py`** — the entry point every agent uses; **this is where we plumb the JWT**
7. **`backend/app/integrations/litellm/litellm_base_client.py`** — `LiteLLMBaseClient` — the underlying HTTP client
8. **`infra/litellm/config.yaml`** — LiteLLM Proxy config (master_key + general_settings blocks)
9. **`docker-compose.yml`** — `litellm` service env vars (we add `JWT_PUBLIC_KEY_URL` here)
10. **`scripts/keycloak-init/forge-realm.json`** — the Keycloak realm definition; we'll add a `forge-backend-public` client for the proxy audience
11. **`/workspace/docs/reference/litellm-bridge.md`** — already-documented LiteLLM integration shape

## What the LiteLLM doc actually says (the parts that matter)

Three things we have to wire up:

```
1. Configure JWT_PUBLIC_KEY_URL — the public-key endpoint of the IdP:
     For Keycloak: {KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/certs

2. Set enable_jwt_auth: True in the proxy's general_settings,
   AND litellm_jwtauth block with at minimum:
     user_id_jwt_field: "sub"
     team_id_jwt_field: "tenant_id"
     user_id_upsert: true
   (this auto-creates the user in LiteLLM DB on first auth)

3. Frontends (and services) send their Forge-issued JWT directly
   as `Authorization: Bearer <access_token>`. LiteLLM Proxy
   validates against the Keycloak JWKS, NOT against our HS256 secret.
```

Two traps to avoid:

- **Don't put `JWT_AUDIENCE` matching Keycloak** — we set `aud = "forge-backend"` because LiteLLM Proxy will reject any token not matching the configured audience. (Per doc: "If not set, the decode step will not verify the audience.")
- **`user_id_upsert: true` is Enterprise-only.** This step assumes you have Enterprise (or run a downstream patch). If not, the auth flow needs a `Pre-User-Create` handler in the proxy, OR we keep the existing Virtual Key path and this step becomes only the JWKS plumbing.

## Zone 1 — Keycloak client config

Update `scripts/keycloak-init/forge-realm.json` (or write a follow-up `forge-realm-update.json` if we can't edit the seeded one). Add a **second client**:

```json
{
  "clientId": "litellm-proxy",
  "publicClient": false,
  "secret": "set-via-env-or-keycloak-cli",
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "redirectUris": ["http://localhost:4000/*"],
  "attributes": {
    "forge.proxy.audience": "litellm-proxy"
  }
}
```

Concretely: configure Keycloak so the JWT issued to `forge-ui` carries `aud = ["forge-backend", "litellm-proxy"]`. Then LiteLLM accepts both.

**Test:** after `docker compose up`, `curl -s http://localhost:8080/realms/forge/.well-known/openid-configuration` should return a JSON doc with `jwks_uri` pointing at `/realms/forge/protocol/openid-connect/certs`.

## Zone 2 — Forge access token claims

Today our access token (`POST /auth/oidc/callback`'s response) is HS256-signed with `JWT_SECRET`. For LiteLLM to validate it against Keycloak JWKS, the token MUST be:
- **RS256 signed** (asymmetric — we issue a private-key-signed token; LiteLLM validates via JWKS public key)
- OR **a fresh Keycloak token** (forwarded as-is)

The cleanest pattern (and the one the LiteLLM doc assumes): **fork our existing token issuance into two**:

1. `forge.access_token` (HS256, what we keep) — for `/api/v1/*` resources
2. `forge.proxy_token` (RS256, **new**) — for LiteLLM Proxy `Authorization: Bearer`

The proxy token has the same claims as the access token, but:
- Signed with our RS256 keypair (`forge_proxy_private.pem` / `forge_proxy_public.pem`)
- `aud: "litellm-proxy"`
- `iss: "https://keycloak:8080/realms/forge"` (matches what Keycloak issues — important for cross-validation later)
- `tenant_id` claim (mapped from `forge.tenant` so LiteLLM Proxy picks it up via `team_id_jwt_field: "tenant_id"`)

**Implementation:** add `forge_proxy_jwt_issue()` to `backend/app/core/security.py`. It generates the RS256 keypair at startup if missing (mounted volume in production for stability), and signs a token with the right claims.

Then `POST /auth/oidc/callback` returns BOTH:

```python
class TokenResponse(BaseModel):
    access_token: str   # HS256 forge token (existing)
    refresh_token: str  # HS256 forge token (existing)
    proxy_token: str    # RS256 token (NEW for LiteLLM)
    token_type: str = "bearer"
    expires_in: int
```

Frontend stores both. Frontend uses `proxy_token` as the `Authorization: Bearer` for `/v1/chat/completions` requests when it talks to LiteLLM Proxy directly. Backend uses `proxy_token` when it talks to LiteLLM Proxy on behalf of the user.

## Zone 3 — LiteLLM config

Update `infra/litellm/config.yaml`:

```yaml
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  enable_jwt_auth: True
  litellm_jwtauth:
    user_id_jwt_field: "sub"            # maps to our `sub` claim
    team_id_jwt_field: "tenant_id"     # maps to LiteLLM's team concept
    user_email_jwt_field: "email"
    user_id_upsert: True               # auto-create LiteLLM user on first auth
    enforce_rbac: True                 # proxy checks roles/models on every call
    role_mappings:
      - role: internal_user
        models: ["gpt-4o", "claude-3-5-sonnet-latest", "all"]
      - role: proxy_admin
        models: ["*"]
    admin_jwt_scope: "forge:admin"     # our HS256 forge-internal admin scope

  # DL-025: refuse to boot without a valid Keycloak URL
  jwt_public_key_url: os.environ/JWT_PUBLIC_KEY_URL
```

Then in `docker-compose.yml` `litellm` service env:

```yaml
JWT_PUBLIC_KEY_URL: "http://keycloak:8080/realms/forge/protocol/openid-connect/certs"
```

**Test:** after restart, `curl -H "Authorization: Bearer sk-1234" http://localhost:4000/config/list` should show `jwt_public_key_url` set. Then:

```bash
# Use the new proxy_token from a previous login
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}'
```

→ 200 if the proxy accepts; 401 if Keycloak's JWKS isn't reachable; 403 if `role_mappings` rejects the model.

## Zone 4 — Backend LiteLLM client

Today `LiteLLMBaseClient` always uses a Virtual Key (`sk-*`) for `Authorization: Bearer`. Two flows need to coexist during a transition (a single commit can't flip):

**Option A (cleaner, long-term):** issue the proxy_token at login. Backend's `LiteLLMClient.chat()` always sends the user's proxy_token. The Virtual Key path becomes **only** the master-key admin path (key provisioning, etc.).

**Option B (migration-friendly):** add a `proxy_token` parameter to `LiteLLMClient.chat()`. If `proxy_token is None`, fall back to `VirtualKeyManager.get_key(tenant_id)`. Migrate callers gradually.

I'll spec the prompt for **Option A** because the codebase is at v2.0 — no legacy to preserve. But you can fall back to Option B if a deployment needs both simultaneously.

**Implementation:**

```python
# backend/app/services/litellm_client.py
class ForgeLLMClient:
    async def chat(
        self, *, messages, model, tenant_id, project_id,
        proxy_token: str,             # <-- NEW required
        workflow_id=None, actor_id=None, stream=False,
        ...
    ):
        # Pass the user's proxy token through; LiteLLM validates it.
        async with self._client.chat_session(proxy_token, trace_id=...) as client:
            resp = await client.post("/chat/completions", json={...})
            ...
```

The `proxy_token` is supplied by the calling route — which gets it from `AuthenticatedPrincipal.raw_claims["forge.proxy_token"]` (we'll add this).

Wait — **don't put the proxy_token in the JWT** (that's a violation of "tokens should be minimal"). Instead, the route handler:

1. Receives `Authorization: Bearer <access_token>`
2. Decodes → `AuthenticatedPrincipal`
3. Either re-issues a proxy_token on the fly (cheap, RS256 sign) OR fetches from a 5-min cache in Redis

Best: **Redis cache for the proxy token**. After login, the `/auth/oidc/callback` endpoint signs the proxy_token ONCE and stores `(access_token_fingerprint → proxy_token)` in Redis with TTL = 1 hour. Routes fetch it on first use per request (via connection pool) and cache the lookup result for 60 seconds.

**Result:** routes never re-issue. Only the login flow signs.

**Simpler option if Redis isn't great here:** have the OIDC callback also set an HTTP-only cookie `forge_proxy=Bearer ...` that's valid for 1 hour and routes use as fallback when the Bearer header doesn't carry a proxy_token. (Don't do this; auth header in the Authorization header is the only right way.)

Let me commit to: **Redis cache, fingerprint key**.

## Zone 5 — User identity claim shape

LiteLLM Proxy uses these JWT claims (per docs):

- `sub` — user id → becomes LiteLLM `user_id`
- `tenant_id` — team id → becomes LiteLLM `team_id`
- `email` — user email → shown in LiteLLM admin UI
- `roles` — list of scopes → mapped via `role_mappings`

Forge currently puts in the access token (per existing `decode_token` logic):

- `sub` — user id ✓
- `forge.tenant` — the tenant uuid
- `forge.project` — current project (or null)
- `forge.permissions` — array of permissions like `dashboard:read`
- `roles` — array of role slugs

**Gap:** LiteLLM expects `tenant_id` (no prefix), `email`, plain `roles`. We need a **dual claim** approach for the proxy token:

```python
proxy_claims = {
    "sub": principal.user_id,
    "email": principal.email,
    "tenant_id": principal.tenant_id,
    "roles": ["internal_user" if "forge:admin" not in principal.roles else "proxy_admin"],
    "permissions": principal.permissions,
    "iss": "https://keycloak:8080/realms/forge",
    "aud": "litellm-proxy",
    "iat": now,
    "exp": now + 3600,
}
```

(Note: `forge.tenant` and `forge.project` are kept for Forge's HS256 token; only the **proxy** token uses the LiteLLM-shaped claims.)

## Zone 6 — Admin path (key provisioning)

The backend's `_package_wiring.py` / `key_manager.py` calls `/key/generate` and `/key/info` on LiteLLM Proxy — those use **Virtual Keys** (admin master key from `LITELLM_MASTER_KEY=sk-1234`). That path **does not change** in this step. Master key continues to be the way for backend services to call admin endpoints. Only user-facing LLM calls go through the proxy token flow.

**Add documentation comment** in `key_manager.py`:

```python
# Admin operations (key provisioning, model registration, spend sync)
# use the master key. End-user LLM calls (chat completions, embeddings)
# use the per-user proxy token issued at /auth/oidc/callback.
# See /workspace/prompts/step65-oidc-litellm-bridge.md.
```

## Zone 7 — Tests

Create `backend/tests/auth/test_oidc_to_litellm_bridge.py`:

1. **test_proxy_token_issued_at_login** — POST `/auth/oidc/callback` with valid Keycloak code → response has `proxy_token` field, decodable, RS256, `aud=litellm-proxy`, `tenant_id` present.

2. **test_proxy_token_has_correct_claims** — decode the proxy_token → matches the `proxy_claims` shape above; `roles` are properly translated.

3. **test_proxy_token_decodes_via_keycloak_jwks** — fetch the JWKS from Keycloak (mocked), validate the proxy_token's signature against it. (Confirms we use the same algorithm as Keycloak.)

4. **test_redis_cache_for_proxy_token** — `proxy_token` is stored under `(access_token_fingerprint)` for 1 hour; second hit doesn't re-sign.

5. **test_litellm_chat_with_proxy_token** — `ForgeLLMClient.chat(..., proxy_token=...)` sends the proxy_token in the `Authorization: Bearer` header to LiteLLM.

6. **test_litellm_chat_rejects_admin_token_as_user** — trying to use the master key (`sk-1234`) in the user-facing chat path is rejected at the LiteLLM config layer (admin_jwt_scope mismatch).

For the frontend, add `apps/forge/lib/api/auth.ts` test:

7. **test_token_response_has_proxy_token** — login response includes `proxy_token`; verified on the SPA before redirect.

## Zone 8 — Frontend updates

**`apps/forge/lib/auth/oidc.ts`** — currently exchanges the code, gets back `access_token` + `refresh_token`. Add a third field:

```typescript
const { access_token, refresh_token, proxy_token } = response;
// Persist in localStorage AND in HttpOnly cookie (decided against cookie earlier;
// use localStorage with 5-min refresh timer):
useAuthStore.getState().setTokens({ accessToken, refreshToken, proxyToken });
```

**`apps/forge/lib/api/client.ts`** — every LLM call now sends `proxy_token` instead of the master key. But wait — **the SPA shouldn't talk to LiteLLM directly** in production. The backend is the proxy. So this update is for backend-led LLM calls only. The frontend's `chat` route hits `/api/v1/copilot/*` which proxies through to LiteLLM.

Concretely: **no frontend change needed** for end-user chat. But:
- `apps/forge/components/admin/llm-gateway/` (Steward admin) — if it shows "force use master key" toggle, leave that. **Steward admin path is unchanged.**
- `apps/forge/components/copilot/` — uses backend routes; **no change.**

So **most of the frontend work is in `apps/forge/lib/auth/oidc.ts` (1 file, ~30 lines).** Persist the proxy_token; let it expire and re-fetch from `/auth/refresh`.

## Zone 9 — Refresh flow

The refresh endpoint (`POST /auth/refresh`) also needs to issue a new `proxy_token`:

```python
@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    # ... existing refresh logic ...
    proxy_token = issue_proxy_token(principal)
    cache_proxy_token(principal.access_fingerprint, proxy_token)
    return TokenResponse(...)
```

And the Redis cache key invalidates on `POST /auth/logout` — adds 30 lines to `auth.py`.

## CONSTRAINTS

- **DL-025 still applies.** The backend remains the only process that talks to provider SDKs. Frontend never calls LiteLLM directly.
- **Rule 1 still applies** — every LLM call still goes through LiteLLM Proxy. The proxy is now trusting our RS256 proxy_token, which is fine because we issue it.
- **Rule 6 (audit)** — every OIDC callback + refresh + key provision emits an `audit_event`. Add `actions.auth.proxy_token.issued`.
- **No LiteLLM Enterprise required** — if `user_id_upsert: true` is Enterprise-only, we degrade: skip auto-upsert, manually create LiteLLM DB rows for each Forge user on first login via a `/user/new` admin call (using the master key once). Document this in the YAML.
- **Don't expose proxy_token in the SPA console** — it lasts 1 hour; logging it is not OK.
- **Don't break existing Virtual Key callers** — `key_manager.py` keeps its current path. Only new flows use `proxy_token`.

## DELIVERABLE

Modified:
- [ ] `scripts/keycloak-init/forge-realm.json` — add `litellm-proxy` client (or extend existing `forge-backend` audience list)
- [ ] `backend/app/core/security.py` — add `issue_proxy_token()` + RS256 keypair init
- [ ] `backend/app/api/v1/auth.py` — `TokenResponse` adds `proxy_token`; `/refresh` re-issues; `/logout` invalidates Redis cache; Redis client + cache helper
- [ ] `infra/litellm/config.yaml` — `enable_jwt_auth: true` + `litellm_jwtauth` block + `jwt_public_key_url`
- [ ] `docker-compose.yml` — `litellm` env gets `JWT_PUBLIC_KEY_URL`
- [ ] `backend/app/integrations/litellm/key_manager.py` — docstring comment only
- [ ] `apps/forge/lib/auth/oidc.ts` — persist `proxy_token`
- [ ] `backend/app/services/litellm_client.py` — `proxy_token` required parameter

Created:
- [ ] `backend/app/core/oauth2_rsa.py` — RS256 keypair generator + signer (small ~50 lines)
- [ ] `backend/app/core/proxy_token_cache.py` — Redis-backed cache for issued proxy_tokens
- [ ] `backend/tests/auth/test_oidc_to_litellm_bridge.py` — 7 tests
- [ ] `infra/keycloak-init/forge-realm-litellm-audience.json` — add `litellm-proxy` client

YAML:
- [ ] `built-features.yaml` — Phase 1 OIDC step `52, 53, 65`; status stays `Production` (this is a hardening, not a feature addition)

Verify:
- [ ] `docker compose up -d` boots without errors
- [ ] `curl -s http://localhost:8080/realms/forge/.well-known/openid-configuration | jq -r .jwks_uri` returns a real URL
- [ ] `curl -H "Authorization: Bearer sk-1234" http://localhost:4000/config/list` shows jwt_public_key_url
- [ ] `pytest tests/auth/test_oidc_to_litellm_bridge.py -v` — all 7 pass
- [ ] End-to-end: log in as `arun@acme-corp.com`, copy `proxy_token`, `curl -X POST http://localhost:4000/v1/chat/completions -H "Authorization: Bearer $PROXY_TOKEN" -d '{"model": "gpt-4o", ...}'` returns 200 with chat content

## "What we deliberately did NOT do"

- **Didn't introduce SDK-style token refresh in user code.** The frontend gets a fresh proxy_token on `/auth/refresh`. Per-zone rate limiting is at the proxy.
- **Didn't add per-model RBAC at the Forge layer.** LiteLLM's `role_mappings` handles this. We trust it.
- **Didn't move tenant_id detection from Keycloak → LiteLLM.** The proxy_token claims include `tenant_id`; the proxy maps it via `team_id_jwt_field`. Clean.
- **Didn't break the existing "admin path uses master key" flow.** `key_manager.py` continues to provision per-tenant Virtual Keys for admin operations; user-facing chat uses the new proxy_token.

---

**Total scope:** ~2-3 days focused work. ~500 lines across backend; ~50 lines frontend.

Tell me to ship it and I'll walk the zones in order, run tests, update YAML. Or tell me which zone to inspect first if anything needs detail.