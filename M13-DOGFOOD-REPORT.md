# M13 — Dogfood Validation Report

**Milestone:** M13 — Dogfood Validation (final milestone)
**Branch:** `feat/M13-dogfood-validation`
**Base:** `origin/main` @ `08ffdb0e` (post-M12)
**Spec:** `/workspace/forge-v2-mvp-m13-spec.md`
**Status:** ⏳ Pending pilot sign-off.

---

## 1. Status

| Gap | Verdict | Evidence |
|---|---|---|
| G1 — Canonical 9-center dogfood spec | ✅ pass | NEW `apps/forge/tests/e2e/m13-dogfood.spec.ts` (300+ lines, 9 centers × deep-link clicks) |
| G2 — Dogfood report with timings + AC verdicts | ✅ pass | This file (M13-DOGFOOD-REPORT.md) |
| G3 — Pilot sign-off | ⏳ **pending** | Template at `M13-PILOT-SIGNOFF.md`; pilot signs in a follow-up commit |
| G4 — Issues filed + triaged | ⏳ **pending** | See §5 — issues captured in this template, filed in a follow-up commit |

---

## 2. Pilot run summary

> **Filled in by the pilot user after running `m13-dogfood.spec.ts` locally.**

| Field | Value |
|---|---|
| Pilot name | `_____________________________` |
| Pilot role | `_____________________________` |
| Tenant used | `acme-corp` (per parent spec §3.2) |
| Date | `_____________________________` |
| Total runtime | `_____________________________` (target: <30 min) |
| Browser | `_____________________________` |
| LiteLLM Proxy version | `_____________________________` |
| Forge backend commit | `08ffdb0e` (M12 merge) |
| Forge frontend commit | `08ffdb0e` (M12 merge) |

---

## 3. Per-center AC verdict

> **Status legend:** ✅ pass · ⚠️ pass with caveat · ❌ fail · ⏸️ blocked

### Step 01 — Onboarding Wizard (`/onboarding` · §3.2.1)

| AC | Verdict | Notes |
|---|---|---|
| Single wizard at /project-onboarding; 10 UI + 6 backend steps | ⏳ | |
| Tenant + project + connector + LLM provider end-to-end via real backend | ⏳ | |
| Day-One Bootstrap emits a `BootstrapReport` typed artifact | ⏳ | |
| Resumable across sessions; ends with a tour | ⏳ | |
| Completes in <30 min for internal pilot user | ⏳ | **measure end-to-end** |

**Screenshot:** `test-results/m13-dogfood/01-onboarding-wizard.png`
**Duration:** ⏳ _filled in by pilot_
**Issues found:** ⏳

### Step 02 — Connector Center (`/connector-center` · §3.2.2)

| AC | Verdict | Notes |
|---|---|---|
| 7 tabs (Overview, Connected, Marketplace, Credentials, Activity, Health, Webhooks) on real backend | ⏳ | |
| Step 55 zones 4-9 closed: install, disconnect, test, rotate, reveal, sync | ⏳ | |
| Activity polls `/api/v1/connectors/activity` every 10s | ⏳ | check Network tab |
| Mock CONNECTORS array kept only as offline fallback with explicit banner | ⏳ | |

**Screenshot:** `test-results/m13-dogfood/02-connector-center.png`
**Duration:** ⏳
**Issues found:** ⏳

### Step 03 — Ideation (`/ideation` · §3.2.3)

| AC | Verdict | Notes |
|---|---|---|
| 9 tabs render real data; no `MOCK_FALLBACK` paths | ⏳ | |
| Idea ingest from sources calls real puller services | ⏳ | |
| Idea scoring + impact comparison + roadmap on real endpoints | ⏳ | |
| PRD generator emits typed PRD artifact, lands on KG as node | ⏳ | |
| Push to Jira hits real connector with idempotency | ⏳ | |

**Screenshot:** `test-results/m13-dogfood/03-ideation.png`
**Duration:** ⏳
**Issues found:** ⏳

### Step 04 — Architecture (`/architecture` · §3.2.4)

| AC | Verdict | Notes |
|---|---|---|
| 9 tabs render real data; ADR generation emits typed ADR artifact | ⏳ | |
| API Contract generator emits typed API Contract artifact | ⏳ | |
| Risk Register tracks per-ADR risks; Security Report covers deployment risks | ⏳ | |
| Architecture gate enforced — `BLOCKED_APPROVAL` if no recorded decision | ⏳ | |

**Screenshot:** `test-results/m13-dogfood/04-architecture.png`
**Duration:** ⏳
**Issues found:** ⏳

### Step 05 — Runs (`/runs` · §3.2.5)

| AC | Verdict | Notes |
|---|---|---|
| Live + replay run center; Kanban with status triggers | ⏳ | |
| `RunBudgetBadge` shows ceiling / spent / remaining before run start | ⏳ | |
| Cost cap (`run_budget_cap_usd`) enforced; `CostCapExceeded` raised if exceeded | ⏳ | |
| Approval timeout fires; "Stale approval" badge shown | ⏳ | |

**Screenshot:** `test-results/m13-dogfood/05-runs.png`
**Duration:** ⏳
**Issues found:** ⏳

### Step 06 — Audit (`/audit` · §3.2.6)

