# Implementation Spec — FORA-258 (11.9 — Service-account scope allow-list + quarterly audit pipeline)

| Field | Value |
| --- | --- |
| **Status** | v0.2 — **fact-corrected after CTO disposition on FORA-572** (FORA-257 polling backstop is `done`, not cancelled; only FORA-256 burst control is cancelled). Pending Phase-2 threat-model walkthrough with CTO. |
| **Date** | 2026-06-20 (rev 17:15Z) |
| **Author** | Security Engineer (`231cc5ae-3235-482c-a791-d8ff3e217c8e`) |
| **Companion** | [threat-model-FORA-258.md](./threat-model-FORA-258.md) (the WHY) |
| **Issue** | [FORA-258](/FORA/issues/FORA-258) |
| **Parent** | [FORA-249 Epic 11](/FORA/issues/FORA-249) sub-task #9 (Phase 2) |

---

## 0. Relationship to the threat model

This doc is the **WHAT/HOW** companion to the [threat model](./threat-model-FORA-258.md) (the WHY). Every section in this implementation spec traces back to a control in §4 of the threat model. No design decisions are made here that aren't bound to a control.

**Status:** implementation paused behind the Phase-2 threat-model walkthrough gate per Security Engineer AGENTS.md.

---

## 1. Package proposal: `@fora/sync-plane-scope` v0.1.0

A new package alongside the existing `@fora/sync-plane-ratelimit` (FORA-516), `@fora/sync-plane-service` (FORA-252), `@fora/connector-events` (FORA-484). Follows the established `@fora/*` naming convention.

```
packages/sync-plane-scope/
  src/
    allowlist/
      loader.ts             # YAML loader + signed_by verification (R-SYNC-02 §2.2 T-2)
      taxonomy/
        jira.ts             # Jira scope taxonomy (read, write, admin, etc.)
        github.ts           # GitHub scope taxonomy (repo, admin:org, etc.)
        clickup.ts          # ClickUp scope taxonomy
        index.ts            # per-platform dispatcher
      matcher.ts            # deny-by-default; matching against allow-list
    audit/
      events.ts             # sync.scope_drift.detected factory + metadata.sync.* keys (R6.1)
      emitter.ts            # tenant_id-first-arg invariant (R6.3)
    broker/
      client.ts             # thin wrapper around apps/customer-cloud-broker (FORA-126)
      vault.ts              # per-tenant webhook secret storage (FORA-161 pattern)
    drift/
      job.ts                # quarterly cron + advisory lock + single-flight
      detector.ts           # diff granted vs allow-list; emit sync.scope_drift.detected
    reprovision/
      state.ts              # per-tenant service-account state machine
      workflow.ts           # de-provision on removed scope; schedule re-consent
    webhook/
      receiver.ts           # POST /sync/scope-changed (HMAC-SHA256 per-tenant)
      verify.ts             # X-IdP-Signature verification + 5min window + nonce
    types.ts                # shared types (Scope, AllowList, DriftEvent, etc.)
    config.ts               # env-driven config
    index.ts                # public exports
  test/
    sync-plane-scope.test.ts        # 5/5 smoke (FORA-117 pattern)
    allowlist-property.test.ts      # property test (FORA-168 pattern)
    drift-detector.test.ts          # unit
    webhook-verify.test.ts          # unit
    memory-dump-scan.test.ts        # property test: no secret in process memory
  docs/
    onboarding.md                   # tenant admin playbook (mirror FORA-126 onboarding.md)
    allowlist-taxonomy.md           # starting point for per-platform scopes
  package.json
  tsconfig.json
  vitest.config.ts
```

**No new top-level workspace deps.** Reuses: `@fora/sync-plane-ratelimit` (event rate limit), `@fora/connector-events` (event emission), `@fora/contracts` (event types), `apps/customer-cloud-broker` (vault), `@fora/session-tokens` (per-tenant request auth).

---

## 2. Data model

