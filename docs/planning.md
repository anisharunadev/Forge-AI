
Backend wiring plan (for frontend to backend integration)

Phase 1: OIDC Auth (Step 53) — Keycloak login, JWT tokens, auth guard
Phase 2: Agents + Providers — Wire Agents Center to /api/v1/agents/*
Phase 3: Connectors — Wire Connectors Center to /api/v1/connectors/*
Phase 4: Workflows + Runs — Wire Workflows + Runs to /api/v1/workflows/*
Phase 5: Dashboard — Now with real data
Phase 6: Knowledge Graph — Wire to /api/v1/knowledge/*
Phase 7: Projects + Stories — Wire to /api/v1/projects/* + /api/v1/stories/*
Phase 8: Ideation — Wire to /api/v1/ideation/* (uses forge-pi)
Phase 9: Co-pilot — Wire to /api/v1/copilot/* (chat + streaming)
Phase 10: Terminal — Wire to PTY sidecar WebSocket
Phase 11: Governance + Audit — Wire to /api/v1/governance/* + /api/v1/audit/*
Phase 12: Settings — Wire to /api/v1/settings/*
Phase 13: Onboarding — Wire to /api/v1/onboarding/*


# Backend Wiring Plan — Real Status Per Phase

> **Snapshot date:** 2026-07-01
> **Source of truth:** `built-features.yaml` + grep counts against `/workspace/codebase/forge-ai/`
> **Purpose:** Decision doc — pick the next phase to ship without re-deriving

## The summary view

| # | Phase | Status | Backend routes | Frontend pages | What's blocking `Production` |
|---|---|---|---|---|---|
| 1 | OIDC Auth | ✅ Production | 3 | 3 | — |
| 2 | Agents + Providers | ✅ Production | 23 | 2 | — |
| 3 | Connectors | ✅ Production | 12 | 4 | — |
| 4 | Workflows + Runs | 🟡 **Beta** | 18 | 2 | Live execution (SSE), workflow templates haven't all been mapped |
| 5 | Dashboard | ✅ Production | 18 | 2 | — (just shipped this session) |
| 6 | Knowledge Graph | 🔴 **Planned** | 9 | 2 | **Zero frontend hooks** — backend complete, frontend reads nothing |
| 7 | Projects + Stories | ✅ Wired 2026-06-30 | 16 | 20 | Sidebar dedupe (DONE per Step 63) — promotion to `Production` pending one test pass |
| 8 | Ideation | 🔴 **Planned** | 50 | 2 | Same problem — 50 backend routes, 2 pages, 0 hooks |
| 9 | Co-pilot | 🟡 **Beta** | 7 | 1 | Streaming SSE not built (POST returns full JSON, no EventSource) |
| 10 | Terminal | 🔴 **Planned** | 16 + WS | 2 | `ws()` helper exists but page never opens socket |
| 11 | Governance + Audit | 🔴 **Planned** | 5 | 4 | 9 frontend calls but no `useGovernanceViolations` hook |
| 12 | Settings | 🔴 **Planned** | 16 + missing | 10 | 17 of 21 tabs use `useSettings` hooks that call routes that **don't exist** in `backend/app/api/v1/` |
| 13 | Onboarding | 🔴 **Planned** | 4 | 2 | `StepProvision` is `setInterval`-driven, fake; `TenantSwitcher` calls non-existent `/auth/me/tenants` |

**Net:** 5 phases are `Production`, 2 are `Beta` (close to Production), 6 are `Planned`.

---

## Two truths I'm telling you up front

### Truth 1: Some phases are mostly shipping. Most need scoped work.

| Phase | Real gap | Effort to Production |
|---|---|---|
| **Phase 4 Workflows** | Live SSE wiring + visual builder template support | 1.5 weeks |
| **Phase 7 Projects + Stories** | Promotion — Step 63 fix already in, just verify | 1 day |
| **Phase 9 Co-pilot streaming** | Backend `EventSourceResponse` for chat + `useCoPilotChat()` hook | 1 week |

### Truth 2: Some phases need a real plan before code.

| Phase | Real gap | Effort |
|---|---|---|
| **Phase 6 Knowledge Graph** | Backend complete (9 routes). Frontend lib absent. Need `useKnowledgeCenter()` + KG view wiring. | 1 week |
| **Phase 8 Ideation** | 50 backend routes. Frontend only calls 2 (`/ideation/approvals` + `/ideation/push`). Need `useIdeationCenter()` (pipeline, ideas, roadmap, PRDs, sources, signals). | 2 weeks |
| **Phase 10 Terminal WS** | Frontend page exists; backend WS router exists; `ws()` helper exists. Just no glue. | 3 days |
| **Phase 11 Governance + Audit** | 5 backend routes, 9 calls scattered in lib/litellm/usage.ts. Need a cohesive `useGovernanceViolations()` + audit feed. | 1 week |
| **Phase 12 Settings** | Real gap. Frontend SDK + 20 hooks exist; **`backend/app/api/v1/{members,env_vars,roles,agent_configs,audit}.py` files don't exist**. Need backend build. | 2-3 weeks |
| **Phase 13 Onboarding** | `StepProvision` is `setInterval`-driven. `TenantSwitcher` calls non-existent route. Need backend + glue. | 2 weeks |

---

## Recommended sequence (the 6-week plan if you want everything)

Order is by **dependency first, ROI second, then smallest**

### Week 1 — Quick wins (5 days)
| Day | Phase | What |
|---|---|---|
| Mon | Phase 7** | Promote to `Production` after one final test pass (Step 63 fix already in) |
| Tue–Wed | Phase 10 | Wire `ws()` to the terminal page; add `useTerminalStream()` hook; one integration test |
| Thu–Fri | Phase 4 | SSE live execution — pick `useRunLiveEvents` to route-SSE, wrap with TanStack hook |

### Week 2 — Co-pilot streaming (1 week)
Add `EventSourceResponse` to `POST /copilot/conversations/{id}/stream`. Wire `useCoPilotChat()` hook on frontend. Replaces the polling pattern in `ComposerInput`.

### Week 3 — Knowledge Graph (1 week)
9 backend routes already there. Build `useKnowledgeCenter()` with `useKGQuery()`, `useKGVectorSearch()`, `useKGStats()`. Wire to `KnowledgeGraphView.tsx` (already exists).

### Week 4 — Governance + Audit (1 week)
Add `useGovernanceViolations()` + `useAuditFeed()`. Backend has 4 violation routes + 1 audit route; lib/litellm/usage.ts has 9 calls already.

### Week 5-6 — Settings backend (2 weeks)
**Real backend work.** Create `backend/app/api/v1/{members,env_vars,roles,agent_configs,projects}/{id}/audit.py`. Includes Fernet-encrypted env vars + tenant-scoped everything + audit events. Largest block.

### Week 7-8 — Onboarding (2 weeks)
Replace `setInterval`-driven `StepProvision`. Add `/auth/me/tenants` route + `useTenantList()` hook. Real provisioning — bootstrap a project, create workspace, transition `setStatus('active')`.

### Week 9-10 — Ideation 9-tab (2 weeks)
50 backend routes wired, 0 frontend hooks. Build `useIdeationCenter()` hook (pipeline, ideas, roadmap, PRDs, sources, signals, customer voice). Wire each tab.

**Total:** 10 weeks for all remaining phases, 1 engineer.

---

## Minimum viable sequence (4-week plan if you have less time)

Order by smallest result-first to keep shipping.

### Week 1 (3 days each)
1. **Phase 7** → Production (1 day)
2. **Phase 10** Terminal WS (3 days)
3. **Phase 4** Workflow SSE (3 days)

### Week 2
4. **Phase 9** Co-pilot streaming

### Week 3
5. **Phase 11** Governance + Audit

### Week 4
6. **Phase 6** Knowledge Graph

**Total:** 4 weeks, 1 engineer. Closes 6 phases to Production. Leaves 12 + 13 for later.

---

## Decision tree (pick one)

### Plan X — "Ship everything in 10 weeks"
Run the 10-week plan. Highest coverage, longest window. Stop other work.

### Plan Y — "Ship the 4-week quick wins"
Run the 4-week plan. Closes 6 of the 8 remaining. Leaves Settings + Onboarding for later (they're the heaviest).

### Plan Z — "Ship 1 phase this turn"
Pick a single phase. I'll ship that one (the smallest complete closure) and stop. You'll have a Production-bumped phase at end of session.

**Smallest concrete options:**

- **Z1 — Phase 7 Production bump** (1 day)
  - Already at "Wired 2026-06-30". Just verify the smoke test + flip the status. Done.

- **Z2 — Phase 10 Terminal WS** (3 days)
  - 16 backend routes + WS router + page exist. Just need a 30-line hook + glue.

- **Z3 — Phase 4 Workflows live SSE** (1 week)
  - 18 routes exist. One TanStack hook wrapping `useRunLiveEvents` plus a status indicator.

- **Z4 — Phase 6 Knowledge Graph** (1 week)
  - 9 routes exist. Adds 3 hooks + wires `KnowledgeGraphView` to real data.

- **Z5 — Phase 9 Co-pilot streaming** (1 week)
  - 7 routes. Backend needs `EventSourceResponse`; frontend needs `useCoPilotChat()`.

Tell me which plan or Z-option. Or tell me which phase to inspect in more detail before committing.