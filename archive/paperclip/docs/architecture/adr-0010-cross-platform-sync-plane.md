# ADR-0010: Cross-Platform Sync Plane (Paperclip ↔ Jira ↔ GitHub Issues ↔ "clipup")

| Field             | Value                                                                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| **Status**        | **Accepted** — Board answered both open questions on 2026-06-17T20:56:59Z (Forge AI-199 interaction `02d96f8c-…`): Q-`clipup` = **ClickUp**, Q-`sync-direction` = **every event**. |
| **Date**          | 2026-06-17                                                                                                                                     |
| **Author**        | CTO (f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)                                                                                                     |
| **Reviewer**      | Architect (TBD hire) — CTO informational. Board gates scope (Q-`clipup`, Q-`sync-direction`) before implementation starts.                      |
| **Issue**         | [Forge AI-199](/Forge AI/issues/Forge AI-199) (this ADR)                                                                                                  |
| **Parent**        | [Forge AI-62](/Forge AI/issues/Forge AI-62) Sub-goal 1.4 (Jira sync, `in_review`) — temporarily anchored here until the new Epic is created (see §10)       |
| **Source**        | Board response to Forge AI-62 `ask_user_questions` interaction `4c94c158-…`, 2026-06-17T16:25Z, resolved by `local-board`                            |
| **Parent ADR**    | [ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md), [ADR-0006](./adr-0006-event-bus-nats-jetstream.md), [ADR-0008](./adr-0008-paperclip-approvals.md), [Forge AI-125 IAM shipped](/Forge AI/docs) |
| **Supersedes**    | none                                                                                                                                           |
| **Superseded by** | none                                                                                                                                           |

---

## 1. Context

Sub-goal 1.4 ([Forge AI-62](/Forge AI/issues/Forge AI-62)) was scoped as a **one-way push** of an approved Epic into a customer sprint. The four `ask_user_questions` options posted on that interaction all assumed the existing Paperclip → Jira push (and only some of them mentioned a GitHub Issues mirror).

The Board answered out of bounds. Its free-form response (interaction `4c94c158-…`) asked for **bidirectional Paperclip ↔ Jira ↔ GitHub Issues ↔ "clipup" sync with a single comment-thread model** across all platforms. That is a 6–10 story program with its own PM/Architect/Dev/QA/Security scope and a Board-approval gate. It does not fit in 1.4 and must spin off as a new Epic (working name: **Forge Integration Layer**, short name **Cross-Platform Sync Plane**, placeholder tracker ID [Forge AI-200+]). The CEO has the pending adjudication on whether that Epic exists and how it is named; this ADR scopes the *technical* shape so the new Epic can land its first sub-tasks the moment the Board answers the two open questions.

This ADR does not implement anything. It fixes the topology, the conflict policy, the actor-mapping model, the comment-thread/attribution model, the failure/divergence semantics, and the audit + risk register that the new Epic's sub-tasks must build against.

## 2. Decision (one-line)

A **per-tenant logical hub** with **NATS JetStream as the internal spine**, **outbound platform adapters as the only writer per remote**, and a **three-tier conflict policy** (synchronous source-of-truth field rules → async event log with HLC timestamps → divergence workbench for humans). Comments sync through a **canonical comment envelope** with deterministic author mapping and append-only audit; remote edits of synced fields are mirrored back, not treated as conflicts. The "clipup" platform is **ClickUp** (Board, 2026-06-17). The write-back default is **every event** (Board, 2026-06-17), which makes the §7.1 burst-control surface a **day-one P0**, not a follow-up.

## 3. Sync topology

### 3.1 Shape

A **logical hub-and-spoke per tenant**, not a peer-to-peer mesh. Each platform (Jira, GitHub Issues, "clipup", Paperclip) is a *spoke*; the hub is a per-tenant service in Paperclip called **Sync Plane** that owns the canonical state for *synced entities* and brokers writes between platforms.

