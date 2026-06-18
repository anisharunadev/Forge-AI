# 11.6 — Outbound rate limiter + circuit breaker + burst control

Sub-goal **11.6** of [FORA-249 Epic 11 — Forge Integration Layer](/FORA/issues/FORA-249).
DAY-ONE P0 (per Board answer Q-sync-direction = every_event on FORA-199 2026-06-17T20:56:59Z).

This directory contains the day-one smoke contract and evidence for
the outbound reliability layer implemented in
`packages/sync-plane-ratelimit/`.

## What ships

The package implements ADR-0010 §7.1 + §8.2 R-SYNC-03:

| AC | Behaviour | Test file |
|----|-----------|-----------|
| AC #1a | Per-tenant token bucket (60 events/min, burst 10) | `outbound.test.ts` |
| AC #1b | Per-(tenant, platform) bucket, separately enforced | `outbound.test.ts` |
| AC #1c | One tenant's burst does not exhaust another tenant's tokens | `outbound.test.ts` |
| AC #2 | Circuit breaker per platform trips on 5×5xx in 60s; half-open after 5 min | `circuit_breaker.test.ts` + `outbound.test.ts` |
| AC #3 | N consecutive edits on same remote issue within W=30s collapse to 1 outbound call | `coalescer.test.ts` + `outbound.test.ts` |
| AC #4 | 3× load test (180 events/min/tenant) — scaled 30s proof; 1h gate is the Epic exit | `smoke_test.mjs` |
| AC #5 | `sync.platform.degraded` audit event on breaker open | `audit.ts` + `outbound.test.ts` |
| AC #6 | `X-RateLimit-Remaining` < 10% pauses the platform's outbound | `outbound.test.ts` + `smoke_test.mjs` |

## Scope notes

- **Pattern reuse.** `TokenBucket` and `CircuitBreaker` are the same
  shape as `@fora/customer-cloud-broker/src/adapters/aws.ts` (FORA-126.5).
  Per the issue body, we do NOT duplicate that work — the customer-cloud-broker
  pattern is keyed `${tenant_id}|${service}`; the sync-plane pattern is
  keyed by `tenant` for the rate buckets and `platform` for the breaker
  (the breaker reacts to platform health, not to one tenant's
  behaviour).
- **No MCP servers added.** This sub-goal is a pure library. The
  sync-plane service (FORA-252 / 11.1) wires the platform adapters
  when it lands.
- **Coalescer boundary.** Composite-edit coalescing is keyed by
  `${tenant}|${platform}|${remote_issue_id}|${edit_kind}` so a
  comment and a status change on the same Jira issue are NOT merged
  (the audit trail must distinguish them).
- **Audit event schema.** `sync.platform.degraded` /
  `sync.platform.recovered` / `sync.outbound.rate_limited` /
  `sync.outbound.coalesced` / `sync.outbound.circuit_open` follow
  ADR-0010 §8.1. The forwarder (FORA-204) reads from the
  `InMemoryAuditSink` seam.

## Run

```bash
cd packages/sync-plane-ratelimit
pnpm install
pnpm test       # 20 unit tests across 4 files
pnpm build      # tsc → dist/

node forge/11.6/smoke_test.mjs   # end-to-end smoke; writes evidence/smoke_<ts>.json
```

## Known follow-ups (NOT in this sub-goal)

- **1-hour production load test.** The Epic-11 exit gate runs the
  full 1-hour 3× load; this smoke runs a scaled 30s proof.
- **Per-tenant override surface.** Today the bucket defaults are
  per-package; a future config-loader hook reads tenant policy from
  the existing customer-cloud-broker policy DSL (FORA-125).
- **Composite body renderers.** The coalescer joins bodies with
  `\n\n---\n\n`; the per-platform renderer (Jira ADF vs. GitHub
  Markdown vs. ClickUp) is owned by FORA-253 (canonical comment
  envelope).
