# Stack Research — Delta to Existing Stack Map

**Project:** Forge AI v2.0 (Agent Operating System)
**Researched:** 2026-06-23
**Mode:** Ecosystem delta — does NOT re-derive decisions documented elsewhere
**Confidence:** HIGH on drift facts (verified in source files); MEDIUM on version recommendations (verified against upstream release notes where fetched); LOW on unverified pilot-impact calls

---

## Purpose of This Document

The `2026-06-20` architecture research (`docs/research-forge-architecture-decisions-2026-06-20.md`, 36KB) resolved OQ-005/006/007 and committed the substrate: PostgreSQL 17 + Apache AGE + pgvector, PostgreSQL RLS, LiteLLM Proxy, LangGraph supervisor, Keycloak, React Flow. The codebase map (`.planning/codebase/STACK.md`, 2026-06-22) inventory the installed versions.

**This document does not re-justify those decisions.** It documents only:

1. **Drift** — where the codebase disagrees with `CLAUDE.md` declarations (Tailwind, etc.)
2. **Staleness** — versions installed in `package.json` / `requirements.txt` that are behind their 2026 stable releases
3. **Missing for pilot readiness** — components the codebase map does not yet name but PILOT-01..PILOT-10 require
4. **What NOT to use** — explicit anti-recommendations for technologies the question raises (Neo4j, OpenRouter, Temporal, CrewAI) with rationale grounded in the existing stack

Every recommendation below cross-references the file that already documents the decision, so this file is additive, not duplicative.

---

## 1. Stack Drift — Already in Code, Conflicts with Declarations

### 1.1 Tailwind CSS 3.4.14 installed vs Tailwind 4 declared — **HIGH IMPACT**

**Where it lives:**
- Installed: `apps/forge/package.json` line `"tailwindcss": "3.4.14"` (devDependencies)
- Declared: `.claude/CLAUDE.md` line `Tailwind CSS 4` and `docs/architecture/overview.md` row "Frontend | Tailwind CSS 4"
- Flagged: `.planning/PROJECT.md` "Known issues" and `.planning/PROJECT.md` "Stack drift (Tailwind 4 vs 3.4.14)" in Constraints

**Why it matters now:** Tailwind 4 (released January 2025) is **not a drop-in upgrade**. Major changes:
- CSS-first config (`@theme` directive replaces `tailwind.config.js`)
- Engine rewrite (Rust-free, Oxide-powered Lightning CSS)
- Removed: `@apply` is de-prioritized, JIT is now default-on, default palette moved
- New: `@tailwindcss/postcss` plugin replaces `tailwindcss` PostCSS plugin
- Shadcn/UI components that target Tailwind 4 (post-`shadcn@2.4`) use the new theme tokens

**Recommendation:**
- **Pilot path (recommended):** Stay on Tailwind 3.4.14 for the pilot. Update CLAUDE.md and overview.md to say "Tailwind 3.4.x" — declare the *actual* state. Tailwind 3 is in security maintenance through the end of 2026; pilot finishes well before that window.
- **Post-pilot path:** Plan a Tailwind 4 migration as a dedicated phase after pilot ships, paired with shadcn/ui regeneration. Do NOT mix Tailwind 3 and 4 themes.

**Pilot-readiness impact:** Blocks the "update docs to match reality" step that PILOT-09 (Constitution rulebook) requires. Resolve in Phase 0, before any roadmap commits decisions that touch styling.
**Confidence:** HIGH (drift is verified in source files); HIGH on Tailwind 4 breaking-change shape (well-documented release).
**Source:** `.planning/PROJECT.md` Constraints section; `apps/forge/package.json`; upstream Tailwind v4.0 release notes.

---

### 1.2 React 19 RC pinned — **MEDIUM IMPACT**

**Where it lives:** `apps/forge/package.json` `"react": "19.0.0-rc-66855b96-20241106"` and matching `react-dom`. Pinned to a specific RC hash from 2024-11-06.

