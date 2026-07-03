# Step 73 — Phase 12 Settings: Wire remaining 13 tabs (partial)

> **Status:** Partially shipped 2026-07-01 — backend foundation + frontend SDK/hooks done; **13 tab rewires still pending** (front-end work blocked on context). See "What shipped" and "Still TODO" below.

## Context

The Settings page (`/admin`) has 21 tabs in 3 sections (Account / Workspace / Enterprise).
Before step 73, **8 of 21** were already wired to real backend endpoints
(General, Members, Agents, Providers, EnvVars, Integrations, Workflow Defaults, Audit).
13 remained stubbed with `localStorage` or hardcoded arrays — the largest frontend gap
in the pipeline. This step adds the backend surfaces and frontend SDK hooks so the
remaining tabs can be wired in follow-up commits.

## Inventory — 13 unwired tabs

| Tab | Backend surface | Status after step 73 |
|---|---|---|
| Profile | `PATCH /auth/me` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| API Tokens | `GET/POST/DELETE /auth/api-tokens` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| Sessions | `GET/DELETE /auth/sessions` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| Notifications | `GET/PATCH /users/me/notifications` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| Branding | `GET/PATCH /tenants/{id}/branding` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| SSO | `GET /auth/sso/config` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| Feature Flags | `GET/PATCH /feature-flags` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| Billing | `GET /analytics/quota` (uses existing `/analytics/usage` cache) | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| Seeds | existing `/seeds/*` | Backend ✓ / SDK ✓ / Hooks ✓ / Tab TODO |
| Webhooks | existing `/webhooks/*` (`webhooks_full.py`) | Backend ✓ / SDK partial / Tab TODO |
| AIGateway | existing `/admin/llm-gateway/*` | Backend ✓ / SDK partial / Tab TODO |
| Connected Apps | derived from `/connectors` + `/connectors/credentials` | No new backend / Tab TODO |
| Keyboard Shortcuts | localStorage (UI-only, deliberately deferred) | Unchanged |

## What shipped

**Backend** (new + extended):
- Migration `k1l2m3n4o5p6` adding `user_api_tokens` + `user_sessions`
- Model `app/db/models/user_session.py` (both tables)
- `app/services/feature_flag_catalog.py` (hardcoded system defaults)
- Routes:
  - `PATCH /auth/me`, `GET /auth/sso/config` (extended `auth.py`)
  - `GET/POST/DELETE /auth/api-tokens` (`auth_tokens.py`)
  - `GET/DELETE /auth/sessions` (`auth_sessions.py`)
  - `GET/PATCH /users/me/notifications` (`users.py`)
  - `GET/PATCH /feature-flags` (`feature_flags.py`)
  - `GET/PATCH /tenants/{id}/branding` (extended `tenants.py`)
  - `GET /analytics/quota` (extended `analytics_usage.py`)
- All new routers registered in `app/api/v1/router.py`

**Frontend SDK**:
- Appended ~14 SDK functions to `apps/forge/lib/settings/data.ts`
- Appended ~8 types to `apps/forge/lib/settings/types.ts`
- Appended ~13 hooks to `apps/forge/lib/hooks/useSettings.ts` (covering Me, Tokens,
  Sessions, Notifications, Branding, SSO, Billing, Feature Flags, Seeds)

**YAML**: `built-features.yaml` row 27 `steps: ["13", "47", "73"]` (added).

## Still TODO (frontend work — out of context budget for this turn)

- Wire 13 tabs: swap localStorage/mock arrays for hooks from `useSettings.ts`.
  Pattern per `AgentsTab.tsx:74-129`.
- Drop hardcoded `counts={...}` prop on `<SettingsSidebar>` in
  `apps/forge/app/admin/page.tsx:87-99` so live `useSettingsCounts` wins.
- `apps/forge/tests/settings/settings-hooks.test.tsx` (per CLAUDE.md convention
  for hook tests, this goes under `tests/` not `__tests__/`).
- `backend/tests/api/v1/test_settings.py` — ~15 tests for the new routes.
- Apply alembic migration; verify endpoints smoke-test via `uvicorn` + curl.
- Run `tsc --noEmit` to confirm no new TS errors.

## Skipped (per `step-73` doc's "What you'll NOT see")

- SSO setup UI (admin-only via env vars) — read-only SSO tab is the deliverable.
- Billing payment integration (Stripe) — read-only usage is the deliverable.
- Profile 2FA + password change UI — backend supports it; UI deferred.
- Org rename UI — tenant rename is admin-only.
- AIGateway outbound guardrail mutations — read-only surface for now.

## Notes

- The original step-73 spec was stale in three places:
  1. It cited "4 wired + 17 unwired"; reality was 8 + 13.
  2. It referenced non-existent `lib/api/settings*.ts` files; the canonical
     surface is `lib/settings/data.ts` + `lib/hooks/useSettings.ts`.
  3. It referenced a non-existent YAML row 51; the actual row is 27 (already
     `Production`).
- Backend `audit_log` does not carry a `session_id` field, so the original
  plan's "derive sessions from audit" approach was replaced with a dedicated
  `user_sessions` table (still no separate service module — endpoints are thin).

## Verification (when tab rewires complete)

1. `cd backend && pytest tests/api/v1/test_settings.py -v` — 15 tests pass
2. `cd apps/forge && pnpm test:unit -- settings-hooks` — vitest passes (note:
   vitest 4 ↔ vite 5 ↔ Node 22 mismatch in this repo per memory
   `env-vitest-runner-broken.md`; rely on `tsc` for local verification)
3. `pnpm typecheck` — 0 new TypeScript errors
4. Manual `/admin` walkthrough: every tab shows live data, mutations persist