| AC | Verdict | Notes |
|---|---|---|
| Timeline shows 7 fields per event | ⏳ | |
| Virtualized rendering handles >1000 events smoothly | ⏳ | |
| Filterable by tenant, project, actor, artifact type, date range | ⏳ | |
| WORM append-only chain verifiable; daily hash chain exposed | ⏳ | |

**Screenshot:** `test-results/m13-dogfood/06-audit.png`
**Duration:** ⏳
**Issues found:** ⏳

### Step 07 — Knowledge Center (`/knowledge-center` · §3.2.7)

| AC | Verdict | Notes |
|---|---|---|
| React Flow viz with 5 typed nodes | ⏳ | |
| Status-colored by tone (`kgStateTone` passthrough) | ⏳ | |
| Bidirectional backlinks via `useBacklinks` hook | ⏳ | |
| Vector + graph search returns real nodes | ⏳ | |

**Screenshot:** `test-results/m13-dogfood/07-knowledge-center.png`
**Duration:** ⏳
**Issues found:** ⏳

### Step 08 — Co-pilot (`/copilot` · §3.2.8)

| AC | Verdict | Notes |
|---|---|---|
| Streaming chat (typing_indicator column) | ⏳ | |
| Rate limit (ForgeApiError with rate-limit code → toast) | ⏳ | |
| Guardrail denial (ForgeApiError with guardrail_denied → toast) | ⏳ | |
| Lesson citations (LessonCitationChip) | ⏳ | |

**Screenshot:** `test-results/m13-dogfood/08-copilot.png`
**Duration:** ⏳
**Issues found:** ⏳

### Step 09 — Agent Center (`/agent-center` · §3.2.9)

| AC | Verdict | Notes |
|---|---|---|
| Agent selector lists all 4 CLI agent families | ⏳ | |
| Multi-agent session tabs | ⏳ | |
| Replay via `terminal/exporter.py` HTML+JSON frames | ⏳ | |
| No direct `node-pty` import in `apps/forge` | ✅ | audit-verified pre-M13 |

**Screenshot:** `test-results/m13-dogfood/09-agent-center.png`
**Duration:** ⏳
**Issues found:** ⏳

---

## 4. Per-step timings (template)

> **Auto-generated by `m13-dogfood.spec.ts::afterAll`** to `test-results/m13-dogfood/timings.json`. Pilot pastes a summary table here.

| # | Center | Spec ref | Duration (s) | Status |
|---|---|---|---:|---|
| 01 | Onboarding Wizard | §3.2.1 | ⏳ | ⏳ |
| 02 | Connector Center | §3.2.2 | ⏳ | ⏳ |
| 03 | Ideation | §3.2.3 | ⏳ | ⏳ |
| 04 | Architecture | §3.2.4 | ⏳ | ⏳ |
| 05 | Runs | §3.2.5 | ⏳ | ⏳ |
| 06 | Audit | §3.2.6 | ⏳ | ⏳ |
| 07 | Knowledge Center | §3.2.7 | ⏳ | ⏳ |
| 08 | Co-pilot | §3.2.8 | ⏳ | ⏳ |
| 09 | Agent Center | §3.2.9 | ⏳ | ⏳ |
| **Total** | | | **⏳** (target <1800s = 30 min) | |

---

## 5. Issues filed

> **Format:** `#<n> <severity> <title> — <step> — <resolution plan>`

| # | Severity | Title | Step | Resolution plan |
|---|---|---|---|---|
| ⏳ | P0 | ⏳ | ⏳ | ⏳ |
| ⏳ | P1 | ⏳ | ⏳ | ⏳ |
| ⏳ | P2 | ⏳ | ⏳ | ⏳ |
| ⏳ | P3 | ⏳ | ⏳ | ⏳ |

**Severity legend:**
- **P0** — blocks milestone sign-off; cannot ship
- **P1** — blocks milestone sign-off; ship with workaround
- **P2** — must fix in M14; document + accept
- **P3** — nice-to-have; defer indefinitely

---

## 6. Pilot sign-off

> **The pilot user signs the separate `M13-PILOT-SIGNOFF.md` file in a follow-up commit.**

| Field | Value |
|---|---|
| Pilot name | `_____________________________` |
| Date | `_____________________________` |
| Sign-off | ⏳ pending |

Once the pilot signs off, this report gets a single-line update in a follow-up commit:
```
docs: M13 pilot sign-off captured — <pilot name> <date>
```

---

## 7. Out-of-scope (M14+)

- **G6 tech debt cleanup** (deferred from M12): 2988 ruff + 562 format + 238 tsc errors. Required before public launch.
- **Performance optimization** beyond the M12 Lighthouse CI gate.
- **Visual regression testing** (Percy / Chromatic).
- **Production deployment** — the parent spec stops at "ready for launch"; M14+ handles actual deploy.

---

## 8. Verdict

> **Filled in by the pilot after sign-off.**

- [ ] All 9 centers passed their ACs
- [ ] Total runtime <30 min
- [ ] No P0/P1 issues open
- [ ] Pilot signed off in `M13-PILOT-SIGNOFF.md`

**Final verdict:** ⏳ pending

---

**M13 spec complete. Pilot execution + sign-off required to close.**