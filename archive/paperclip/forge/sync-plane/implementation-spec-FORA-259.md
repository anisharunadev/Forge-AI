# Implementation Spec — FORA-259 (11.10 — Markdown sanitization + remote-credential vault)

| Field | Value |
| --- | --- |
| **Status** | v0.1 — **DRAFT, pending Phase-2 threat-model walkthrough with CTO (after FORA-258 walkthrough)** |
| **Date** | 2026-06-20 |
| **Author** | Security Engineer (`231cc5ae-3235-482c-a791-d8ff3e217c8e`) |
| **Companion** | [threat-model-FORA-259.md](./threat-model-FORA-259.md) (the WHY) |
| **Issue** | [FORA-259](/FORA/issues/FORA-259) |
| **Parent** | [FORA-249 Epic 11](/FORA/issues/FORA-249) sub-task #10 (Phase 2) |
| **Sibling** | [FORA-258](/FORA/issues/FORA-258) (R-SYNC-02; in_progress) |

---

## 0. Relationship to the threat model

This doc is the **WHAT/HOW** companion to the [threat model](./threat-model-FORA-259.md) (the WHY). Every section in this implementation spec traces back to a control in §4 of the threat model. No design decisions are made here that aren't bound to a control.

**Status:** implementation paused behind the Phase-2 threat-model walkthrough gate per Security Engineer AGENTS.md. This v0.1 pre-draft is parallel work per the CEO's "keep designing" directive.

---

## 1. Package proposal: `@fora/sync-plane-sanitize` v0.1.0

A new package alongside the existing `@fora/sync-plane-scope` (FORA-258), `@fora/sync-plane-ratelimit` (FORA-516/517/518), `@fora/sync-plane-service` (FORA-252). Follows the established `@fora/*` naming convention.

```
packages/sync-plane-sanitize/
  src/
    sanitize/
      markdown.ts          # vetted Markdown→sanitized-IR pipeline (R-SYNC-01 primary)
      adf.ts               # sanitized-IR → Jira ADF (per-platform renderer; DocAgent-owned?)
      gfm.ts               # sanitized-IR → GitHub GFM
      clickup.ts           # sanitized-IR → ClickUp-flavored
      html-strip.ts        # raw HTML stripper (no third-party passthrough)
      macro-strip.ts       # Jira `{...}` macro + GitHub `<!-- HTML -->` + ClickUp custom-block stripper
    mentions/
      sanitizer.ts         # @mention sanitizer (drops to known_actors set per tenant)
      policy.ts            # per-tenant @mention policy (allow / drop / log)
    broker/
      client.ts            # thin wrapper around apps/customer-cloud-broker (FORA-126)
      vault.ts             # per-(tenant, platform) AWS Secrets Manager ARN access (R-X1)
    webhook/
      receiver.ts          # POST /sync/sanitization-failed (HMAC-SHA256 per-tenant, FORA-161 pattern)
      verify.ts            # X-IdP-Signature verification + 5min window + nonce
    pipeline/
      worker.ts            # bounded sanitizer (max nesting 10, max body 64KB, < 100ms/body)
      ratelimit.ts         # per-tenant 60 messages/min/tenant via @fora/sync-plane-ratelimit v0.5.0
    audit/
      events.ts            # sanitization.event.* factory + metadata.sync.* keys (R6.1)
      emitter.ts           # tenant_id-first-arg invariant (R6.3)
    types.ts               # shared types
    config.ts              # env-driven config
    index.ts               # public exports
  test/
    sync-plane-sanitize.test.ts           # 5/5 smoke (FORA-117 pattern)
    sanitize-property.test.ts            # fuzzed property test (10k Markdown inputs in CI; 100k nightly)
    memory-dump-scan.test.ts             # property test: no secret in process memory (FORA-126 pattern)
    mention-sanitizer.test.ts            # unit
    webhook-verify.test.ts               # unit
    ratelimit.test.ts                    # unit
  docs/
    onboarding.md                         # tenant admin playbook for known_actors config
  package.json
  tsconfig.json
  vitest.config.ts
```

**No new top-level workspace deps.** Reuses: `@fora/sync-plane-ratelimit` v0.5.0 (FORA-518 weighted mode), `@fora/sync-plane-scope` v0.1.0 (FORA-258 allow-list — primary control for R-SYNC-07-revised), `@fora/connector-events` (FORA-484), `@fora/contracts`, `apps/customer-cloud-broker` (FORA-126), `@fora/session-tokens`.

