# Step 52 — Deliverable: Forge frontend wired to real backend auth + tenants

## Summary

Built the foundation that unblocks every authenticated API call in the Forge frontend:

- **ZONE 1** — Typed API client with bearer-token interceptor, 401→refresh→retry loop, 204 support, tenant-id header (Rule 2), and WebSocket auth helper.
- **ZONE 2** — Zustand auth store (persisted to localStorage) holding user / tenant / token / refresh-token, with login, OAuth redirect, logout, refresh, switch-tenant, and hydrate-on-mount actions.
- **ZONE 3** — Login page (`/login`) with email/password form, eye-toggle on the password field, OAuth buttons (Google / GitHub / Microsoft), error-state mapping (network / 401 / 423 / 403-mfa / 403-unverified / 429), and a "Welcome back" success toast.
- **ZONE 4** — OAuth callback page (`/auth/callback`) that persists `?token=…&refresh=…`, hydrates `/auth/me`, then bounces to the original requested URL.
- **ZONE 5** — `<AuthGuard>` HOC that wraps the workspace tree, redirects unauthenticated users to `/login`, preserves the original URL in `sessionStorage.return_url`, and re-hydrates `/auth/me` when a token exists but the user is missing.
- **ZONE 6** — `<TenantSwitcher>` in the top bar (replaces the mocked selector): popover listing the user's workspaces, plan badges, per-tenant avatar, loading skeletons, and a "Create new workspace" entry.
- **ZONE 7** — Single-flight refresh singleton in the API client: concurrent 401s share one in-flight refresh; on second failure the client forces a logout + redirect to `/login`.
- **ZONE 8** — `<UserMenu>` in the top bar (replaces the hardcoded "Arun R. / arun@acme-corp.com"): live user.name / user.email / tenant.name pulled from `useAuth()`, with a real Sign out action that clears all state and routes back to `/login`.
- **ZONE 9** — `<ApiErrorBoundary>` class component (catches render-time errors and renders a recovery surface with Try-again / Reload) and an `<api-toast>` module that maps `ApiError.status` → user-facing copy (network / 4xx / 5xx / 429).
- **ZONE 10** — Backend endpoint audit (see "Backend dependency" below).

The chrome (Sidebar + Topbar + MobileNav) now hides itself on `/login` and `/auth/callback` via a new `<ShellChrome>` wrapper, and every workspace route is wrapped in `<AuthGuard>` and `<ApiErrorBoundary>`.

## Rationale (skill rules cited)

Adopted the rules surfaced by the three `python3 .claude/skills/ui-ux-pro-max/scripts/search.py` invocations:

| Skill result | How it landed |
| --- | --- |
| Sidebar → wrap in `SidebarProvider` at layout level | The existing `ShellProvider` already satisfies this; the new `<ShellChrome>` is mounted once at the layout level and gates the chrome on the pathname, which is the same architectural intent (single source of truth for chrome state). |
| Form → use Form with `react-hook-form` | `app/(auth)/login/page.tsx` uses `useForm` + `zodResolver` + shadcn `Form` + `FormField` + `FormMessage` exactly as the skill prescribes. |
| Toast → `toast.success` / `toast.error` semantics | `api-toast.tsx` maps `ApiError` → context-aware `toast.error(...)` calls. The login flow emits `toast.success('Welcome back')` on success. |
| Form message → use `FormMessage` after `FormControl` | Login form renders `<FormMessage />` directly under every field. |
| A11y → dialogs handle focus | All popovers/dropdowns use Radix primitives (focus trapping is free). |

Additional rationale:

- **Rule 2 (multi-tenancy)**: the API client *always* sends `x-forge-tenant-id`, derived from the active tenant in the auth store and falling back to the demo seed only when no tenant is selected. The header is never optional — even unauthenticated `/auth/login` carries it so the backend can decide tenant-scope policy.
- **Token storage**: localStorage is explicit per the goal's CONSTRAINTS section ("Tokens stored in localStorage (for now) — consider httpOnly cookies in production"). The auth store's `persist` config is the only place that knows the keys, so the production migration is a single-file change.
- **No client-side password validation**: the form validates email format (UX hint) but never validates password complexity — the server is the source of truth.
- **WebSocket auth**: `api.ws(path)` appends `?token=…` to the URL because browsers cannot set headers on the WebSocket handshake. The backend is expected to validate on `await ws.accept()`.

## What we deliberately did NOT change

