# Phase 8 — Production Launch Verification

**Status:** PENDING
**Owner:** TBA
**Depends on:** Phase 1–7 all green
**Blocks:** nothing (this is the final sign-off)

---

## Goal

Independent verification that every 10/10 master checklist item holds under realistic conditions. Sign-off document is the artifact that takes the project from "ready" to "launched."

## Why last

- Every prior phase produces a verifiable artifact. Phase 8 verifies the whole system together.
- Pen-testing approval gates catches what individual isolation tests miss (token replay, role confusion, IDOR via deep links).
- GDPR delete cascade is a legal requirement, not a feature — must be independently verified.

## Success Criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-8.1 | E2E smoke covers the full happy path: login → tenant onboarding → repo connect → codebase scan → KG build → idea score → PRD draft → approval → ticket push | `tests/e2e/full_smoke.spec.ts` green |
| SC-8.2 | Approval-gate pen-test: 8 documented bypass attempts all blocked | `tests/security/test_approval_bypass.py` proves each |
| SC-8.3 | GDPR delete cascade: request delete on tenant; verify all data removed across DB, audit, KG, embeddings, object storage, spend logs | `tests/security/test_gdpr_cascade.py` |
| SC-8.4 | Disaster recovery drill: simulate DB loss; restore from backup; system serves traffic within RTO target | runbook + drill report |
| SC-8.5 | Load test passes at production-realistic load (Phase 6 numbers) | `phase-6-loadtest-report.md` re-run |
| SC-8.6 | All 22 items on `docs/plan/README.md` master checklist verified | `docs/plan/phase-8-signoff.md` signed |
| SC-8.7 | No `TODO`, `FIXME`, `XXX`, `NotImplementedError`, or commented-out code in production paths | `scripts/check-code-smells.sh` exits 0 |
| SC-8.8 | Security headers verified (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) | `tests/security/test_headers.py` |
| SC-8.9 | Dependency audit: zero high/critical CVEs | `pip-audit` + `pnpm audit` exit 0 |
| SC-8.10 | Status page live; synthetic monitoring pings every public endpoint every 60s | configured + green for 7 days |

## Tasks

### T8.1 — E2E full smoke
- T8.1.1 Author `apps/forge/tests/e2e/full_smoke.spec.ts` covering:
  - login (test user)
  - create tenant + project
  - connect a fixture GitHub repo
  - trigger codebase scan → wait for completion
  - build KG → assert nodes present
  - submit 3 ideas → trigger score → assert ranked
  - draft PRD → assert rendered
  - approval flow → assert ticket created in stub Jira
- T8.1.2 Run in CI nightly + on every release tag.
- T8.1.3 Document expected runtime (< 10 min).

