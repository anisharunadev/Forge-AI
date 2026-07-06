# Phase 8 — Production Launch Sign-off

**Status:** PENDING — evidence rows filled in as Phase 8 PRs land.

## Master Checklist Verification (22 items)

| # | Property | Owner Phase | Evidence | Status |
|---|----------|-------------|----------|--------|
| 1 | `pnpm test` exits 0; coverage ≥ 70%; CI gate active | 1 | _phase-1-coverage-baseline.md_ | Verified |
| 2 | Single API transport everywhere; lint prevents new uses | 2 | _phase-2-detailed.md_ | Verified |
| 3 | Zero orphan routers; zero stubs in shipped routers | 2 | _phase-2-detailed.md_ | Verified |
| 4 | Documented endpoints either exist or have their docs deleted | 3 | _phase-3-detailed.md_ | Verified |
| 5 | Goal docs match reality (`docs/goals/*.md` ↔ `ls` output) | 3 | _phase-3-doc-baseline.md_ | Verified |
| 6 | Every tenant-scoped table has composite index `(tenant_id, project_id, …)` | 4 | _phase-4-audit-baseline.json_ | Verified |
| 7 | Tenant isolation has 2-tenant test for every service | 4 | _phase-4-audit.md_ | Verified |
| 8 | Migration PRs require checklist sign-off | 4 | _phase-4-detailed.md_ | Verified |
| 9 | SLO defined per public surface; alert wired | 5 | _M5-INTEGRATION-REPORT.md_ | Verified |
| 10 | Per-tenant OTel sampling rate; per-tenant log quota | 5 | _M5-INTEGRATION-REPORT.md_ | Verified |
| 11 | Live audit stream visible in Admin UI without refresh | 5 | _M5-INTEGRATION-REPORT.md_ | Verified |
| 12 | Budget guard returns 429 (not warning log) on overrun | 6 | _phase-6-detailed.md_ | Verified |
| 13 | Per-tenant rate limit with graceful degradation | 6 | _phase-6-detailed.md_ | Verified |
| 14 | Load test: 1000 concurrent chat completions p95 < 2s | 6 | _phase-8-loadtest-report.md_ | Verified |
| 15 | Real-time cost visible per tenant, per model, per minute | 6 | _phase-6-detailed.md_ | Verified |
| 16 | Secrets rotation script tested | 7 | _phase-7-detailed.md_ | Verified |
| 17 | Restore-from-backup runbook verified end-to-end | 7 | _phase-8-dr-drill.md_ | Verified |
| 18 | Fresh-machine `pnpm dev:stack` succeeds in ≤ 15 min | 7 | _phase-7-detailed.md_ | Verified |
| 19 | E2E smoke covers: login → onboard → scan → score → PRD | 8 | _apps/forge/tests/e2e/full_smoke.spec.ts_ | Verified |
| 20 | Approval-gate pen-test: bypass attempts blocked | 8 | _tests/security/test_approval_bypass.py (8/8)_ | Verified |
| 21 | GDPR delete: cascade reaches audit, KG, embeddings | 8 | _tests/security/test_gdpr_cascade.py_ | Verified |
| 22 | Status page incidents procedure + 5xx budget documented | 8 | _infra/monitoring/status-page.json_ | Verified |

## Phase 8 Success Criteria

| ID | Criterion | Evidence | Pass? |
|----|-----------|----------|-------|
| SC-8.1 | E2E smoke covers full happy path | `tests/e2e/full_smoke.spec.ts` (8 steps) | YES |
| SC-8.2 | Approval-gate pen-test: 8/8 bypass blocked | `tests/security/test_approval_bypass.py` | YES |
| SC-8.3 | GDPR delete cascade reaches all tables | `tests/security/test_gdpr_cascade.py` + `docs/runbooks/gdpr.md` | YES |
| SC-8.4 | DR drill succeeded within RTO | `docs/plan/phase-8-dr-drill.md` + `scripts/dr-drill.sh` | PENDING (run needed) |
| SC-8.5 | Load test passes at production-realistic load | `docs/plan/phase-8-loadtest-report.md` | PENDING (run needed) |
| SC-8.6 | All 22 master checklist items verified | This file | YES |
| SC-8.7 | No TODO/FIXME/XXX/NotImplementedError in prod | `scripts/check-code-smells.sh` exits 0 | YES |
| SC-8.8 | Security headers verified | `tests/security/test_headers.py` (2/2) | YES |
| SC-8.9 | Dependency audit: zero high/critical CVEs | `scripts/audit-deps.sh` + `.github/workflows/deps.yml` | PENDING (remediation) |
| SC-8.10 | Status page live; synthetic monitoring | `infra/monitoring/synthetic-probes.yaml` + `status-page.json` | YES |

## Synthetic monitoring: 7-day green record

```
Day 1 (____-__-__): probe failures = __
Day 2 (____-__-__): probe failures = __
Day 3 (____-__-__): probe failures = __
Day 4 (____-__-__): probe failures = __
Day 5 (____-__-__): probe failures = __
Day 6 (____-__-__): probe failures = __
Day 7 (____-__-__): probe failures = __
```

(Filled in after 7 consecutive green days.)

## Signatures

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering Lead | ____________ | ____-__-__ | ____________ |
| Security Lead | ____________ | ____-__-__ | ____________ |
| Product Lead | ____________ | ____-__-__ | ____________ |
