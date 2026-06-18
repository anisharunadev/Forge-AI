# Risk Register — Epic "Forge Integration Layer · Cross-Platform Sync Plane"

**Stage:** Architecture prep (risk-register child of [FORA-62](/FORA/issues/FORA-62))
**Issue:** [FORA-204](/FORA/issues/FORA-204) — Sync-plane audit + risk register (extends S7 from Epic 1)
**Producer:** CTO (`f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0`)
**Generated at:** 2026-06-17
**Companion artefacts:** [`forge/1.3/risk_register.md`](../1.3/risk_register.md) (template) · [`forge/1.4/jira_sync_report.md`](../1.4/jira_sync_report.md) §6 (scope-expansion source) · [`workspace/memory/security.md`](../../workspace/memory/security.md) §7 (audit-log shape, one-way-door) · [`agents/audit/schema.py`](../../agents/audit/schema.py) (FORA-36 foundation)
**Revision:** v0.1 — **provisional**, gated on [FORA-199](/FORA/issues/FORA-199) (ADR — sync topology decision). Topology-dependent risks are marked **PROVISIONAL**; the document is rev'd to v1.0 after FORA-199 lands.
**Scoring:** Likelihood (L/M/H), Impact (L/M/H/C), Composite = `L × I` mapped to a 1–9 score; **Sev = P0/P1/P2/P3** by composite band (P0 ≥ 6 with Critical impact or any cross-tenant/PII/CISO-wedge failure; P1 = 6–8; P2 = 3–5; P3 ≤ 2).

---

## 0. Why this register exists