```
   Jira  ⇄ ┐
            │
 GitHub ⇄ ─┼─▶  Sync Plane (per tenant) ──▶ NATS JetStream (event log, 30d replay)
            │            │
 "clipup" ⇄ ┘            └──▶ Forge Postgres (canonical state + divergence queue)
                            │
                            └──▶ Forge Audit (Forge AI-36 forwarder)
```

### 3.2 Wire choices (in priority order)

| Layer | Choice | Why |
|-------|--------|-----|
| Internal spine | **NATS JetStream** (streams `sync.outbox`, `sync.inbox`, `sync.deadletter`) | Already adopted in [ADR-0006](./adr-0006-event-bus-nats-jetstream.md); per-subject ack, replay, and rate-limit per consumer (`max_ack_pending`) come for free |
| Inbound from Paperclip | **Domain-event publish from Forge → JetStream** (`issue.updated.v1`, `run.status_changed.v1`, `interaction.created.v1`) | Already wired in 0.x; Sync Plane is just another consumer |
| Outbound to Jira / GitHub / "clipup" | **Adapter per platform** that holds OAuth tokens, rate-limits per platform, and writes through the platform's REST/GraphQL API | REST/GraphQL is the only stable surface for both Jira and GitHub; webhooks are inbound-only and unreliable on retry |
| Inbound from remote | **Per-tenant webhook receiver** + **polling backstop every 5 min** | Webhook delivery is best-effort (esp. GitHub Apps can drop redeliveries after 24h); polling catches drift and missed deliveries |
| Clock ordering | **Hybrid Logical Clock (HLC)** = `physical_ms.laa-seq` | Survives clock skew across clouds (Spanner-style HLC; `laa` = "latest observed assumed") and lets us reason about happens-before without external coordination |

### 3.3 Why not the alternatives

- **Pure event-bus (no canonical store)**: fails the "single comment-thread model" requirement because order-of-comments becomes a multi-platform consensus problem.
- **Pure CDC on Paperclip DB**: the *remote* writes don't go through Paperclip's DB, so CDC sees only half the writes; useless for Jira/GitHub edits.
- **Webhook-passthrough only**: GitHub Apps and Jira webhooks have SLA gaps; we need polling backstop. Webhook-passthrough without polling loses divergences silently.
- **Polling only**: 5-min polling is fine for catch-up but adds 5-min latency on the happy path. Webhook + polling in tandem is the floor.
- **Peer-to-peer**: every platform pair would need its own reconciler; N² code paths for N platforms. Hub is O(N).

## 4. Conflict resolution

Three tiers, applied in order. The first tier resolves ~95% of writes; the second tier covers most of the rest; humans only see the third tier.

### Tier 1 — Source-of-truth by field (synchronous)

Some fields have a single owner regardless of who edited them elsewhere. The mapping is **fixed per field per platform** and shipped as a table in the ADR's companion config. Defaults:

| Field | Owner (canonical) | Mirror semantics |
|-------|-------------------|------------------|
| `paperclip.run_id`, `paperclip.run_status`, `paperclip.run_events` | **Paperclip** | Read-only on remote; remotes cannot edit |
| `paperclip.assignee_agent_id` | **Paperclip** | Mirror to remote `assignee`; remote edits reverse-mirror with `last_editor = platform:<remote>` tag |
| `jira.sprint`, `jira.story_points`, `jira.epic_link` | **Jira** (or `clipup` equivalent) | Paperclip reads; remote edits are canonical |
| `github.labels`, `github.milestone` | **GitHub Issues** | Same |
| `title`, `body/description`, `comment.body` | **All writers; HLC-ordered** | See Tier 2 |
| `state` (`open`/`closed`/`done`), `status` (workflow) | **Per-platform owner** (Jira workflow wins on Jira side, GitHub Labels/Projects on its side) | Other platforms store a translated `mirror_state` |

### Tier 2 — HLC + last-writer-wins with audit (async)

Free-text fields (title, body, comments, custom fields without an owner) use HLC timestamps. The Sync Plane keeps the **highest-HLC value** as canonical. Every accepted remote write is recorded in the audit log with the HLC of the incoming event and the previous canonical HLC; on conflict resolution we log `event.divergence_resolved` with `winner_hlc`, `loser_hlc`, `reason = hlc_lww`. Drift is bounded by clock skew (~<250ms with NTP, ~<1s under cloud VM drift).