- **Backend auth routes.** No `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/me/tenants`, `/auth/logout`, `/auth/oauth/{provider}`, or `/tenants/{id}/switch` endpoint exists yet in `backend/app/api/v1/`. The frontend is ready to call them, but they need to be added as a follow-up backend task before login can succeed end-to-end. Until then the existing demo paths (the persona cookie + the `acme-corp` seed) keep the dashboard rendering for development — meeting the CONSTRAINTS bullet "Don't break existing mock data display (during the transition)."
- **Page designs.** No visual hierarchy was changed: the top bar still has the same control cluster (just with a real TenantSwitcher + real UserMenu in place of the mocked selector and "Arun" avatar). Sidebar nav, breadcrumb, command palette, theme toggle — all unchanged.
- **Mock-data fallback.** Persona dashboards that read from the orchestrator REST stub (`lib/api.ts`) keep working because the new `lib/api/client.ts` is additive; nothing in the persona dashboards was rewritten to consume it.
- **Token storage backend.** As above — localStorage now, httpOnly cookies later. The four storage keys (`forge_token`, `forge_refresh`, `forge_user`, `forge_tenant`) are the only thing to swap.
- **Shell architecture.** The root layout still wraps everything in `<ShellProvider>`. We added `<ShellChrome>` to gate the chrome on the pathname instead of restructuring every page into a `(workspace)` route group — that refactor is safe to do once the backend endpoints land and the auth flow is verified end-to-end.

## Backend dependency

The following endpoints are required for the frontend to function end-to-end. None currently exist:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | Email + password → `{ access_token, refresh_token }` |
| POST | `/api/v1/auth/refresh` | `{ refresh_token }` → `{ access_token }` |
| GET | `/api/v1/auth/me` | Bearer token → `User` |
| GET | `/api/v1/auth/me/tenants` | Bearer token → `Tenant[]` |
| POST | `/api/v1/auth/logout` | Bearer token → 204 (currently called by client but not strictly required) |
| POST (redirect) | `/api/v1/auth/oauth/{provider}` | Returns the browser to `/auth/callback?token=…&refresh=…` |
| POST | `/api/v1/tenants/{id}/switch` | Bearer token → `{ tenant, access_token }` |

These should land as a single follow-up step (the schemas already mirror what `lib/api/auth.ts` declares — see `User`, `Tenant`, `LoginResponse`, `OAuthProvider`, `SwitchTenantResponse`).

## Tests

- `pnpm typecheck` passes with **zero new errors** introduced by step-52 (93 pre-existing errors remain in unrelated files: connector-center, command-center, knowledge/, ideation/, hooks/, tickets/detect.ts, tests/).
- Manual test plan once backend lands:
  1. **Login**: real credentials → success toast → redirect to `/dashboard`.
  2. **Tenant switch**: choose a different workspace → page reloads → all tenant-scoped data refetches under the new header.
  3. **Token expires**: wait for access-token TTL → next API call returns 401 → silent refresh fires → retry succeeds with no UI flicker.
  4. **Logout**: click Sign out → all state cleared → `forge_token` / `forge_refresh` / `forge_user` / `forge_tenant` removed from localStorage → redirect to `/login`.
  5. **OAuth**: Continue with Google/GitHub/Microsoft → redirect to provider → bounce back to `/auth/callback?token=…` → hydrate → redirect to `/dashboard`.

## Files added

```
apps/forge/lib/api/client.ts            # Zone 1 — typed API client
apps/forge/lib/api/auth.ts              # Zone 2 — Zustand auth store
apps/forge/app/(auth)/layout.tsx        # Zone 3 — auth route-group layout (chrome-free)
apps/forge/app/(auth)/login/page.tsx    # Zone 3 — login form
apps/forge/app/(auth)/auth/callback/page.tsx  # Zone 4 — OAuth callback
apps/forge/components/auth-guard.tsx    # Zone 5 — auth route guard HOC
apps/forge/components/tenant-switcher.tsx     # Zone 6 — workspace popover
apps/forge/components/user-menu.tsx     # Zone 8 — user dropdown
apps/forge/components/api-error-boundary.tsx # Zone 9 — render-time error boundary
apps/forge/components/api-toast.tsx     # Zone 9 — typed toast helpers
apps/forge/components/shell/ShellChrome.tsx   # chrome-free / workspace gate
```

## Files modified

```
apps/forge/app/layout.tsx               # use ShellChrome instead of inline chrome
apps/forge/components/shell/Topbar.tsx  # replace mocked Arun + mocked tenant selector with real TenantSwitcher + UserMenu
```