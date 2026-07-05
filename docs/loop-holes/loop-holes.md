The architecture is genuinely good (the 18-rule discipline is rare). But the implementation has real holes that any 3am page would
  expose. Here's the breakdown:

  ┌──────────────────────┬────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │      Dimension       │ Score  │                                               Why                                                │
  ├──────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Architectural        │ 8.5/10 │ 18 rules, multi-tenant by default, typed artifacts — most teams never get this                   │
  │ discipline           │        │                                                                                                  │
  ├──────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Code organization    │ 7/10   │ Clear layering (api/services/db), but 3 API transports coexist (api, forgeFetch, lib/api.ts) —   │
  │                      │        │ that's decision debt                                                                             │
  ├──────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Implementation       │ 5/10   │ forge_phase4.py is literally a stub. Orphan routers exist (Step-69 memory: silent failure on     │
  │ completeness         │        │ missing registration).                                                                           │
  ├──────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Test reliability     │ 3/10   │ Vitest runner is broken (ERR_PACKAGE_PATH_NOT_EXPORTED on vite/module-runner). Tests in          │
  │                      │        │ __tests__/ aren't picked up by the glob. You literally cannot run CI.                            │
  ├──────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Docs ↔ code          │ 5/10   │ docs/goals/step-69.md reads greenfield but 4 target files already shipped. Documented endpoints  │
  │ alignment            │        │ (/ideation/sources, /market-signals, /voice-clusters) are not registered.                        │
  ├──────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Operational maturity │ 5/10   │ OpenTelemetry exists, audit exists, but no SLOs, no error budgets, no DR plan in code            │
  ├──────────────────────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Production readiness │ 5/10   │ See below                                                                                        │
  └──────────────────────┴────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘

  ---
  What you need to improve (prioritized)

  P0 — Stop the bleeding (this week)

  1. Fix vitest. Per memory: pnpm vitest errors at startup. Vitest 4 ↔ vite 5 ↔ Node 22 mismatch. Either pin to working combo or migrate.
  Without tests in CI you ship blind.
  2. One test glob. Move all __tests__/ tests under tests/ so they're auto-discovered. Right now half your tests don't run.
  3. One API transport. Pick api from lib/api/client.ts, deprecate the other two. Document the migration. Three transports = every new
  dev writes to whichever one they found first.
  4. Orphan-router lint. Add a CI check: every file in backend/app/api/v1/<bucket>/ must appear in <bucket>/__init__.py AND router.py.
  The Step-69 footgun repeats silently.

  P1 — Production-grade (next sprint)

  5. Backfill the documented-but-missing endpoints. /ideation/sources, /destinations, /market-signals, /voice-clusters, /ingest/status —
  puller services exist, REST surface doesn't. Either ship them or delete the docs.
  6. Delete forge_phase4.py if it's a stub, or graduate it. Stubs rot.
  7. Doc-drift detector. docs/goals/step-X.md claims vs ls apps/forge/lib/... reality. Make scripts/check-feature-docs.sh fail on drift.
  8. Secrets rotation runbook. infra/auth/keycloak-runbook.md exists (in your dirty status) but no rotation script in backend/scripts/.
  9. Multi-tenant migration safety. Alembic autogenerate cannot detect renames or enum changes. Add a migrations/review.md checklist that
  PRs must tick.

  P2 — Real-time / scale (next month)

  10. Load test one tenant at 1000 concurrent chat completions. Streaming SSE through LiteLLM Proxy — know where it breaks before users
  do.
  11. SLOs in code. Not in a Google Doc. Latency p95/p99 per surface (chat, KG query, ideation score) with error budget alerts.
  12. Cost guardrails actually fail closed. forge_budget_guard.py exists — verify a tenant that exceeds budget gets a 429, not a warning
  log.
  13. Backup + restore drill. Document and run the restore. Most teams have backups; few have verified restores.
  14. GDPR delete cascade. /forge/observability mentions GDPR — verify it's actually wired (audit, KG nodes, embeddings all purge).

  ---
  Behaviors ultimately required to build this kind of system

  These are not features, they are habits that must be in the team's DNA:

  1. Constraint discipline over creativity. The 18 rules exist because someone saw the failure mode. New devs will want to "just quickly"
  — your job is to refuse. ADR required for every violation.
  2. Delete more than you add. 95 workflows, 60 routers, 30 skills — half probably don't earn their place. A quarterly cull pass kills
  orphans.
  3. Boring over clever. The 3-transport API situation is exactly what happens when someone was clever. Pick one. Document it. Move on.
  4. Test the boring path, not the hero path. Every tenant isolation boundary, every approval gate, every budget guard — these are the
  paths that fail in prod.
  5. Treat docs as product. Rule 18 says this. Drift is a bug. If step-X.md lies, it's worse than no doc.
  6. Migration reviews are mandatory. Multi-tenant schema changes are irreversible. The team that skips alembic upgrade head review in
  staging before prod earns a 3am rollback.
  7. Reproducibility. pnpm dev:stack, setup-local.sh must work on a fresh machine in <15 min. Every "works on my machine" is a future
  incident.

  ---
  What makes this a real-time production app

  Currently you have the plumbing but not the nerves. Here's the diff:

  ┌──────────────────────────────────────┬────────────────────────────────────────────────────────────────┐
  │                 Have                 │                            Missing                             │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Streaming SSE for chat completions   │ Stream reconnect logic on the client when proxy drops          │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ WebSocket auth via api.ws()          │ Heartbeat + dead-connection cleanup on the backend             │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Redis pub/sub event bus              │ Backpressure policy when consumers lag                         │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ PTY sidecar terminal                 │ Session timeouts, idle cleanup, max concurrent PTYs per tenant │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Real-time cost tracking (spend logs) │ Per-request cost dashboard, not just aggregated                │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Audit log writes                     │ Live audit stream to UI (currently read-on-demand?)            │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ OpenTelemetry traces                 │ Sampling rate per tenant, not a global default                 │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ LiteLLM proxy guardrail pipeline     │ Pre-call guardrail failure behavior — does it block or warn?   │
  ├──────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Foreground agents / Kanban / runs    │ WebSocket reconnection + state recovery on page refresh        │
  └──────────────────────────────────────┴────────────────────────────────────────────────────────────────┘

  The 5 things that would make it production:
  1. Real-time cost + budget enforcement at the request level (not just post-hoc aggregation)
  2. SLO-driven alerting (p95 latency, error rate, queue depth) — not log-watching
  3. Tenant-isolated rate limits with graceful degradation (slow → 429, never crash)
  4. Audit stream to UI so admins see what's happening now, not what happened
  5. Verified DR runbook — restore the DB in a fresh region in <1 hour, documented, tested