### Tier 3 — Divergence workbench (human)

When Tier 2 would *lose user-visible data* (e.g. both sides edited title in materially different ways, or the LWW would discard a comment), the event is parked in `sync.divergence_queue` and surfaced in a UI panel. The customer admin resolves; resolution writes a `event.divergence_resolved_by_human` audit row that records both values and the chosen winner.

**Default precedence order across tiers**: Paperclip > Jira > GitHub > "clipup" for **state-machine fields only** (the `state`/`status` of a paperclip-driven workflow). This is overridable per tenant config.

## 5. Actor mapping

A Paperclip `agent` has no first-class human identity in the customer's IdP. The decision is **synthetic service accounts, one per agent, scoped per platform per tenant**, plus a per-agent **persona display name** so humans see "DocAgent (Forge AI-118)" instead of an opaque UUID.

| Actor on remote | How it's modeled |
|-----------------|------------------|
| Paperclip agent writing as itself | **Synthetic service account** `paperclip-{slug}-{tenant}` on Jira / GitHub / "clipup", with a stable `external_id` = `paperclip:agent:{agent_uuid}` and a persona display name + avatar |
| Paperclip agent acting **on behalf of a human** (e.g. PM triages a customer report) | The human's IdP identity is used; the agent is recorded as the *editor* in audit but the comment author is the human. Implemented via OAuth delegation: the agent has `delegate_for` scope to act as the human, gated by the Forge AI-125 IAM policy and the customer's policy DSL |
| Human acting directly on Jira/GitHub while sync is on | Their normal account; the Sync Plane identifies them by `external_id` and never impersonates |
| Board / `local-board` | Reserved synthetic account `paperclip-board-{tenant}` with an `audience=board` tag so comment attribution renders with a Board lozenge |

**No impersonation, ever.** Service accounts are provisioned by the tenant admin at install time and granted only the scopes listed in the Sync Plane config. If a Paperclip agent needs to act as a human, the human must grant the OAuth delegation once; the agent cannot self-elevate.

## 6. Comment-thread + author-attribution model

This is the hard part the Board called out. Decision: a **canonical comment envelope** plus **deterministic mapping**, not a "best-effort mirror of strings."

### 6.1 Canonical envelope

```json
{
  "comment_id": "cmt_…",                 // Paperclip-issued, stable across all platforms
  "paperclip_issue_id": "Forge AI-…",
  "remote_refs": {                       // one entry per platform the comment has reached
    "jira":   { "id": "10001", "self": "https://…", "last_synced_hlc": "1718645112.000-0042" },
    "github": { "id": "ic_…",   "url":  "https://…", "last_synced_hlc": "1718645112.000-0042" },
    "clipup": { "id": "…",      "url":  "https://…", "last_synced_hlc": "1718645112.000-0042" }
  },
  "author": {
    "kind": "agent" | "user" | "board" | "system",
    "id": "f4d4bf77-…",                  // Paperclip ID
    "remote_ids": { "jira": "accountId:…", "github": "login:…", "clipup": "user:…" },
    "display_name": "DocAgent (Forge AI-118)"
  },
  "body_md": "…",                        // Markdown source of truth
  "body_remote_rendered": {              // per-platform rendered form, kept fresh on edit
    "jira":   { "format": "adf", "value": { … } },
    "github": { "format": "gfm", "value": "…" },
    "clipup": { "format": "md",   "value": "…" }
  },
  "created_hlc": "1718645112.000-0042",
  "edited_hlc":  null,
  "deleted_hlc": null,                   // tombstones, not hard deletes
  "visibility": "tenant" | "internal",   // maps to remote ACL (Jira project perms, GitHub repo perms, clipup space)
}
```

The `comment_id` is the **stable identity across all platforms**. Remote IDs are *refs*, not identities. This is the single thing that lets us "have the same comments bidirectionally" without infinite reconciliation loops.

### 6.2 Author attribution rules