```sql
-- Migration 0007_sync_plane_scope.sql (proposed; coordinated with SeniorEngineer)
CREATE TABLE sync_scope_allowlist (
  tenant_id        TEXT NOT NULL,
  platform         TEXT NOT NULL CHECK (platform IN ('jira', 'github', 'clickup')),
  scope_name       TEXT NOT NULL,
  scope_tier       TEXT NOT NULL CHECK (scope_tier IN ('read', 'write', 'admin')),
  added_by         TEXT NOT NULL,           -- agent UUID or user UUID
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_by        TEXT NOT NULL,           -- must be 'security-engineer-agent' or 'architect-agent'
  manifest_hash    TEXT NOT NULL,           -- git tree hash of the YAML source
  PRIMARY KEY (tenant_id, platform, scope_name)
);

CREATE TABLE sync_service_account (
  tenant_id        TEXT NOT NULL,
  platform         TEXT NOT NULL,
  sa_external_id   TEXT NOT NULL,           -- paperclip:agent:<uuid> (per ADR-0010 §5)
  sa_display_name  TEXT NOT NULL,
  granted_scopes   JSONB NOT NULL,          -- snapshot from platform
  last_observed_at TIMESTAMPTZ NOT NULL,
  reprovision_state TEXT NOT NULL DEFAULT 'active' CHECK (reprovision_state IN
    ('active', 'consent_scheduled', 're_consenting', 'de_provisioning', 'de_provisioned')),
  PRIMARY KEY (tenant_id, platform, sa_external_id)
);

CREATE TABLE sync_scope_drift_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  platform         TEXT NOT NULL,
  sa_external_id   TEXT NOT NULL,
  drift_kind       TEXT NOT NULL CHECK (drift_kind IN
    ('added_scope', 'removed_scope', 'replaced_scope', 're_provisioned', 'out_of_band_change')),
  drift_detail     JSONB NOT NULL,
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  detected_by      TEXT NOT NULL,           -- 'quarterly_job' | 'webhook' | 'manual'
  paged_pagerduty  BOOLEAN NOT NULL DEFAULT false,
  resolved_at      TIMESTAMPTZ,
  resolved_by      TEXT
);
CREATE INDEX ON sync_scope_drift_audit (tenant_id, detected_at DESC);
CREATE INDEX ON sync_scope_drift_audit (resolved_at) WHERE resolved_at IS NULL;
```

**Per-tenant RLS** on all three tables (per FORA-485 pattern). Migration version bump coordinated with SeniorEngineer.

---

## 3. Event schema — `sync.scope_drift.detected`

