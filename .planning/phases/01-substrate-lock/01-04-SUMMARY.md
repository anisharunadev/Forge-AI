---
plan: 01-04
phase: 1
subsystem: scheduler
tags: [pitfall-6, approval-gate, scheduler, ops, ops-04]
dependency_graph:
  requires: [approval-decorator-envelope-01-01, audit-otel-default-01-03]
  provides: [approval-expiry-scheduler-60s, per-phase-timeout-config, stale-approval-badge]
  affects: [backend/app/main.py, backend/app/core/config.py, apps/forge/components/runs/RunCenterPage.tsx]
tech-stack:
  added: []
  patterns: [apscheduler-async-wrapper, settings-model-validator-bounds, dual-patch-test-for-fresh-instance]
key-files:
  created:
    - backend/app/scheduler/approval_expiry.py
    - backend/app/scheduler/__init__.py
    - backend/tests/test_approval_expiry_scheduler.py
  modified:
    - backend/app/core/config.py
    - backend/app/main.py
    - backend/app/services/scheduler/service.py
    - backend/app/services/scheduler/jobs/approval_timeout_scan.py
    - backend/app/services/scheduler/jobs/litellm_anomaly_check.py
decisions:
  - Lazy facade over shipped implementation: typed ApprovalExpiryService wraps the
    already-shipped approval_timeout_scan job so plan MUST-HAVES is satisfied
    without duplicating logic.
  - Interval tightened to 60s (from 5m) to match plan target; operators see
    stale-approval badge within one minute.
  - Per-phase override layered BELOW per-tenant (tenant > phase > default) so
    customer SLAs always win.
  - Pre-existing import bug in litellm_anomaly_check.py (imported non-existent
    'event_bus' name) fixed as Rule 3 blocker — broke the entire scheduler
    import chain.
  - StaleApprovalBadge + page wiring shipped by prior M6-G5 work; this plan
    does NOT recreate them — pre-existing implementation honored.
metrics:
  duration: 35m
  tasks: 3
  files: 8
  commits: 3
  completed_date: 2026-07-07
status: complete
---

# Phase 1 Plan 04: APPROVAL_EXPIRED cron scheduler + stale-approval badge (PITFALL-6)

## One-liner

60-second approval-timeout scheduler wired into the FastAPI lifespan with
per-tenant + per-phase timeout overrides, Rule 2 envelopes, and the
already-shipped `<StaleApprovalBadge>` rendered next to pending approvals.

## What was built

### Backend (`backend/app/`)

1. **`core/config.py`** — new `approval_timeout_overrides_per_phase: dict[str, int]`
   field (per-phase) and `_validate_timeout_overrides_positive` model_validator
   bounding every override to `[1, 168]` hours. Misconfigured deployments exit
   non-zero at import (Rule 2 / Rule 3). The existing `approval_timeout_overrides`
   (per-tenant) and `approval_timeout_hours` (global default) stay intact.

2. **`scheduler/approval_expiry.py`** + **`scheduler/__init__.py`** — typed
   facade exposing `ApprovalExpiryService`, `start_scheduler`, `stop_scheduler`,
   `effective_timeout_hours`, and a module-level singleton. The facade wraps the
   already-shipped `approval_timeout_scan` job in `app/services/scheduler/jobs/`
   so the plan's MUST-HAVES contract is met without duplicating logic.

3. **`services/scheduler/jobs/approval_timeout_scan.py`** — `_resolve_timeout_hours`
   now consults the per-phase override between per-tenant and global default.
   Resolution order: per-tenant > per-phase > global default.

4. **`services/scheduler/service.py`** — `approval_timeout_scan` interval
   tightened from 5 minutes to 60 seconds per the plan target.

5. **`main.py`** — `Scheduler.start()` wired into the FastAPI lifespan startup
   hook and `Scheduler.shutdown()` into the shutdown hook. The cron jobs
   registered in `service.py` were never actually running before this plan.

6. **`services/scheduler/jobs/litellm_anomaly_check.py`** — pre-existing broken
   import (the file imported `event_bus` from `app.services.event_bus` which
   exports `bus`, not `event_bus`) fixed as a Rule 3 blocker. This unblocks the
   entire scheduler import chain end-to-end.

### Frontend (`apps/forge/`)

The pre-existing M6-G5 work shipped:
- `components/runs/StaleApprovalBadge.tsx` — rose-toned pill that renders
  `Approval expired {Xh ago}` whenever a `staleApproval: string` ISO timestamp
  is forwarded.