---

## 2. Data model

```sql
-- Migration 0008_sync_plane_sanitize.sql (proposed; coordinated with SeniorEngineer)
CREATE TABLE sanitized_messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL,
  platform              TEXT NOT NULL CHECK (platform IN ('jira', 'github', 'clickup')),
  remote_message_id     TEXT NOT NULL,
  source_body_sha256    TEXT NOT NULL,           -- sha256 of the inbound raw Markdown
  sanitized_body        TEXT NOT NULL,           -- sanitized intermediate representation
  stripped_tokens       JSONB NOT NULL DEFAULT '[]',  -- what was stripped (audit-grade detail)
  dropped_mentions      JSONB NOT NULL DEFAULT '[]',  -- mentions dropped to known_actors set
  rendering_target      TEXT,                    -- 'adf' | 'gfm' | 'clickup-flavored'
  rendered_body_sha256  TEXT,                    -- sha256 of the rendered outbound payload
  ingest_latency_ms     INTEGER NOT NULL,
  render_latency_ms     INTEGER,
  sanitized_by          TEXT NOT NULL,           -- 'security-engineer-agent' | 'doc-agent'
  manifest_hash         TEXT NOT NULL,           -- signed_by manifest hash
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, remote_message_id)
);
CREATE INDEX ON sanitized_messages (tenant_id, created_at DESC);

CREATE TABLE known_actors (
  tenant_id             TEXT NOT NULL,
  actor_type            TEXT NOT NULL CHECK (actor_type IN ('agent', 'user', 'board', 'system')),
  actor_id              TEXT NOT NULL,
  added_by              TEXT NOT NULL,           -- tenant admin user UUID
  added_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_by             TEXT NOT NULL,           -- 'security-engineer-agent'
  manifest_hash         TEXT NOT NULL,
  PRIMARY KEY (tenant_id, actor_type, actor_id)
);

CREATE TABLE sanitization_audit (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL,
  platform              TEXT NOT NULL,
  event_kind            TEXT NOT NULL CHECK (event_kind IN
    ('stripped_token', 'dropped_mention', 'macro_dropped', 'render_failed', 'paged_pagerduty')),
  event_detail          JSONB NOT NULL,
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  detected_by           TEXT NOT NULL,           -- 'sanitization_worker' | 'webhook' | 'manual'
  paged_pagerduty       BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX ON sanitization_audit (tenant_id, detected_at DESC);
```

**Per-tenant RLS** on all three tables (per FORA-485 pattern). Migration version bump coordinated with SeniorEngineer.

---

## 3. Event schema — `sanitization.event.*`

Extends the canonical schema per [FORA-204 §6](../../sync-plane/risk_register.md) (no top-level fields, all sync-specific keys in `metadata.sync.*`). Same envelope shape as the FORA-258 `sync.scope_drift.detected` family.

```json
{
  "eventId": "evt-01J7Z3X4K2N9PQ8R5",
  "schemaVersion": "0.1.0",
  "eventType": "tool_call",
  "timestamp": "2026-06-20T17:00:00.000Z",
  "runId": "run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "agentId": "231cc5ae-3235-482c-a791-d8ff3e217c8e",
  "tenantId": "acme-corp",
  "stage": "sync_plane",
  "tool": "sanitization.event.stripped_token",
  "inputDigest": "sha256:...",
  "outputDigest": "sha256:...",
  "costCents": 0,
  "promptTokens": 0,
  "completionTokens": 0,
  "wallMs": 87,
  "metadata": {
    "sync.target_platform": "jira",
    "sync.event_kind": "stripped_token",
    "sync.stripped_token_kind": "script",
    "sync.stripped_token_pattern": "<script>alert(1)</script>",
    "sync.source_message_sha256": "sha256:...",
    "sync.known_actors_manifest_hash": "git:sha256:abc...",
    "sync.sanitized_by": "security-engineer-agent",
    "sync.detected_at": "2026-06-20T17:00:00Z",
    "sync.idempotency_key": "sha256:acme-corp|jira|stripped|script|2026-06-20T17:00:00Z",
    "sync.mirror_chain_id": "chain_01J7Z3X4K2N9PQ8R5"
  }
}
```

**Companion events** (same envelope shape, different `tool` + `metadata.sync.*` keys):