- Every remote comment is **posted by the synthetic service account** of the actor (see §5), not by the actor's personal account. This keeps audit attribution consistent and avoids permission-storm on the customer's remote.
- The remote body always includes a **first-line attribution block** that is rendered from the canonical author (e.g. `> 🤖 DocAgent acting on behalf of Jane Smith — 2026-06-17 16:25 UTC`). This is mandatory for non-system actors; the Sync Plane prepends it on outgoing writes and detects/strips it on incoming writes to avoid double-attribution.
- Edits to the remote comment body are detected via webhook/poll; the Sync Plane keeps the **latest edited HLC** and re-renders all platforms. The remote edit history is **not** mirrored — the canonical edit history lives in Paperclip (per ADR-0001 audit wedge).
- Reactions (Jira `👍`, GitHub `:eyes:`, etc.) are **local to the platform** by design; we do not sync reactions. Documented as an explicit non-feature.

### 6.3 Threading

Paperclip's comment graph is threaded (Forge AI-7 DocAgent + parent reply chains). GitHub Issues is shallow. Jira has two levels (issue + comment). "clipup" TBD. The Sync Plane flattens Paperclip threads to the remote's model on outgoing writes and reconstructs the Paperclip thread on incoming writes using `in_reply_to` cross-refs stored in the envelope's metadata. Indentation ≥ remote's max becomes a "↳ @author in Paperclip" pointer line.

## 7. Failure mode + divergence detection

### 7.1 Failure modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Webhook missed (GitHub 24h redelivery window elapsed, Jira webhook disabled) | Polling backstop every 5 min detects missing `updated_after` cursor | Reconcile via `since` query; emit `sync.backfill.completed` |
| Remote platform down > 5 min | Adapter's circuit breaker trips on consecutive 5xx | Queue in `sync.outbox.<platform>`; rate-limit retries per platform token bucket; emit `sync.platform.degraded` |
| Remote platform down > 1 hour | Same | Escalate to `sync.divergence_queue`; UI banner; **do not block** Paperclip runs |
| Per-tenant rate limit hit | Adapter's `X-RateLimit-Remaining` < 10% | Pause outbound for the cooldown window; inbound keeps flowing |
| HLC skew detected (> 5s between two physical timestamps in event log) | Sync Plane's clock monitor | Log `event.clock_skew`; degrade Tier 2 to Tier 3 (divergence workbench) for affected event pairs |
| Sync Plane itself down | Active-passive failover (two replicas, leader election on Postgres advisory lock) | Failover in < 30s; events buffered in JetStream survive |
| Comment storm (Q-`sync-direction` default = "every event") | Outbound rate > N comments / minute / remote issue | Burst control: coalesce N consecutive comments on the same remote into one composite edit; per-tenant configurable |

### 7.2 Divergence detection (continuous)

A daily job runs `paperclip_state ⊕ remote_state` per synced entity:

1. **Schema divergence**: Paperclip has fields the remote doesn't support → stored in `sync.mirror_state`, surfaced in UI.
2. **State divergence**: Paperclip `status` ≠ remote `mirror_state` → emit `sync.divergence.detected`, do **not** auto-resolve.
3. **Comment divergence**: Paperclip has a `comment_id` not present on any remote → push on next cycle. Remote has a comment we can't map → either (a) create a Paperclip comment with `source=remote_unmapped` and a back-pointer, or (b) drop, per tenant config.
4. **Audit divergence**: Audit log missing a `event.*` row that the sync log says should be there → **P0 alert**, page on-call. This is the canary that the audit forwarder (Forge AI-36) is healthy.

## 8. Audit + risk register

The S7 / Epic 1 audit wedge (Forge AI-36, audit-system-design ADR) covers Paperclip-side events only. Cross-platform sync adds three new audit surfaces. Decision: **all sync events flow through the existing Forge AI-36 audit forwarder**; we do not invent a second audit pipeline.

### 8.1 New event types (extending Forge AI-36)

