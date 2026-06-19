# 11.5a — Tier-3 Divergence Workbench UI Surface (Implementation Child)

| Field            | Value                                                                                                              |
|------------------|--------------------------------------------------------------------------------------------------------------------|
| **Sub-goal of**  | [FORA-255 (11.5 — Tier-3 Divergence Workbench)](../../issues/FORA-255)                                             |
| **Status**       | **todo** — dispatched after FORA-11.0 Architect hire closes (per design.md §9)                                     |
| **Author**       | Architect (this sub-task: 11.5a)                                                                                   |
| **Reviewer**     | Designer + CTO                                                                                                     |
| **Blocks**       | Epic 11 ship gate (FORA-249 §11.5 exit)                                                                            |
| **Blockers**     | FORA-11.0 (Architect hire); FORA-255 v0.1 contract acceptance                                                       |
| **Spec source**  | `forge/11.5/design.md` §4 (UI panel contract), §5 (server endpoints), §6 (daily digest), §8 (test plan)              |

This document is the **implementation seed** for the workbench UI that
the v0.1 contract (`forge/11.5/design.md`) describes. It is intentionally
short — the contract is the source of truth; this file enumerates the
files, the route, and the ACs so the implementation child issue body
can be generated from it without re-deriving anything.

---

## 0. Quick start (read first)

The v0.1 contract (`forge/11.5/design.md`) pins the typed seam,
the audit row shape, and the server endpoint surface. This child:

1. **Adds the four server endpoints** listed in design.md §5 to the
   Forge API (`apps/forge/`). All four are tenant-scoped at the boundary
   and reuse the typed seam in `agents/sync_plane/divergence_queue.py`.
2. **Adds the workbench route** `/forge/divergence/:tenant_id` in the
   Forge console (`apps/forge/`), composing the DocAgent primitives
   (`DataPanel`, `DiffPair`, `confirm_destructive`) the design.md §4
   references.
3. **Adds the daily digest cron job** per design.md §6 (09:00 UTC,
   per-tenant opt-out, the 1 000 cap, top-5 truncation, the
   `sync.digest.sent` audit row).
4. **Adds the k6 end-to-end render-budget probe** that proves AC #1
   end-to-end (the current smoke only asserts the in-process sub-budget).

The DocAgent handoff is the styling source of truth; this child is
type-and-route work, not design work.

## 1. Files to add / change

### 1.1 Server endpoints (design.md §5)

| Endpoint                                                            | Method | Owner |
|---------------------------------------------------------------------|--------|-------|
| `/api/forge/sync/divergence/list`                                   | POST   | Backend |
| `/api/forge/sync/divergence/:queue_id`                              | GET    | Backend |
| `/api/forge/sync/divergence/:queue_id/resolve`                      | POST   | Backend |
| `/api/forge/sync/divergence/bulk`                                   | POST   | Backend |

The handlers live at `apps/forge/app/api/sync/divergence/[list|get|resolve|bulk]/route.ts`
(Next.js 15 App Router; the workspace has `apps/forge/` from FORA-374
persona dashboards). Each handler:
- reads the tenant boundary from the session middleware,
- delegates to `agents/sync_plane/divergence_queue.py`,
- returns the typed result as JSON.

The handlers MUST NOT mutate the queue row directly. The typed seam is
the only writer.

### 1.2 UI route (design.md §4)

`/forge/divergence/:tenant_id` — single Forge route, composing:

- **List view** — virtualised window, 200 rows / scroll, columns per
  design.md §4.1 (Detected HLC, Field path, Paperclip ↔ Remote chips,
  Age, Actions). Filter chips in the URL so deep-links are
  reproducible.
- **Pick / merge actions** — three buttons per row (`Pick left`,
  `Pick right`, `Merge`). Optimistic UI: row disappears on click,
  re-appears with red toast if the API call fails. Merge opens the
  DocAgent `DiffPair` editor.
- **Bulk-pattern panel** — side panel listing the tenant's saved
  patterns from `sync.divergence_bulk_patterns`. Each pattern has a
  count badge ("matches 47 unresolved events") and an **Apply** button
  that opens the DocAgent `confirm_destructive` modal.
