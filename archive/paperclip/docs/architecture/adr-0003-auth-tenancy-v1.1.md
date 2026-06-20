# ADR-0003 v1.1 — In-Process JWT Validation (Amendment to ADR-0003 §4.2)

| Field           | Value |
|-----------------|-------|
| **Status**      | **Proposed** |
| **Proposed**    | 2026-06-20 |
| **Accepted**    | _pending CEO sign-off_ |
| **Author**      | CTO ([f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0](/Forge AI/agents/cto)) |
| **Reviewer**    | CEO + (future) Security Engineer |
| **Issue**       | [Forge AI-526](/Forge AI/issues/Forge AI-526) — 0.1.8 In-process JWT validation |
| **Parent ADR**  | [ADR-0003 §4.2](/Forge AI/docs/architecture/adr-0003-auth-tenancy.md) |
| **Supersedes**  | _none_ — amends §4.2 v0.1 |
| **Superseded by** | _none_ |

---

## 1. Context

ADR-0003 v0.1 (Forge AI-38, accepted 2026-06-19) defined the brokered identity model:
a single `identity-broker` service terminates OIDC, mints Forge AI-issued access tokens,
and the Orchestrator (along with the other Forge AI services) consumes those tokens.

The v0.1 **deployment** model relied on a gateway upstream to verify the JWT
and stamp the verified `tenant_id` on a header (`x-fora-tenant-id`). The
Orchestrator and the rest of Forge AI's services then trusted that header as the
"this is who the caller is" signal. ADR-0003 §4.2 (Postgres RLS) was bound
*through* that header:

```
client → gateway [verify JWT, stamp x-fora-tenant-id] → orchestrator [trusts header]
                                                         ↓
                                              db pool sets app.tenant_id
                                                         ↓
                                                   Postgres RLS
```

This v0.1 deployment model has three problems:

1. **The gateway is in the trust boundary.** If the gateway is compromised
   (or a misconfiguration routes traffic around it), the Orchestrator will
   honour a forged `x-fora-tenant-id` header. The trust model becomes
   "the gateway is correct" — which is exactly the single-point-of-failure
   class of failure that ADR-0003 was written to avoid.
2. **An untrusted LB / sidecar cannot be in front of the Orchestrator.**
   Cloud-native L7 LBs (AWS ALB, GCP HTTPS LB, k8s ingress) and sidecars
   (Istio, Linkerd) cannot mint a `x-fora-tenant-id` header that the
   Orchestrator will trust. v0.1 implicitly required a Forge AI-owned
   gateway in front of every Orchestrator deployment.
3. **The broker's own audit (Forge AI-36) is bypassed for service-to-service
   calls.** The gateway's verification is invisible to the broker; the
   Orchestrator cannot tell from the request whether the JWT was
   actually verified upstream or merely *assumed* to be verified.

Forge AI-526 is the v1.1 amendment that closes these gaps. The decision: the
**Orchestrator verifies the JWT in-process**, removing the gateway from
the trust boundary.

## 2. Decision

We move JWT validation from the upstream gateway into the Orchestrator
process. The change is local to the Orchestrator service; the broker,
the token shape, and the rest of ADR-0003 §3 / §4 / §5 are unchanged.

### 2.1 The new deployment model

```
client → [untrusted LB / sidecar OK] → orchestrator [verify JWT in-process]
                                                  ↓
                                       request.tenantContext stamped
                                                  ↓
                                       db pool sets app.tenant_id
                                                  ↓
                                           Postgres RLS
```

The gateway is no longer required. The Orchestrator can be deployed
behind any L7 LB that *passes the `Authorization: Bearer <jwt>` header
through* (which is the universal default — most L7 LBs and sidecars
do exactly that, because stripping auth headers would break the
client).

### 2.2 What stays in the broker

The broker (ADR-0003 §3) is unchanged:

- The broker is still the only service that mints Forge AI-issued tokens.
- The broker is still the only service that holds the per-tenant
  IdP config and the per-tenant role/scope policy.
- The broker still publishes its JWKS at
  `{public_url}/.well-known/jwks.json`. The Orchestrator consumes
  this JWKS to verify tokens (jose `createRemoteJWKSet`).
- The broker still owns revocation (Forge AI-36 audit events; per-tenant
  `jti` deny-list).

### 2.3 What moves into the Orchestrator

The Orchestrator now performs the verification step that the gateway
used to do. Concretely:

1. **A Fastify `preHandler` hook** (`server.ts#jwtAuthHook`) runs on
   every non-`/healthz` request. It reads
   `Authorization: Bearer <jwt>`, calls `JwtValidator.verify`, and
   stamps the typed `JwtPrincipal` on `request.tenantContext`.