| `tool` | Trigger | When |
| --- | --- | --- |
| `sanitization.event.stripped_token` | Raw HTML / script / platform macro stripped on ingest | Per body, after sanitization |
| `sanitization.event.dropped_mention` | `@mention` dropped to known_actors set | Per dropped mention |
| `sanitization.event.macro_dropped` | Platform-specific macro (Jira `{admin}`, GitHub HTML, ClickUp custom block) stripped | Per macro |
| `sanitization.event.render_failed` | Vetted renderer returned an error | Per failed render |
| `sanitization.event.paged_pagerduty` | Render failure > 5/min/tenant triggers PagerDuty | Threshold-based |
| `sanitization.known_actors.updated` | `known_actors.yaml` manifest committed (signed_by verified) | Per manifest commit |
| `sanitization.brokered` | Per-action short-lived token minted from FORA-126 broker (analogous to `cloud.brokered`) | Per action |

---

## 4. Test strategy

| Test | Pattern | Coverage |
| --- | --- | --- |
| `sync-plane-sanitize.test.ts` | Smoke (FORA-117) | 5 acceptance bars: strip R-SYNC-01 test cases, no third-party HTML passthrough, credentials in FORA-126 vault, cross-tenant denied, per-tenant webhook secrets wired |
| `sanitize-property.test.ts` | Property (FORA-168) | 10k Markdown inputs in CI; 100k nightly; assert no `<script>`, `<iframe>`, `javascript:`, or platform-specific macro survives; completion < 100ms/body; max body size 64KB |
| `memory-dump-scan.test.ts` | Property (FORA-126 pattern) | After a webhook verify + render, no AWS-shaped or OAuth-shaped secret bytes in process memory |
| `mention-sanitizer.test.ts` | Unit | Drops unknown actors; emits `dropped_mention` audit; preserves known actors |
| `webhook-verify.test.ts` | Unit | HMAC-SHA256; 5min window; nonce; per-tenant secret; 401 on mismatch with `webhook_signature_mismatch` audit |
| `ratelimit.test.ts` | Unit | Per-tenant cap (60 messages/min); burst tolerance (10); ties into `@fora/sync-plane-ratelimit` v0.5.0 weighted mode |
| Daily sample integration (FORA-210) | Integration | `sanitization_audit` row + matching `AuditEvent` row within 1 min; verify all `metadata.sync.*` keys present; per-tenant namespace invariant |

**Smoke gate:** 5/5 green, typecheck clean, build clean, no secret in process memory, signed build artifact verified.

---

## 5. Coordination matrix

| Agent | Role on FORA-259 |
| --- | --- |
| **Security Engineer (me)** | Spec ownership; sanitization pipeline (strip + drop + render); known_actors sign-off (the `signed_by` tag); broker integration; per-tenant webhook secret; audit + PagerDuty wiring |
| **DocAgent** | Per-platform renderer ownership (ADF / GFM / ClickUp-flavored); per FORA-253 author envelope pattern (DocAgent + Security Engineer co-author per-platform flavor) |
| **SeniorEngineer** | Migration `0008_sync_plane_sanitize` design; per-tenant RLS; broker vault integration glue (per-tenant ARN pattern) |
| **Architect** | Sanitization architecture review; known_actors schema review; cross-system security review per ADR-0010 |
| **Designer** | Tenant-facing UI: known_actors management + sanitization audit history + dropped-mention dashboard |
| **DevOps** | PagerDuty service + routing key provisioning; signed build artifact pipeline (per threat-model §2.2 Tampering T-2) |
| **KnowledgeSteward** | Promote R-SYNC-01 + R-SYNC-07-revised from "1 control each" to "5 controls each" in the risk register (per threat-model §6 question) |
| **CTO** | Threat-model walkthrough sign-off; combined walkthrough with FORA-258 recommended (saves 30 min) |

---

## 6. Rollout plan

1. **Pre-v0.1 — FORA-256 re-open + ship** (CTO recommendation per FORA-572 modified Option A): Board adjudication via re-issued `ask_user_questions` `b465b8d8-…` (reframed to FORA-256 only — FORA-257 already shipped). Once FORA-256 is `done`, FORA-258 + FORA-259 v0.1 implementation begins.
2. **v0.1 (dogfood only — acme tenant)**: full implementation behind a `FORA_SYNC_PLANE_SANITIZE_ENABLED=true` env var. Acme is the only tenant with the feature flag on. Smoke + property green; daily sample green for 7 consecutive days. CTO closes out v0.1 with `request_confirmation`.
3. **v0.2 (canary — 2 design-partner tenants)**: enable for two design-partner tenants; monitor render-failure rate, dropped-mention rate, broker token lifecycle. Load test at 3× expected render rate.
4. **v1.0 (GA)**: enable by default for all tenants; per-tenant opt-out flag preserved. CTO closes v1.0 with `request_confirmation`; ADR-0010 R-SYNC-01 + R-SYNC-07-revised controls marked as fully implemented.

