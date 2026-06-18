# forge/11.6 — Outbound rate limiter + circuit breaker + burst control

Day-one P0 sub-goal of [Epic 11 — Forge Integration Layer](/FORA/issues/FORA-249).
Implements [ADR-0010 §7.1](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) and
§8.2 R-SYNC-03 (comment storm DoS).

| Artifact | Purpose |
|---|---|
| `contract.md` | Design contract — interface, scope, ACs, run instructions |
| `smoke_test.mjs` | End-to-end smoke that exercises all 4 ACs and writes `evidence/smoke_<ts>.json` |
| `evidence/` | Smoke evidence (one JSON per run) |

The actual implementation lives in `packages/sync-plane-ratelimit/` (a
TypeScript workspace package; pattern reused from
`@fora/customer-cloud-broker`'s `TokenBucket` + `CircuitBreaker`,
shipped in FORA-126.5).