**Why it matters now:** React 19 GA shipped December 2024; a fresh stable is now mainstream. Pinning to an RC hash:
- Loses React 19 GA bug fixes (especially `use()`, `useActionState`, server-component edges)
- Surfaces a non-reproducible dependency (the exact RC tarball may be reaped from the npm registry mirror)
- Breaks expectations in `tsconfig` consumers expecting `@types/react 19.x`

**Recommendation:**
- **Pilot path:** Move to `react@^19.0.0` and `react-dom@^19.0.0` matching `@types/react 19.x`. Verify all Shadcn/Radix components are 19-compatible (Radix shipped 19-compatible primitives in Q1 2025).
- Verify `next@15.0.3` → `next@^15.1.0` (or newer 15.x) because Next.js 15.0.3 predates the official React 19 stable support matrix.

**Pilot-readiness impact:** Medium. React 19 RC has no known blockers in the v2.0 surface, but the pin pattern is a smell that gets surfaced by `pnpm audit` and dependency-review bots.
**Confidence:** HIGH.
**Source:** `apps/forge/package.json`; Next.js 15 release notes.

---

### 1.3 `litellm` Python client SDK pulled at all — **LOW IMPACT, WATCH**

**Where it lives:** `backend/requirements.txt` `litellm>=1.40,<2` with the comment "client SDK ONLY for type stubs; HTTP via httpx in production." `.planning/codebase/INTEGRATIONS.md` repeats this.

**Why it matters now:** The codebase map claims Rule 1 (provider-agnostic) is satisfied because `httpx` is used in production. That is correct for runtime traffic — but the `litellm` package itself is a large dependency surface that *also* imports provider SDKs transitively (it bundles OpenAI, Anthropic, etc. for its own internal use). Importing `litellm` types in app code is fine; importing it at runtime risks re-introducing the SDKs the rule forbids.

**Recommendation:**
- **Pilot path:** Keep the comment. Add a CI grep gate: `backend/app/services/litellm_client.py` is the *only* file allowed to `import litellm`. All other modules go through `litellm_client`.
- Add an `import-linter` rule (or `ruff` custom check) that fails the build if any module outside `litellm_client` imports `litellm`.
- Document this gate in the constitutional rules section of `CLAUDE.md`.

**Pilot-readiness impact:** Low for runtime (gate already enforced by convention), but the gate is a one-liner away from becoming a real linter rule. Worth doing before pilot so a future contributor cannot accidentally re-import provider SDKs.
**Confidence:** HIGH on the risk shape; LOW on whether the transitive provider SDKs are already triggering linter warnings today (not verified).
**Source:** `backend/requirements.txt`; `backend/app/services/litellm_client.py`; Rule 1 in `.claude/CLAUDE.md`.

---

### 1.4 `node-pty` in frontend deps — **LOW IMPACT, ARCHITECTURAL SMELL**

**Where it lives:** `apps/forge/package.json` `"node-pty": "^1.0.0"` in devDependencies alongside `"ws": "^8.18.0"`.

**Why it matters now:** `node-pty` is a native module that compiles against the Node ABI. It is run by `bin/terminal-server.mjs` per the `dev:terminal` script — a *separate* Node process spawned by the Next.js dev workflow. This is documented (`STACK.md` "backend terminal PTY (used via the separate terminal-server.mjs)"), so it is not a bug — but the architecture question this raises is: **should the terminal server live inside `apps/forge` or move to its own package?**

`ADR-006` (`0006-terminal-center-xterm-native-pty.md`) commits to "PTY for terminals" but doesn't pin the runtime boundary. Having `node-pty` shipped in the Next.js app's `node_modules` (even as a devDependency) couples the UI build to a native-module compile step on every developer laptop.

