# Coding Conventions

**Analysis Date:** 2026-06-22

This document captures the coding conventions actually used across the
Forge AI monorepo (Next.js 15 frontend in `apps/forge/` and Python 3.13
FastAPI backend in `backend/`). It is prescriptive: future code should
match the patterns below, and existing deviations are flagged as anti-patterns.

---

## Languages & Versions

| Layer    | Language       | Version | Files                              |
|----------|----------------|---------|------------------------------------|
| Frontend | TypeScript     | 5.x     | `apps/forge/tsconfig.json`         |
| Frontend | Node           | >=20    | `apps/forge/package.json`          |
| Backend  | Python         | 3.13    | `backend/pyproject.toml`           |

**Mode flags:**

- Frontend `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`,
  `target: ES2022`, `moduleResolution: bundler`, `paths: { "@/*": ["./*"] }`.
- Backend Python: `from __future__ import annotations` at the top of every
  module (see `backend/app/main.py`, `backend/app/services/event_bus.py`).

---

## Naming Patterns

### Files

| Surface         | Convention                                                       | Example                                                          |
|-----------------|------------------------------------------------------------------|------------------------------------------------------------------|
| Backend modules | snake_case module name, plural folders for collections           | `app/services/connector_manager.py`                              |
| Backend tests   | `test_<unit>[_<scenario>].py`                                    | `backend/tests/test_idea_enhance.py`, `test_ideation.py`         |
| Backend fixtures| snake_case factories / `_seed_*` helpers in same file            | `_seed_idea()`, `_FakeBus`                                       |
| Frontend page   | `page.tsx` (Next.js App Router)                                  | `apps/forge/app/dashboard/page.tsx`                              |
| Frontend module | kebab-case folder + PascalCase component files                  | `components/connector-center/MarketplaceCard.tsx`                |
| Frontend util   | camelCase file, named export                                     | `lib/useRealtime.ts`, `hooks/use-api-data.ts`                    |
| Frontend tests  | `<unit>.test.{ts,tsx}` co-located in `apps/forge/tests/<area>/`  | `apps/forge/tests/timeline.test.tsx`                             |
| E2E tests       | `NN-<area>.spec.ts` numbered by area                             | `apps/forge/tests/e2e/01-smoke.spec.ts`                          |

### Functions and Methods

- Backend: snake_case for functions and methods
  (`async def submit_idea(...)`, `def can_access_connector_center(...)`).
- Frontend: camelCase for functions and methods
  (`function isRotationDeadlineImminent(...)`, `useRealtime(opts)`).
- React components: PascalCase exported function
  (`export function ConnectorDetailPanel({ ... }) { ... }`).
- Hooks: `use` prefix (`useRealtime`, `useApiData`, `useMigrationPlans`).
- Boolean accessors: `can...`, `is...`, `has...`
  (`canAccessConnectorCenter`, `isRotationDeadlineImminent`,
  `hasWebSocket`).

### Variables and Constants

- BACKEND module-level constants: SCREAMING_SNAKE_CASE
  (`DEV_TENANT_UUID` in `apps/forge/lib/api.ts`, `TOAST_LIMIT` in
  `apps/forge/hooks/use-toast.ts`).
- FRONTEND constant objects: PascalCase typed `Record`/`as const`
  (`STAGES_IN_ORDER`, `PERSONAS`, `RUN_BADGE`,
  `stageBadgeClass` in `apps/forge/components/Timeline.tsx`).
- React props interface: `<ComponentName>Props`
  (`ConnectorCardProps`, `UseRealtimeOptions`, `RealtimeTimelineProps`).

### Types

- Backend: PascalCase classes / `NewType` aliases
  (`class ConnectorManager`, `ConnectorStatus`, `class IdeaStatus(str, enum.Enum)`).
- Frontend: PascalCase type aliases and interfaces
  (`type Persona = 'pm' | 'eng-lead' | 'cto'`,
  `interface McpConnector`).
- Status enums expressed as string-literal unions
  (`type ToolCallStatus = "success" | "degraded" | "error"`,
  `type RunStatus = 'created' | 'running' | ...`).

### Tests

