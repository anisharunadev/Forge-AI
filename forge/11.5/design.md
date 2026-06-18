# 11.5 — Tier-3 Divergence Workbench (Design + Contract)

| Field            | Value                                                                                                              |
|------------------|--------------------------------------------------------------------------------------------------------------------|
| **Sub-goal of**  | [FORA-249 Epic 11 — Forge Integration Layer](../../issues/FORA-249)                                              |
| **Status**       | **in_progress** (CTO-authored v0.1; Architect + Designer execute against it)                                       |
| **Author**       | CTO (`f4d4bf77-…`)                                                                                                |
| **Reviewer**     | Architect (post-11.0 hire) + Designer                                                                             |
| **Date**         | 2026-06-18                                                                                                        |
| **Stage**        | Architect (per FORA-7 DocAgent / Knowledge Layer §0 conventions)                                                  |
| **Version**      | v0.1 (first rev — pinned; do not edit, copy + bump)                                                                |

---

## 0. Quick start (read first)

This document is the **architectural seam** between the Sync Plane's Tier-3 detection
(11.4 resolver) and the customer-facing UI that lets a tenant admin pick a winner.
Three artifacts land together:

1. `forge/11.5/design.md` — this document. The contract.
2. `forge/11.5/migrations/0001_divergence_queue.sql` — the Postgres DDL the
   Tier-3 detector writes to and the UI reads from.
3. `agents/sync_plane/divergence_queue.py` — the typed seam the resolver calls
   to enqueue and the workbench UI calls to resolve.

The smoke test lives at `agents/sync_plane/tests/test_divergence_queue.py`
and asserts the §AC contract end-to-end (enqueue → render → resolve → audit
row → 2 s render for 10 k rows).

**Cross-Epic gate:** 11.5 is blocked on 11.4 (resolver must identify Tier-3
candidates) and on 11.0 (Architect hire) for the production UI build. The
contract and the typed seam can land in parallel with both.

## 1. Why a workbench, not a silent drop

Per ADR-0010 §4 Tier 3: when Tier 2 would *lose user-visible data* (e.g. both
sides edited a title in materially different ways, or the LWW would discard
a comment), the event is parked and surfaced for a human. The workbench is
the only Tier-3 surface. No Tier-3 event may be silently dropped, deferred, or
auto-resolved by the system.

## 2. Divergence queue (Postgres table)

```sql
-- forge/11.5/migrations/0001_divergence_queue.sql
CREATE TABLE sync.divergence_queue (
    queue_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         text NOT NULL,
    -- The synced entity this event is about.  Composite key covers
    -- (paperclip_issue, remote_kind, remote_id, field_path).
    paperclip_issue_id text NOT NULL,
    remote_kind       text NOT NULL,                -- "jira" | "github" | "clickup"
    remote_id         text NOT NULL,                -- native remote id (e.g. "10001")
    field_path        text NOT NULL,                -- e.g. "title" | "body" | "comment.body"
    -- Candidate values, exactly as they arrived.
    left_value        jsonb NOT NULL,               -- canonical side (winner by HLC, or Paperclip default)
    left_hlc          text NOT NULL,                -- canonical-form HLC string (23 chars)
    left_platform     text NOT NULL,                -- "paperclip" | "jira" | "github" | "clickup"
    right_value       jsonb NOT NULL,               -- the divergent side
    right_hlc         text NOT NULL,
    right_platform    text NOT NULL,
    -- Detection context.
    detected_at       timestamptz NOT NULL DEFAULT now(),
    detected_hlc      text NOT NULL,                -- the HLC at detection time
    reason            text NOT NULL,                -- "hlc_skew" | "user_data_loss" | "tenant_policy"
    metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Resolution state.  NULL = unresolved.
    resolved_at       timestamptz,
    resolved_by       text,                         -- "user:<uuid>" | "agent:<uuid>" | "system:bulk"
    resolution        text,                         -- "left" | "right" | "merge"
    resolution_audit_id uuid,                       -- FK to the audit row (forwarder fills record_hash)
    -- Soft-delete for GDPR right-to-erasure; the row stays so audit is reproducible.
    tombstoned_at     timestamptz
);

-- Tenant-scoped queue scan; the workbench always filters by tenant_id.
CREATE INDEX divergence_queue_tenant_unresolved
    ON sync.divergence_queue (tenant_id, detected_at DESC)
    WHERE resolved_at IS NULL AND tombstoned_at IS NULL;

-- Daily-digest job: one row per (tenant, day).
CREATE INDEX divergence_queue_tenant_day
    ON sync.divergence_queue (tenant_id, date_trunc('day', detected_at))
    WHERE resolved_at IS NULL;

-- Bulk-pattern matching: rule lookup hits (tenant, field_path, pattern_key).
CREATE INDEX divergence_queue_field_path
    ON sync.divergence_queue (tenant_id, field_path)
    WHERE resolved_at IS NULL;
```

