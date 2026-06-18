# `@fora/sync-plane` — Tier-1 / Tier-2 conflict resolver + HLC

Implementation of [ADR-0010](../../docs/architecture/adr-0010-cross-platform-sync-plane.md) §3.2 (Hybrid Logical Clock) and §4 (three-tier conflict policy).

Closes acceptance criteria for **[FORA-265](/FORA/issues/FORA-265)** — Epic 11.4
(sub-task #4 of the *Forge Integration Layer / Cross-Platform Sync Plane* Epic):

| AC | Where it lives | Status |
|----|---------------|--------|
| HLC implementation in `forge/sync-plane/hlc.ts` (node time + counter + node_id; merge tested for skew) | `src/hlc.ts` + `test/hlc.test.ts` | ✅ |
| Field-ownership table loaded from `forge/sync-plane/tenants/<slug>/ownership.yaml` | `src/ownership.ts`, sample `tenants/acme/ownership.yaml` | ✅ |
| Tier-2 resolver tests: clock skew up to 5 min, concurrent same-field writes, comment-vs-status ordering | `test/resolver.test.ts` | ✅ |
| Parked-Tier-3 events surface as a row in the divergence queue (consumed by sub-task #5 workbench) | `src/divergence-queue.ts` (`DivergenceQueue.list()` / `.get()`) | ✅ |
| 40+ assertions total | **142 `expect()` calls across 49 tests** | ✅ |

## Public surface

```ts
import {
  Hlc, hlcCompare, hlcFromWire, hlcToWire, HlcClockSkewError,
  loadOwnership, buildOwnershipTable, type OwnershipTable,
  DivergenceQueue, type ParkedEvent,
  Resolver, type SyncEvent, type ResolutionOutcome,
} from '@fora/sync-plane';
```

## Tier semantics

1. **Tier 1 — Field ownership.** Each field has a declared owner (e.g.
   `paperclip.run_status` → Paperclip). Writes from other platforms become
   mirror events with the rule's `mirrorPolicy`
   (`read_only_on_remote` / `reverse_mirror_with_tag` /
   `translated_mirror_state`). Mode `creator` resolves the owner from the
   issue's `creatorPlatform`.
2. **Tier 2 — HLC LWW.** Tier-2 fields (default: `issue.title`,
   `issue.body`, `comment.body`) pick the candidate with the highest HLC.
   Tiebreaker: lexicographic `eventId`. Restricted-writer Tier-2 fields
   treat off-list platforms as mirror.
3. **Tier 3 — Divergence queue.** If LWW would drop user-visible data
   (`wouldDropData` predicate) or the only candidates are mirror-only on a
   restricted-writer field, the resolver parks the event into the
   in-memory `DivergenceQueue` for the workbench (sub-task #5).

## HLC contract

- Wire form: `"<physicalMs>.<hexCounter>-<nodeId>"` — matches ADR §3.2.
- `Hlc.now()` is monotonic per node; counter rolls forward into `physicalMs`
  past `MAX_COUNTER` (0xffff).
- `Hlc.observe(remote)` absorbs forward skew up to `MAX_SKEW_MS` (5 min);
  beyond that it throws `HlcClockSkewError` and the caller is expected to
  park the affected event pair as Tier-3 per §7.1.

## Sample tenant config

See [`tenants/acme/ownership.yaml`](./tenants/acme/ownership.yaml).

## Downstream consumers

- Sub-task #1 (Sync Plane service skeleton) — instantiates `Resolver` per
  tenant and persists `DivergenceQueue` rows into Postgres.
- Sub-task #5 (Divergence workbench) — reads `DivergenceQueue.list()` and
  calls `resolve()` once a human picks a winner.
- Sub-task #7 (Polling backstop) — uses `Hlc.observe()` to order observed
  remote events into the canonical stream.
- FORA-200 / FORA-201 / FORA-202 (Jira / GitHub / ClickUp adapters) —
  emit `SyncEvent` values; receive `ResolutionOutcome` for write-back.

## Tests

```bash
pnpm install
pnpm typecheck
pnpm test
```

Last green run (2026-06-18):

```
✓ test/hlc.test.ts       (14 tests, 42 expects)
✓ test/resolver.test.ts  (21 tests, 69 expects)
✓ test/ownership.test.ts (14 tests, 31 expects)

Test Files  3 passed (3)
     Tests  49 passed (49)
   Expects  142
```