- Python: `def test_<unit>_<scenario>_when_<condition>_then_<result>()`
  (see `backend/tests/test_ideation.py`):
  `test_submit_idea_basic`, `test_enhance_writes_editor_note_to_latest_analysis`,
  `test_rotate_updates_config_emits_bus_event_and_reprobes`.
- TypeScript: `describe('<Unit>', () => { it('<behavior> when <condition> then <result>', ...)})`
  (see `apps/forge/tests/connector-card-mcp.test.tsx`,
  `apps/forge/tests/timeline.test.tsx`):
  `describe('<ConnectorDetailPanel>', () => { it('renders the detail panel with the right testid and data attributes', ...) })`.
- Both follow `docs/testing/test-naming.md` — preferred over vague
  names like `test_happy_path` or `test_1`.

---

## Code Style

### Frontend (TypeScript / Next.js)

- **Prettier** is the canonical formatter (CI runs
  `pnpm -r --filter "./apps/*" prettier --check .` per
  `.github/workflows/ci-frontend.yml`). No local `.prettierrc` is
  present at `apps/forge/`; the CI uses repo defaults.
- **ESLint** is run via `pnpm -r --filter "./apps/*" lint` per
  `.github/workflows/ci-frontend.yml`, but the `apps/forge/package.json`
  does NOT define a `lint` script. Treat the absence of a defined
  script as a known gap (do not add a new lint script without checking
  for the workspace-level config).
- **Indentation**: 2 spaces; **quotes**: single quotes for TS, double
  quotes allowed in JSX/JSX prop strings (mixed in practice, see
  `apps/forge/components/ConnectorStatusPill.tsx` vs
  `apps/forge/components/ConnectorCard.tsx` — match the surrounding
  file).
- **Semicolons**: always.
- **Trailing commas**: yes (multi-line).
- **Line length**: not strictly enforced; long URLs / test data run
  beyond 100 chars.
- **Numeric separators**: use underscores
  (`staleTime: 30_000`, `pollIntervalMs: 5_000`).

### Backend (Python)

- **Ruff** is the lint + formatter (config in `backend/pyproject.toml`).
  - `line-length = 100`, `target-version = "py313"`.
  - Selects: `E, F, I, B, UP, SIM, PL`.
  - Ignores: `PLR0913` (too many args), `PLR2004` (magic numbers),
    `B008` (default-argument function calls in FastAPI deps).
  - Per-file ignores: `app/api/**/*.py` allows `B008`; `tests/**/*.py`
    allows `PLR2004` and `B011` (asserts).
- **Mypy** runs against `app/` (config in `pyproject.toml`,
  `python_version = "3.13"`, `strict = false`, ignores missing imports).
- **Indentation**: 4 spaces.
- **Docstring style**: module-level triple-quoted docstring describing
  the module purpose + linked ticket (e.g.
  `"""FastAPI application entry point..."""` in
  `backend/app/main.py`).
- **String quotes**: double-quoted docstrings, single-quoted strings
  inside code (consistent with ruff defaults).

---

## Import Organization

### Frontend

1. React and Next.js framework imports
   (`import { useEffect, useState } from 'react';`,
   `import Link from 'next/link';`).
2. Third-party packages
   (`import { render, screen } from '@testing-library/react';`,
   `import { create } from 'zustand';`).
3. Workspace path-alias imports (`@/components/...`, `@/lib/...`)
   — always absolute via the `@/` alias defined in `tsconfig.json`
   (`paths: { "@/*": ["./*"] }`) and `vitest.config.ts`.
4. Relative imports only for tightly-coupled co-located modules
   (`import { Timeline } from './Timeline';` in
   `components/RealtimeTimeline.tsx`).

`use client` directive is the FIRST line of every client component
(see `components/PersonaSwitcher.tsx`, `components/RealtimeTimeline.tsx`,
`components/providers.tsx`, `hooks/use-api-data.ts`). Server components
omit the directive.

### Backend

1. `from __future__ import annotations` at top.
2. Standard library (`asyncio`, `enum`, `uuid`, `dataclasses`).
3. Third-party packages (`fastapi`, `sqlalchemy`, `structlog`,
   `pytest`).
4. First-party application imports grouped by layer
   (`app.core.*`, `app.db.*`, `app.api.*`, `app.services.*`,
   `app.schemas.*`).
5. Tests import the system-under-test by its real module path
   (`from app.services.ideation.idea_enhance import ...`).

