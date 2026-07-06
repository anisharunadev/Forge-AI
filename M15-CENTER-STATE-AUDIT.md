# M15 — Sprint 5 Center State Audit

Source-grounded audit of where each of the 9 centers reads its data and what
state a banner must surface. Used as the input to CenterStateBanner.tsx and
the per-center wiring in Sprint 5.

## Summary table

| Center             | Page(s)                                                    | State source                                                                                | Possible states                         |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| Onboarding         | `app/onboarding/workspace/page.tsx`                        | `api.post('/tenants')` (manual submit) — no React Query, derives `submitting` local flag   | live, demo (sample tenant list), loading |
| Ideation           | `app/ideation/page.tsx`                                    | `useIdeasAdapter`, `useApprovalsAdapter`, `useIdeationIngestStatus`                         | live, demo, cached, error, loading       |
| Runs               | `app/runs/page.tsx` → `components/runs/RunCenterPage.tsx`  | `useWorkflowRunsIndex()` (TanStack)                                                         | live, cached, error, loading             |
| Audit              | `app/audit/page.tsx`                                       | `useAuditIntegrity()` (TanStack); existing `AuditIntegrityBanner` already renders OK/Broken/Error/Loading | live, error, loading, demo (empty chain) |
| Knowledge Center   | `app/knowledge-center/page.tsx`                            | `useKGNodes`, `useKGEdges`, `useKGStats` (TanStack)                                         | live, cached, error, loading, demo      |
| Co-pilot           | `app/copilot/page.tsx`                                     | `useCopilotStore` (zustand) + WS connection status                                          | live, error, loading                    |
| Agent Center       | `app/agent-center/page.tsx`                                | `useAgents()` (TanStack) + sidecar liveness                                                 | live, cached, error, loading            |
| Architecture       | `app/architecture/page.tsx`                                | local `useState` (typed ADRs / decisions / connectors)                                      | live, demo, loading                     |
| Connector Center   | `app/connector-center/page.tsx` (Sprint 3 — already wired) | `useConnectors`, `useMarketplace`, `useCredentials`, `useConnectorActivity` via `OfflineBanner` | live, error (Sprint 3)                  |

## Per-center notes

### Onboarding
- `app/onboarding/workspace/page.tsx` renders a create-workspace form. No
  TanStack query; only `submitting` local state. State source is the
  `POST /tenants` call itself.
- `sample_data.py` referenced in the brief corresponds to seed status
  (`useSeedStatus`) — for Sprint 5 scope we treat "demo" as: the demo
  fixture list is shown (no live tenants yet). The banner sits at top of
  `workspace/page.tsx` keyed on `useSeedStatus` so a seeded demo tenant
  triggers the demo banner.

### Ideation
- Adapter hooks (`useIdeasAdapter`, `useApprovalsAdapter`) wrap the
  canonical `useIdeas` / `useApprovals` hooks in `lib/hooks/useIdeation.ts`.
- Ingest-status hook surfaces the adapter hot-sync state.
- Banner reads the three adapter queries' `isError` / `isPending` and a
  `seedOnly` flag from the catalog response.

### Runs
- `useWorkflowRunsIndex()` returns a discriminated `WorkflowRunsView`
  (unreachable | ok | empty). Banner keys off `unreachable → error`,
  `ok + stale → cached`, `isPending → loading`, otherwise null.

### Audit
- `AuditIntegrityBanner` already renders OK / Broken / Loading / Error.
- Sprint 5 keeps it (re-wrap as CenterStateBanner with the hash-chain
  variant for the "broken" state). No new component instance is mounted
  on the Audit page; we add a vitest regression test that asserts the
  `center-state-banner-error` and `center-state-banner-loading` testids
  fire in the right TanStack states.

### Knowledge Center
- Three TanStack queries (`useKGNodes`, `useKGEdges`, `useKGStats`).
- Banner collapses the three into a single state: any error → error,
  pending with no data → loading, otherwise null. Demo fires when
  `seedOnly` is true and the graph is otherwise empty.

### Co-pilot
- WebSocket connection lives in `lib/store/copilot` (zustand). The
  banner reads the WS status slice and shows `error` when
  `status === 'disconnected'`.

### Agent Center
- `useAgents()` TanStack query plus a `sidecarUp` boolean (derived from
  the same `/api/v1/agents` response — the response carries a
  `sidecar_alive` field).

### Architecture
- Typed data via local `useState` with deterministic seed fixtures.
- "Demo" means seed fixtures are visible (no live connectors repo).
- Banner reads `isLiveConnectors` from `LiveConnectorDataProvider` (already
  in tree).

### Connector Center
- Sprint 3 wired `OfflineBanner`. Sprint 5 re-exports the same component
  via the new `CenterStateBanner` so the existing
  `data-testid="offline-banner"` keeps working.

## Implementation notes

- Each banner instance is placed at the top of the page, before the
  page-level header. Layout: `flex flex-col gap-3`.
- `data-testid` pattern: `center-state-banner-{state}` for state assertion;
  the `center-state-banner` testid is also rendered for generic queries.
- Role: `status` + `aria-live="polite"` for live/cached/demo/loading;
  `alert` + `aria-live="assertive"` for error.
- The component is a leaf — no provider required, accepts props and
  optional overrides for tests.
