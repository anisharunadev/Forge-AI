# Forge-AI 10/10 Production Readiness Roadmap

**Target:** take the current **6.5/10** codebase to **10/10** — a real-time, multi-tenant, production-grade AI orchestration platform.

**Constitutional anchor:** every phase must leave the codebase in a state where no stub, no mock, no `TODO`, and no dead code remains in its scope. Anything half-implemented is either finished or deleted in the same phase.

---

## Phase Dependency Graph

```
Phase 1: Test Infrastructure ─────────────┐
        │                                   │
        ▼                                   ▼
Phase 2: Routing & API Hygiene ──► Phase 4: Multi-Tenancy Hardening
        │                                   │
        ▼                                   ▼
Phase 3: Documentation as Code ──► Phase 5: Observability & SLOs
                                            │
                                            ▼
                       Phase 6: Cost, Budgets & Rate Limits
                                            │
                                            ▼
                       Phase 7: Operational Readiness
                                            │
                                            ▼
                       Phase 8: Production Launch Verification
```

Each phase produces a verifiable artifact (green CI, lint clean, load test pass) before the next begins.

---

## Phase Index

| # | Title | Goal | Files | Phase Doc |
|---|-------|------|-------|-----------|
| 1 | **Test Infrastructure Foundation** | `pnpm test` exits 0; one glob; CI blocks | ~6 | [phase-1.md](./phase-1.md) |
| 2 | **Routing & API Hygiene** | 1 API transport; orphan lint; missing endpoints backfilled or deleted | ~12 | [phase-2.md](./phase-2.md) |
| 3 | **Documentation as Code** | Doc drift detected in CI; goals → code reality enforced | ~5 | [phase-3.md](./phase-3.md) |
| 4 | **Multi-Tenancy Hardening** | Every tenant-scoped query verified isolated; migration safety gate | ~8 | [phase-4.md](./phase-4.md) |
| 5 | **Observability & SLOs** | Per-surface SLOs; live audit stream; per-tenant sampling | ~10 | [phase-5.md](./phase-5.md) |
| 6 | **Cost, Budgets & Rate Limits** | Budgets fail closed; 1000-concurrent load verified; real-time cost dashboard | ~9 | [phase-6.md](./phase-6.md) |
| 7 | **Operational Readiness** | Rotation script; verified DR; 15-min fresh setup | ~7 | [phase-7.md](./phase-7.md) |
| 8 | **Production Launch Verification** | E2E smoke; pen-test approval gates; GDPR cascade; sign-off | ~5 | [phase-8.md](./phase-8.md) |

---

## Definition of "10/10" — Master Checklist

A reviewer can mark the project 10/10 when **all** of the following are true. Each item maps to a phase; the phase doc defines how to verify it.

| # | Property | Owner Phase |
|---|----------|-------------|
| 1 | `pnpm test` exits 0; coverage ≥ 70%; CI gate active | 1 |
| 2 | Single API transport everywhere; lint prevents new uses | 2 |
| 3 | Zero orphan routers; zero stubs in shipped routers | 2 |
| 4 | Documented endpoints either exist or have their docs deleted | 3 |
| 5 | Goal docs match reality (`docs/goals/*.md` ↔ `ls` output) | 3 |
| 6 | Every tenant-scoped table has composite index `(tenant_id, project_id, …)` | 4 |
| 7 | Tenant isolation has 2-tenant test for every service | 4 |
| 8 | Migration PRs require checklist sign-off | 4 |
| 9 | SLO defined per public surface; alert wired | 5 |
| 10 | Per-tenant OTel sampling rate; per-tenant log quota | 5 |
| 11 | Live audit stream visible in Admin UI without refresh | 5 |
| 12 | Budget guard returns 429 (not warning log) on overrun | 6 |
| 13 | Per-tenant rate limit with graceful degradation | 6 |
| 14 | Load test: 1000 concurrent chat completions p95 < 2s | 6 |
| 15 | Real-time cost visible per tenant, per model, per minute | 6 |
| 16 | Secrets rotation script tested | 7 |
| 17 | Restore-from-backup runbook verified end-to-end | 7 |
| 18 | Fresh-machine `pnpm dev:stack` succeeds in ≤ 15 min | 7 |
| 19 | E2E smoke covers: login → onboard → scan → score → PRD | 8 |
| 20 | Approval-gate pen-test: bypass attempts blocked | 8 |
| 21 | GDPR delete: cascade reaches audit, KG, embeddings | 8 |
| 22 | Status page incidents procedure + 5xx budget documented | 8 |

---

## Anti-Patterns Forbidden in Every Phase

These are ponytail-mode rules for this project. Violations block merge.

- **No `TODO`, `FIXME`, `XXX`** in committed code (CI lint check; if it's in a doc it must have an owner + due date).
- **No `# in real impl this would …`** — write the real impl.
- **No `pass` in business logic** — empty handlers, silent fallbacks, swallowed exceptions.
- **No `raise NotImplementedError`** in shipped code paths.
- **No `if settings.DEBUG`** in business logic — production code runs in prod.
- **No `time.sleep` in tests** — use `freezegun`, fake clocks, or event-driven waits.
- **No commenting-out code** — delete it; git remembers.
- **No dead exports** — every public symbol has a caller or a doc + owner.

---

## Working Agreement

- We implement **one phase at a time** in order.
- Each phase ends with: green CI, all success criteria met, a commit per task, a phase close-out note appended to the phase doc.
- If a phase reveals that a later phase is now moot (because the work was absorbed), we delete the later phase from the roadmap.
- We do **not** skip ahead. Phase 1 unblocks verifiable work; skipping it ships blind.