Ruff's `I` rule enforces `isort`-compatible ordering. The codebase
follows the result of `ruff check --fix .`.

---

## Path Aliases

| Tool        | Alias          | Resolves to                            |
|-------------|----------------|----------------------------------------|
| `tsconfig`  | `@/*`          | `./` (the `apps/forge/` package root)  |
| `vitest`    | `@`            | `apps/forge/`                          |
| Shadcn/UI   | `components/`, `utils/`, `ui/`, `lib/`, `hooks/` | resolved via `components.json` to the same `@/...` paths |
| Backend     | `app.*`        | `backend/app/`                         |

Always prefer the `@/` alias over `../../../` chains. The
`components.json` file at `apps/forge/components.json` declares the
aliases Shadcn uses when emitting new components.

---

## Error Handling

### Backend

- **Strategy**: domain-specific exceptions + FastAPI `HTTPException`
  mapping at the route boundary.
- **Patterns:**
  - Custom errors raised in services (`raise LookupError(...)`,
    `raise PermissionError(...)`,
    `raise FileNotFoundError(...)` — see
    `backend/tests/test_connector_lifecycle.py::_StubManager`).
  - Routes translate to HTTP responses:
    ```python
    try:
        agent = await agent_registry.get_agent(agent_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    ```
    (from `backend/app/api/v1/agents.py`).
  - RBAC enforced at the dep factory (`_perm: Principal = require_permission(...)`)
    combined with audit decorator (`@audit(action="agents.list", ...)`).
  - Lifespan / boot code logs and swallows so one failure does not
    block startup; the structure is
    `try: ... except Exception: logger.exception("forge.X.failed")`
    (see `backend/app/main.py`).
- **Logging:** `structlog` via `get_logger(__name__)` (see
  `backend/app/core/logging.py`). Every log line carries
  `tenant_id`, `project_id`, `actor_id` via contextvars (Rule 2).

### Frontend

- **Strategy:** wrap transport failures into typed `OrchestratorError`
  with `status` and `body`; UI components branch on `RunsView.state`
  discriminated union (`unreachable` | `ready` | `empty`).
  See `apps/forge/lib/api.ts` (`OrchestratorError`) and
  `apps/forge/components/OrchestratorNotice.tsx`.
- **Patterns:**
  - `try/catch` in `request()` to wrap low-level errors:
    ```typescript
    try {
      res = await fetch(`${base()}${path}`, { ... });
    } catch (err) {
      throw new OrchestratorError(`orchestrator unreachable: ${message}`, 0, null);
    }
    ```
  - Components use `role="alert"` / `role="status"` and
    `data-testid="orchestrator-unreachable"` for unreachable-state
    banners.
  - Fetch hooks use `AbortController` for cancellation
    (`apps/forge/hooks/use-api-data.ts`).
  - Realtime hook (`apps/forge/lib/useRealtime.ts`) exposes a
    caller-supplied `fallbackPoll` so transport failures degrade to a
    polled cadence rather than surfacing as exceptions.

---

## Logging

- **Frontend:** `console` is the only observed logger in dev
  (no `logger.ts` / `pino` adapter). Errors are silently swallowed in
  background pollers (`.catch(() => { /* Silent */ })`) when the UI
  already surfaces an unreachable-state banner
  (`components/RealtimeTimeline.tsx`).
- **Backend:** `structlog` (`backend/app/core/logging.py`) with:
  - `configure_logging(level=settings.log_level)` in `main.py`
    lifespan.
  - JSON renderer in non-development; pretty `ConsoleRenderer` in
    development.
  - Contextvars (`tenant_id_ctx`, `project_id_ctx`, `actor_id_ctx`)
    injected on every line.

**Patterns:**
- Log keys are dotted (`forge.startup`, `forge.jira_ingestion.registered`,
  `forge.alerts.started`).
- All log lines use `logger.exception(...)` when capturing an error
  context, never `logger.error(...)` with manual formatting.
- Logger obtained via `from app.core.logging import get_logger`
  (every service / route module follows this).

---

## Comments and Docstrings

### When to Comment

- Module-level docstring is mandatory on every backend service
  (`backend/app/services/connector_manager.py`,
  `backend/app/services/event_bus.py`,
  `backend/app/api/v1/agents.py`).