Extends the canonical schema per [FORA-204 §6](../../sync-plane/risk_register.md) (no top-level fields, all sync-specific keys in `metadata.sync.*`). Followed by the support events emitted at adjacent lifecycle points.

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
  "tool": "scope.drift_detected",
  "inputDigest": "sha256:...",
  "outputDigest": "sha256:...",
  "costCents": 0,
  "promptTokens": 0,
  "completionTokens": 0,
  "wallMs": 412,
  "metadata": {
    "sync.target_platform": "jira",
    "sync.drift_kind": "added_scope",
    "sync.drift_scope": "admin:project",
    "sync.drift_scope_tier": "admin",
    "sync.sa_external_id": "paperclip:agent:security-engineer-agent",
    "sync.allowlist_manifest_hash": "git:sha256:abc...",
    "sync.detected_by": "quarterly_job",
    "sync.detected_at": "2026-06-20T17:00:00Z",
    "sync.paged_pagerduty": true,
    "sync.pagerduty_incident_key": "PD-INC-12345",
    "sync.idempotency_key": "sha256:acme-corp|jira|paperclip:agent:security-engineer-agent|added_scope|admin:project|2026Q2",
    "sync.mirror_chain_id": "chain_01J7Z3X4K2N9PQ8R5"
  }
}
```

**Companion events** (same envelope shape, different `tool` + `metadata.sync.*` keys):

| `tool` | Trigger | When |
| --- | --- | --- |
| `scope.drift_resolved` | Tenant admin re-consents or de-provisions | On workflow transition |
| `scope.allowlist_updated` | `signed_by` tag verified, manifest committed | On every allow-list change |
| `scope.out_of_band_change` | Webhook receiver detects platform-side grant change | On webhook (≤24h) |
| `scope.reprovision_scheduled` | Drift detected on removed-from-allow-list scope | Same heartbeat as `scope.drift_detected` |
| `scope.reprovision_completed` | Re-consent or de-provision lands | On terminal state |

---

## 4. Test strategy

| Test | Pattern | Coverage |
| --- | --- | --- |
| `sync-plane-scope.test.ts` | Smoke (FORA-117) | 5 acceptance bars: install-time deny, drift emit, PagerDuty on >0, 24h out-of-band, reprovision UX + audit row |
| `allowlist-property.test.ts` | Property (FORA-168) | Fuzzed YAML + signed_by invariants; 10k random allow-lists; deny-by-default holds for all |
| `drift-detector.test.ts` | Unit | Diff algorithm; quarterly cadence; advisory lock prevents overlap |
| `webhook-verify.test.ts` | Unit | HMAC-SHA256; 5min window; nonce; per-tenant secret |
| `memory-dump-scan.test.ts` | Property (FORA-126 pattern) | After a webhook verify + drift detect, no secret-shaped bytes in process memory |
| Daily sample integration (FORA-210) | Integration | `sync_scope_drift_audit` row + matching `AuditEvent` row within 1 min; verify all `metadata.sync.*` keys present |

**Smoke gate:** 5/5 green, typecheck clean, build clean, no secret in process memory.

---

## 5. Coordination matrix

| Agent | Role on FORA-258 |
| --- | --- |
| **SeniorEngineer** | Migration `0007_sync_plane_scope` design; per-tenant RLS; broker vault integration glue |
| **Architect** | Allow-list taxonomy review (per-platform scope names); cross-system security review per ADR-0010 |
| **DocAgent** | `onboarding.md` for tenant admin; `allowlist-taxonomy.md` as Markdown source of truth |
| **Designer** | Tenant-facing UI: allow-list snapshot at install time + drift alert banner + re-provisioning flow |
| **DevOps** | PagerDuty service + routing key provisioning; cron infrastructure for quarterly job |
| **KnowledgeSteward** | Promote R-SYNC-02 from "1 control" to "5 controls" in the risk register (per threat-model §6 #7) |
| **CTO** | Threat-model walkthrough sign-off; FORA-256 disposition decision (modified Option A: re-open + ship before Phase 2) — FORA-257 already shipped |
| **Security Engineer (me)** | Spec ownership; allow-list sign-off (the `signed_by` tag); drift detector + re-provisioning workflow; audit + PagerDuty wiring |

---

## 6. Rollout plan

1. **Pre-v0.1 — FORA-256 re-open + ship** (CTO recommendation per FORA-572): Board adjudication via re-issued `ask_user_questions` (reframed to FORA-256 only — FORA-257 already shipped). Once FORA-256 is `done`, FORA-258 v0.1 implementation begins.
2. **v0.1 (dogfood only — acme tenant)**: full implementation behind a `FORA_SYNC_PLANE_SCOPE_ENABLED=true` env var. Acme is the only tenant with the feature flag on. Smoke + property green; daily sample green for 7 consecutive days. CTO closes out v0.1 with `request_confirmation`.
3. **v0.2 (canary — 2 design-partner tenants)**: enable for two design-partner tenants; monitor drift-event rate, PagerDuty alert latency, reprovision workflow completion. Load test at 3× expected drift-event rate.
4. **v1.0 (GA)**: enable by default for all tenants; per-tenant opt-out flag preserved. CTO closes v1.0 with `request_confirmation`; ADR-0010 R-SYNC-02 control marked as fully implemented.

**Rollback:** per-tenant opt-out flag → drift detector skips that tenant. Audit + webhook still receive events for forensic purposes.

---

## 7. Open questions for the CTO walkthrough

These complement the threat-model spec's §6. Ask both at the same walkthrough.

1. **Allow-list taxonomy ownership**: Architect + Security Engineer jointly own the canonical per-platform scope list, or Security Engineer alone? My recommendation: jointly, with Security Engineer holding the `signed_by` gate.
2. **PagerDuty routing key scope**: per-tenant routing keys (more isolation) vs single Forge-on-call rotation (simpler ops)? Threat-model §6 #3.
3. **Audit retention**: 30d (R-SYNC-04 default) or 1y for compliance? Threat-model §6 #4.
4. **Tenant UI scope in v1**: read-only snapshot of allow-list, or also tenant-editable with `signed_by` re-tag? Threat-model §7 (out of scope: read-only v1).
5. **Sync.scope_drift.detected rate limit**: per-tenant cap (e.g., 100 events/min) to absorb the FORA-256 cancellation gap (re-open + ship per CTO, but FORA-256 is still not shipped as of 17:15Z). My recommendation: yes, wire into `@fora/sync-plane-ratelimit` v0.3+ (FORA-516) for free as a defense-in-depth control. Once FORA-256 ships, this becomes belt-and-suspenders.
6. **FORA-256 disposition** (CTO recommended modified Option A in FORA-572 close-out `255e2291-…`): re-open + ship before Phase 2. Awaiting CEO relay + Board adjudication on re-issued `ask_user_questions` (reframed to FORA-256 only — FORA-257 already shipped).
7. ~~**FORA-257 disposition**~~ — **RESOLVED 2026-06-20T16:54Z**: FORA-257 is `done`. No action.
8. **Walkthrough format**: 45-min live, or async review of both specs (`threat-model-FORA-258.md` + this doc) with comments?

---

## 8. References

- [threat-model-FORA-258.md](./threat-model-FORA-258.md) — companion WHY doc
- [ADR-0010 §8.2 R-SYNC-02](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) — binding spec
- [FORA-126 customer-cloud-broker v1](/FORA/issues/FORA-126) — vault + audit pattern
- [FORA-128 secrets-mcp AWS SM adapter](/FORA/issues/FORA-128) — per-tenant secret storage
- [FORA-161 IdP Revoke Webhook](/FORA/issues/FORA-161) — HMAC-SHA256 per-tenant pattern (template)
- [FORA-204 sync-plane audit + risk register](/FORA/issues/FORA-204) — `metadata.sync.*` schema + invariants
- [FORA-210 daily audit sample](/FORA/issues/FORA-210) — daily verification path
- [FORA-256 burst control (cancelled 2026-06-19T21:04Z; CTO recommends re-open per modified Option A)](/FORA/issues/FORA-256) — primary control for R-SYNC-03, **not shipped**. See §6 #1 + §7 #6.
- [FORA-257 polling backstop (done 2026-06-20T16:54:30Z)](/FORA/issues/FORA-257) — primary control for R-SYNC-04, R-SYNC-05, FORA-258 AC #3. **Shipped.**
- [FORA-117 DocIndex pattern](/FORA/issues/FORA-117) — smoke test pattern
- [FORA-168 approvals pg adapter](/FORA/issues/FORA-168) — property test pattern
- [FORA-485 connector-config](/FORA/issues/FORA-485) — per-tenant RLS pattern
- [FORA-516 sync-plane-ratelimit](/FORA/issues/FORA-516) — three-layer limiter; reuse for drift-event rate cap
- [FORA-484 connector-events](/FORA/issues/FORA-484) — event emission pattern
- [forge/sync-plane/risk_register.md](./risk_register.md) — 19 P0 controls

---

**Change log**

| Rev | Date | Author | What |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 | Security Engineer (`231cc5ae`) | Initial draft. Package proposal `@fora/sync-plane-scope` v0.1.0; data model with 3 tables; 6-event schema family; 6 test files; coordination matrix; 3-phase rollout; 7 walkthrough questions. |
| v0.2 | 2026-06-20T17:15Z | Security Engineer (`231cc5ae`) | **Fact correction** (per CTO disposition on FORA-572 close-out `255e2291-…`): FORA-257 polling backstop is `done`, not cancelled. Removed §7 #7 (FORA-257 disposition question). Updated §7 #5 (rate-limit now defense-in-depth, not absorbing FORA-256 cancellation). Updated §7 #6 to reflect CTO's modified Option A recommendation. §6 rollout gained a pre-v0.1 step (FORA-256 re-open + ship). §8 references added. **No FORA-258 control changes** — the spec already accommodates FORA-257 as shipped. |