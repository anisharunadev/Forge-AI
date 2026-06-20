# @fora/sync-plane-job

FORA Sync Plane nightly cron worker. Walks
`sync.divergence_queue` once per day, emits
`sync.backfill.completed` per tenant, and feeds the
FORA-204 daily drift report.

Owner: IntegrationEngineer (CTO supervises, Architect
reviews per ADR-0010).

## Scope

- **FORA-438 AC#5** — nightly cron over the GitHub
  divergence path. The shared worker pattern means
  FORA-406 (Jira) divergences go through the same scan.
- **FORA-204** — the audit forwarder owns the
  consolidated daily drift report. The cron emits the
  per-tenant `sync.backfill.completed` rows that the
  drift report aggregates.

## Out of scope (per the FORA-200 charter)

- Push to protected refs / main / release/*.
- Direct writes to Jira or GitHub.
- GitHub Issues / ClickUp adapter bodies — separate
  child slices.

## Entry points

- `pnpm --filter @fora/sync-plane-job scan` — runs the
  scan once (the orchestrator invokes this on the cron
  schedule).
- `pnpm --filter @fora/sync-plane-job register` —
  prints the cron registration descriptor as JSON. The
  orchestrator reads this to install the k8s CronJob.
- `pnpm --filter @fora/sync-plane-job smoke` — runs a
  dependency-free smoke that the wiring is correct.

The Python module at
`agents/sync_plane_service/nightly_cron.py` is the
source of truth for the scan logic; this package is the
k8s CronJob registration surface.

## Acceptance bar

- `divergence_signal` smoke green: 422 mock →
  `sync.event.divergence_detected` in audit log (the
  per-event 422 path — see
  `agents/sync_plane_service/adapters/test_github.py`
  S6).
- Nightly cron scheduled via this worker; idempotent
  (re-running on the same snapshot yields no new
  divergence events).
- Daily drift report aggregates across all platforms
  via FORA-204.