**Recommendation:**
- **Pilot path:** Move `node-pty` + `terminal-server.mjs` into a dedicated `packages/forge-terminal-server` workspace package. This isolates the native build, lets it ship its own `Dockerfile` (so CI doesn't need `build-essential` in the Next.js stage), and makes the terminal server's lifecycle explicit (start/stop, health check, port management).
- Document the move as a refactor that does not change behavior — the only goal is packaging hygiene.

**Pilot-readiness impact:** Low for pilot (it works today), high for scale-out (multi-region deploys will hit this first).
**Confidence:** MEDIUM.
**Source:** `apps/forge/package.json`; `apps/forge/bin/terminal-server.mjs`; `ADR-006`.

---

## 2. Version Staleness — Behind 2026 Stable Releases

The codebase map was generated 2026-06-22. Versions below are the *currently installed* version vs the **2026 stable** as of this research date. Each row only flags items where there is a meaningful gap.

### 2.1 Frontend

| Package | Installed | 2026 Stable | Gap | Pilot Action |
|---|---|---|---|---|
| `next` | `15.0.3` | `15.4.x` (15.x line) | Behind by ~5 minors | Bump to `^15.1.0` minimum; full `^15.4` if 19 React stable upgrade lands first |
| `react`, `react-dom` | `19.0.0-rc-...` | `19.1.x` stable | RC → stable gap | See §1.2 |
| `tailwindcss` | `3.4.14` | `3.4.17` (3.x) or `4.1.x` (4.x) | Patch behind on 3.x line | Bump to `3.4.17` for the pilot path; defer Tailwind 4 to post-pilot |
| `vitest` | `2.1.0` | `3.x` stable (released late 2025) | Major behind | Bump to `^3.0.0`; check `@vitest/coverage-v8` and `jsdom` peer compatibility |
| `@playwright/test` | `1.48.0` | `1.5x` | Behind by several minors | Bump to latest 1.x; required for E2E in CI to match modern browser versions |
| `zod` | `^3.23.8` | `3.24.x` or `4.x` | Patch behind | Bump to `^3.24.0`; do not jump to 4.x without auditing Shadcn form resolvers |
| `lucide-react` | `^0.453.0` | `0.460+` | Behind | Bump — icon library churn is low-risk |
| `@hookform/resolvers` | `^3.9.0` | `^3.10.0` | Minor behind | Bump — pairs with Zod 3.24 |

**Confidence:** MEDIUM (versions verified against public release pages; exact 2026-stable minor depends on release cadence).
**Pilot-readiness impact:** Med. None are blockers. The Tailwind bump is the highest-impact; everything else is hygiene.

### 2.2 Backend

| Package | Installed | 2026 Stable | Gap | Pilot Action |
|---|---|---|---|---|
| `fastapi` | `>=0.115,<0.117` | `0.115.x` line; `0.116` may have shipped | On track | Tighten the cap to `,<0.116` and bump when FastAPI 0.116 lands |
| `pydantic` | `>=2.7,<3` | `2.10+` | Behind | Bump to `>=2.10,<3` — 2.10 added several performance and serialization improvements |
| `sqlalchemy` | `>=2.0,<2.1` | `2.0.x` (still 2.0 line) | On track | No action; 2.1 is not yet GA |
| `asyncpg` | `>=0.29,<0.31` | `0.30.x` | On track | No action |
| `langgraph` | `>=0.2.0` | `0.2.x` or `0.3.x` | Verify | Pin to a known-good minor after a 2-week soak window — LangGraph has had breaking-change releases between minors in the past |
| `langchain` / `langchain-core` | `>=0.3.0` | `0.3.x` | On track | Pin exact minor to avoid `langchain-core` mismatch with `langgraph` |
| `litellm` | `>=1.40,<2` | `1.50+` | Behind | Bump to `>=1.50,<2` after verifying the Proxy image (`ghcr.io/berriai/litellm:main-latest`) is on a compatible server version |
| `structlog` | `>=24.1,<25` | `25.x` | Behind | Bump to `>=25,<26`; 25.x changed the dev/prod renderer defaults |
| `redis` (Python) | `>=5.0,<6` | `5.x` or `6.x` | Verify | Stay on `5.x`; check if `redis-py` 6 has breaking changes around cluster mode |
| `httpx` | `>=0.27,<0.29` | `0.28.x` | Behind by minor | Bump to `>=0.28,<0.30` |
| `apscheduler` | `>=3.10,<4` | `3.10.x` | On track | No action (single-replica scheduler is already documented as a follow-up) |
| `watchdog` | `>=4.0,<7` | `6.x` | On track | No action |

**Confidence:** MEDIUM (versions verified; exact 2026-stable minors may shift).
**Pilot-readiness impact:** Med. None are blockers. `langgraph` is the most consequential — pin exact minor to avoid drift.

### 2.3 Infrastructure / Container

| Image | Pinned | Recommendation |
|---|---|---|
| `pgvector/pgvector:pg17` | `:pg17` (latest patch) | Pin to `pg17` major; let patch float. **Verify pgvector and Apache AGE versions are co-installed in the chosen patch.** |
| `redis:7-alpine` | `:7-alpine` | **Consider bumping to `redis:8-alpine`** — Redis 8 shipped in 2025 with vector search built in, which could obviate parts of pgvector for cache-side similarity. Pilot stays on 7; post-pilot ADR. |
| `quay.io/keycloak/keycloak:26.0.0` | `26.0.0` exact pin | Good. Keycloak 26 is the current LTS; keep pinning exact. |
| `ghcr.io/berriai/litellm:main-latest` | `main-latest` (floating) | **Pin to a specific LiteLLM release tag.** Floating tags make rollback and audit unreliable. Pick the tag matching the Python `litellm` SDK minor. |
| `floci/floci:latest` | `:latest` (floating) | **Pin to a specific version.** Floci is the LocalStack Community successor; "sunset March 2026" is documented in `INTEGRATIONS.md` — there is no guarantee that `:latest` exists tomorrow. |

**Confidence:** HIGH on pin-discipline recommendation; MEDIUM on Redis 8 vector-search parity with pgvector for Forge's specific use cases (not benchmarked here).
**Source:** `docker-compose.yml`; `.planning/codebase/INTEGRATIONS.md`.

---

## 3. Missing for Pilot Readiness

The codebase map names everything *built*. PILOT-01..PILOT-10 (`.planning/PROJECT.md` "Active") name everything *required*. The delta is below.

### 3.1 WebSocket / Realtime library — **NOT NAMED IN CODEBASE MAP**

**PILOT-06** ("Terminal Center streams live agent execution...over WebSocket with replay capability") requires a server-push transport. The codebase has:
- `websockets>=13.0,<14` in backend (correct for FastAPI)
- `ws ^8.18.0` in frontend (matches the dev terminal-server)
- `app/api/ws/terminal_broadcast.py`, `app/api/ws/runs.py` (per `INTEGRATIONS.md`)

**What's missing in the map:** No client-side React hook for WS connection state, retry, reconnect, or message-type discriminated union typing. The terminal center has its own protocol (xterm bytes + ANSI), but the **run timeline** and **audit timeline** need a typed WS client.

**Recommendation:**
- Add `^1.8.0` for a typed WS client (TanStack Query already provides hooks for HTTP polling; for WS, the de-facto pair is `react-use-websocket` or `@tanstack/react-query`'s `streamedQuery` if 5.62+).
- Define a discriminated-union `ForgeWsEvent` schema in `packages/connector-events` (already 0.1.1 per `STACK.md`; can extend it) so the WS client and backend share types.

**Pilot-readiness impact:** HIGH. PILOT-04 (Audit Timeline) and PILOT-05 (Approval Timeline) become unusable in real time without a typed WS client.
**Confidence:** HIGH.

### 3.2 Cost / budget ledger schema — **DOCUMENTED IN RESEARCH, NOT IN CODE**

The 2026-06-20 research (§Q7) commits to "workflow-level + token-level breakdown" with "LiteLLM `response_cost` callback + workflow aggregation." The codebase has `litellm_client.py` and `audit_log`, but no ledger table is named in the codebase map.

**Recommendation:**
- Before pilot: add an ADR-009 (`0009-cost-ledger-schema.md`) that names the table columns: `{tenant_id, engagement_id, workflow_id, provider_id, model_id, input_tokens, output_tokens, cost_usd, ts}` — exactly as the research specifies.
- Add a brief integration test in `backend/tests/` that asserts: every LiteLLM completion call writes exactly one `cost_ledger` row with non-null `workflow_id`.

**Pilot-readiness impact:** HIGH. PILOT-05 (Approval Timeline with cost gates) requires the ledger to exist, not just be designed.
**Confidence:** HIGH (schema is in the research); MEDIUM on the test framing (depends on existing test infrastructure).

### 3.3 Source-of-truth conflict schema — **DOCUMENTED IN RESEARCH, NOT IN CODE**

The 2026-06-20 research (§Q2) commits to a `conflicted` state, `priority_policy` table, and `conflict_events` audit record. None are named in the codebase map.

**Recommendation:**
- ADR-010 (`0010-source-of-truth-conflict-policy.md`) before any code lands. Same urgency as ADR-009.
- Without this schema, PILOT-03 (Knowledge Graph visualization with color-coded by status: draft / approved / deployed) has no `conflicted` state to color.

**Pilot-readiness impact:** HIGH (PILOT-03).
**Confidence:** HIGH.

### 3.4 Multi-tenant CMK envelope — **NAMED IN RESEARCH, NOT IN CODEBASE**

The research §Q3 and §Q5 commit to per-tenant AWS KMS CMKs with annual rotation. The codebase map does not name any KMS abstraction. AWS SDKs only appear inside MCP servers (`mcp-aws`, `mcp-secrets`) — the backend has no direct KMS surface.

**Recommendation:**
- **Pilot path:** Per-tenant CMK is over-engineering for one-tenant pilot. Document this as a deferred decision in ADR-011 (`0011-kms-pilot-vs-multi-tenant.md`): pilot uses a single AWS-managed KMS key, with an explicit migration path to per-tenant CMK at tenant #3 or #5.
- The `mcp-secrets` server's `rotate(secret_ref)` tool already supports per-secret rotation; extend it with KMS key references.

**Pilot-readiness impact:** LOW for pilot (one tenant, one key is fine); HIGH for the multi-tenant story.
**Confidence:** HIGH.

### 3.5 Frontend RBAC enforcement — **NOT NAMED IN CODEBASE MAP**

The codebase has `forge:admin` short-circuit + JWT permission bundle + `PolicyEngine` in `backend/app/services/{rbac,policy_engine}.py`. But the **frontend** also needs to gate UI elements (PILOT-05 one-click approve/reject requires the button to render only for users with `forge:approve:*` permission).

**Recommendation:**
- Add `apps/forge/lib/rbac.ts` — a typed wrapper around JWT claim extraction + permission check, paired with a `<RequirePermission scope="forge:approve:architecture">...</RequirePermission>` component.
- Use the same permission strings on frontend and backend so the audit log shows the same `permission` field as the UI's gating decision.

**Pilot-readiness impact:** HIGH for PILOT-05 (Approval Timeline).
**Confidence:** HIGH.

### 3.6 Per-tenant cost attribution in event bus envelopes — **PARTIAL**

`backend/app/services/event_bus.py` already wraps events in `{tenant, project}` envelopes (per `STACK.md`). Cost attribution requires `engagement_id` and `workflow_id` on every event that triggers an LLM call. The codebase map does not confirm this is present.

**Recommendation:**
- Verify event_bus envelopes carry `engagement_id` and `workflow_id` (not just `tenant`/`project`). If absent, add them — this is a one-line schema change but a one-week audit to backfill.
- Add a property test that asserts every `litellm_client.completion()` call has a `workflow_id` in its envelope or raises.

**Pilot-readiness impact:** HIGH for cost attribution (NFR-030).
**Confidence:** MEDIUM (depends on current envelope shape; not verified here).

---

## 4. What NOT to Use — Anti-Recommendations

The question explicitly asks for rationale on the alternatives the existing research already eliminated. The delta is: re-state each anti-recommendation as a *pilot-relevant* decision, with one-line rationale grounded in the existing stack.

### 4.1 **NOT Neo4j** for the knowledge graph — even if a team member suggests it

**Why not:**
- Forces a second database engine (PostgreSQL + Neo4j = dual operational footprint)
- RLS is a Postgres concept; Neo4j multi-tenancy is either per-database-per-tenant (operational overhead) or app-layer filtering (defeats defense in depth)
- Cannot join `services` (relational table) with `:DEPENDS_ON` (graph edge) in a single query without ETL — F-103 architecture discovery needs this natively
- ADR-002 (`0002-postgresql-17-apache-age-pgvector.md`) already commits to PostgreSQL + Apache AGE; switching now would invalidate the entire data layer

**Source:** `docs/research-forge-architecture-decisions-2026-06-20.md` §Q1; `docs/architecture/overview.md` "Graph" row.
**Pilot-readiness impact:** N/A — already decided. Document this anti-pattern in the architecture ADR so a future contributor doesn't re-open the question.

### 4.2 **NOT FalkorDB** as a lighter Apache AGE alternative

**Why not:**
- FalkorDB is a Redis-based graph (LiteGraph fork). It would split the data plane: graph goes to Redis, relational stays in Postgres.
- Breaks the **single-substrate** commitment: backup/restore, replication, and tenant isolation would have to be solved twice.
- RLS does not apply; multi-tenancy would have to be re-implemented at the app layer for graph data.
- Loses the hybrid SQL+Cypher query pattern that F-103 needs.

**Pilot-readiness impact:** N/A — same as Neo4j. Anti-recommendation only.

### 4.3 **NOT OpenRouter as the primary LLM gateway** — keep LiteLLM Proxy

**Why not:**
- OpenRouter is a routing marketplace, not an audit instrument. It does not provide per-key virtual keys with budgets, does not have `store_audit_logs`, does not provide Prometheus cost metrics that the cost ledger requires.
- LiteLLM Proxy can route *to* OpenRouter as a provider (`openrouter/*` model names) — best of both worlds. The proxy layer is the boundary; OpenRouter is one of many upstream providers.
- The existing decision (`ADR-005` and `INTEGRATIONS.md`) commits to LiteLLM as the only ingress. OpenRouter can be added as a configured upstream provider; it cannot replace the proxy.

**Pilot-readiness impact:** N/A — already decided.
**Source:** `ADR-005`; `docs/research-forge-architecture-decisions-2026-06-20.md` §Q4.

### 4.4 **NOT Temporal** as the agent orchestrator — keep LangGraph supervisor

**Why not:**
- Temporal is a workflow-as-code engine, not an LLM-aware orchestrator. LangGraph provides: stateful checkpoints for resumable SDLC runs, HITL interrupts that map 1:1 to the constitutional approval gates (Rule 3), and a typed state schema that the audit log can serialize.
- HITL interrupt is the constitutional enforcement point (`backend/app/agents/approval_gate.py`). Re-implementing this in Temporal would mean re-writing the gate logic in Go/TypeScript and losing the LangChain/LangGraph tool ecosystem.
- Temporal is a strong choice for *non-LLM* long-running workflows. Forge's workflows are LLM-first; LangGraph is the natural fit.

**Pilot-readiness impact:** N/A — already decided. Document as anti-pattern.
**Source:** `ADR-007`; `backend/app/agents/sdlc_agent.py`; `backend/app/agents/approval_gate.py`.

### 4.5 **NOT CrewAI / AutoGen** as the multi-agent framework — keep LangGraph

**Why not:**
- CrewAI and AutoGen are role-playing multi-agent abstractions. Forge's SDLC supervisor is a *state machine* with explicit phases (`discovery → planning → architecture → implementation → testing → security → review → deployment`), not a free-form conversation among agents.
- LangGraph's `StateGraph` + `interrupt` is the natural primitive for the phase machine + approval gates. CrewAI's "crew" abstraction does not map cleanly.
- LangGraph integrates with LiteLLM Proxy natively (via the OpenAI-compatible completion interface), preserving Rule 1.
- The existing code (`sdlc_agent.py`, `refactor_agent.py`) is already on LangGraph.

**Pilot-readiness impact:** N/A — already decided.
**Source:** `ADR-007`; `backend/requirements.txt` (`langgraph>=0.2.0`).

### 4.6 **NOT `@modelcontextprotocol/sdk` versions prior to 1.0** — already on `^1.0.4` ✓

The codebase is already on the correct major. **Verify pin policy:** the `mcp-servers/*` packages use `^1.0.4` which is a caret range — they will auto-bump to `1.5+` etc. when new releases land. The TypeScript SDK has been breaking-change-active; pin to an exact minor per-server until pilot ships.

**Source:** `STACK.md` "MCP Servers" section.

### 4.7 **NOT `create-llama` / `langchain` agent frameworks outside `litellm_client.py`**

**Why not:** Same as Rule 1. Anything that imports `langchain_openai`, `langchain_anthropic`, `langchain_google_genai`, etc. directly from `langchain-core` re-introduces a provider SDK. The codebase map confirms the gateway path; the anti-pattern is the *test fixtures* — they sometimes pull in direct SDKs for "convenience." Add a CI grep gate.

**Source:** Rule 1 in `.claude/CLAUDE.md`.

---

## 5. Stack Patterns by Pilot Variant

**If pilot tenant is small (< 50 engineers) and AWS-native:**
- Single AWS account, single RDS, single ElastiCache, single ECS service.
- Per-tenant CMK deferred (single KMS key for the pilot tenant is sufficient — see §3.4).
- Single LiteLLM Proxy replica; HA deferred to multi-tenant.

**If pilot tenant needs data residency in EU:**
- Add `eu-west-1` region to ADR-001; LiteLLM Proxy image is region-agnostic.
- KMS keys stay in the same region as the data (no cross-region replication for pilot).

**If pilot customer has a non-GitHub primary VCS:**
- The `mcp-router` package already supports swapping connectors via the manifest; add the appropriate MCP server (Bitbucket, GitLab) to the marketplace.
- No backend code change required; this is the *point* of Rule 8.

**If pilot customer wants Claude-only or OpenAI-only:**
- Already supported via LiteLLM Proxy model catalog in `infra/litellm/config.yaml`. Add the model name to the catalog; no code change.

---

## 6. Version Compatibility — Pilot Blockers

| Package A | Compatible With | Notes |
|---|---|---|
| `react@^19.0.0` | `next@^15.1.0` | Next.js 15.0.3 predates official React 19 stable. Bump Next first, then React. |
| `langgraph@^0.2.x` | `langchain-core@^0.3.x` | Cross-package pinning must be exact — mismatched minors cause cryptic `Runnable` errors |
| `litellm>=1.50,<2` (Python) | `ghcr.io/berriai/litellm:<exact-tag>` | Proxy image must match SDK major. Pin both. |
| `pgvector/pgvector:pg17` | `apache-age` (init script) | Verify the chosen pg17 patch includes the AGE-compatible pgvector version |
| `@modelcontextprotocol/sdk@^1.x` | Node 20+ | Already on Node 22 Alpine per Dockerfile |

---

## 7. Immediate Actions for Pilot Readiness

In order of dependency:

1. **Phase 0, before any pilot-phase plan lands:**
   - Resolve Tailwind drift — update CLAUDE.md/overview.md to say Tailwind 3.4.x, OR commit to a Tailwind 4 migration with a clear scope. (See §1.1.)
   - Pin `node-pty` removal into a package refactor. (See §1.4.)

2. **Phase 1 first sub-task:**
   - Write ADR-009 (cost ledger schema) and ADR-010 (conflict policy schema). The research already commits to both shapes; the ADRs make them architecture-locked. (See §3.2, §3.3.)

3. **Phase 1, parallel with above:**
   - Bump frontend React/Next/Tailwind/Vitest/Zod/lucide-react to current minors. (See §2.1.)
   - Bump backend Pydantic/litellm/structlog/httpx to current minors. (See §2.2.)
   - Pin LiteLLM Proxy image and floci image to exact versions. (See §2.3.)

4. **Phase 2:**
   - Add WS client + typed event schema for PILOT-04/05/06. (See §3.1.)
   - Add frontend RBAC enforcement for PILOT-05. (See §3.5.)

5. **Phase 3:**
   - Verify event_bus envelopes carry `engagement_id` + `workflow_id`. (See §3.6.)
   - Pilot tenant comes online.

---

## 8. Confidence Assessment

| Area | Confidence | Reason |
|---|---|---|
| Drift facts (Tailwind 3.4.14, React RC, litellm client SDK comment) | HIGH | Verified in `package.json`, `requirements.txt`, `docker-compose.yml` |
| Drift fixes (recommended target versions) | MEDIUM | Verified against upstream release pages; minor versions may shift |
| Missing components (WS client, cost ledger, conflict schema, frontend RBAC) | HIGH | Inferred directly from PILOT-01..PILOT-10 acceptance criteria |
| Anti-recommendations (Neo4j, FalkorDB, OpenRouter, Temporal, CrewAI) | HIGH | Already decided in ADRs and 2026-06-20 research; rationale restated |
| Per-tenant CMK deferral rationale | MEDIUM | Defensible but not architecturally committed — needs an ADR |
| Redis 8 vector search parity with pgvector | LOW | Not benchmarked; deferred to post-pilot regardless |

---

## 9. Gaps to Address in Phase-Specific Research Later

- **LangGraph 0.3 vs 0.4 breaking-change analysis** — required when the team bumps past the current minor.
- **LiteLLM Enterprise tier SLA** — required before pilot ships if any customer commits to a 99.9% uptime SLO.
- **Apache AGE multi-tenant benchmark at 100+ concurrent traversals** — flagged in `research-forge-architecture-decisions-2026-06-20.md` §Research Gaps, still open.
- **Floci vs LocalStack Community vs Moto for dev** — `:latest` pinning is a smell; pick one and document.
- **WS client library choice** (see §3.1) — short follow-up research, not full Phase research.
- **Frontend RBAC pattern** — Shadcn has a permission pattern; verify it composes with the existing JWT-claim-based `policy_engine.py`.

---

## 10. Cross-References

- Existing codebase map: `.planning/codebase/STACK.md` (inventory of installed versions, 2026-06-22)
- Existing codebase map: `.planning/codebase/INTEGRATIONS.md` (integration inventory, 2026-06-22)
- Architecture research: `docs/research-forge-architecture-decisions-2026-06-20.md` (36KB — OQ-005/006/007 resolved, GSD pivot recommended, 2026-06-20)
- Architecture overview: `docs/architecture/overview.md`
- Project context: `.planning/PROJECT.md` (Active requirements PILOT-01..PILOT-10, Known Issues, Constraints)
- Constitutional rules: `.claude/CLAUDE.md` (Rules 1–8)
- ADRs: `docs/architecture/decisions/` (0001..0008 locked, 0009+ to be added per §7)

---

*Stack delta research for: Forge AI v2.0 pilot readiness*
*Researched: 2026-06-23*
*This document is additive to `.planning/codebase/STACK.md` and `docs/research-forge-architecture-decisions-2026-06-20.md`; it does not re-justify decisions already documented there.*