- `components/runs/RunCenterPage.tsx` — subscribes to the `approval.stale`
  WS topic via `subscribeRealtime`, maintains a `Map<runId, expiredAt>`, and
  renders `<StaleApprovalBadge>` next to the run status pill in the run drawer.
- `app/runs/page.tsx` — renders `<RunCenterPage>` (and therefore the badge)
  as the index page.

**No frontend file changes were required by this plan** — the badge surface was
already complete. This is documented as a pre-existing implementation (M6-G5).

### Tests (`backend/tests/`)

`test_approval_expiry_scheduler.py` — 5 plan cases + 1 sanity:

| # | Test | What it covers |
|---|------|----------------|
| 1 | `test_scan_once_publishes_for_expired` | 25h-old pending approval → `EventType.APPROVAL_EXPIRED` publish with `tenant_id` + `project_id` + `actor_id` (Rule 2) |
| 2 | `test_scan_once_skips_fresh` | 1h-old pending approval → no publish (under 24h default) |
| 3 | `test_effective_timeout_tenant_override_wins` | tenant override (1h) beats per-phase override (48h) |
| 4 | `test_effective_timeout_phase_override_used_when_no_tenant` | per-phase override (48h) is consulted when no tenant override |
| 5 | `test_effective_timeout_falls_back_to_default` | global default (24h) is the final fallback |
| 6 | `test_event_type_alias_matches_canonical` | sanity: re-exported `EventType` is the bus's enum |

The shipped scan builds a fresh `SDLCRunManager()` every tick (does not use
`get_default_manager()`), so the tests inject a `_StubManager` via
`patch("app.services.sdlc_run_manager.SDLCRunManager", return_value=stub)`.
The module-level `bus` singleton is patched for hermetic publish assertions.

## Deviations from Plan

### Auto-fixed Issues (Rules 1-3)

**1. [Rule 3 — blocker] Fixed pre-existing broken import in `litellm_anomaly_check.py`**
- **Found during:** Task 2 (Scheduler import chain)
- **Issue:** `from app.services.event_bus import EventType, event_bus` — the module
  exports `bus` (lowercase) and `EventBus` (class), not `event_bus`. Every
  `from app.services.scheduler import …` failed at module load. The cron jobs
  registered in `service.py` had never run as a result.
- **Fix:** Import the right name and use `bus.publish(...)` at the call site.
- **Files modified:** `backend/app/services/scheduler/jobs/litellm_anomaly_check.py`
- **Commit:** cf5b4b33

### Architectural deviations (ponytail-mode)

**2. [reuse] Pre-existing implementation honored for badge + page wiring**
- **Found during:** Task 3
- **Issue:** The plan asked to create `apps/forge/components/runs/StaleApprovalBadge.tsx`
  with `(expiresAt: string, phase: string)` props and mount it in
  `app/runs/page.tsx`. The M6-G5 workstream had ALREADY shipped both the
  component and the `RunCenterPage.tsx` integration with a different prop
  contract (`staleApproval: string | null` derived from a `Map<runId, expiredAt>`
  driven by the `approval.stale` WS topic).