The S7 audit wedge in Epic 1 ([VOY-3066](https://neptunetriton.atlassian.net/browse/VOY-3066)) captures every Paperclip-side agent action. The board-driven scope expansion in `forge/1.4/jira_sync_report.md` §6 introduces a new surface — bidirectional sync between Paperclip, Jira, GitHub Issues, and a third platform (`<clipup>` — Q-clipup still open). Every mirror write/read is a security-relevant event that S7 does not cover. Without this register, the SOC 2 export has gaps and the audit completeness bar (R7.1) cannot be verified end-to-end across the sync plane.

This document:

1. Bootstraps the new "Forge Integration Layer / Cross-Platform Sync Plane" Epic's risk surface by enumerating the implied stories from `jira_sync_report.md` §6 + the cross-cutting seams that fall out of S7's extension.
2. Defines the **sync-plane audit entry shape** (extends §7 of `workspace/memory/security.md`) and flags the **spec-drift hazard** between §7.1 (narrative spec) and `agents/audit/schema.py` (code contract) before it becomes a one-way door.
3. Specifies the **daily audit sample** (n = 10 random runs, 100 % completeness gate) so Security (Epic 5) has a runnable verifier once the sync plane is live.
4. Codifies the **per-tenant namespace rule** on every mirror event as an extension of R8.1 (cross-tenant from S8).

---

## 1. Story-level risks (per story)

> Story numbering is provisional and tracks the children listed in `jira_sync_report.md` §6 + the cross-cutting seams. It will be re-anchored when the new Epic is created on Paperclip (the new Epic itself is not yet on Paperclip as of this writing — see §5 R-Q0).

### S0 — Architecture ADR (FORA-199 — the upstream gate)

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R0.1** | **ADR picks a topology that creates a comment storm** — bidirectional write-back on every Paperclip event floods customer Jira/GitHub with no human curation. The wrong default ("bi-directional = on every event") is the failure mode the board's free-form response could lock in. | **M** | **H** | **P0** | **ADR must explicitly state the write-back trigger (event class, debounce window, human-curation gate). Default reject: write-back only on board-approved events with a per-tenant debounce. Document the rejected alternatives.** | **Architect + CTO** | **ADR v1 lands without a write-back trigger section — page CTO immediately** |
| R0.2 | ADR does not name an actor-mapping scheme → `agent:<id>` actors cannot be attributed on customer Jira/GitHub (no first-class human identity) | M | H | P0 | ADR §"actor mapping" must list a default scheme (e.g., service-account + per-agent alias) and the fallback when the customer's IdP cannot accept the alias. Q-`actor-mapping` from `jira_sync_report.md` §6 lands inside the ADR. | Architect + CTO | ADR ships without an actor-mapping section |
| R0.3 | ADR does not name a conflict-resolution strategy → concurrent edits on both sides diverge silently, mirror-divergence becomes a P0 SOC 2 artefact | M | C | P0 | ADR §"conflict resolution" must pick one of (last-write-wins by `updated_at`, three-way merge by `etag`, manual reconcile queue) and document the SOC 2 implication of each | Architect + CTO | ADR ships without a conflict-resolution section |
| R0.4 | ADR lands and is treated as final without a deprecation/reversal path — one-way-door on the topology | L | H | P0 | ADR requires an explicit "exit cost" section (what does it take to swap the event bus for CDC, etc.); FORA-199 is gated on Architectural Review board approval per `agents/audit/README.md` pattern | Architect + CTO | ADR ships without an exit-cost section |

> **All four S0 risks are P0.** The ADR is the single point of failure for the rest of the sync plane — every downstream story inherits whatever the ADR locks in. Until FORA-199 lands, every risk below marked **PROVISIONAL** is a placeholder; the risk register is revved to v1.0 after FORA-199.

---

### S1 — Shared Mirror Plane (event bus / CDC / polling, idempotency, retry)

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R1.1** | **Mirror write succeeds on the source side but the audit event is dropped** — the source-of-truth platform records the change, the mirror writes, but the audit log has no record. Audit completeness (R7.1 analogue) fails. | **M** | **C** | **P0** | **Mirror plane emits the audit event as part of the same outbox transaction (transactional outbox pattern). Audit write is fail-closed: mirror-write commits only if the audit append returns success. Daily sample (§3 below) verifies 100 % completeness.** | **Dev + Security (Epic 5)** | **Any missing mirror event in the daily sample — page on-call** |
| R1.2 | Idempotency-key collision → duplicate mirror writes or, worse, dropped writes after a retry | M | M | P2 | Idempotency key = `sha256(tenant_id + source_issue_id + event_id + event_type)`; collision space is 2²⁵⁶ — collision risk is informational only; lint test inserts 10⁶ synthetic keys and asserts uniqueness | Dev | Lint fails > 0 collisions in test |
| R1.3 | Retry storm on a degraded downstream platform (e.g., Jira 5xx) saturates the queue and stalls other tenants' mirrors | M | M | P2 | Per-tenant retry buckets (token-bucket pattern from FORA-126, `agents/customer_cloud_broker/` lands post-ship); circuit breaker per (tenant, platform); shared queue has a hard ceiling | DevOps + Dev | One tenant exceeds 20 % of the queue for > 5 min |
| R1.4 | Mirror queue is not multi-region → a single AWS region outage stalls every tenant's sync | L | H | P0 | Active-active queue across at least two regions; mirror write is idempotent so region failover is safe; SOC 2 "availability" CC controls inherit this | DevOps | Single-region outage > 5 min |

> Topology of S1 (event bus vs. CDC vs. polling) is **PROVISIONAL pending FORA-199** — R1.1, R1.3 mitigation specifics depend on the ADR's topology pick.

---

### S2 — Paperclip ↔ Jira bidirectional sync

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R2.1** | **Cross-platform actor-impersonation** — a Paperclip `agent:<id>` writes a Jira comment that appears under a customer's human user's identity (or vice versa), because the actor-mapping scheme is loose. The customer cannot distinguish a human action from an agent action; SOC 2 "logical access" CC controls fail. | **M** | **C** | **P0** | **Every Jira write carries an explicit `actor_type` field (`agent` / `user` / `system`) + the canonical actor id; the Jira comment prefix is `[agent:<id>]` (verifiable); the customer-facing avatar is the service account; the agent's actual id is in a metadata block visible to admins. ADR §"actor mapping" (R0.2) is the upstream gate.** | **Dev + Security (Epic 5)** | **Any Jira comment where `actor_type` cannot be recovered — page on-call** |
| R2.2 | Jira rate-limit (REST API ~100 req/min) tripped by a burst of mirror writes during a board-response run | M | M | P2 | Per-tenant Jira rate-limit token bucket; debounce window from R0.1 trigger; back-off with jitter | Dev | 429 response rate > 1 % over 1 h |
| R2.3 | Jira webhook delivery (inbound) is delayed or dropped → Paperclip state is stale, a `done` Paperclip issue still shows `In Progress` on Jira | M | M | P2 | Webhook → outbox → reconciliation cron catches drift every 5 min (configurable); divergence emits a `mirror_divergence` audit event | Dev | Reconciliation catches drift > 5 times/day/tenant |
| R2.4 | Jira attachment body is a customer file → mirror to Paperclip exposes it to the agent allow-list (prompt-injection surface) | M | H | P0 | Attachment bodies are mirrored as opaque references (Paperclip never fetches the bytes unless an explicit user action approves); attachment metadata only in the audit entry (`input_digest`, no body) | Security (Epic 5) + Dev | Any attachment body reaches the agent runtime |

---

### S3 — Paperclip ↔ GitHub Issues bidirectional sync

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R3.1** | **GitHub App installation token stored in `process.env` of a process the agent runtime does not own** — direct violation of `workspace/memory/security.md` §3. A single memory dump or error log leaks the token. | **L** | **C** | **P0** | **GitHub App private key lives in AWS Secrets Manager; the runtime fetches a short-lived (≤ 15 min) installation token via the existing `mcp-servers/secrets/` MCP (FORA-128); the token is injected as a sidecar env var, never persisted. Pinned unit test asserts no `process.env.GITHUB_*` reference.** | **Dev + Security (Epic 5)** | **Any `process.env.GITHUB_*` reference in `git grep` — page on-call** |
| R3.2 | GitHub commit/issue body is rendered as Markdown — XSS via a mirror write that injects `<script>` into a Paperclip comment rendered as HTML | M | H | P0 | Render as Markdown in Paperclip (not HTML); CSP `script-src 'self'` per `security.md` §6; lint rule rejects any `dangerouslySetInnerHTML` on mirrored content (auto-flag per §11) | Security (Epic 5) + Dev | Any XSS payload reaches a rendered Paperclip surface |
| R3.3 | Public GitHub repo leaks Paperclip issue body (and vice versa) when a customer accidentally links the wrong repo | L | C | P0 | Per-installation allow-list of repos the mirror may touch; CI lint rejects installation requests that include `*` or a public org; daily sample asserts every mirror write's repo is in the allow-list | Security (Epic 5) + Dev | Mirror write targets a repo not in the allow-list — page on-call |
| R3.4 | GitHub Issues has no project-pin analogue to Jira's `project_pin` → cross-repo leak | M | H | P0 | Mirror scoped to a single repo per Paperclip tenant; cross-repo writes are rejected at the MCP server layer; lint rule refuses `installation_id` with > 1 repo in scope | Dev + Security | Any cross-repo read/write |

---

### S4 — Paperclip ↔ `<clipup>` bidirectional sync

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R4.1** | **Platform identity unresolved (Q-`clipup` still open from `jira_sync_report.md` §6)** — ClickUp vs. custom-internal vs. something else. Picking wrong → rebuild or, worse, ship with the wrong actor-mapping scheme. | **H** | **M** | **P1** | **S4 work does not start until the board disambiguates Q-`clipup`. The risk register entry is a placeholder; the story itself is `blocked` on a separate interaction with the board.** | **CTO + Board** | **Q-`clipup` open > 7 days — escalate to CEO** |
| R4.2 | Inherits S2/S3 risks (actor-impersonation, token storage, rate-limit, XSS) once platform is named | — | — | (inherited) | All P0 controls from S2/S3 apply; the platform-specific risks get their own row once the platform is named | Dev + Security (Epic 5) | Inherits from S2/S3 triggers |
| R4.3 | Per-platform token storage (a new P0 mentioned in the AC) — every platform has its own credentials and rotation policy; a tenant onboarding audit must verify all of them | M | C | P0 | Tenant onboarding includes a "sync-plane credential inventory" check; per-platform credentials all live in AWS Secrets Manager; per-platform rotation policy in `mcp-servers/secrets/` MCP (FORA-128); daily sample verifies every mirror event references a credential that is in the inventory | Security (Epic 5) + DevOps | Any mirror event references a credential not in the inventory — page on-call |

---

### S5 — Cross-platform comment thread + author-attribution model

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R5.1** | **Comment authorship ambiguity** — a comment written on Paperclip by `agent:developer` renders on Jira as `user:cto@acme-corp` (the customer's `on_behalf_of`) because the customer-facing avatar and the audit-log actor are conflated. SOC 2 "who did what" answers become unrecoverable. | **M** | **C** | **P0** | **Every mirrored comment carries four orthogonal fields: `author_type` (`agent`/`user`/`system`), `author_id` (canonical id), `authored_for_tenant` (the tenant on whose behalf the action ran), `rendered_as` (the customer-visible avatar — always a service account). The audit entry carries all four; the customer-facing comment carries `rendered_as` + a `[agent:<id>]` prefix per R2.1. Mirror-divergence sample asserts the four-field invariant.** | **Dev + Security (Epic 5) + PM** | **Any comment where the four fields are not jointly present — page on-call** |
| R5.2 | Comment storm during a board-response run — every Paperclip heartbeat comment mirrors to Jira, GitHub, `<clipup>` | M | M | P2 | Per-R0.1 write-back trigger + per-tenant debounce window (default 60 s); heartbeat-class comments are explicitly excluded from mirror | PM + Dev | Mirror rate > 10 comments/hour/tenant for > 1 h |
| R5.3 | Edited comment diverges across platforms — Paperclip has the edit, Jira has the original | L | M | P3 | Comment edits emit a new audit event with `parent_comment_id`; reconciliation cron detects divergence and emits a `mirror_divergence` audit event | Dev | Reconciliation catches > 1 edit divergence/day |

---

### S6 — Sync-plane audit + risk register (this issue, FORA-204)

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R6.1** | **Audit entry-shape drift between this register, `security.md` §7.1, and `agents/audit/schema.py`** — three different field-name conventions exist today: §7.1 uses `args_hash` / `duration_ms`; `schema.py` uses `inputDigest` / `wallMs`; the AC text on this issue uses `query_hash` / `response_hash` / `latency_ms` / `cost_usd`. Any new event emitter picking the wrong convention breaks the daily sample. | **M** | **C** | **P0** | **Single canonical schema: `agents/audit/schema.py` is the source of truth (FORA-36 contract). §7.1 of `security.md` is reconciled to `schema.py` in a follow-up PR (version bump to `AUDIT_SCHEMA_VERSION = "0.2.0"`). The sync-plane extension lives in `metadata` (R6.2) — never as new top-level fields — until §7.1 and `schema.py` are reconciled.** | **Security (Epic 5) + CTO** | **Any PR that adds a top-level audit field without bumping `AUDIT_SCHEMA_VERSION` — page on-call** |
| R6.2 | Sync-plane-specific fields (`target_platform`, `mirror_event_type`, `query_hash`, `response_hash`, `cost_usd`) cannot be added to the schema without a breaking change | M | M | P2 | Add the sync-plane fields to `metadata` dict (free-form) keyed by namespaced names (`sync.target_platform`, `sync.mirror_event_type`, `sync.query_hash`, `sync.response_hash`, `sync.cost_usd`); lint rule asserts every mirror event has the sync.* keys; future schema bump promotes them to first-class | Dev | Schema bump triggered before §7.1 reconciliation |
| R6.3 | Per-tenant namespace rule (R8.1 extension) is implemented at the audit-reader layer but not at the audit-writer layer → a writer can leak another tenant's `tenant_id` in `metadata` | M | C | P0 | Per-tenant namespace enforced at write time (not just read time): the audit-emit helper takes `tenant_id` as the first arg, asserts `metadata.tenant_id` matches, refuses to emit otherwise; CI lint asserts every `emit.mirror_event` call site passes `tenant_id` first | Dev + Security (Epic 5) | Any writer call site without `tenant_id` as first arg |
| R6.4 | Daily audit sample (n = 10 random runs) cannot be run until the sync plane is implemented (S1–S5) | H | M | P1 | Daily sample code is written and unit-tested against a stub mirror plane before FORA-199 lands; production run is gated on the sync-plane-implementation stories; sample code review is part of this issue's `in_review` disposition | Dev + Security (Epic 5) | Sync plane impl slips past 2026-08-15 |

---

### S7 — Mirror-divergence detection + reconciliation

| ID | Risk | L | I | Sev | Mitigation | Owner | Trigger to escalate |
|----|------|---|---|-----|------------|-------|---------------------|
| **R7.1** | **Mirror-divergence becomes a SOC 2 audit artefact** — two platforms hold different states for the same logical entity and the audit log shows neither side noticed. SOC 2 "input completeness" and "output accuracy" CC controls fail. | **M** | **C** | **P0** | **Reconciliation cron runs every 5 min per (tenant, platform-pair); emits a `mirror_divergence` audit event on detection with both sides' `updated_at`, `etag`, and a content-hash; divergence > 15 min auto-pages on-call; daily sample asserts the reconciliation cron ran for every active tenant.** | **Dev + Security (Epic 5)** | **Any un-reconciled divergence > 15 min — page on-call** |
| R7.2 | Divergence detection itself is racy — both sides update between the cron reads, false-positive divergence | M | M | P2 | Read-window optimisation: read both sides within 1 s; accept divergence only if the second read still differs; retry once on false-positive | Dev | False-positive rate > 5 % over 24 h |
| R7.3 | A platform's clock skew makes every comparison false-positive | L | M | P3 | Use server-side `etag` / `version` fields (not `updated_at`) as the primary comparator; clock skew is a fallback only | Dev | Clock-skew false positives > 1 / day |

---

## 2. Cross-cutting risks (spanning multiple stories)

| ID | Risk | L | I | Sev | Spans | Mitigation | Owner |
|----|------|---|---|-----|-------|------------|-------|
| **R-X1** | **Per-platform token storage** — every platform (Jira, GitHub, `<clipup>`, plus future Slack/Confluence/SonarQube/Figma per `security.md` §1) has its own credential and rotation policy. A tenant onboarding audit must verify all of them; a single missed rotation is a SOC 2 "logical access" CC failure. | **M** | **C** | **P0** | **All per-platform credentials live in AWS Secrets Manager via `mcp-servers/secrets/` MCP (FORA-128); tenant onboarding includes a credential inventory check; rotation policy lives in the same MCP; daily sample verifies every mirror event references a credential that is in the inventory and within its rotation window.** | **DevOps + Security (Epic 5)** |
| **R-X2** | **Audit entry completeness across all mirrored platforms** — the daily sample must find 100 % of mirror events for n = 10 random runs across every platform the tenant mirrors to. A missing entry is a P0. | **M** | **C** | **P0** | **Sample selects 10 random `(tenant_id, run_id)` pairs from the last 24 h; for each, asserts every mirror event the run emitted has a matching `AuditEvent` row in the store; any missing entry → P0 alert. Run as a scheduled Lambda on a per-tenant schedule; result is itself an audit event (`sample_run_complete`).** | **Security (Epic 5)** |
| **R-X3** | **Rate limit + debounce policy** — every platform has different rate limits and different acceptable debounce windows. A burst of mirror writes during a board-response run can saturate one platform without affecting the others. | **M** | **M** | **P2** | **Per-(tenant, platform) rate-limit token bucket with per-platform defaults (Jira ~100 req/min, GitHub ~5000 req/h, `<clipup>` TBD); debounce window from R0.1 trigger; back-off with jitter; cross-platform burst budget (the global per-tenant cap that protects against any one platform saturating).** | **Dev + DevOps** |
| **R-X4** | **Failure-mode handling when two platforms diverge during an in-flight run** (e.g., Jira field is updated directly while a Paperclip run is writing to it). The wrong default re-writes the user's change; the right default surfaces a conflict. | **M** | **H** | **P1** | **ADR §"conflict resolution" (R0.3) is the upstream gate. The runtime implements the ADR's pick; the mirror plane surfaces conflicts to the agent (not the user) when the run is in flight, and to the user when no run is in flight. Audit event `conflict_resolved` carries the strategy used (`lww` / `three_way_merge` / `manual_queue`).** | **Architect + Dev** |
| **R-X5** | **Schema drift between Paperclip's issue model and each platform's model** — Jira has `Components` and `Fix versions`, GitHub has `Labels` and `Milestones`, `<clipup>` has TBD. A field with no mapping either silently drops (lossy) or generates a noisy stub (noisy). | **M** | **M** | **P2** | **Per-platform mapping table is a versioned artefact (`forge/sync-plane/mapping_<platform>.json`); unmapped fields emit a `field_unmapped` audit event; the lint rule asserts the mapping table covers every Paperclip field used in v1; a future ADR (R-Q3) decides whether unmapped fields block or surface.** | **Dev + PM** |
| **R-X6** | **No prompt-injection regression test set for mirror payloads** — `workspace/memory/security.md` §5 requires a regression test for every external payload source. Mirror payloads (Jira ticket body, GitHub issue body, `<clipup>` task description) are external payloads by definition. | **M** | **H** | **P1** | **Seed 10 prompt-injection + 10 role-violation eval cases per platform in `packages/evals/cases/safety/sync_plane/`; CI fails if any safety regression appears; Q7 from `forge/1.3/risk_register.md` R-X4 (CTO + ba-agent) is extended to cover mirror payloads.** | **QA + PM + Security (Epic 5)** |
| **R-X7** | **Cost attribution across platforms** — the S7 cost block (`cost_cents`, `promptTokens`, `completionTokens`) covers Paperclip-side cost only. Mirror writes to Jira/GitHub/`<clipup>` have their own per-call cost (rate-limit budget, not dollars, but the same attribution problem). | **M** | **M** | **P2** | **Mirror-plane cost is tracked in `metadata.sync.cost_units` (rate-limit-budget units, not dollars); daily cost summary in `agents/audit/reader.py` aggregates by `(tenant_id, platform)`; per-tenant budget gate (R8.2 from `1.3/risk_register.md`) is extended to include mirror cost.** | **DevOps + Dev** |
| **R-X8** | **Tenant data residency** — Jira Cloud is region-pinned, GitHub is US, `<clipup>` is TBD. A EU tenant's mirror write to GitHub US may violate the DPA. | **L** | **C** | **P0** | **Tenant onboarding includes a residency-check; mirror-plane refuses to write to a platform whose region conflicts with the tenant's DPA; lint rule asserts the residency-check ran for every active tenant.** | **DevOps + Security (Epic 5)** |

---

## 3. Risk roll-up

| Severity | Count | Notable |
|----------|-------|---------|
| **P0** | 19 | R0.1 (ADR no write-back trigger), R0.2 (ADR no actor mapping), R0.3 (ADR no conflict resolution), R0.4 (ADR no exit cost), R1.1 (mirror audit fail-open), R1.4 (queue single-region), R2.1 (cross-platform impersonation), R2.4 (attachment body leak), R3.1 (GitHub token in env), R3.2 (XSS via mirror), R3.3 (wrong-repo mirror), R3.4 (cross-repo mirror), R4.3 (per-platform credential inventory), R5.1 (comment authorship), R6.1 (audit schema drift), R6.3 (per-tenant namespace at writer), R7.1 (mirror divergence SOC 2), R-X1 (per-platform token storage), R-X2 (audit completeness across platforms), R-X8 (residency) |
| **P1** | 4 | R4.1 (Q-`clipup` unresolved), R6.4 (daily sample can't run yet), R-X4 (in-flight conflict), R-X6 (no mirror-payload eval set) |
| **P2** | 9 | R1.2 (idempotency collision — informational), R1.3 (retry storm), R2.2 (Jira rate-limit), R2.3 (Jira webhook delay), R5.2 (comment storm), R5.3 (edited comment divergence), R6.2 (sync-plane fields in metadata), R7.2 (racy divergence), R-X3 (rate-limit + debounce), R-X5 (schema drift), R-X7 (cost attribution) |
| **P3** | 2 | R7.3 (clock skew), R5.3 |

> **P0 count is 19 (provisional).** This is roughly 2× the P0 concentration of `forge/1.3/risk_register.md` (9 P0s), which is consistent with the new surface area — a sync plane introduces new actors, new credentials, new failure modes, and a new SOC 2 audit surface all at once. Once FORA-199 lands and the topology-dependent mitigations solidify, expect 1–3 PROVISIONAL P0s to either resolve (ADR mitigates) or stay P0 (and we add controls). Either way, this register is revved to v1.0.

**Composite risk profile:** **high**, dominated by **P0 controls on cross-platform actor identity, per-platform credential storage, and audit completeness**. The control framework that exists (`workspace/memory/security.md` §3 secrets, §4 tenancy, §7 audit; `agents/audit/` foundation from FORA-36) covers most of the per-control mitigations, but several controls are not yet *wired* into the sync-plane event-emit path. The verification path for most P0s is Security (Epic 5) — the security-engineer hire owns the daily sample, the cross-tenant lint, the per-tenant inventory check, and the mirror-divergence sample.

---

## 4. Risk → Story → Stage routing

| Severity | Story | Stage where the control is implemented | Stage where the control is verified |
|----------|-------|---------------------------------------|--------------------------------------|
| P0 | S0 (ADR — every ADR section) | Architect | CTO + Board |
| P0 | S1 (mirror audit fail-open) | Dev | Security (Epic 5) |
| P0 | S1 (queue multi-region) | DevOps | DevOps |
| P0 | S2 (cross-platform impersonation) | Dev | Security (Epic 5) |
| P0 | S2 (attachment body leak) | Dev | Security (Epic 5) |
| P0 | S3 (GitHub token in env) | Dev | Security (Epic 5) |
| P0 | S3 (XSS via mirror) | Dev | QA + Security (Epic 5) |
| P0 | S3 (wrong-repo mirror) | Dev | Security (Epic 5) |
| P0 | S3 (cross-repo mirror) | Dev | Security (Epic 5) |
| P0 | S4 (per-platform credential inventory) | DevOps | Security (Epic 5) |
| P0 | S5 (comment authorship) | Dev | Security (Epic 5) + PM |
| P0 | S6 (audit schema drift) | Dev + Security (Epic 5) | Security (Epic 5) |
| P0 | S6 (per-tenant namespace at writer) | Dev | Security (Epic 5) |
| P0 | S7 (mirror divergence) | Dev | Security (Epic 5) |
| P0 | R-X1 (per-platform token storage) | DevOps | Security (Epic 5) |
| P0 | R-X2 (audit completeness across platforms) | Dev | Security (Epic 5) |
| P0 | R-X8 (residency) | DevOps | Security (Epic 5) |

The P0 controls are again predominantly **Dev-built + Security-verified** — the same shape as Epic 1. The PM/BA role is to ensure the Story-level AC explicitly references the control (FORA-204's AC does; see R0.x → S0 ADR sections, R2.1 → S2 AC, R6.1 → S6 AC, R-X2 → S7 sample).

---

## 5. Open risk questions

| ID | Question | Owner | Due |
|----|----------|-------|-----|
| R-Q0 | The new "Forge Integration Layer / Cross-Platform Sync Plane" Epic is not yet created on Paperclip. Should it be a child of FORA-62 (the Jira sync sub-goal) or of FORA-15 (the parent Forge Epic)? My recommendation: child of FORA-15, with FORA-62 as the originating audit link. | CEO + CTO | Before FORA-199 ships |
| **R-Q1** | **What does the ADR (FORA-199) decide on each of R0.1–R0.4?** This entire register's v1.0 is the ADR's output. Until FORA-199 lands, the P0 controls are placeholders. | **Architect + CTO** | **FORA-199 acceptance** |
| **R-Q2** | **What is `<clipup>`?** S4 cannot start without this. The board's free-form response did not disambiguate. | **Board + CTO** | **S4 cannot start before this resolves** |
| R-Q3 | Should unmapped fields (R-X5) block the mirror write or surface a stub? Affects whether a tenant sees "Jira has Components, Paperclip doesn't" as a hard error or a soft warning. | Dev + PM | Before S5 ships |
| R-Q4 | Daily sample (R-X2) — is `n = 10` per tenant, per platform, or per tenant-per-platform? The AC text says `n = 10 random runs` without scoping. My recommendation: per-tenant, drawn uniformly across all mirrored platforms for that tenant; small tenants (< 10 runs/day) are sampled exhaustively. | Security (Epic 5) | Before the sample ships |
| R-Q5 | Should the mirror plane's audit entry carry a `mirror_chain_id` that lets a downstream consumer reconstruct the full cross-platform chain of a single logical change? Adds 16 bytes per event but enables SOC 2 "input completeness" assertions end-to-end. | Dev + Security (Epic 5) | Before S6 ships |
| R-Q6 | The AC says `latency_ms` and `cost_usd`; the canonical schema (`schema.py`) uses `wallMs` and `costCents`. R6.1 is the resolution path — confirm `metadata.sync.*` keys are the right home until the schema bump. | CTO + Security (Epic 5) | Before S6 ships |

---

## 6. Sync-plane audit entry shape (extends `workspace/memory/security.md` §7)

> This section is the **normative spec** for the sync-plane audit entry. It extends §7.1 by adding `metadata.sync.*` keys; it does **not** add top-level fields (per R6.1 — that requires an `AUDIT_SCHEMA_VERSION` bump). The shape below is what every mirror-plane emitter must produce. The verification path is the daily sample (R-X2).

```json
{
  "eventId": "evt-01J7Z3X4K2N9PQ8R5",
  "schemaVersion": "0.1.0",
  "eventType": "tool_call",
  "timestamp": "2026-06-17T17:00:00.000Z",
  "runId": "run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "agentId": "f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0",
  "tenantId": "acme-corp",
  "stage": "sync_plane",
  "tool": "jira.mirror_issue_update",
  "inputDigest": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "outputDigest": "sha256:0a04135949726c7fd2c6b8b0b9f5b50eaa2c6b8b0b9f5b50eaa2c6b8b0b9f5b5",
  "costCents": 0,
  "promptTokens": 0,
  "completionTokens": 0,
  "wallMs": 412,
  "metadata": {
    "sync.target_platform": "jira",
    "sync.mirror_event_type": "issue_update",
    "sync.query_hash": "sha256:7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730",
    "sync.response_hash": "sha256:2c624232cdd221771294dfbb310aca000a0df6ac8b66b696d90ef06fdefb64a3",
    "sync.latency_ms": 412,
    "sync.cost_usd": 0.0,
    "sync.actor_type": "agent",
    "sync.actor_id": "agent:developer",
    "sync.authored_for_tenant": "acme-corp",
    "sync.rendered_as": "service-account:fora-sync@acme-corp",
    "sync.idempotency_key": "sha256:acme-corp|ISSUE-123|evt-01J7Z3X4K2N9PQ8R5|issue_update",
    "sync.parent_event_id": "evt-01J7Z3X4K2N9PQ8R4",
    "sync.mirror_chain_id": "chain_01J7Z3X4K2N9PQ8R5",
    "sync.platform_region": "us-east-1",
    "sync.platform_credential_ref": "arn:aws:secretsmanager:us-east-1:...:secret:acme-corp/jira",
    "sync.platform_response_code": 200
  }
}
```

### Field reference

| Field | Required | Source | Notes |
|-------|----------|--------|-------|
| `eventId` | yes | `agents/audit/schema.py` | ULID, monotonic |
| `schemaVersion` | yes | `AUDIT_SCHEMA_VERSION` | Bumped on every breaking change |
| `eventType` | yes | enum | Always `tool_call` for sync-plane events in v1 |
| `timestamp` | yes | ISO-8601 UTC | From the emitter |
| `runId` | yes | runtime | The Paperclip run that triggered the mirror |
| `agentId` | yes | runtime | The agent whose action triggered the mirror |
| `tenantId` | yes | runtime first arg | R6.3 enforces this at write time |
| `stage` | yes | enum | New value: `sync_plane` (in addition to `dev`, `qa`, etc.) |
| `tool` | yes | `<platform>.<verb>` | e.g., `jira.mirror_issue_update`, `github.mirror_comment_create`, `clipup.mirror_task_update` |
| `inputDigest` / `outputDigest` | yes | runtime | sha256 of the request/response body — never the body itself |
| `costCents`, `promptTokens`, `completionTokens`, `wallMs` | yes | runtime | `costCents` is 0 for non-LLM mirror calls; `wallMs` carries latency |
| `metadata.sync.target_platform` | yes | emitter | `jira` \| `github` \| `clipup` \| future Slack/Confluence/etc. |
| `metadata.sync.mirror_event_type` | yes | emitter | `issue_update`, `comment_create`, `attachment_link`, etc. |
| `metadata.sync.query_hash` / `sync.response_hash` | yes | emitter | sha256 of the request/response body — matches the AC text |
| `metadata.sync.latency_ms` / `sync.cost_usd` | yes | emitter | AC-named fields; mirrors `wallMs` and `costCents` for cross-platform dashboards |
| `metadata.sync.actor_type` | yes | R5.1 invariant | `agent` \| `user` \| `system` |
| `metadata.sync.actor_id` | yes | R5.1 invariant | Canonical id — never the customer-facing avatar |
| `metadata.sync.authored_for_tenant` | yes | R5.1 invariant | The tenant on whose behalf the action ran |
| `metadata.sync.rendered_as` | yes | R5.1 invariant | The customer-visible avatar (always a service account) |
| `metadata.sync.idempotency_key` | yes | R1.2 | sha256 over the deterministic tuple |
| `metadata.sync.parent_event_id` | when applicable | emitter | For child mirror events in a chain |
| `metadata.sync.mirror_chain_id` | recommended | R-Q5 | Carries the full cross-platform chain of a logical change |
| `metadata.sync.platform_region` | yes | emitter | R-X8 residency check depends on this |
| `metadata.sync.platform_credential_ref` | yes | emitter | AWS Secrets Manager ARN; R-X1 inventory check depends on this |
| `metadata.sync.platform_response_code` | yes | emitter | The downstream platform's HTTP response code |

### Per-tenant namespace rule (R8.1 extension)

Every mirror event's `tenantId` MUST equal `metadata.sync.authored_for_tenant`. A mismatch is a **P0 cross-tenant leak** (R6.3 + R8.1 from `forge/1.3/risk_register.md`). The audit-emit helper in `agents/audit/emit.py` MUST take `tenant_id` as the first positional argument and refuse to emit a `metadata.sync.*` event whose `authored_for_tenant` does not match. CI lint (`agents/audit/tests/`) MUST walk every `emit.mirror_event` call site and assert the invariant.

---

## 7. Daily audit sample design (R-X2)

> The sample is **not runnable** until the sync plane is implemented (S1–S5). The sample *code* is unit-testable today against a stub mirror plane; the production run is gated on the sync-plane stories.

### Sample shape

```python
def daily_audit_sample(tenant_id: str, n: int = 10) -> SampleReport:
    """Pick n random (run_id, target_platform) pairs from the last 24 h,
    assert every mirror event the run emitted has a matching AuditEvent row,
    assert every AuditEvent row in the mirror scope has a matching downstream
    platform record (R7.1 mirror-divergence sample).
    """
```

### Verifier invariants

1. **Completeness** — for every `(tenant_id, run_id, target_platform)` in the sample, the count of `AuditEvent` rows with `stage = "sync_plane"` AND `metadata.sync.target_platform = target_platform` equals the count of downstream platform records for that pair (where downstream records are reachable via the per-platform MCP). **A missing entry is a P0** (R-X2 + R7.1 analogue of R7.1 from `1.3/risk_register.md`).
2. **Schema invariant** — every sampled row has all required `metadata.sync.*` keys (per §6). A missing key is a P0 (R6.1 / R6.2).
3. **Per-tenant namespace** — every sampled row's `tenantId` equals `metadata.sync.authored_for_tenant`. A mismatch is a P0 (R6.3 + R8.1).
4. **Actor invariant** — every sampled row's `metadata.sync.actor_type` is one of `agent`/`user`/`system` and the four-field actor invariant from §6 holds. A violation is a P0 (R5.1).
5. **Credential invariant** — every sampled row's `metadata.sync.platform_credential_ref` resolves to a credential that is in the tenant's credential inventory and within its rotation window. A violation is a P0 (R-X1).

### Sample scheduling

- Per-tenant scheduled Lambda; default 02:00 UTC (off-peak) + jitter.
- Result is itself an `AuditEvent` with `eventType = "sample_run_complete"`, `tool = "audit.daily_sample"`, and a `metadata.sync.*` block summarising n, completeness rate, and any P0s raised.
- A P0 raised by the sample pages on-call within 5 min.

### Out of scope for v1

- Statistical sampling (n = 10 is the AC; no confidence interval).
- Cross-tenant aggregation in the sample (each tenant's sample is independent; cross-tenant rollups live in `agents/audit/reader.py`).
- Sampling tenants with < 10 runs/day (sample exhaustively; flag the small-tenant cohort).

---

## 8. Related

- [`forge/1.3/risk_register.md`](../1.3/risk_register.md) — template + the P0 controls this register extends (R2.1, R7.1, R7.2, R7.3, R8.1, R8.2)
- [`forge/1.4/jira_sync_report.md`](../1.4/jira_sync_report.md) §6 — origin of the scope expansion; lists the 6 follow-up children this register bootstraps
- [`workspace/memory/security.md`](../../workspace/memory/security.md) §3 (secrets), §4 (auth/tenancy), §5 (LLM-agent controls), §7 (audit logging), §11 (security anti-patterns)
- [`agents/audit/README.md`](../../agents/audit/README.md) — FORA-36 foundation (append-only store, hash chain, tenant-scoped read API, admin override)
- [`agents/audit/schema.py`](../../agents/audit/schema.py) — `AuditEvent` contract; `AUDIT_SCHEMA_VERSION = "0.1.0"`
- [FORA-126 — Customer-cloud broker v1](/FORA/issues/FORA-126) — reference for per-tenant token bucket + circuit-breaker pattern (R1.3, R-X3). The broker module lands as `agents/customer_cloud_broker/` post-FORA-126 ship; until then the pattern is documented in the FORA-126 ship note.
- [`mcp-servers/secrets/`](../../mcp-servers/secrets/) — FORA-128 reference for per-platform credential storage (R3.1, R-X1)
- [FORA-199 — ADR — sync topology decision](/FORA/issues/FORA-199) — upstream gate (R0.1–R0.4)
- [FORA-62 — Sub-goal 1.4 — Jira sync report](/FORA/issues/FORA-62) — parent
- [VOY-3066 — S7 Audit Log Capture](https://neptunetriton.atlassian.net/browse/VOY-3066) — the wedge this register extends
- [FORA-168 — Approvals pg adapter](/FORA/issues/FORA-168) — reference for the integration-child unblock pattern that closed a similar recovery loop

---

**Change log**

| Rev | Date | Author | What changed |
|-----|------|--------|--------------|
| v0.1 | 2026-06-17 | CTO (`f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0`) | Initial risk register — 20 P0s, 4 P1s, 9 P2s, 2 P3s. Provisional, gated on FORA-199. Documents the sync-plane audit entry shape (extends `security.md` §7.1 via `metadata.sync.*` keys — no top-level field additions until `AUDIT_SCHEMA_VERSION` is bumped per R6.1). Specifies the daily-sample design (R-X2) and the per-tenant namespace rule (R6.3 + R8.1 extension). Daily-sample production run remains blocked on sync-plane implementation (S1–S5). |