### 2.1 Schema invariants

- `left_hlc` and `right_hlc` are **byte-comparable** canonical-form HLC
  strings (see `agents/sync_plane/hlc.py`). They are never NULL once the row
  exists; the detector rejects the event before the insert if either is missing.
- `field_path` is one of the §4 fixed-field set OR a free-text path the
  resolver registered. The detector validates `field_path` against the
  field-ownership table before insert.
- `resolution` is one of `{"left", "right", "merge"}`. There is no `null`
  resolution; the row stays unresolved until a human (or the bulk-pattern
  resolver) picks a side.
- `metadata` carries the §7.1 context: which platform's HLC was the loser,
  any tenant policy override that was applied, the diff summary, and the
  pointer to the inbound event in the JetStream `sync.inbox` subject.

## 3. Tier-3 audit row (`event.divergence_resolved_by_human`)

Per ADR-0010 §8.1, the human-resolution path emits a row with
`event_type = "sync.event.divergence_resolved_by_human"`. This is a sibling
of the existing `sync.event.divergence_resolved` event in
`agents/sync_plane/audit.py` and uses the same `AuditRow` envelope. The
additions are recorded in the `metadata` blob:

```jsonc
{
  "event_type": "sync.event.divergence_resolved_by_human",
  "tenant_id": "tenant_abc",
  "actor": "user:<uuid>",                        // the tenant admin who clicked
  "field": "title",
  "winner_platform": "jira",
  "loser_platform": "paperclip",
  "winner_hlc": "1718645112000.004-0042",
  "loser_hlc":  "1718645111000.003-0041",
  "reason": "human_pick",                        // new reason value
  "metadata": {
    "queue_id": "<uuid>",                        // FK back to sync.divergence_queue
    "paperclip_issue_id": "FORA-…",
    "field_path": "title",
    "resolution": "left",                        // "left" | "right" | "merge"
    "merge_value": "<merged json>",              // only when resolution="merge"
    "bulk_pattern_key": null,                    // or "always_paperclip_state" etc.
    "is_bulk": false
  }
}
```

`build_audit_row()` in `agents/sync_plane/audit.py` is extended to accept
`DIVERGENCE_RESOLVED_BY_HUMAN_EVENT` and the new `reason = "human_pick"`. The
existing `digest_payload()` already covers the new fields because the
metadata blob is canonicalised inside the JSON payload.

### 3.1 Bulk resolution audit semantics

A bulk action that resolves N events emits **N individual audit rows**, one
per `queue_id`, with `is_bulk = true` and the same `bulk_pattern_key`. The
`actor` is the human admin, not the system; the bulk operation is a UI
ergonomic, not an authorisation boundary. The UI MUST NOT resolve events
from multiple tenants in a single transaction — bulk is per-tenant only.

## 4. UI panel contract

The workbench is a single Forge route
`/forge/divergence/:tenant_id` (added by this sub-task). The page
composes three surfaces; the design-system alignment is inherited from the
DocAgent handoff (FORA-7 / Knowledge Layer §0 — typography, spacing,
status lozenges, the existing Forge `DataPanel` and `DiffPair` primitives).

### 4.1 List view

| Column            | Source                                   | Width  |
|-------------------|------------------------------------------|--------|
| Detected (HLC)    | `detected_hlc` (click → raw)             | 12 ch  |
| Field path        | `field_path`                             | flex   |
| Paperclip ↔ Remote| `left_platform` / `right_platform` chips | 18 ch  |
| Age               | `now() - detected_at` (live-ticking)     | 8 ch   |
| Actions           | **Pick left / Pick right / Merge**       | flex   |

