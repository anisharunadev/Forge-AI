# Pitfalls Research — v2.0 Pilot Cutover

**Domain:** Forge AI v2.0 — Agent Operating System runtime pilot cutover
**Researched:** 2026-06-23
**Confidence:** HIGH (pitfalls derived from `CONCERNS.md`, `ARCHITECTURE.md`, `TESTING.md`, P0/P1 runbooks, and incident-response runbook — i.e., the exact code paths the pilot will exercise)
**Scope:** Runtime / first-week pitfalls that emerge under real user load. Static code-review findings (the 10 priorities in `CONCERNS.md`) are referenced but not duplicated; this document focuses on **what breaks when a real person clicks through the SDLC supervisor**.

---

## Executive Summary

The pilot is structurally a *first-user-benchmark*. The codebase was authored by the build team; the build team's mental model of the rules (RLS, approval gates, audit, budgets) is encoded in `Depends(get_current_principal)` decorators and pattern-matched `requires_approval` flags. Real users do not follow the build team's mental model. They click the wrong button, paste a 2,000-character idea into the wrong field, abandon a session at the approval gate, and rerun `forge-arch-new` three times because they think nothing happened.

The high-frequency pitfalls cluster into six families:

1. **Approval-gate UX bypass** — users find the *back* path and skip the gate (Rule 3 violation that doesn't show up in code review).
2. **Cost blowup on first run** — admission pre-authorizes a fixed dollar amount per call, the discovery phase fires many calls, and a single long context produces a 5–10× cost spike before the budget guard kicks in.
3. **MCP / OAuth flake during demo** — connectors health-check green in P0 W2, then rate-limited / token-expired during the live P1 artifact run.
4. **RLS silent leak** — second-tenant cutover exposes joins / sessions / job code paths that never set `app.tenant_id` and `app.project_id`.
5. **Audit / observability gap under load** — `BasePhaseNode` and `gsd_wrapper` push to event bus / in-memory list; under burst, some paths miss the audit table while still appearing "audited" in logs.
6. **Approval timeout / stuck run** — `APPROVAL_TIMEOUT_HOURS = 24` is hard-coded; a pilot user who started a run on Friday sees a "stuck" run on Monday morning and assumes Forge is broken.

These are *not* the same as the static findings in `CONCERNS.md`. They require behavioral mitigation: pre-pilot dogfood session, budget caps, RLS second-tenant smoke test, and approval-gate UX rehearsal.

---

## Critical Pitfalls

### Pitfall 1: Approval gate bypassed via direct API call or run-resume on stale checkpoint

**What goes wrong:**
P1's exit gate requires an architect to accept the first ADR. In production, a user (or a confused pilot engineer) bypasses the approval gate by either:
- calling `POST /api/v1/architecture/approvals/{id}/decide` with an already-stale run id and a forged `accepted` payload,
- resuming a LangGraph checkpoint after the gate fired but before the architect saw the request,
- editing the run's `pending_approval` field via the run-state PATCH endpoint if one is exposed.

The artifact is then written to the registry with `status=accepted` and an audit row that looks correct, but the architect never saw it. **Rule 3 violation that passes static review.**

**Why it happens:**
`backend/app/agents/nodes/base.py:282` reads `state.metadata.get(f"approval:{self.phase_name.value}")` — stringly-typed. A typo, a renamed phase, or a new phase node added without `requires_approval = True` silently bypasses the gate. The architecture / security / deployment services (`api_contract_generator.py`, `risk_register.py`, etc.) generate typed artifacts but **do not internally check `requires_approval`** — they trust the supervisor to gate them. Any direct call to `/api/v1/architecture/*` or `/api/v1/security/*` from the UI, the proxy, or a curl reaches the artifact registry without going through the gate.

**How to avoid:**
- Add a server-side `@require_approval_phase("architecture" | "security" | "deployment")` decorator on every route that can write a typed artifact in those three layers (the architecture/security/deployment routers), so the gate is enforced at the API boundary, not just in the supervisor graph.
- Stamp `pending_approval` and `gate_decided_by` on the run-state Pydantic model as `pydantic.Field(..., frozen=True)` after the gate fires, so a checkpoint cannot be resumed "past" a gate that has not been decided.
- Make the approval decision endpoint require `Idempotency-Key` and reject decisions against runs whose `pending_approval` does not match the active gate id.

**Warning signs (observability):**
- Audit log shows `architecture.artifact.persisted` events whose `prior_event_id` does not point to an `approval_request.decided` event with `decision=accepted`.
- `forge_approval_latency_seconds` histogram sees zero observations for a phase that produced artifacts (gate was bypassed, not fast).
- LangGraph checkpoints contain runs in `state` past `architecture` without a corresponding `APPROVAL_REQUESTED → APPROVAL_DECIDED` event pair in the audit log.

**Phase to address:** Pre-Pilot hardening (P0 W2) — before the first architect sees a draft. Add as a P0 acceptance checklist item.

**Severity for pilot:** **Critical** — Rule 3 violation; demo-defeating.

---

### Pitfall 2: LLM cost explosion on first architecture run (token-budget overshoot)

**What goes wrong:**
On `forge-arch-new`, the architecture phase (a) calls the knowledge graph wrapper to gather context, (b) calls the repomix wrapper for the repo bundle, (c) builds a multi-thousand-token prompt including Org Knowledge templates and the past 30 days of project decisions, and (d) generates a 4,000–6,000-token ADR draft. The first run also performs discovery, planning, and implementation preludes. End-to-end: 8–14 LLM calls with prompt sizes between 15k and 60k tokens each.

`backend/app/services/litellm_client.py:35-36` pre-authorizes `$0.05` per admission check (chat) / `$0.0001` per embed check when the caller doesn't pre-compute. Pre-call budget guard runs, but the **post-call actual cost** is what hits `cost_ledger`. On a single 60k-context call to a long-context model, a single call can cost **$0.40–$1.20**, and an entire SDLC run can land at **$5–$15** instead of the pre-authorized $0.40 envelope. The pilot's first architect sees an alert: "Pilot budget exceeded" within 30 minutes of kicking off `forge-arch-new`.

**Why it happens:**
- Pre-call admission pre-authorizes a tiny constant; post-call ledger catches the actual cost asynchronously. The guard never blocks a call that is individually under-budget but cumulatively over-budget.
- `_DEFAULT_PROJECTED_CHAT_USD = 0.05` is a guess, not derived from the prompt. A long-context call to `claude-sonnet-4-6` with 60k prompt tokens + 4k completion at $3/M input + $15/M output is ~$0.24 — already 5× the pre-auth, before any other call.
- `workflow_budget.py:228,229,251,268,269,472,495` writes budget rows with `tenant_id` / `project_id` *but* the cost ledger is queried at the org level by default, masking per-user overruns.

**How to avoid:**
- Derive a per-call projected cost from prompt token estimate × current model price, and pre-authorize that number. Refuse admission when the *cumulative* projected cost for the run exceeds the pilot's per-run cap.
- Add a hard ceiling per `forge-arch-new` invocation (pilot cap: $5) enforced in the supervisor before the architecture node enters; surface to UI as "Run budget: $5.00 / Used: $0.34" before the run starts.
- Pin a *cheaper* model for the discovery / planning / implementation-support phases; reserve the long-context model for the architecture phase only.

**Warning signs:**
- `cost_ledger.run_total_usd` for `forge-arch-new` exceeds $2 within 15 minutes.
- `litellm_client.prompt_tokens` p99 > 30k on the architecture node.
- `workflow_budget.evaluated` events fire more than 5× per run.
- Cost dashboard shows non-zero `project_id = NULL` rows from `workflow_budget.py` writes (masking issue).

**Phase to address:** Pre-Pilot hardening (P0 W4 trial run) and as a hard rule in P1.5 success criteria.

**Severity for pilot:** **Critical** — single incident can exceed the pilot's monthly LLM budget before the second artifact.

---

### Pitfall 3: MCP server flake during live demo (rate limit / OAuth refresh / pre-built binary)

**What goes wrong:**
In P0 W2 the connectors report `healthy`. In P1 Day 1 the pilot user runs `forge-arch-new`. The architecture node calls the GitHub MCP server to pull recent PRs and ADRs; **the connector fails silently in mid-run** with one of:
- 429 from GitHub (rate limit) because the pilot user's IP shares an egress NAT with the build team's other tooling,
- 401 from Jira (OAuth refresh token expired, the MCP server holds an in-memory cache that doesn't survive the container restart between demo sessions),
- 502 from SonarQube (the MCP server's `node-pty` prebuilt binary doesn't match the demo container's glibc),
- network timeout (LiteLLM proxy upstream took 25s, the MCP wrapper's default timeout is 15s).

The architecture node swallows the error and emits a degraded artifact with `Sources: <unavailable>`. The architect sees a draft with holes. **The audit log shows the failure but the artifact registry doesn't surface it.**

**Why it happens:**
- `mcp_client.py` (846 lines) is a single point of failure for all agent calls. The retry policy is uniform; per-server backoff is declared in the registry (`mcp_registry.py:90`) but **not enforced at the proxy**.
- `connector_states.py` records `FAILED` on a single test, but the architecture node may not check `state=ACTIVE` before each call. A `STALE` connector is still callable.
- OAuth refresh tokens are stored per-tenant in the secrets bucket; if the bucket is the shared Jira bucket (per `comm_ingestion.py:90` and `doc_ingestion.py:65,80`), rotating the Jira token during connector rotation also rotates the GitHub and Notion tokens — making OAuth refresh impossible until manual fix.
- The MCP servers use `node-pty: ^1.0.0` (`apps/forge/package.json:55`), a native binding whose prebuilt binaries may not match the pilot container's libc.

**How to avoid:**
- Before `forge-arch-new`, run a **fresh `forge-connector-test`** against each connector used by the SDLC. Fail fast at the supervisor if any connector is not `ACTIVE`.
- Pre-warm OAuth tokens at P0 W2: write a synthetic test that expires + refreshes each connector's token, then stores the fresh token in the per-type secrets bucket. Verify the per-type bucket key actually exists.
- Set per-MCP-server timeouts and exponential backoff matching the registry's `rate_limits` — make these **enforced at the proxy**, not just declared.
- For the pilot specifically, run the MCP servers inside the same Docker network as the backend (eliminate NAT issues), and pin glibc-compatible `node-pty` builds.

**Warning signs:**
- `connector.sync_history` shows a row with `outcome=failed` within 5 minutes of `forge-arch-new` invocation.
- Architecture artifact contains `## Sources\n- (GitHub MCP: rate_limited)` style fallback text.
- `litellm_client.completion` duration exceeds 25s on any call (upstream timeout).
- Audit log shows `connector.oauth_refresh.failed` events for any connector.

**Phase to address:** P0 W2 (connector health), re-verified at P1 Day 1 morning (pre-flight).

**Severity for pilot:** **Critical** — demo-defeating; first artifact is the headline outcome of P1.

---

### Pitfall 4: Multi-tenancy leak surfaces only when the second tenant is added

**What goes wrong:**
The pilot is one tenant. P1.5 introduces a second tenant (a different pilot customer, or a sandbox tenant for review). The first thing the second-tenant user does is log in and search for an idea. The query returns rows from the *first* tenant because one of:
- `apps/forge/lib/api.ts:54` hard-codes `DEV_TENANT_UUID` in the typed REST client. Removing it requires every page to thread the principal's tenant from the middleware, but only the proxy sets `X-Forge-Tenant-Id` — pages that call `process.env.NEXT_PUBLIC_FORGE_API_URL` directly bypass the proxy header injection.
- `backend/app/services/ideation/*` accepts `tenant_id: UUID | str | None = None` at many signatures (`idea_intake.py:198-199`, `idea_analysis.py:232,342`, `scoring.py:173,248`, `arch_preview.py:189,270`, `roadmap_generator.py:369`, `realtime_workflow.py:117,185`, `output_bundle.py:86`, `impact_graph.py:157`, `agent_selector.py:108`, `idea_enhance.py:59`, `approval_queue.py:56`, `push_to_delivery.py:73,131,188,249`). Every `None` is a potential Rule 2 violation if the caller forgets.
- `workflow_budget.py:228,229,251,268,269,472,495` writes audit/cost rows without tenant context — appears org-wide unfiltered.
- Scheduler jobs (`scheduler/jobs/ideation_ingest.py:152`, `repo_ingestion.py:774`) open sessions via `get_session_factory()` rather than going through `rls_required`. If a job forgets `SET LOCAL app.tenant_id = ...`, cross-tenant reads succeed because the migrator bypasses RLS.
- `audit_service.record` silently substitutes a sentinel `"00000000-0000-0000-0000-000000000000"` for missing `project_id` (`audit_service.py:37`). Audit query filters that assume `(tenant_id, project_id)` joins will not surface these rows.
- `IDEATION_JIRA_PROJECT_KEY = 'FORA'` is hard-coded (`apps/forge/lib/hooks/usePushIdeaToJira.ts:39`). Both tenants push to the same Jira project.

**Why it happens:**
- RLS catches *some* of these at the DB layer (`db/rls.py:64-92`), but writes that bypass the session's RLS context (direct ORM calls in jobs) can still leak.
- The dev-mode `DEV_AUTH_BYPASS=1` (`docker-compose.yml:206`) returns a synthetic principal with `tenant_id="00000000-...-ace"`. Every code path that uses the bypass never exercises multi-tenant enforcement because the bypass principal is a single fixed tenant.
- The first tenant's UI never shows leakage because there is no "other" to leak from.

**How to avoid:**
- **Before pilot cuts to multi-tenant, run a "tenant-isolation smoke test"**: provision a second tenant, log in as a non-admin user, attempt to list the first tenant's artifacts/audit/cost rows. Every endpoint must return empty (or 403, not 200-empty).
- Make `tenant_id` and `project_id` *required* on every ideation / cost / audit signature. Drop the `= None` default. Raise `TypeError` at the boundary.
- Add a startup assertion: `if dev_auth_bypass and settings.environment != "development": raise`. Refuse to boot.
- Wire `IDEATION_JIRA_PROJECT_KEY` from the connector config, not from a constant. Same for the connector-bound repo selection in `usePushIdeaToJira.ts`.
- Audit every scheduler job for explicit `await session.execute(text("SET LOCAL app.tenant_id = ..."))`.

**Warning signs:**
- A query against `audit_events` returns rows with `tenant_id` ≠ caller's tenant.
- `cost_ledger` shows rows with `project_id IS NULL` or `project_id = "00000000-..."`.
- `psql` console: `SET app.tenant_id = '<tenant_a>'; SELECT * FROM artifacts;` returns rows from `tenant_b`.
- A `/v1/ideation/ideas` GET as `tenant_b` user returns `tenant_a`'s ideas (the classic symptom).

**Phase to address:** Before any second-tenant onboarding (P1.5 expansion); before P3 evaluation that compares across tenants.

**Severity for pilot:** **Critical** (when second tenant lands) / **Major** during single-tenant P1 (latent).

---

### Pitfall 5: Audit / observability gap under burst load — "looks audited, isn't"

**What goes wrong:**
The pilot reviewer audits the artifact and sees an `audit_log` row per LLM call. They trust the audit. But:
- `BasePhaseNode` (`backend/app/agents/nodes/base.py:163-238`) emits `AGENT_RUN_STARTED`, `AGENT_RUN_COMPLETED`, `AGENT_RUN_FAILED` **to the event bus**, not to the `audit_events` table. Audit log queries (`/v1/audit`) miss them entirely. Event-bus subscribers see them, but the audit chain hash (`audit_log.hash_chain`) does not include them.
- `gsd_wrapper` (`backend/app/agents/tools/gsd_wrapper.py:131`) keeps audit records in `self.audit_log: list[AuditRecord] = []` in memory unless an `audit_sink` is injected. Default construction (`build_default_wrapper()`) does not inject the sink. Audit records vanish on restart.
- Under burst (e.g., three pilot users run workflows concurrently), `event_bus._dispatch` swallows handler errors silently. Subscribers that fail to write to `audit_events` are not retried; the dispatch log shows the failure but the orchestrator moves on.
- `otel_exporter_otlp_insecure: bool = True` and `otlp_endpoint: str | None = None` (`core/config.py:78-80`) — OTel spans are dropped by default. The docker-compose backend service doesn't set `OTEL_EXPORTER_OTLP_ENDPOINT`. Observability dashboard shows nothing during pilot unless operators manually configure the exporter.

**Why it happens:**
- Two parallel audit surfaces: `audit_events` (table) and the event bus (`EventType.AGENT_RUN_*`). They were never unified. Static review doesn't catch this because both surfaces *appear* to write.
- Default sinks are convenient in tests (where in-memory is fine) but production builds don't override them.
- OTel is configured to *initialize* but the export endpoint is opt-in. Local development can't tell the difference between "no spans because nothing happened" and "no spans because the exporter is unconfigured."

**How to avoid:**
- Default `gsd_wrapper`'s `audit_sink` to `audit_service.record` in production. Add a test that asserts the default is wired in non-test settings.
- Choose one system-of-record for audit (`audit_events` is the constitutional choice per Rule 6 + ADR-008) and have the event bus mirror it on a `subscribe` handler that calls `audit_service.record`. If event bus beats the table to the write, the mirror upserts.
- Wire `OTEL_EXPORTER_OTLP_ENDPOINT` into `docker-compose.yml` for the backend service before P1. Verify OTel spans reach the collector with `otel-cli` or a smoke test.
- Add a "did you boot with audit on?" probe to `/healthz`: include `audit_sink=audit_service.record` and `otel_exporter_configured=true` in the response. Surface a warning in the UI when either is missing.

**Warning signs:**
- `SELECT count(*) FROM audit_events WHERE event_type = 'AGENT_RUN_COMPLETED'` is zero while `redis-cli SUBSCRIBE forge:events:AGENT_RUN_COMPLETED` shows active traffic.
- `gsd_wrapper.audit_log` is non-empty in memory but the corresponding rows are missing in `audit_events`.
- OTel collector shows zero spans from `app.agents.*` services.
- Audit chain hash drift detected (`audit_log.hash_chain` doesn't match the recomputed chain for any row).

**Phase to address:** P0 W2 platform readiness (re-verify at P1 daily standup "audit status" line).

**Severity for pilot:** **Major** — trust impact; not a single-day crash but a long-tail liability when something goes wrong and reviewers can't reconstruct what happened.

---

### Pitfall 6: Hard-coded 24-hour approval timeout causes "stuck run" on Monday morning

**What goes wrong:**
A pilot user starts a run on Friday afternoon, hits the architecture approval gate, and goes home. On Monday morning, they open the UI and see the run still in `pending_approval`. They assume Forge is broken or that the architect ignored the request. The actual state: the gate timed out at 24 hours, the run is parked in a LangGraph checkpoint, but the supervisor did not surface the timeout in the UI or via the event bus.

The user manually cancels and re-runs. The re-run starts from scratch — all the LLM cost from Friday is sunk. The architect, who saw the request Friday at 4pm, is now confused about why a new request arrived Monday.

**Why it happens:**
- `APPROVAL_TIMEOUT_HOURS = 24` is a constant in `backend/app/agents/approval_gate.py:37`. No per-tenant / per-approval-type override.
- The `interrupt()` call in the LangGraph supervisor parks the run in a checkpoint but does not schedule a timer. The "timeout" only fires when *something* resumes the run and observes that 24h have passed — at which point the run enters an undefined state.
- The UI shows the run as `pending_approval` indefinitely; there is no "expired" badge.

**How to avoid:**
- Schedule a periodic timer (via `backend/app/services/scheduler/`) that scans runs in `pending_approval` past their deadline and fires a `APPROVAL_EXPIRED` event. Mark the run state as `approval_expired`, surface it in the UI with a distinct color, and notify both the requester and the reviewer rotation.
- Make the timeout configurable per phase and per tenant: `settings.approval_timeout_hours` defaults to 24, but the architecture phase can override to 72h to accommodate long reviews.
- On resume of a parked run past deadline, automatically route to a `notification` node that informs the requester instead of resuming silently.

**Warning signs:**
- Runs in `pending_approval` for >24h with no `APPROVAL_DECIDED` event in the audit log.
- Audit log shows runs resuming from checkpoint with no preceding approval decision.
- Users complain "the architect never replied" — check whether the run expired without a UI indication.

**Phase to address:** P0 W4 trial run; P1 daily standup observation.

**Severity for pilot:** **Major** — UX-defeating; doesn't break the demo, breaks trust.

---

### Pitfall 7: Frontend tenant-from-claim migration gap (`DEV_TENANT_UUID`)

**What goes wrong:**
The frontend typed REST client `apps/forge/lib/api.ts:470` hard-codes `DEV_TENANT_UUID` at line 54. Every page that calls the REST client (and bypasses the `/api/proxy/*` catch-all) sends the wrong tenant id. When the proxy injects `X-Forge-Tenant-Id`, the backend trusts whichever one came in last. A page that reads `X-Forge-Tenant-Id` from the proxy and a page that sends the hard-coded constant disagree.

When the second tenant logs in, they may receive data from the first tenant because the page made a direct call with the hard-coded UUID before the middleware overrode it.

**Why it happens:**
- The hard-coded constant was introduced for dev convenience and never migrated.
- The proxy is a catch-all (`/api/proxy/[...path]`) but pages can also call `process.env.NEXT_PUBLIC_FORGE_API_URL` directly. Both paths exist; consistency is not enforced.

**How to avoid:**
- Remove `DEV_TENANT_UUID` from `apps/forge/lib/api.ts`. Read `tenant_id` from the persona cookie or the response header (`X-Forge-Tenant-Id` echoed by the backend).
- Add a CI check: fail the frontend typecheck if `DEV_TENANT_UUID` or any string-UUID-looking literal appears in `apps/forge/lib/`.

**Warning signs:**
- Network tab shows two tenants' data interleaved on a single page load.
- Backend logs show `tenant_id` from the request body ≠ `tenant_id` from the `X-Forge-Tenant-Id` header.

**Phase to address:** Pre-P0 hardening; before P1 day 1.

**Severity for pilot:** **Major** (latent — breaks on tenant #2).

---

### Pitfall 8: Repo ingestion time / first-a-ha time exceeds 30 minutes (acceptable threshold)

**What goes wrong:**
P1 measures **First Aha Time** — wall-clock from `forge-arch-new` to the architect seeing a usable ADR draft. Target is <15 minutes. In pilot:
- Repo ingestion (`repo_ingestion.py`, 806 lines) is a long-running job that may not have completed by the time `forge-arch-new` runs. The architecture node then sees a sparse knowledge graph.
- The repomix bundle for a 50k-LOC repo can take 3–5 minutes to assemble and ship into the LLM prompt.
- The architect doesn't get a notification when the draft is ready; they have to refresh the page.

If First Aha Time exceeds 30 minutes, the architect treats Forge as "broken" and stops checking.

**Why it happens:**
- No streaming of partial architecture output to the UI; the artifact appears all-at-once.
- No notification (Slack / email) on draft-ready.
- The architecture node assumes the knowledge graph is populated; it doesn't degrade gracefully on a partial graph.

**How to avoid:**
- Stream architecture progress via the `ws/ideation` WebSocket: emit `architecture.section.context_ready`, `architecture.section.options_evaluated`, `architecture.section.decision_ready` events as the node progresses.
- Send a Slack / email notification to the reviewer rotation when a draft is ready (per P1 kickoff runbook, but not implemented in the codebase).
- Pre-warm the knowledge graph: run `forge-onboard-repo` 24 hours before the first `forge-arch-new`, not 5 minutes before.
- Make the architecture node emit a "low-context draft" with a clear warning when the knowledge graph is sparse.

**Warning signs:**
- `forge_arch_new.total_duration_seconds` p95 > 1800.
- Architect refreshes the artifacts page more than 3× in 5 minutes.
- Audit log shows the architecture node starting before the repo ingestion event chain is complete.

**Phase to address:** P0 W4 trial run (verify First Aha Time); P1 daily standup first-week review.

**Severity for pilot:** **Major** — fails the P1 success criterion; pushes the pilot toward "PIVOT."

---

## Technical Debt Patterns (Pilot-Surface Edition)

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| `DEV_AUTH_BYPASS=1` in dev compose | Engineers can iterate without Keycloak | One misconfigured deploy gives every request admin | Only when `environment=development` is asserted; never in pilot |
| `_DEFAULT_PROJECTED_CHAT_USD = 0.05` | Pre-call admission stays fast | First long-context call overruns budget by 5–20× | Never — derive from prompt size |
| `tenant_id=None` default on ideation services | Fewer call-site changes | Every `None` is a Rule 2 footgun | Never in production code paths |
| `IDEATION_JIRA_PROJECT_KEY = 'FORA'` constant | Single-tenant pilot works | Second tenant pushes to first tenant's Jira | Never past P0 |
| Sentinel `project_id = "00000000-..."` in audit | Audit never fails | Audit queries miss rows; RLS joins break | Never — make required |
| `requires_approval = True` per-node attribute | Easy to forget to set | New phase node silently bypasses Rule 3 | Replace with class-level decorator |
| `connector_type=ConnectorType.SLACK # reuses secrets bucket` | Connectors work without per-type buckets | Rotating one token rotates all | Never past P0 |
| `forge-commands.ts` (692 lines) single file | One place to look up commands | Single-point failure; no per-feature ownership | Refactor pre-P2 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| GitHub MCP | OAuth refresh token stored in shared bucket; expires silently mid-run | Pre-flight token check before `forge-arch-new`; per-type bucket key |
| Jira MCP | `IDEATION_JIRA_PROJECT_KEY = 'FORA'` hard-coded in `usePushIdeaToJira.ts:39` | Read project key from connector config at runtime |
| Slack / Notion / Secrets MCP | Reuses Jira secrets bucket (`comm_ingestion.py:90`, `doc_ingestion.py:65,80`) | Provision per-connector-type secrets bucket before P0 W2 |
| SonarQube MCP | `node-pty: ^1.0.0` native binary mismatch on demo container | Pin glibc-compatible build; smoke-test in P0 W2 |
| Apache AGE (knowledge graph) | OQ-006 unresolved — graph vs property-model collision | Resolve before P1.5; otherwise ingestion writes silently collide |
| LiteLLM Proxy | `otlp_endpoint=None` means OTel drops spans | Wire `OTEL_EXPORTER_OTLP_ENDPOINT` in docker-compose for backend |
| Keycloak | MFA required (NFR-004a) but not enforced on dev realm | Enforce at realm import; verify on first login |
| LangGraph checkpoint | `interrupt()` parks indefinitely on 24h timeout | Scheduler must expire runs and surface UI state |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Long-context ADR prompt (60k+ tokens) | Single LLM call >$0.40; budget alert fires | Cap context size; chunk and summarize Org Knowledge before assembly | First run |
| Repomix bundle assembly blocking the event loop | Architecture node sees 5–10s silence before LLM call | Pre-bundle at `forge-onboard-repo` time; cache by repo SHA | Repos >30k LOC |
| Knowledge graph query (AGE) per LLM call | Architecture latency dominated by graph traversal | Pre-compute context slices at ingestion time; cache per phase | >100 nodes per query |
| Event bus back-pressure under burst | Subscribers drop events silently | Per-channel queue + retry; saturate with deliberate load test in P0 W4 | 3+ concurrent runs |
| `workflow_budget.py` org-wide writes | Cost dashboard shows total at org scope, not per tenant | Make `tenant_id` required on all writes | Day 1 of pilot (single tenant = single scope) |
| `_DEFAULT_PROJECTED_CHAT_USD = 0.05` pre-auth | Actual cost can exceed by 20× | Derive from prompt estimate | First run |

## Security Mistakes (Pilot-Surface)

| Mistake | Risk | Prevention |
|---|---|---|
| `DEV_AUTH_BYPASS=1` ships to staging by accident | Every endpoint is admin | Startup assertion: refuse to boot unless `environment=development` |
| `_verify_github_signature` returns on empty secret | Forged pre-commit payloads manipulate merge gate | Raise `HTTPException(500)` on empty secret; refuse to boot in non-dev |
| `JWT_SECRET` is single string, no key rotation | Rotation requires coordinated restart; HS256 in dev | Add JWKS endpoint; RS256 in pilot |
| Audit sentinel `project_id = "00000000-..."` masks missing tenant context | Cross-tenant reads invisible in audit | Make `project_id` required on `audit_service.record` |
| CORS allows `allow_methods=["*"], allow_headers=["*"]` | If `cors_origins` is misconfigured, credentialed XHR is wide-open | Restrict to known methods/headers per environment |
| Slack/Notion/Secrets reuse Jira token bucket | Rotating Jira token rotates GitHub/Notion — DoS the second connector | Per-connector-type secrets buckets (post-P0) |
| No rate-limit middleware on FastAPI | MCP rate-limit policy declared but not enforced | Enforce at the proxy per the registry's `rate_limits` |
| `acme-corp` hard-coded in dev bypass principal (`security.py:110`) | Synthetic principal inconsistent with its own claims | Either remove the bypass entirely or align claim values |

## UX Pitfalls (Pilot-User-Facing)

| Pitfall | User Impact | Better Approach |
|---|---|---|
| Approval gate is invisible until the architect opens the URL | Pilot user thinks "nothing is happening" | WebSocket push of approval state; banner in UI within 30s |
| No notification when draft is ready | Architect doesn't check the UI; First Aha Time degrades | Slack / email notification on `artifact.draft_ready` |
| No "approval expired" state | Run sits in `pending_approval` past 24h; user cancels and re-runs | Scheduled expiry event; distinct UI badge |
| Run progress is invisible until completion | User refreshes repeatedly; loses trust | Stream `architecture.section.*` events via WebSocket |
| Approval gate reject reason is free-form | Pilot user doesn't know why; re-runs unchanged | Typed rejection categories (insufficient context, missing risk, etc.) |
| Persona cookie not refreshed on tenant switch | Old persona's commands fire against new tenant's data | Clear persona + re-fetch on tenant switch |
| Audit log link in UI broken | Reviewer can't trace artifact → prompt → cost | Wire `/api/v1/audit?artifact_id=...` to a populated view |
| `forge-commands.ts` (692 lines) — no per-feature filtering | Command palette in UI shows 60+ commands at once | Category-aware command palette; defer to Phase post-MVP |
| Hard-coded `DEV_TENANT_UUID` in `apps/forge/lib/api.ts` | Direct-API pages show wrong tenant | Read tenant from persona cookie; CI lint forbids UUID literals |

## "Looks Done But Isn't" Checklist

- [ ] **Multi-tenancy**: every query carries `tenant_id` + `project_id` — verify by provisioning a second tenant and listing the first's artifacts (returns empty).
- [ ] **Approval gate**: no artifact persists in architecture/security/deployment without `APPROVAL_REQUESTED → APPROVAL_DECIDED` event pair — verify with a synthetic run that has no decision.
- [ ] **Audit**: every event on the bus has a matching row in `audit_events` — verify `SELECT count(*) FROM audit_events WHERE event_type = 'AGENT_RUN_COMPLETED'` matches the event bus count.
- [ ] **Observability**: OTel spans reach the collector for the architecture node — verify with `otel-cli` or a collector smoke test.
- [ ] **Cost cap**: a single `forge-arch-new` cannot exceed $5 — verify by removing the cap and running the full pipeline.
- [ ] **Connector health**: every connector is `ACTIVE` immediately before `forge-arch-new` — verify with a `forge-connector-test` invocation.
- [ ] **MCP auth refresh**: each connector's token survives a 24h soak without manual rotation — verify with an expiry-and-refresh test.
- [ ] **LangGraph resume**: a checkpoint older than 24h surfaces as `approval_expired`, not silently re-runs — verify by parking a run, waiting 25h, and resuming.
- [ ] **Frontend tenant**: no UUID literal in `apps/forge/lib/` — verify with `grep -rE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' apps/forge/lib/`.
- [ ] **Jira push**: `IDEATION_JIRA_PROJECT_KEY` reads from connector config — verify by switching tenants and pushing an idea.
- [ ] **Dev bypass off**: `DEV_AUTH_BYPASS=1` in non-dev environment refuses to boot — verify by setting `environment=staging` with the bypass flag.
- [ ] **Webhook secret**: empty `github_webhook_secret` raises 500 on first POST — verify by POSTing without the header.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Approval gate bypassed | HIGH (regain reviewer trust) | Snapshot audit log; identify all artifacts written without decision; pause affected phases (`Tier-1 rollback`); re-run with gate enforced; notify reviewers |
| LLM cost explosion | LOW (refund credits) | Pause the run; lower budget cap; rotate LiteLLM virtual key if leaked; document actual cost; tune admission |
| MCP flake during demo | MEDIUM (re-run, re-notify reviewers) | `forge-connector-test`; rotate tokens; restart MCP containers; re-run architecture node |
| RLS silent leak | CRITICAL (tenant trust) | Pause affected tenant (`Tier-3 rollback`); snapshot `audit_events` + `cost_ledger`; identify rows that crossed; quarantine; rotate per-tenant secrets; legal review |
| Audit/observability gap | MEDIUM | Wire `OTEL_EXPORTER_OTLP_ENDPOINT`; default `gsd_wrapper` `audit_sink`; reconcile `audit_events` from event bus replay |
| 24h approval timeout | LOW | Manually expire runs in scheduler; UI badge; request re-review |
| Frontend tenant-from-claim | HIGH (depends on leakage scope) | Remove `DEV_TENANT_UUID`; force-refresh on persona switch; second-tenant smoke test |
| First-Aha-Time >30min | LOW (perception) | Stream architecture progress; pre-warm knowledge graph 24h before; notify reviewer on draft-ready |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| 1 — Approval gate bypass | P0 W2 (security hardening) | Synthetic run without decision → artifact is NOT persisted |
| 2 — Cost explosion | P0 W4 (trial run cost cap) | Run full pipeline with $5 cap; verify alert at $4.50 |
| 3 — MCP flake | P0 W2 (connector health) + P1 D1 morning pre-flight | `forge-connector-test` returns `ACTIVE` for all connectors used |
| 4 — RLS leak | Pre-P1.5 (before second tenant) | Second-tenant smoke test: empty result set on first-tenant queries |
| 5 — Audit gap | P0 W2 (audit topology) | `count(audit_events) = count(event_bus deliveries)` for `AGENT_RUN_*` |
| 6 — Approval timeout | P0 W4 (trial run expiry) | Park a run, advance time 25h, observe `approval_expired` state |
| 7 — Frontend tenant UUID | Pre-P0 (CI lint) + Pre-P1.5 | `grep` finds no UUID literal in `apps/forge/lib/` |
| 8 — First-Aha-Time | P1 daily standup | `forge_arch_new.total_duration_seconds` p95 < 1800 |

## Phase-Specific Warnings

| Phase / Activity | Likely Pitfall | Mitigation |
|---|---|---|
| P0 W2 — Tenant + platform readiness | Connectors report `healthy` in health-check but fail under live `forge-arch-new` load | Run a full `forge-arch-new` against a sandbox repo in W4 trial run, not just a connector test |
| P0 W3 — Baseline TTTD | Hand-written baseline vs Forge-generated artifact compared on the same rubric; rubric biases toward hand-written | Architect reviews both with explicit `forge_artifact_origin` flag; report bias in baseline-tttd.md |
| P0 W4 — Trial run | Demo runs on the build team's clean network; pilot runs on customer's network | Test from a network that matches pilot's egress (NAT, firewall) |
| P1 Day 1 — First `forge-arch-new` | First run blows budget / hits approval timeout | Pre-flight: connectors `ACTIVE`, knowledge graph populated, budget cap visible to user |
| P1 Daily standups | "Audit status" line is a green emoji with no numbers | Quantitative: count of audit rows / cost per day / chain hash status |
| P1.5 — Second tenant added | All multi-tenancy pitfalls surface here | Tenant-isolation smoke test before any second-tenant login |
| P3 — Evaluation | Cost / TTTD averages span both tenants, masking per-tenant overruns | Always report per-tenant cost + per-tenant TTTD |

## Open Questions for Phase-Specific Research

- What is the realistic long-context prompt size for an ADR generation at CMC's repo size, and what model + price should the pilot cap assume? (Resolves cost pitfall.)
- Does Apache AGE's `cypher()` planner degrade past 1k graph nodes, or is the RLS overhead the actual bottleneck? (Resolves knowledge-graph performance pitfall.)
- Is the scheduler capable of detecting `pending_approval` runs older than the timeout, or is this a new scheduled job? (Resolves approval-timeout pitfall.)
- Does the architecture node already emit progress events on the event bus, or is that a P1 deliverable? (Resolves First-Aha-Time pitfall.)

## Sources

- `.planning/codebase/CONCERNS.md` — static findings (multi-tenancy, security, audit); cited by reference, not duplicated.
- `.planning/codebase/ARCHITECTURE.md` — system topology, LangGraph checkpointing, RLS context, white-label command map.
- `.planning/codebase/TESTING.md` — coverage thresholds (cost ledger 95%+, RLS 95%+, approval gate 95%+ — but CI gate is 70%), test fixtures (sqlite vs Postgres gap on RLS), flakiness policy.
- `docs/operations/pilot-p0-pre-pilot.md` — exit-gate criteria, W2 platform readiness, baseline TTTD protocol.
- `docs/operations/pilot-p1-kickoff.md` — `forge-arch-new` flow, First Aha Time targets, daily standup template.
- `docs/operations/incident-response.md` — severity matrix, triage SLA (RLS bypass ≤15min, audit integrity ≤15min, cost anomaly >3x ≤1h), Tier-1/2/3 rollback triggers, GDPR 72h clock.
- `.claude/CLAUDE.md` — constitutional Rules 1–8; Rule 3 (approval gates), Rule 6 (audit), Rule 7 (observability), Rule 8 (configurability).

---

*Pitfalls research for: Forge AI v2.0 Pilot Cutover (P1)*
*Researched: 2026-06-23*