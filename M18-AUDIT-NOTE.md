# M18 — Audit Note (back-merge traceability)

> Audit-trail companion to the direct-to-main merge of
> `feat/M18-product-transformation-cut`. The actual merge already
> happened on `main` at `66a6e65b`.

## What this PR back-merges

- **Source branch:** `feat/M18-product-transformation-cut`
- **Merged into:** `main` at `66a6e65b`
- **Squash commit:** `ab9323e7` (refactor: M18 — product transformation cut)
- **PR title (back-merge):** M18 audit note — product transformation cut traceability

## Sprint metrics

| Metric | Value |
|---|---:|
| Files changed | 364 |
| Lines deleted | 61,751 |
| Lines added | ~50 |
| MCP servers removed | 14 (kept `jira` only) |
| Pages removed | 8 directories |
| Components removed | 9 files |
| Lib files removed | 5 files |
| Tests removed | 7 files |
| Redirects added | 8 (next.config.mjs) |
| Typecheck delta | +22 (pre-existing patterns) |

## The cut (one paragraph)

Per the Head-of-Product assessment and the product audit, the
12-center architecture was the product's biggest liability. M18
collapses the surface area to the single `/workflow` spine (M16/M17)
by removing 8 cut-candidate page directories (forge-command-center,
personas, stories, refactor, validator, organization-knowledge,
project-intelligence, governance-center), 14 dead MCP servers
(zero application consumers — verified by `grep`), 9 supporting
components, and the dead test files. 61,751 lines of code that
served no user, no audit, no flow. Bookmarks and external links
are preserved via `next.config.mjs` redirects.

## What stays (the moat)

- `lib/workflow-shell/*` + `components/workflow-shell/*` (M16/M17)
- `/workflow/[stage]` pages
- `lib/api/auth.ts` (multi-tenant auth)
- `backend/app/agents/sdlc_agent.py` + LangGraph state
- `backend/app/agents/approval_gate.py` (HITL gate)
- Audit chain (`audit_service.py`, daily hash)
- Cost ledger (`cost_ledger.py`, `forge_budget_guard.py`)
- LiteLLM governance
- 7 typed artifact schemas
- The `jira` MCP server (used by `remediation_router.py` and
  `ideation/jira_status_subscribers.py`)

## Conflict resolution

Day 5 (`6a579c9c`) landed while M18 was in flight. Conflicts:
- `apps/forge/app/organization-knowledge/page.tsx` — Day 5
  modified the file M18 deleted. **Took the deletion** (the page
  is removed per the audit).
- `apps/forge/lib/api/stories.ts` — Day 5 modified the file M18
  deleted. **Took the deletion** (the consumers were also removed
  in M18).
- `apps/forge/components/ConnectorDetailPanel.tsx` — both
  modified. **Took the M18 version** (M18 was the more recent
  intent; Day 5's changes to deleted routes are stale).
- `apps/forge/tsconfig.tsbuildinfo` — build cache, took either.

## See also

- `M18-PRODUCT-TRANSFORMATION-CUT.md` (this M18 integration report)
- `/workspace/audit/FORGE_AI_PRODUCT_AUDIT_2026_07.md` — the
  20-document production audit (47/100 verdict)
- `/workspace/audit/FORGE_AI_PRODUCT_STRATEGY_2026_07.md` — the
  product strategy blueprint (Phase A-E, 90 days)
- `M16-WORKFLOW-SHELL.md` and `M17-PRODUCTION-GRADED-STAGES.md` —
  the workflow shell that remains after the cut

## Process notes

- Rebased onto `origin/main` (Day 5 landed during M18 work)
- 3 conflicts resolved manually; all in the user's favor (deletions
  win over modifications to dead code)
- Single commit; no `M18-AUDIT-NOTE.md` file in the main merge
  (audit notes are added in a follow-up commit on the branch,
  per the M1-M17 pattern)
- PR #19 will be created and closed as the audit-trail back-merge