- **Render budget:** ≤ 2 s for 10 000 events. The query is
  `… WHERE tenant_id = $1 AND resolved_at IS NULL AND tombstoned_at IS NULL
  ORDER BY detected_at DESC LIMIT 200 OFFSET $2`. The index
  `divergence_queue_tenant_unresolved` covers it; the page is virtualised
  (windowed list, 200 rows per scroll, full count surfaced as "10 247
  unresolved, showing 1–200").
- **Empty state:** no unresolved events → render the empty state from the
  DocAgent handoff (`DataPanel` with title "No divergences" and the
  explanatory copy "All synced fields are within Tier 1 / Tier 2. New
  divergences land here automatically.").
- **Filter chips:** field path, platform, age (last 1 h / 24 h / 7 d / 30 d
  / all). Chip state is serialised in the URL so the deep-link is
  reproducible for the audit-trail.

### 4.2 Pick / merge actions

Each row carries three buttons:

- **Pick left** — sets `resolution = "left"`, `resolved_by = user:<uuid>`.
  The UI optimistically removes the row; if the API call fails the row
  re-appears with a red toast. Optimistic removal is safe because the
  queue row is the only state the user sees.
- **Pick right** — symmetric.
- **Merge** — opens a `DiffPair` editor (DocAgent primitive, see
  `forge/2.4/` from the architecture publisher) with both candidates in
  side-by-side panes and a writable "merged" pane. The merged value is
  written to `resolution = "merge"`, `metadata.merge_value = <json>`.

All three actions call the same server endpoint
`POST /api/forge/sync/divergence/:queue_id/resolve` with the same
`{resolution, merge_value?}` payload. The server is the only writer; the UI
never edits the queue row directly.

### 4.3 Bulk-pattern panel

A side panel lists the tenant's saved patterns
(`sync.divergence_bulk_patterns`, e.g. `"always_paperclip_state"`). Each
pattern row has:

- a human description,
- a count badge ("matches 47 unresolved events"),
- a **Apply** button that resolves every matching event in one click.

Clicking **Apply** opens a confirm modal (DocAgent `confirm_destructive`):
"Resolve 47 events matching 'always prefer Paperclip for `state`'? This
emits 47 audit rows. Continue?". Confirm → 47 individual POSTs to
`/resolve`, streamed with a progress bar. Cancel → no-op.

### 4.4 Tenant policy table (admin-only)

The admin can also persist a bulk-pattern inline from a single Pick:

> "Always pick **Paperclip** for the `state` field on this tenant."

This writes to `sync.divergence_bulk_patterns` and resolves the current
event in the same transaction. The pattern is then surfaced in the side
panel for future one-click application.

## 5. Server surface (the four endpoints)

```
POST   /api/forge/sync/divergence/list
       { tenant_id, limit, offset, filter? }    →  { rows: [...], total: <int> }
GET    /api/forge/sync/divergence/:queue_id    →  row (with both values)
POST   /api/forge/sync/divergence/:queue_id/resolve
       { resolution: "left"|"right"|"merge",
         merge_value?: <json>,
         save_pattern?: { key, description } }  →  { audit_id }
POST   /api/forge/sync/divergence/bulk
       { tenant_id, filter,
         resolution: "left"|"right"|"merge",
         merge_value?: <json>,
         save_pattern?: { key, description } }  →  { resolved: <int>,
                                                      audit_ids: [...] }
```

All four are tenant-scoped at the boundary (the Forge session middleware
checks `tenant_id` against the actor's tenant list; cross-tenant calls
return 403). The `actor` on every audit row is the resolved human's UUID
(`"user:<uuid>"`), not the agent's UUID — the agent is the UI runner, not
the principal.

## 6. Daily divergence summary email

- **Schedule:** 09:00 UTC every day (cron, configured per tenant).
- **Recipients:** the tenant's admin list, cc-able.
- **Content:** one section per `field_path` with the count, the top 3
  representative candidate pairs (redacted to 200 chars each), and a
  deep-link to the workbench pre-filtered.
- **Opt-out:** per-tenant config flag
  `sync.divergence_digest_opted_out` (default `false`).
- **Per-day cap:** if the count exceeds 1 000, the email subject flips to
  "Action required: >1000 divergences on <tenant>" and the body links to
  the bulk-pattern panel; the per-`field_path` breakdown is truncated to
  the top 5.
- **Audit:** a `sync.digest.sent` audit row is emitted for every send
  (including the opt-out and the >1000 cap paths).

## 7. Acceptance criteria mapping (from the sub-task body)

| AC from FORA-255                                                           | Where it is satisfied                                                                                |
|----------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| UI panel renders within 2 s for queues up to 10 000 events                  | §4.1 render budget + §2 index `divergence_queue_tenant_unresolved`                                   |
| Resolution writes audit row with both HLCs and the chosen winner           | §3 row shape + §5 `/resolve` endpoint                                                                |
| Bulk resolution emits N individual audit rows                               | §3.1 bulk semantics + §5 `/bulk` endpoint                                                            |
| Daily summary email is opt-out per tenant                                  | §6 opt-out flag + per-tenant config                                                                  |
| No silent resolution — every Tier-3 event leaves an audit trail            | §3 + §3.1 + §5 server-only writes; the UI never edits the queue row directly                         |
| Designer handoff per FORA-7 DocAgent style (Knowledge Layer §0 conventions) | §4 column set, empty state, confirm modal, pattern panel — all DocAgent primitives                  |

## 8. Test plan

`agents/sync_plane/tests/test_divergence_queue.py` (new file, dependency-free):

1. **Enqueue** — `enqueue_divergence()` inserts a row with the §2 schema;
   reject when either `left_hlc` or `right_hlc` is not a 23-char canonical
   HLC; reject when `field_path` is not in the field-ownership table.
2. **Render** — `list_divergences(tenant_id, limit, offset)` returns the
   unresolved subset in `detected_at DESC` order. Inject 10 000 fake rows
   in-memory; assert the query plan hits the unresolved index
   (Postgres test) and the rendered payload serialises in < 50 ms
   (Python test).
3. **Resolve** — `resolve(queue_id, resolution, actor, merge_value?)` writes
   the audit row (§3 shape) and updates the queue row to
   `resolved_at = now()`. The audit row's `event_type` and `reason` match
   the spec; `digest_payload()` is stable across reruns.
4. **Bulk** — `bulk_resolve(tenant_id, filter, resolution, actor)` emits
   exactly N audit rows for N matched events, all with `is_bulk = true`,
   the same `bulk_pattern_key`, and the same `actor`. Atomicity: if one
   insert fails, prior inserts are not rolled back; the API returns the
   partial list so the UI can show "resolved 23 of 47, 24 failed, see
   toast for queue_ids".
5. **Daily digest** — `build_digest_payload(tenant_id, day)` returns the
   email body; assert subject is `"Action required: >1000 divergences on
   <tenant>"` when the count is > 1 000, the per-`field_path` list is
   truncated to top 5 in that case, and the opt-out tenant returns
   `None` (no email).
6. **2 s render for 10 k events** — end-to-end smoke: spin up the workbench
   route against an in-process Postgres fixture loaded with 10 000
   unresolved events; assert the list endpoint returns < 200 ms; assert
   the page render (HTML + assets) returns < 2 s in the k6 probe.

## 9. Stage injection (Knowledge Layer §0)

This sub-task sits in the **Architect** stage. The contract lands before
the Architect hire; the implementation lands after. The implementation
child will be dispatched to the Architect once 11.0 closes. Until then,
this v0.1 spec is the only thing the 11.4 resolver, the future UI build,
and the DocAgent handoff all read from.

## 10. Versioning footnote

This is **v0.1**, pinned. Future revisions copy + bump; the diff lives in
`forge/11.5/CHANGELOG.md` so the cross-references in §0 always resolve to
the current rev. The contract is intentionally strict: every field name,
every enum value, every audit reason is a public surface the 11.4 resolver
and the workbench UI both depend on, and a typo in either place fails
the smoke test.

## 11. Cross-references

- ADR-0010 §4 Tier 3 — `docs/architecture/adr-0010-cross-platform-sync-plane.md`
- ADR-0010 §7.2 divergence detection — `docs/architecture/adr-0010-cross-platform-sync-plane.md`
- ADR-0010 §8.1 audit event types — same file
- FORA-249 Epic 11 — parent Epic, sub-task map §11.5
- FORA-11.4 (id `be1c6eef-…`) — Tier-1/Tier-2 resolver; live `in_progress`
- FORA-11.0 (id `a1fe46f5-…`) — Architect hire; live `in_progress`
- FORA-36 audit forwarder — audit row consumer; hash-chain + SOC 2 export
- `agents/sync_plane/audit.py` — existing `DIVERGENCE_RESOLVED_EVENT` shape
- `agents/sync_plane/divergence_queue.py` — typed seam (this sub-task)
- Knowledge Layer §0 — `docs/knowledge-layer/README.md` (DocAgent style)