- Public exports on the frontend carry a JSDoc block describing the
  contract and linking the ticket
  (`/** FORA-514 — useRealtime hook for the Forge console. */` in
  `apps/forge/lib/useRealtime.ts`).
- Block comments inside functions are used to explain *why* a
  non-obvious decision was made, never to restate the code
  (`// SSR safety: when window or WebSocket is not defined ...`
  in `apps/forge/lib/useRealtime.ts`).

### JSDoc / TSDoc

- Used on React component functions, hook entry points, exported
  utilities, and pure-function helpers (`backoffMsFor`,
  `fmtTime`, `fmtPct`).
- Format: opening `/**`, summary line, blank line, optional longer
  prose, `*/`.
- Reference ticket IDs (`FORA-514`, `FORA-578`, `FORA-579`,
  `FORA-128`, `FORA-501`, `Pillar 1 — Phase 2`) are surfaced inside
  the doc block so future readers can trace the change.

### Python Docstrings

- Use `"""..."""` triple-quoted blocks, no Napoleon / Google style
  required.
- Module-level docstring describes purpose + linked ticket / FR id.
- Function docstrings are rare; intent is usually conveyed by type
  hints + the function name. Prefer typed signatures over prose.

---

## Function Design

### Backend

- **Async-first:** every service method is `async def` and uses
  SQLAlchemy async sessions
  (`async with factory() as session: ...`).
- **Tenant + project IDs are explicit parameters** at the top of the
  signature, never implicit / closure-captured
  (`tenant_id: str, project_id: str, actor_id: str` — see
  `backend/tests/test_connector_lifecycle.py`,
  `backend/app/services/connector_manager.py`).
- **Pydantic models** at the API boundary; **dataclass** for internal
  data carriers (`@dataclass class TestResult` in
  `backend/app/services/connector_manager.py`).
- **Idempotency-Key** header convention is used by every mutating
  client (tests assert it is forwarded).

### Frontend

- **React components** take a typed `Props` interface. Public props are
  `readonly`. Components return JSX directly; no `React.FC` wrapper.
- **Hooks** take a single options object and return a single result
  object (`useRealtime(opts): UseRealtimeResult`,
  `useApiData<T>(path, init?): UseApiDataResult<T>`).
- **SSR safety:** hooks check `typeof window === 'undefined'` and
  `typeof WebSocket !== 'undefined'` and short-circuit to a no-op
  (see `lib/useRealtime.ts` `hasWebSocket()`).
- **Pure helpers** are exported for testability (`backoffMsFor`,
  `isRotationDeadlineImminent`, `cn`).

### Parameters and Returns

- Use `ReadonlyArray<T>` for fetched data to discourage accidental
  mutation (`apps/forge/lib/types.ts`,
  `apps/forge/lib/useRealtime.ts`).
- Use `as const` for literal tuples that drive `keyof` / union
  derivations (`PERSONAS`, `STAGES_IN_ORDER`).
- Use discriminated unions for state machines (`RunsView` in
  `apps/forge/lib/api.ts`).

---

## Module Design

### Exports

- Prefer **named exports** for everything (`export function ...`,
  `export interface ...`, `export const ...`).
- **Default exports** are reserved for Next.js `page.tsx` /
  `layout.tsx` modules (`export default function RootLayout` in
  `apps/forge/app/layout.tsx`,
  `export default RefactorCenterPage` in
  `apps/forge/tests/refactor/page.test.tsx`).
- **Barrel files** are NOT used; consumers import from the source
  module directly.

### Module Boundaries

- Backend: `app.api.v1.<domain>` exposes only FastAPI routers; logic
  lives in `app.services.<domain>`.
- Frontend: `lib/` is for cross-feature utilities; `components/<area>/`
  is feature-scoped; `hooks/` is for React-only hooks.

---

## Anti-Patterns to Avoid

### Anti-Pattern: Inline `node:`-scheme imports in browser-reachable modules

**What happens:** Some `lib/*.ts` files are imported from both server
components and client components. Importing `node:fs` directly in those
modules breaks the browser bundle with `UnhandledSchemeError`.

**Why it's wrong:** Documented in the warning block at the top of
`apps/forge/lib/api.ts`. The fix is to read server-only resources in a
Next.js route handler (`/api/proxy/*`).

