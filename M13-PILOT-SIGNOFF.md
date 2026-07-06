# M13 — Pilot Sign-off

**Milestone:** M13 — Dogfood Validation
**Branch:** `feat/M13-dogfood-validation`
**Spec:** `/workspace/forge-v2-mvp-m13-spec.md`
**Report:** `M13-DOGFOOD-REPORT.md`
**Spec under test:** `apps/forge/tests/e2e/m13-dogfood.spec.ts`

---

## Pilot info

| Field | Value |
|---|---|
| Pilot name | `_____________________________` |
| Pilot role | `_____________________________` (e.g. Steward, L3 Architect, PM) |
| Date | `_____________________________` |
| Total runtime | `_____________________________` (target: <30 min) |

---

## Pre-flight (must all be true before running the dogfood)

- [ ] `docker compose up` boots clean; `/healthz` returns 200 with all probes green
- [ ] `acme-corp` tenant + `acme-platform` project seeded
- [ ] `.env` populated with valid LiteLLM keys (`LITELLM_INTEGRATION_ENABLED=true`)
- [ ] Backend running on port 8000; frontend on port 3000; terminal sidecar on port 7681
- [ ] Steward user has `steward` realm-role

---

## Per-center AC verification

> Mark each cell: ✅ pass · ⚠️ pass with caveat · ❌ fail · ⏸️ blocked

### 01 — Onboarding Wizard (`/onboarding` · §3.2.1)
- [ ] Single wizard at /project-onboarding; 10 UI + 6 backend steps
- [ ] Tenant + project + connector + LLM provider end-to-end via real backend
- [ ] Day-One Bootstrap emits a `BootstrapReport` typed artifact
- [ ] Resumable across sessions; ends with a tour
- [ ] Completes in <30 min for an internal pilot user

### 02 — Connector Center (`/connector-center` · §3.2.2)
- [ ] 7 tabs (Overview, Connected, Marketplace, Credentials, Activity, Health, Webhooks) on real backend
- [ ] Step 55 zones 4-9 closed: install, disconnect, test, rotate, reveal, sync
- [ ] Activity polls `/api/v1/connectors/activity` every 10s
- [ ] Mock CONNECTORS array kept only as offline fallback with explicit banner

### 03 — Ideation (`/ideation` · §3.2.3)
- [ ] 9 tabs render real data; no `MOCK_FALLBACK` paths
- [ ] Idea ingest from sources calls real puller services
- [ ] Idea scoring + impact comparison + roadmap on real endpoints
- [ ] PRD generator emits typed PRD artifact, lands on KG as node
- [ ] Push to Jira hits real connector with idempotency

### 04 — Architecture (`/architecture` · §3.2.4)
- [ ] 9 tabs render real data; ADR generation emits typed ADR artifact
- [ ] API Contract generator emits typed API Contract artifact
- [ ] Risk Register tracks per-ADR risks; Security Report covers deployment risks
- [ ] Architecture gate enforced — `BLOCKED_APPROVAL` if no recorded decision

### 05 — Runs (`/runs` · §3.2.5)
- [ ] Live + replay run center; Kanban with status triggers
- [ ] `RunBudgetBadge` shows ceiling / spent / remaining before run start
- [ ] Cost cap (`run_budget_cap_usd`) enforced; `CostCapExceeded` raised if exceeded
- [ ] Approval timeout fires; "Stale approval" badge shown

### 06 — Audit (`/audit` · §3.2.6)
- [ ] Timeline shows 7 fields per event
- [ ] Virtualized rendering handles >1000 events smoothly
- [ ] Filterable by tenant, project, actor, artifact type, date range
- [ ] WORM append-only chain verifiable; daily hash chain exposed

### 07 — Knowledge Center (`/knowledge-center` · §3.2.7)
- [ ] React Flow viz with 5 typed nodes
- [ ] Status-colored by tone (`kgStateTone` passthrough)
- [ ] Bidirectional backlinks via `useBacklinks` hook
- [ ] Vector + graph search returns real nodes

### 08 — Co-pilot (`/copilot` · §3.2.8)
- [ ] Streaming chat (typing_indicator column)
- [ ] Rate limit (ForgeApiError with rate-limit code → toast)
- [ ] Guardrail denial (ForgeApiError with guardrail_denied → toast)
- [ ] Lesson citations (LessonCitationChip)

### 09 — Agent Center (`/agent-center` · §3.2.9)
- [ ] Agent selector lists all 4 CLI agent families
- [ ] Multi-agent session tabs
- [ ] Replay via `terminal/exporter.py` HTML+JSON frames
- [ ] No direct `node-pty` import in `apps/forge` (pre-verified via audit)

---

## Blocker issues

> List any P0/P1 issues that block milestone sign-off.

| # | Severity | Title | Workaround |
|---|---|---|---|
| | | | |

---

## Open questions for the team

> Anything that came up during dogfood that isn't a blocker but needs a team decision.

| Question | Suggested owner |
|---|---|
| | |

---

## Overall rating

> Pick one.

- [ ] **Ready to ship** — all 9 centers pass, no P0/P1, <30 min runtime
- [ ] **Ship with known issues** — all 9 centers pass modulo documented P2s
- [ ] **Block on fixes** — at least one P0/P1 unresolved
- [ ] **Re-run required** — pilot unable to complete; environment issue

---

## Pilot signature

```
Name:   _____________________________
Role:   _____________________________
Date:   _____________________________

I have personally run m13-dogfood.spec.ts against the acme-corp seed
tenant and verified the ACs above. I accept the rating above as the
milestone verdict.

Signature: _____________________________
```

---

## After sign-off

1. Commit the signed PDF/scan to this branch:
   ```
   git add M13-PILOT-SIGNOFF.md
   git commit -m "docs: M13 pilot sign-off captured — <pilot name> <date>"
   ```
2. Update `M13-DOGFOOD-REPORT.md` §6 + §8 with the sign-off date and final verdict.
3. Push the branch and open PR #13 (the M3-M12 back-merge audit pattern).
4. File any open issues from §5 of the dogfood report.
5. Hand off to the M14 (G6 tech debt cleanup) lead.

---

**M13 ready to close once this sign-off is committed.**