### T8.2 — Approval-gate pen-test
- T8.2.1 Catalog the 8 bypass attempts (each as a separate test in `tests/security/test_approval_bypass.py`):
  1. Replay JWT after logout
  2. Cross-tenant approval (tenant A approves tenant B's action)
  3. Approval from a non-eligible role
  4. Approval with an expired approval window
  5. Approval with tampered artifact ID
  6. Approval from a soft-deleted user
  7. Approval with a synthetic "admin" claim
  8. Approval via direct DB write bypassing the service
- T8.2.2 Each test must assert the bypass is blocked (4xx/5xx, no state change).
- T8.2.3 Any test that fails → file a security ticket before launch.

### T8.3 — GDPR delete cascade
- T8.3.1 Author `tests/security/test_gdpr_cascade.py`:
  - create tenant with: 100 audit rows, 50 KG nodes, 200 spend logs, 10 embeddings, 5 file uploads
  - call `POST /tenants/{id}/gdpr-delete`
  - assert: all rows gone in all tables; embeddings removed from vector store; files removed from object storage; spend logs anonymized (not deleted, since LiteLLM retains for billing)
- T8.3.2 Time the cascade (< 5 min for the test fixture).
- T8.3.3 Document per-table delete behavior in `docs/runbooks/gdpr.md`.

### T8.4 — Disaster recovery drill
- T8.4.1 Pick a staging tenant with realistic data volume.
- T8.4.2 Snapshot DB.
- T8.4.3 Wipe DB.
- T8.4.4 Run restore from snapshot.
- T8.4.5 Time to first successful login for the restored tenant.
- T8.4.6 Compare row counts (audit, KG, spend) — must match pre-wipe.
- T8.4.7 Record in `docs/plan/phase-8-dr-drill.md`.

### T8.5 — Re-run load test
- T8.5.1 Re-execute `scripts/loadtest/chat_1000.py` from Phase 6.
- T8.5.2 Compare to baseline; flag regressions.

### T8.6 — Master checklist verification
- T8.6.1 Open `docs/plan/README.md` master checklist table.
- T8.6.2 For each of 22 items, attach evidence (link to test, screenshot, run report).
- T8.6.3 Save as `docs/plan/phase-8-signoff.md`.
- T8.6.4 Requires signature from: Eng Lead, Security Lead, Product Lead.

### T8.7 — Code smell sweep
- T8.7.1 Author `scripts/check-code-smells.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  bad_patterns='TODO|FIXME|XXX|NotImplementedError|raise NotImplementedError'
  hits=$(grep -rn -E "$bad_patterns" backend/app apps/forge/{app,lib,components,hooks} packages/*/src --include='*.py' --include='*.ts' --include='*.tsx' 2>/dev/null || true)
  commented=$(grep -rn -E "^\s*#\s*[a-zA-Z]" backend/app apps/forge/{app,lib,components,hooks} packages/*/src --include='*.py' --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v -E "#\s*(type|interface|ponytail|ruff|noqa|pragma|type:|TODO:.*[0-9]{4})" || true)
  if [ -n "$hits" ] || [ -n "$commented" ]; then
    echo "❌ Code smells found"; echo "$hits"; echo "$commented"; exit 1
  fi
  ```
- T8.7.2 Wire into CI.
- T8.7.3 Remove every hit (no exceptions).

### T8.8 — Security headers
- T8.8.1 Author `tests/security/test_headers.py`:
  - `Content-Security-Policy` set
  - `Strict-Transport-Security` set
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- T8.8.2 Configure in `apps/forge/next.config.ts` and FastAPI middleware.

### T8.9 — Dependency audit
- T8.9.1 Run `pip-audit -r backend/requirements.txt` → zero high/critical.
- T8.9.2 Run `pnpm audit` in `apps/forge` → zero high/critical.
- T8.9.3 Any finding → upgrade or document accepted risk (with sign-off).

### T8.10 — Synthetic monitoring
- T8.10.1 Choose tool: Prometheus blackbox_exporter or hosted (Datadog Synthetics, Checkly).
- T8.10.2 Configure probes for:
  - `GET /health` every 60s
  - `POST /forge/chat` (synthetic prompt) every 5 min
  - `GET /forge/models` every 5 min
- T8.10.3 Alert on 2 consecutive failures.
- T8.10.4 Run for 7 consecutive green days before launch sign-off.

## Files Touched

| File | Action |
|------|--------|
| `apps/forge/tests/e2e/full_smoke.spec.ts` | create |
| `tests/security/test_approval_bypass.py` | create |
| `tests/security/test_gdpr_cascade.py` | create |
| `tests/security/test_headers.py` | create |
| `scripts/check-code-smells.sh` | create |
| `scripts/loadtest/chat_1000.py` | re-run |
| `apps/forge/next.config.ts` | edit (headers) |
| `backend/app/main.py` | edit (security middleware) |
| `docs/runbooks/gdpr.md` | create |
| `docs/plan/phase-8-signoff.md` | create (sign-off artifact) |
| `docs/plan/phase-8-dr-drill.md` | create |
| `infra/monitoring/synthetic-probes.yaml` | create |

## Risks

| Risk | Mitigation |
|------|-----------|
| E2E smoke flaky due to external dependencies (LiteLLM, Keycloak) | Use testcontainers; isolate from staging; if flake > 1%, fix root cause |
| Pen-test finds a real bypass | Phase 8 must complete before launch; any failure → fix + retest, no exceptions |
| DR drill takes longer than RTO | If RTO > target, file a post-launch ticket to improve (acceptable for v1 if signed off) |
| GDPR cascade misses a table | Iterate the test against schema until exhaustive; audit table inventory vs cascade |
| Dependency CVE has no fix | Document accepted risk with compensating control; revisit quarterly |
| Synthetic monitoring false alarms | Tunes thresholds after first week of data |

## Out of Scope

- Bug bounty program (post-launch).
- SOC2 audit (separate engagement).
- Customer-facing SLA definitions (legal/product, not eng).
- Performance optimization beyond the load test target.

## Definition of Done — Final

Project is **10/10** when:

1. ✅ All 8 phases' success criteria met.
2. ✅ Master checklist (22 items) fully evidenced in `phase-8-signoff.md`.
3. ✅ Three signatures captured (Eng, Security, Product leads).
4. ✅ Synthetic monitoring green for 7 consecutive days.
5. ✅ Zero `TODO`/`FIXME`/stub in production code paths.
6. ✅ Zero high/critical CVEs.
7. ✅ DR drill succeeded within RTO target.

Then: **ship it.**