- **Tenant policy table (admin-only)** — lets the admin persist a
  bulk pattern inline from a single Pick.

Empty state per design.md §4.1.

### 1.3 Daily digest cron (design.md §6)

- Job lives at `apps/orchestrator/jobs/divergence_digest.py` (or
  wherever the existing daily-report jobs are scheduled; see
  `agents/sync_plane/daily_report.py` for the pattern).
- 09:00 UTC cron, per-tenant iteration.
- Calls `build_digest_payload(tenant_id, day, opted_out=…)` from the
  typed seam.
- If `opted_out is True`: emit `sync.digest.sent` audit row with
  `reason=opted_out`; no email.
- Otherwise: render the email body + send via the Forge tenant-mailer;
  emit `sync.digest.sent` with the row counts.
- If `is_action_required is True`: subject flips to
  `"Action required: >1000 divergences on <tenant>"`.

### 1.4 k6 render-budget probe (design.md §8.6)

- Script at `apps/forge/tests/k6/divergence_workbench_render.js`.
- Loads 10 000 unresolved events into a Postgres fixture (the
  migration already supports it).
- Asserts `GET /forge/divergence/<tenant_id>` returns < 2 s end-to-end.
- Asserts the list endpoint returns < 200 ms server-side.
- Runs in CI on the `forge-ui` job (add to `apps/forge/.github/workflows/`
  or wherever the existing k6 jobs are scheduled).

## 2. Acceptance criteria

These are the ACs the implementation child owns. The contract-level
ACs from FORA-255 are upstream; this child proves them end-to-end.

- [ ] `/forge/divergence/:tenant_id` renders within 2 s for 10 000
      unresolved events (k6 probe green).
- [ ] Pick left / Pick right / Merge write one `event.divergence_resolved_by_human`
      audit row per action with both HLCs + chosen winner.
- [ ] Bulk Apply emits N individual audit rows (one per event) all
      with `is_bulk = true` + `bulk_pattern_key`.
- [ ] Daily digest cron runs at 09:00 UTC; respects the per-tenant
      opt-out; flips the subject at the 1 000 cap; emits
      `sync.digest.sent` audit row for every send.
- [ ] Designer handoff: all components use DocAgent primitives
      (`DataPanel`, `DiffPair`, `confirm_destructive`); status lozenges
      + empty state match the existing Forge persona-dashboard style.

## 3. Test plan

The contract-level tests at `agents/sync_plane/tests/test_divergence_queue.py`
stay green; this child adds:

1. **API tests** — `apps/forge/tests/api/sync/divergence/*.test.ts`
   (Vitest, per the `apps/forge/` existing pattern). Tenant boundary,
   idempotency on resolve, partial-failure semantics on bulk, opt-out
   on digest.
2. **Component tests** — React Testing Library, mirroring the
   `apps/forge/components/` test pattern. List view renders ≤ 200
   rows; pick buttons optimistically remove the row; merge opens
   the `DiffPair` editor.
3. **k6 end-to-end** — the render-budget probe above.

## 4. Out of scope (deliberate)

- Tier 3 detection itself (FORA-11.4 / `agents/sync_plane/resolver.py`).
- Production Postgres / JetStream wiring of `enqueue_divergence`
  (one-line substitution at the call site; non-trivial only when
  FORA-11.4's `__init__.py` indentation error is fixed).
- Multi-tenant bulk — the design.md §3.1 explicitly forbids it; the
  UI surfaces a clear error if the admin tries.

## 5. Cross-references

- v0.1 contract: `forge/11.5/design.md`
- v0.1 changelog: `forge/11.5/CHANGELOG.md`
- Typed seam: `agents/sync_plane/divergence_queue.py`
- DDL: `forge/11.5/migrations/0001_divergence_queue.sql`
- ADR-0010 §4 Tier 3, §7.2 divergence detection, §8.1 audit event types
- FORA-249 Epic 11 — parent Epic, sub-task map §11.5
- FORA-7 / DocAgent — design-system primitives (`DataPanel`, `DiffPair`,
  `confirm_destructive`)
- FORA-374 — Forge AI console (Next.js 15 persona dashboards; the
  implementation seed for the workbench UI lives here)