2. **`JwtValidator`** (`jwt-validator.ts`) is a thin typed wrapper
   around the `jose` library. It enforces the claim-set contract
   from ADR-0003 §3.2 (the same schema `@fora/session-tokens`
   produces) and returns one of four typed errors on failure
   (`EXPIRED` / `TAMPERED` / `INVALID` / `WRONG_TENANT`).
3. **`request.tenantContext`** carries `tenantId` / `actorId` /
   `principal` / `role` / `scopes` / `traceId` / `jti` / `exp`. The
   existing `defaultExtractTenant` reads `tenantId` from there; the
   rest of the request handlers (Forge AI-50 §4.1 routes, the
   approval-router ports) read `actorId` / `role` / `scopes` as
   needed.
4. **The legacy `x-fora-tenant-id` header is REMOVED from the trust
   boundary.** The header is still honoured as a fallback ONLY when
   `Forge AI_REQUIRE_JWT=false` (local dev). Production MUST run with
   `Forge AI_REQUIRE_JWT=true` (the default). A process-startup warning
   log fires whenever the opt-out is on so the footgun is visible
   in test runs.

### 2.4 Configuration

Five env vars, all defaulting to the identity-broker's local-dev
defaults:

| Env var | Default | Purpose |
|---|---|---|
| `Forge AI_JWT_VERIFIER_URL` | `{IDENTITY_BROKER_PUBLIC_URL}/.well-known/jwks.json` | The broker's JWKS document |
| `Forge AI_JWT_ISSUER` | `identity-broker.fora.local` | Expected `iss` claim |
| `Forge AI_JWT_AUDIENCE` | `forge-runtime` | Expected `aud` claim |
| `Forge AI_REQUIRE_JWT` | `true` | When `false`, fall back to `x-fora-tenant-id` (LOCAL DEV ONLY) |
| `Forge AI_JWT_CLOCK_TOLERANCE_SEC` | `0` | Allow N seconds of clock skew on `exp` / `nbf` |

## 3. Why now (and not later)

Three concrete pressure points make this the right time:

1. **Forge AI-38 (Epic 0.7 auth foundation) shipped 2026-06-19.** The
   broker is live and minting tokens. The Orchestrator is the
   first Forge AI service that consumes those tokens; verifying in
   process is the smallest change that gets the broker → service
   contract into a deployable state.
2. **Forge AI-110 (Epic 0.1 Master Orchestrator) shipped 2026-06-20.**
   The v0.1 ship was a v0.1 deployment, with the gateway-stamp
   model. Forge AI-526 is the first v0.2 follow-up that removes a
   known v0.1 deployment assumption. The cost of carrying the
   gateway-stamp model into v0.2 is the cost of carrying a known
   security weakness into a production-facing release.
3. **The customer-cloud broker (ADR-0003 §6) and the secrets-mcp
   (ADR-0003 §7) both want the same in-process verification
   pattern.** Establishing the pattern in the Orchestrator first
   gives the next two follow-ups (0.1.9 / 0.1.a in the v0.2
   queue) a working template to copy.

## 4. Migration path

The v0.1 deployment (gateway upstream) and the v1.1 deployment
(orchestrator verifies) can run side-by-side during the cutover:

1. **Phase 1 — v1.1 ships behind a feature flag.** The new
   `Forge AI_REQUIRE_JWT` defaults to `true`, so a fresh deployment
   requires the JWT. The existing gateway-stamp path still works
   when `Forge AI_REQUIRE_JWT=false` is set.
2. **Phase 2 — Production cutover.** Operators flip
   `Forge AI_REQUIRE_JWT=true` in the production env. The gateway
   stops stamping `x-fora-tenant-id`; the LB passes
   `Authorization: Bearer <jwt>` through verbatim. Existing
   clients do not need to change.
3. **Phase 3 — Gateway retirement.** The Forge AI-owned gateway is
   retired. Cloud-native L7 LBs (ALB / GCP HTTPS LB / k8s
   ingress) take over with no auth-stripping concerns.

There is no DB migration, no token-shape change, and no broker
change. The cutover is a config flip per environment.

## 5. Cross-cutting impact

- **Forge AI-50 §4.1 routes** — unchanged. The `requireTenant` /
  `requireIdempotencyKey` call sites read the tenant from
  `extractTenant(req)`, which now reads from
  `request.tenantContext` (production) instead of the gateway
  header.
- **Forge AI-137 approval router** — unchanged. The router receives
  the request after the hook has run, so `tenantContext` is
  already stamped.
- **Audit (Forge AI-36 §8.1)** — additive. The hook logs the JWT
  failure code (`EXPIRED` / `TAMPERED` / `INVALID` /
  `WRONG_TENANT`) on every 401 so the broker-side audit gets
  the discrete failure mode. The wire response stays
  `401 VALIDATION` so a probe cannot differentiate.
