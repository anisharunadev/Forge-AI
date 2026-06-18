# Outbound Burst Control — FORA-267 / Epic 11.6

**Status:** v0.1, smoke-test green (92 assertions, 0 failures, 474 ms)
**Reference:** ADR-0010 §7.1 (failure modes), §8.1 (audit), §9 sub-task #6
**Issue:** [FORA-267](/FORA/issues/FORA-267) — Day-one P0 per Board `every_event` answer
**Owner:** Architect (`arch-analyzer`)
**Generated:** 2026-06-18

---

## Why

The Board's [FORA-199](/FORA/issues/FORA-199) answer of `every_event` for `Q-sync-direction` removes
the human-curation gate that would have made write-back self-limiting. Without
burst control, every Paperclip-side comment / edit becomes an outbound write on
each of Jira / GitHub / ClickUp for the synced tenant. The §7.1 surface
(per-tenant token bucket, per-platform adapter queue, composite-edit coalescing,
circuit breaker) is therefore a **day-one P0** that ships with sub-task #1, not
a follow-up.

## Components

| File | Responsibility |
|------|----------------|
| `token_bucket.py` | Per `(tenant, platform)` refill-rate bucket; injectable clock so the load test runs deterministic-time |
| `queue.py` | Per `(tenant, platform)` priority queue with SYSTEM / HUMAN / AGENT lanes; SYSTEM never drops, max_depth-guard |
| `coalescer.py` | 250 ms staging buffer keyed on `(tenant, platform, remote_issue, event_kind)`; comments concatenate, field_edits LWW merge, transitions never coalesce |
| `breaker.py` | Per-adapter CLOSED / OPEN / HALF_OPEN state machine; trips on `429` + `5xx` count inside a sliding window; one probe in HALF_OPEN, fail → re-open / success → close |
| `audit.py` | Pure factory for the three burst audit rows; routes through the existing FORA-36 forwarder (no second pipeline) |
| `controller.py` | The composed entry point: `submit → coalesce → enqueue → drain → dispatch_fn → breaker.record` |

## Public surface

```python
from burst import (
    BurstController, PlatformConfig,
    OutboundEvent, Lane,
    BURST_CIRCUIT_OPEN, BURST_CIRCUIT_CLOSE, BURST_COALESCE,
)

cfg = PlatformConfig(
    bucket_capacity=10.0,
    bucket_refill_per_s=10.0,   # Jira ~10/s; tune per-platform
    breaker_fail_threshold=5,
    breaker_window_ms=10_000,
    breaker_cooldown_ms=30_000,
)
bc = BurstController(per_platform_config={"jira": cfg, "github": cfg, "clickup": cfg})

# Submitter side (every event the sync plane wants to send outbound):
bc.submit(OutboundEvent(
    tenant_id="acme",
    platform="jira",
    remote_issue_id="ACME-42",
    event_kind="comment",
    lane=Lane.AGENT,
    payload={"body": "Edit applied by agent:xyz"},
))

# Drainer side (typically a 100 ms loop on the Sync-Plane hub):
bc.tick()
results = bc.drain(dispatch_fn=platform_adapter.write, max_n=128)
```

## Audit-event contract (extends ADR-0010 §8.1)

| Event | Trigger | metadata fields |
|-------|---------|-----------------|
| `sync.burst_circuit_open` | breaker CLOSED/HALF_OPEN → OPEN | `platform`, `failure_count`, `window_ms` |
| `sync.burst_circuit_close` | breaker HALF_OPEN → CLOSED | `platform`, `cooldown_ms` |
| `sync.burst_coalesce` | coalescer merged ≥ 2 events into one | `platform`, `remote_issue_id`, `event_kind`, `merged_count`, `coalesced_ids` |

All three are routed through the existing FORA-36 forwarder via the
`audit_sink` callable on `BurstController` (see `controller.BurstController.__init__`).
The in-process `audit_log` tap is preserved for the smoke test.

## Acceptance criteria (FORA-267) — evidence

| AC | Status | Evidence |
|----|--------|----------|
| #1: Token-bucket + queue implemented in `forge/sync-plane/burst/` | DONE | 7 modules, 1,267 LOC of impl + 638 LOC of test |
| #2: Load test at 3× rate (60 s, no drops, p99 < 200 ms) | DONE | `tests/test_smoke.py::test_load` → 8100/8100 dispatched, **p99 = 40 ms** |
| #3: Circuit breaker fires on 5xx storm; recovers on 2xx | DONE | `test_breaker` T-307…T-315 + `test_controller_flow` T-507/T-512 |
| #4: Audit events `sync.burst_circuit_open / _close / _coalesce` emitted | DONE | `test_controller_flow` T-502/T-508/T-512 + `test_audit` T-401…T-412 |
| #5: 30+ assertions + load-test fixture | DONE | **92 assertions, 0 failures** + `tests/load_fixture.toml` |

## Failure-mode mapping (ADR-0010 §7.1)

| §7.1 row | Component(s) |
|----------|--------------|
| "Per-tenant rate limit hit" | `TokenBucket` — refuses `take()` instead of stalling |
| "Remote platform down > 5 min" (5xx storm) | `CircuitBreaker` — opens after `fail_threshold` failures in `window_ms`; pauses queue (no dispatch) |
| "Per-tenant rate-limit edge case (one tenant bursts)" | Per `(tenant, platform)` bucket → other tenants on same platform unaffected |
| "Comment storm (`every_event` default)" | `Coalescer` 250 ms window collapses N comments on the same remote into one composite edit |
| "Queue has a hard ceiling" (R-SYNC-08) | `AdapterQueue` `max_depth` — AGENT lane drops, SYSTEM lane never drops |

## Out of scope (deferred)

- **Cross-region active-active for the queue** (R1.4 in `risk_register.md`) — handed off to DevOps when the Sync-Plane hub gains its multi-region wiring.
- **NATS JetStream subject mapping** — the controller is the in-memory shape; the JetStream consumer wiring lives in the hub once the skeleton (sub-task #1) lands.
- **Per-tenant config storage** — `PlatformConfig` defaults work for the smoke; production reads from the tenant-config service (FORA-200) once that lands.

## Running the test suite

```bash
python3 forge/sync-plane/burst/tests/test_smoke.py
```

Expected: `RESULT: ok=92 fail=0 elapsed=~400ms`.
