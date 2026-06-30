---
title: Phase 1 — OIDC Authentication
description: Keycloak + JWT + tenant foundation wired into the frontend and backend.
---

Phase 1 wires **Keycloak 26+** into the Forge stack so every request carries
a verified JWT and a tenant context. This page describes what's live, what's
not yet, and how to test it locally.

## Status

- **Wired:** 2026-06-27 (Step 52, commit `58ca2f5c`)
- **Status:** Phase 1 of 13 integration phases. See
  [Integration Phases Roadmap](./phases-2-13) for the remaining phases.
- **Scope:** Keycloak login, JWT verification, tenant context propagation,
  auth guards on protected routes.

## What works

- **Login flow.** Users land on `/login`, are redirected to Keycloak
  (OIDC + PKCE), and return to the app with a code that the backend
  exchanges for tokens.
- **JWT verification.** Every API call from `apps/forge` is sent with the
  access token in `Authorization: Bearer …`. The backend validates the
  signature against Keycloak's JWKS, checks `iss`/`aud`/`exp`, and pins the
  session to a `(tenant_id, user_id)` pair.
- **Tenant context.** `tenant_id` and `project_id` flow into every service
  call (Rule 2). Helpers live in `lib/tenant/` (frontend) and
  `app/core/multi_tenant.py` (backend).
- **Auth guard.** Unauthenticated users hitting a protected route are
  redirected to `/login`. The guard is centralized so new routes inherit it
  automatically.

## What does NOT work yet

- **Token refresh.** Access tokens are short-lived but the silent-refresh
  interceptor is still under construction. Users may need to re-login after
  expiry.
- **SAML.** Configured in Keycloak but not exercised end-to-end.
- **Phase 2+ wiring.** Agents, Connectors, Workflows, etc. still use mock
  data on the frontend. See [phases-2-13](./phases-2-13).

## Local testing

1. Bring up Keycloak + the backend:

   ```bash
   docker compose up -d keycloak postgres redis
   cd backend && uvicorn app.main:app --reload
   ```

2. Configure the OIDC client (one-time, idempotent):

   ```bash
   ./scripts/keycloak-init/init.sh
   ```

   This creates the `forge-dashboard` client with the correct redirect URIs.

3. Start the frontend and visit `http://localhost:3000`. You should be
   redirected to Keycloak.

## Configuration

| Env var | Where | Purpose |
|---|---|---|
| `KEYCLOAK_URL` | backend, frontend | Base URL of the Keycloak realm |
| `KEYCLOAK_REALM` | backend, frontend | Realm name (default `forge`) |
| `KEYCLOAK_CLIENT_ID` | backend, frontend | OIDC client ID |
| `KEYCLOAK_CLIENT_SECRET` | backend only | Used for the code-exchange request |

See `.env.example` at the repo root and at `apps/forge/.env.example`.

## Related

- Rule 1 — Model-Provider Agnosticism (auth does not depend on a provider SDK)
- Rule 2 — Multi-Tenancy by Default
- Rule 6 — Mandatory Auditability (every login attempt is audited)
- ADR-005 — LiteLLM control (the auth and provider-abstraction stacks are
  intentionally decoupled)