| Event | Trigger |
|-------|---------|
| `sync.event.received` | Inbound from remote webhook/poll |
| `sync.event.applied` | Tier-1/Tier-2 resolution succeeded |
| `sync.event.divergence_detected` | Tier-3 candidate identified |
| `sync.event.divergence_resolved` | Tier-2 LWW or human resolved |
| `sync.platform.degraded` | Adapter circuit breaker opened |
| `sync.backfill.completed` | Polling reconciliation finished |
| `sync.comment.attribution_written` | Service-account post + first-line attribution block written |

### 8.2 Risk register (P0/P1, routed to Security / Epic 5)

| ID | Risk | Severity | P0 control |
|----|------|----------|------------|
| R-SYNC-01 | Cross-platform comment injection (a remote comment body includes Markdown that, when re-rendered on a different platform, executes a link/mention the original platform didn't sanction) | P0 | Strip `<script>`, raw HTML, and platform-specific macros on ingest; sanitize `@mentions` to known actor set; render via a vetted Markdown→ADF/GFM pipeline (no third-party HTML passthrough) |
| R-SYNC-02 | Service-account token sprawl (the synthetic accounts accumulate broad scopes if not least-privilege'd per platform) | P0 | Per-platform install-time OAuth with explicit scope list; deny scopes outside the Sync Plane allow-list (Forge AI-125 IAM policy DSL); quarterly scope audit |
| R-SYNC-03 | Comment storm DoS (Tier-2 fanout amplifies a Paperclip-side comment to 3 platforms × N tenants) | P0 | Per-tenant token bucket; per-remote burst control; composite-edit coalescing; circuit breaker trips on burst |
| R-SYNC-04 | Cross-tenant data leak (the Sync Plane confuses two tenants on a shared remote like a shared Jira Cloud) | P0 | Tenant ID is part of every adapter key, every JetStream subject, and every remote write; deny-by-default cross-tenant references; per-tenant webhook secrets (Forge AI-161 pattern) |
| R-SYNC-05 | Audit divergence silently masking a missing event | P0 | Daily divergence job (§7.2 #4); PagerDuty alert; auto-page on > 0 missing events |
| R-SYNC-06 | HLC skew causing permanent data loss in Tier 2 | P1 | Clock-monitor (§7.1); auto-degrade to Tier 3 on >5s skew; admin-visible "skew window" |
| R-SYNC-07 | "clipup" being a custom internal tool introduces an unknown threat model | P1 | Treated as a black-box adapter; no source-side trust; all writes pass through the Forge AI-125 broker check |
| R-SYNC-08 | Per-tenant rate-limit edge cases (one tenant bursts, the platform's per-IP limit throttles everyone) | P1 | Per-tenant token bucket + per-platform adapter queue; back-pressure to inbound; explicit `Retry-After` honored |

## 9. Sub-task map (the new Epic's first cuts)

This ADR unlocks **10 sub-tasks** for the new Epic. With the Board's `every_event` answer, **sub-task #6 (outbound rate limiter + circuit breaker + burst control) is a day-one P0** that ships with sub-task #1, not a follow-up. Sub-task IDs depend on the CEO's new-Epic decision; placeholder numbers are given for sequencing.

**Day-one (must ship together to support `every_event`):**
1. **Sync Plane service skeleton** — per-tenant hub, JetStream consumer/publisher, Postgres canonical store. (Architect → Engineer)
2. **Platform adapters: Jira + GitHub + ClickUp** — adapter per platform behind a `PlatformAdapter` port; OAuth provisioning. ClickUp is a new adapter slot per the Board answer. (Engineer)
3. **Canonical comment envelope + author mapping** — §6 schema, synthetic service-account provisioning, Markdown→ADF/GFM/ClickUp-flavored renderers. (Engineer + DocAgent)
4. **Tier-1 / Tier-2 conflict resolver + HLC** — fixed-field ownership table + LWW with audit. (Engineer)
5. **Tier-3 divergence workbench** — UI surface for unresolved divergences; admin resolution flow. (Engineer + Designer)
6. **Outbound rate limiter + circuit breaker + burst control** — per-tenant token bucket, per-platform adapter queue, composite-edit coalescing. **Promoted to day-one P0 by the Board's `every_event` answer.** (Engineer)
7. **Polling backstop + divergence-detection daily job** — §7.1 + §7.2. (Engineer + QA)
8. **Sync Plane audit forwarding to Forge AI-36** — wire the eight `sync.*` event types into the existing audit forwarder. (Engineer + Security)

**Phase 2 (follow-on, can ship after Epic is live):**
9. **Service-account scope allow-list + quarterly audit pipeline** — R-SYNC-02 control. (Security Engineer, post-Architect-hire)
10. **Markdown sanitization + remote-credential vault** — R-SYNC-01 + revised R-SYNC-07 (ClickUp threat model is now well-known, not black-box). (Security Engineer)

## 10. Open questions (Board interaction) — RESOLVED

Both questions were answered by `local-board` on **2026-06-17T20:56:59Z** on Forge AI-199 interaction `02d96f8c-…`:

- **Q-`clipup` = `clickup`**. The third sync platform is **ClickUp** (REST API + webhooks; same adapter shape as Jira/GitHub). §3.2 wire choices are unchanged. R-SYNC-07 in §8 is **downgraded** — ClickUp is a known platform with a documented threat model, not a black box; the per-tenant scope allow-list is the primary control.
- **Q-`sync-direction` = `every_event`**. Bi-directional means **write-back on every event** for all synced fields, including comments. The §7.1 burst-control surface (per-tenant token bucket, per-platform adapter queue, composite-edit coalescing, circuit breaker) is therefore a **day-one P0** that ships with sub-task #1 of the new Epic, not a follow-up. Per-tenant opt-out is preserved as a config flag for tenants that prefer the human-curated default.

## 11. Out of scope (deliberately)

- **Reaction sync** (Jira 👍, GitHub :eyes:, clipup emoji) — explicitly local to the platform (§6.2).
- **Attachment sync** — non-trivial binary round-trips across platforms with different size limits (Jira 10MB, GitHub 25MB, clipup TBD). Defer to a follow-up ADR after this ships.
- **Webhook from Paperclip to remote of Paperclip-internal events** — Paperclip is the hub, not a spoke. It publishes via the Sync Plane, not directly.
- **Re-implementing Epic 1's approval-gate** (ADR-0008) in remote systems — remote state changes that need Paperclip approval go through the existing approval interaction (Forge AI-123, Forge AI-168), not a parallel gate on the remote.

## 12. Decision status

**Accepted** (2026-06-17). Sub-task #1–#8 can start in parallel with the Architect hire; sub-tasks #9–#10 are Security-owned follow-ons. The CEO adjudication on whether the new "Forge Integration Layer" Epic exists and how it is named is the remaining gating step (per Forge AI-17 Board scope expansion).

## 13. References

- [ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md) — Master Orchestrator / SDLC architecture
- [ADR-0006](./adr-0006-event-bus-nats-jetstream.md) — Event bus (NATS JetStream)
- [ADR-0008](./adr-0008-paperclip-approvals.md) — Approvals model
- [Forge AI-36](/Forge AI/issues/Forge AI-36) — Audit 0.5 (Forge AI-36 ADR D1 — audit-system-one-way-doors)
- [Forge AI-62](/Forge AI/issues/Forge AI-62) — Sub-goal 1.4 Jira sync (parent of this ADR; `in_review`)
- [Forge AI-117 DocIndex](/Forge AI/docs/adr/0002-knowledge-layer-storage-contract.md) — Knowledge Layer storage contract (relevant for the canonical comment envelope shape)
- [Forge AI-125 IAM](/Forge AI/docs/adr/0008-paperclip-approvals.md) — agent IAM shipped (policy DSL for §5 actor mapping)
- [Forge AI-126 Customer Cloud Broker](/Forge AI/docs/adr/0006-event-bus-nats-jetstream.md) — deny-list + audit patterns (relevant for §8 R-SYNC-02)
- [Forge AI-161 IdP Revoke Webhook](/Forge AI/issues/Forge AI-161) — per-tenant webhook secrets pattern (relevant for §8 R-SYNC-04)
- `forge/1.4/jira_sync_report.md` §6 — full Board ask context