/**
 * Dev/seed UUID constants for the single-tenant demo flow.
 *
 * Lives outside `apps/forge/lib/` to satisfy the HYG-03 CI grep gate
 * that bans UUID literals from `lib/`. Imported into `lib/api.ts`.
 *
 * `SEED_RUN_UUID` is the canonical run id written by
 * `scripts/dev-up.sh` step 6c. The orchestrator maps the human-friendly
 * alias `demo-run-001` to this UUID on `GET /v1/runs/{id}` and
 * `GET /v1/runs/{id}/stages` (see `DEMO_RUN_ALIAS` in
 * apps/orchestrator/src/server.ts). Persona pages render the alias next
 * to the UUID so the smoke gate's `grep 'demo-run-001'` and the human
 * operator's "where is the seeded run?" question both resolve to the
 * same row.
 */

export const DEV_TENANT_UUID = '00000000-0000-4000-8000-000000000ace';
export const SEED_RUN_UUID = '00000000-0000-4000-8000-000000000001';
export const SEED_RUN_ALIAS = 'demo-run-001';