**Do this instead:** Read the `.stub-port` file inside the proxy route
handler, never inside a shared lib module.

### Anti-Pattern: Casting through `unknown` for WebSocket doubles

**What happens:** Tests inject a fake `WebSocket` constructor by
assigning it to `globalThis.WebSocket` and casting
`as unknown as typeof WebSocket`
(`apps/forge/tests/useRealtime.test.ts`).

**Why it's wrong:** The duck-typing seam is intentional — the hook
only relies on `addEventListener` + `close` + `constructor`. The cast
is the test seam, not a hack.

**Do this instead:** When testing hooks with WebSocket, follow the
exact pattern: install the fake on `globalThis`, cast through
`unknown`, and clean up in `afterEach` with
`Reflect.deleteProperty(globalThis, 'WebSocket')`.

### Anti-Pattern: Mocking the database when behavior depends on it

**What happens:** A few early tests used a magic mock instead of the
in-memory SQLite engine.

**Why it's wrong:** `docs/testing/test-strategy.md` §4 explicitly
forbids this: "Never mock the database unless you are doing pure logic
work. RLS bugs hide behind mocks."

**Do this instead:** Use the `sqlite_db` fixture from
`backend/tests/conftest.py` which spins up an in-memory async
SQLite engine with model metadata registered.

### Anti-Pattern: Hand-typed tenant / project ID tuples

**What happens:** Some call sites hardcode `(tenant_id, project_id)`
inside service bodies.

**Why it's wrong:** Violates Rule 2 (Multi-Tenancy by Default) —
every query must carry `tenant_id` and `project_id` explicitly.

**Do this instead:** Pass them as named keyword args from the route
handler down (`tenant_id=principal.tenant_id`,
`project_id=body.project_id` — see `backend/app/api/v1/agents.py`).

### Anti-Pattern: Direct LLM SDK imports

**What happens:** None observed in the current codebase.

**Why it's wrong:** Violates Rule 1 (Model-Provider Agnosticism).
LiteLLM is the only LLM client; `httpx` is the transport
(`backend/requirements.txt` comment: "openai/anthropic/google-generativeai
are NOT direct deps").

**Do this instead:** Always go through `app.services.litellm_client`
or the LiteLLM Proxy at `LITELLM_PROXY_URL`.

### Anti-Pattern: `@fora/*` package scope in v2.0 code

**What happens:** A few comments / docstrings still reference
`@fora/*` Paperclip-era package names.

**Why it's wrong:** Per the v2.0 naming rule in `.claude/CLAUDE.md`:
"NO `@fora/*` scope in v2.0 code." Use `apps/forge`,
`packages/forge-<name>`, or `@forge-ai/<name>` instead.

**Do this instead:** New code uses `forge-dashboard` (the existing
`apps/forge` package name), `forge-backend`, etc. Active code that
still references `@fora/*` should be migrated or archived.

---

## Where Conventions Are Enforced

| Layer    | Tool                | Where                                          |
|----------|---------------------|------------------------------------------------|
| Frontend | Prettier            | `.github/workflows/ci-frontend.yml` (`prettier --check .`) |
| Frontend | ESLint              | `.github/workflows/ci-frontend.yml` (`pnpm -r --filter "./apps/*" lint`) |
| Frontend | TypeScript          | `apps/forge/tsconfig.json` (`strict`, `noUncheckedIndexedAccess`) + `tsc --noEmit` in CI |
| Backend  | Ruff (lint+format)  | `backend/pyproject.toml` `[tool.ruff]`, `scripts/lint.sh` |
| Backend  | Mypy                | `backend/pyproject.toml` `[tool.mypy]`, `scripts/lint.sh` |
| Backend  | pytest              | `backend/pyproject.toml` `[tool.pytest.ini_options]` |
| Both     | Coverage gates      | `.github/workflows/ci-backend.yml` (`--cov-fail-under=70`) and `.github/workflows/ci-frontend.yml` (`vitest --coverage`) |

Tests at the appropriate tier are required by CODEOWNERS review per
`docs/testing/test-strategy.md` §8: "Every PR that adds production code
must add at least one test at the appropriate tier."

---

*Convention analysis: 2026-06-22*