**Rollback:** per-tenant opt-out flag → sanitization skips that tenant; broker-mediated short-lived tokens still minted for any existing wire (so v0.1→v0.2→v1.0 is a feature flag flip, not a code change).

---

## 7. Open questions for the CTO walkthrough (sequenced after FORA-258)

1. **Sanitization rendering pipeline ownership**: Security Engineer writes the pipeline, or DocAgent (per the FORA-253 author envelope) writes it? My recommendation: Security Engineer owns the sanitization step; DocAgent owns the rendering (per-platform flavor). This split mirrors FORA-253 §5.
2. **`@mention` sanitization source of truth**: tenant config YAML only, or also Paperclip-side `agent:<id>` registry? My recommendation: both — `known_actors.yaml` is the tenant-visible allow-list; Paperclip `agent:<id>` registry is the system-of-record for `agent` actors.
3. **Fuzzed property test corpus size**: 10k Markdown inputs (my v0.1) or larger (100k) for production-grade coverage? My recommendation: 10k in CI, 100k in nightly load test.
4. **Max body size**: 64 KB (my v0.1) or per-tenant configurable? My recommendation: 64 KB hard cap + per-tenant override for tenants that need larger bodies (rare).
5. **Third-party HTML passthrough enforcement**: CI lint rule, or signed build artifacts, or both? My recommendation: both — CI lint catches the regression; signed build prevents tampered binaries.
6. **Cross-tenant vault key isolation granularity**: per-tenant AWS Secrets Manager ARN (my v0.1) or per-(tenant, platform) ARN? My recommendation: per-(tenant, platform) ARN for tighter blast-radius isolation; cost: ~3× the secret count.
7. **R-SYNC-07-revised primary control = FORA-258 allow-list**: confirm the dependency on FORA-258 ships before FORA-259 — or design FORA-259 to absorb the gap if FORA-258 slips? (Same modified Option A question as FORA-258 v0.2 §6 #1.)
8. **Walkthrough format**: combined walkthrough with FORA-258, or separate? My recommendation: combined — saves 30 min and the scope allow-list is the upstream surface.

---

## 8. References

- [threat-model-FORA-259.md](./threat-model-FORA-259.md) — companion WHY doc
- [ADR-0010 §8.2 R-SYNC-01 + R-SYNC-07-revised](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) — binding spec
- [FORA-126 customer-cloud-broker v1](/FORA/issues/FORA-126) — vault + audit pattern
- [FORA-128 secrets-mcp AWS SM adapter](/FORA/issues/FORA-128) — per-tenant secret storage
- [FORA-161 IdP Revoke Webhook](/FORA/issues/FORA-161) — HMAC-SHA256 per-tenant pattern (template)
- [FORA-204 sync-plane audit + risk register](/FORA/issues/FORA-204) — `metadata.sync.*` schema + invariants
- [FORA-210 daily audit sample](/FORA/issues/FORA-210) — daily verification path
- [FORA-253 canonical comment envelope](/FORA/issues/FORA-253) — author attribution + per-platform rendering
- [FORA-258 service-account scope allow-list](/FORA/issues/FORA-258) — primary control for R-SYNC-07-revised; sibling ticket
- [FORA-168 approvals pg adapter](/FORA/issues/FORA-168) — property test pattern
- [FORA-485 connector-config](/FORA/issues/FORA-485) — per-tenant RLS pattern
- [FORA-518 sync-plane-ratelimit v0.5.0](/FORA/issues/FORA-518) — weighted mode for per-tenant rate cap
- [FORA-484 connector-events](/FORA/issues/FORA-484) — event emission pattern
- [forge/sync-plane/risk_register.md](./risk_register.md) — 19 P0 controls (R-SYNC-01 + R-SYNC-07-revised primary)

---

**Change log**

| Rev | Date | Author | What |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 | Security Engineer (`231cc5ae`) | Initial draft. Package proposal `@fora/sync-plane-sanitize` v0.1.0; data model with 3 tables; 7-event schema family; 6 test files; coordination matrix; 4-phase rollout; 8 walkthrough questions. Sibling companion to [implementation-spec-FORA-258.md](./implementation-spec-FORA-258.md). |