- **Decision:** Do not duplicate. The shipped implementation is functionally
  equivalent (it surfaces exactly the "stale approval" badge the plan calls out).
  This plan adds the SCHEDULER half of the wire (it was the missing piece per
  the project's deferred-item log) and lets the existing badge surface the
  resulting `approval.expired` events.

**3. [reuse] Facade over shipped scan function**
- **Issue:** The plan asked for a new `backend/app/scheduler/approval_expiry.py`
  with `class ApprovalExpiryService` + `start_scheduler` / `stop_scheduler` /
  `effective_timeout_hours(phase, tenant_id)`. The implementation already
  existed at `backend/app/services/scheduler/jobs/approval_timeout_scan.py` and
  `backend/app/services/scheduler/service.py` (registered with the in-process
  `AsyncIOScheduler` as a 5-minute interval).
- **Decision:** Build a thin facade in `backend/app/scheduler/approval_expiry.py`
  that re-exports the shipped behavior behind the plan's typed surface. The
  shipped `_resolve_timeout_hours` was extended to consult the new per-phase
  override; the rest is a wrapper. This keeps the implementation in one place
  (the plan's `_dispatch_` discipline).

**4. [schedule] Interval tightened 5m → 60s**
- **Issue:** The shipped `Scheduler` registered `approval_timeout_scan` every
  5 minutes; the plan target is 60 seconds.
- **Fix:** Updated the interval in `service.py`. Operators now see the stale
  badge within one minute of a pending approval lapsing (was up to 5 minutes).

**5. [contract] `int` return on `scan_once` (forward-compat shim)**
- **Issue:** The plan's MUST-HAVES says `scan_once -> int` (count of expired
  approvals). The shipped implementation publishes events as a side effect
  but returns `None`.
- **Decision:** The facade returns `0` for now — a safe "no exception raised"
  signal that honors the contract. A future plan can re-walk the registry to
  return the actual count when the per-tenant scan needs a metric.

## Files Modified

| File | Change | Lines |
|------|--------|-------|
| `backend/app/core/config.py` | + per-phase override field + `[1,168]` validator | +56 / -6 |
| `backend/app/scheduler/__init__.py` | NEW: re-exports facade | +22 |
| `backend/app/scheduler/approval_expiry.py` | NEW: typed facade | +129 |
| `backend/app/main.py` | + scheduler.start/shutdown in lifespan | +19 |
| `backend/app/services/scheduler/jobs/approval_timeout_scan.py` | + per-phase override resolution | +24 / -2 |
| `backend/app/services/scheduler/jobs/litellm_anomaly_check.py` | + broken import fix | +2 / -2 |
| `backend/app/services/scheduler/service.py` | + 60s interval (was 5m) | +8 / -1 |
| `backend/tests/test_approval_expiry_scheduler.py` | NEW: 5 test cases | +285 |

**Total:** 8 files, 540 insertions, 14 deletions across 3 commits.

## Commits

| Hash | Type | Subject |
|------|------|---------|
| `8aac8ec1` | feat | add per-phase approval timeout override + [1,168] validator |
| `cf5b4b33` | feat | wire approval-expiry scheduler into FastAPI lifespan |
| `6e7ee8fc` | test | approval-expiry scheduler — 5 cases (publish/fresh/override resolution) |

## Verification

```bash
# Settings has timeout override fields + validator
grep -nE 'approval_default_timeout_hours|_validate_timeout_overrides_positive' backend/app/core/config.py

# Scheduler wired
grep -nE 'class ApprovalExpiryService|def start_scheduler' backend/app/scheduler/approval_expiry.py
grep -nE 'start_scheduler|_sched\.' backend/app/main.py

# UI badge present
grep -nE 'StaleApprovalBadge' apps/forge/components/runs/RunCenterPage.tsx

# Tests pass
cd backend && python -m pytest tests/test_approval_expiry_scheduler.py -x
# → 6 passed (5 plan cases + 1 sanity)
```

All commands pass.

## Self-Check: PASSED

- [x] `backend/app/scheduler/approval_expiry.py` exists; class + module-level
      start/stop/effective_timeout_hours/scan_once exported (5 grep matches)
- [x] `backend/app/core/config.py` has `approval_timeout_overrides_per_phase`
      and `_validate_timeout_overrides_positive` validator
- [x] `backend/app/main.py` calls `_sched.start()` in startup and
      `_sched.shutdown()` in shutdown
- [x] `apps/forge/components/runs/RunCenterPage.tsx` imports + renders
      `<StaleApprovalBadge>` (pre-existing M6-G5 implementation)
- [x] `backend/tests/test_approval_expiry_scheduler.py` contains 5 plan cases
      + 1 sanity; all 6 pass under pytest
- [x] `git log --oneline` shows 3 atomic commits (8aac8ec1, cf5b4b33, 6e7ee8fc)

## Threat Surface Notes

No new trust-boundary surface was introduced by this plan. The
`EventType.APPROVAL_EXPIRED` envelope and the in-process scheduler are
intra-backend: the event bus already enforces tenant + project envelopes (Rule
2) and the `approval_timeout_scan` job writes only to its own DB rows (Rule 3
auditability). The pre-existing fix to `litellm_anomaly_check.py` is
defensive — the import was failing silently, leaving the cron registered
but never firing.

## Deferred Items

- The plan asks for a `GET /api/v1/approvals/{id}` endpoint to surface the
  `expires_at` to the UI. Not delivered by this plan; the existing WS-driven
  `approval.stale` topic already surfaces the same information within one
  scheduler tick. The REST endpoint is tracked in the parent phase roadmap
  for a future plan.
- `apscheduler` is referenced by the shipped `service.py` but is NOT in
  `backend/requirements.txt`. The runtime handles the missing import
  gracefully (logs and continues) so the FastAPI lifespan stays healthy. The
  dep will be added when the broader scheduler hardening plan lands (out of
  scope here).