- **Per-tenant rate-limit (Forge AI-437)** — unchanged. The
  rate-limit key is `(tenant_id, route)`; the hook stamps the
  same `tenant_id` the v0.1 header carried.

## 6. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| `jose` `createRemoteJWKSet` flapping when the broker rotates keys | `jose` caches the JWKS internally (default 10 min) and refreshes on `kid` miss; the `JwtValidator` constructor accepts a `clockToleranceSec` to absorb small skew | Bypass the hook via `Forge AI_REQUIRE_JWT=false` to fall back to the v0.1 gateway-stamp model. The flag is the rollback switch. |
| A clock-skew bug between broker and orchestrator locks out all clients | `Forge AI_JWT_CLOCK_TOLERANCE_SEC=30` opens a 30-second window. Default is 0; bump on incident. | Bump the env var; no rebuild required. |
| An attacker probes the failure mode (`expired` vs `tampered` vs `wrong_tenant`) by watching the error code | The wire response is the standard `401 VALIDATION` envelope; the discrete code is logged server-side only (`app.log.warn`), never sent to the client | The hook is the only place that knows the code; removing the hook reverts the wire response. |
| The local-dev opt-out (`Forge AI_REQUIRE_JWT=false`) leaks into production | A startup `app.log.warn` fires whenever the flag is off; CI runs with the flag on; a smoke test asserts the flag is `true` in the production build profile | Re-deploy with `Forge AI_REQUIRE_JWT=true`. |
| JWKS endpoint unreachable at boot | `createRemoteJWKSet` is lazy — the JWKS is fetched on the first verify call, not at construction. A failed JWKS fetch surfaces as a `JwtError('INVALID', ...)` on the first request, not a boot crash | A second orchestrator replica or a cached JWKS file (future) absorbs the broker outage. |

The rollback switch is `Forge AI_REQUIRE_JWT=false`. The flag restores the
v0.1 deployment model in one config flip, with no rebuild.

## 7. Acceptance criteria (Forge AI-526 §Acceptance)

| Forge AI-526 AC | Where it lands |
|---|---|
| 1. New module `apps/orchestrator/src/jwt-validator.ts` | `src/jwt-validator.ts` (new) — `JwtValidator` + `JwtPrincipal` + typed `JwtError` |
| 2. Fastify hook in `server.ts` validates `Authorization` and stamps `request.tenantId` | `src/server.ts#jwtAuthHook` + `defaultExtractTenant` reads `request.tenantContext.tenantId` |
| 3. A v1.1 ADR documents the move and the migration path | This file |
| 4. New env vars: `Forge AI_JWT_VERIFIER_URL` / `Forge AI_JWT_ISSUER` / `Forge AI_JWT_AUDIENCE` / `Forge AI_REQUIRE_JWT` / `Forge AI_JWT_CLOCK_TOLERANCE_SEC` | `src/config.ts` |
| 5. Tests: `test/jwt-validator.test.ts` covers valid / expired / tampered / wrong-tenant; `test/server-auth.test.ts` covers the Fastify hook for both `Authorization` present and missing (401 with `VALIDATION` code) | `test/jwt-validator.test.ts` + `test/server-auth.test.ts` (new) |
| 6. Typecheck clean, all existing 171/171 vitest still pass | `pnpm typecheck` + `pnpm test` — see commit message for the exact counts |

## 8. Out of scope (explicitly)

- **DPoP / sender-constrained tokens** (ADR-0003 §10 sub-decision #5)
  — separate ADR when the auth-engineer is hired. The current
  `JwtValidator` is a single-token verifier; DPoP adds a binding
  between the token and the request's TLS key.
- **Token revocation propagation** — the broker still owns
  revocation (Forge AI-36). v1.1 does NOT add a per-`jti` deny-list
  in the Orchestrator. A revoked token is honoured until the
  token's `exp` (≤15 min for board users, ≤5 min for agents per
  §3.2). Revocation is broker-side; the audit-trail path is
  unchanged.
- **JWKS prefetch / warm cache** — `jose` is lazy. A future
  optimisation is a process-level JWKS cache that refreshes on
  the broker's `/jwks-rotate` webhook. Not v1.1.
- **Other services (runtime, identity-broker itself, customer-
  cloud-broker)** — v1.1 is Orchestrator-only. The runtime gets
  the same hook in a follow-up (0.1.9 / 0.1.a in the v0.2
  queue). The broker and the customer-cloud-broker are the
  trust anchors, not consumers.

## 9. Sub-decisions carried over from ADR-0003 v0.1 §10

The five sub-decisions (OIDC schema, tenant policy DSL, OIDC
federation playbook, secret-manager contract, token binding
mechanism) are all unchanged. v1.1 does not introduce a new
sub-decision. The wire format is unchanged (Forge AI-issued JWTs
with the §3.2 claim set); only the *verifier location* moved.
