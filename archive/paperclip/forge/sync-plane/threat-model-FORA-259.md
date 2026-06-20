# Threat Model — FORA-259 (11.10 — Markdown sanitization + remote-credential vault)

| Field | Value |
| --- | --- |
| **Status** | v0.1 — **DRAFT, pending Phase-2 threat-model walkthrough with CTO (after FORA-258 walkthrough)** |
| **Date** | 2026-06-20 |
| **Author** | Security Engineer (`231cc5ae-3235-482c-a791-d8ff3e217c8e`) |
| **Reviewer** | CTO (`f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0`) — threat-model walkthrough gate |
| **Issue** | [FORA-259](/FORA/issues/FORA-259) |
| **Parent** | [FORA-249 Epic 11 — Forge Integration Layer](/FORA/issues/FORA-249) sub-task #10 (Phase 2) |
| **Sibling** | [FORA-258](/FORA/issues/FORA-258) (R-SYNC-02; in_progress) |
| **Binding spec** | [ADR-0010 §8.2 R-SYNC-01 + R-SYNC-07-revised](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) |
| **Risk register** | [forge/sync-plane/risk_register.md](./risk_register.md) (FORA-204) — R-SYNC-01 + R-SYNC-07-revised primary |

---

## 0. Why this document exists

ADR-0010 §8.2 R-SYNC-01 (cross-platform comment injection) and R-SYNC-07-revised (ClickUp is no longer a black-box; per-tenant scope allow-list is the primary control from FORA-258) bind this sub-task. FORA-259 is the **defense-in-depth** for cross-platform Markdown payloads: even if a malicious Markdown body bypasses the scope allow-list (FORA-258), the sanitization pipeline (FORA-259) must render it as inert text on every destination platform.

Implementation is paused behind the Phase-2 threat-model walkthrough gate per Security Engineer AGENTS.md. This v0.1 spec pre-drafts the threat model so the walkthrough is ready the moment FORA-258 unblocks.

---

## 1. Asset model

| Asset | Sensitivity | Storage | Owner |
| --- | --- | --- | --- |
| **Inbound Markdown body** (Jira ADF, GitHub GFM, ClickUp-flavored) | Medium — customer-side content; may contain injection payloads | Forge Postgres `inbound_messages` table (per FORA-204 schema); per-tenant RLS | Security Engineer + Architect |
| **Sanitized intermediate representation** (after sanitization pipeline) | Low — already stripped | Postgres `sanitized_messages` table; per-tenant RLS | Security Engineer |
| **Rendered outbound payload** (ADF / GFM / ClickUp-flavored, ready to POST) | Low — already sanitized + rendered via vetted pipeline | Ephemeral in Sync Plane worker memory; not persisted | Sync Plane service |
| **Per-tenant OAuth tokens** for Jira / GitHub / ClickUp | High — full read+write on customer's issue tracker | `apps/customer-cloud-broker` vault (AWS Secrets Manager via FORA-128); never on Paperclip DB; never in `process.env` of agent runtime | Tenant admin (grants); broker (mints per-action short-lived) |
| **Per-tenant webhook secret** (for the new sanitization pipeline webhook — e.g., "rendering failed, please retry") | High — gates the outbound write-back surface | Broker `BrokerConfig.tenants[tenant].webhook_secret` (FORA-161 pattern) | Tenant admin (rotates); broker (validates HMAC) |
| **Per-tenant known-actor set** (for `@mention` sanitization) | Medium — controls who can be mentioned from a sanitized payload | `tenants/<tenant>/known_actors.yaml`; versioned + signed | Tenant admin (manages); Security Engineer (signs) |

---

## 2. STRIDE analysis

### 2.1 Spoofing

| Threat | L | I | Sev | Control |
| --- | --- | --- | --- | --- |
| Attacker spoofs a remote-platform webhook (e.g., a fake Jira comment-created event) to inject a sanitization-bypass payload | M | H | P0 | HMAC-SHA256 per-tenant webhook secret (FORA-161 pattern); 5-min timestamp window + nonce; 401 + `auth.login.failed reason: webhook_signature_mismatch` on mismatch |
| Attacker spoofs a remote-platform author identity to bypass `@mention` sanitization (e.g., mention a victim via forged actor) | M | H | P0 | `@mention` sanitization compares the canonical Paperclip author to the `known_actors` set per tenant; unknown actors are dropped; audit event `mention.sanitized.dropped` records the dropped mention |
| Attacker spoofs a tenant's broker credential to mint cross-tenant tokens | L | C | P0 | Tenant-scoped secret ARN in AWS Secrets Manager; broker `assume()` validates `tenant_id` match; cross-tenant references denied by default (R-SYNC-04 control); CI lint walks every credential call site |

### 2.2 Tampering

| Threat | L | I | Sev | Control |
| --- | --- | --- | --- | --- |
| Attacker tampers with the sanitized intermediate representation in `sanitized_messages` | L | C | P0 | Per-tenant RLS on the table; hash chain + Merkle root on every row (per FORA-36 audit wedge pattern); admin override requires dual-control; any historical edit emits `sanitization.event.amended` |
| Attacker tampers with the `known_actors` YAML to whitelist a malicious actor | L | H | P0 | YAML is git-versioned + signed (`signed_by: security-engineer-agent` tag); CI lint rejects any change without the tag; daily sample asserts every `known_actors` row has a valid manifest hash |
| Attacker tampers with the Markdown rendering pipeline (e.g., a malicious PR that introduces a third-party HTML passthrough) | M | C | P0 | CI lint rule rejects any `dangerouslySetInnerHTML` on rendered content; per-ADR-0010 §6 + R-SYNC-01; property test fuzzer seeds 10k Markdown inputs and asserts no `<script>`, `<iframe>`, `javascript:`, or platform-specific macro survives; signed build artifacts (`signed_by: security-engineer-agent`) |

### 2.3 Repudiation

| Threat | L | I | Sev | Control |
| --- | --- | --- | --- | --- |
| Tenant admin claims they did not authorize a sanitization drop (e.g., a `@mention` was dropped but the admin says it should have been kept) | L | M | P2 | Every drop emits `mention.sanitized.dropped` audit event with the original payload + the reason; tenant-facing UI shows the sanitization history; per-ADR-0010 §6 attribution model |
| Security Engineer denies removing an actor from `known_actors` | L | M | P2 | YAML is git-versioned; every change has commit + author + `signed_by` tag |

### 2.4 Information disclosure

| Threat | L | I | Sev | Control |
| --- | --- | --- | --- | --- |
| Tenant-side secret leaked via sanitization error log (e.g., broker logs the secret in a stack trace) | L | H | P0 | Broker logs redaction guard (per `apps/customer-cloud-broker/src/audit.ts` pattern); `cloud.brokered` audit envelope never carries the secret; property test (memory-dump-scan pattern from FORA-126) verifies no AWS-shaped credential in process memory after a webhook verify + render |
| Sanitized intermediate representation leaks raw input that should have been stripped | M | M | P2 | The sanitized payload is per-tenant; cross-tenant read returns 403; daily sample (FORA-210) asserts every `sanitized_messages` row has the expected strip set applied |
| `@mention` expansion reveals a victim user's identity to a remote platform that the victim did not consent to | M | M | P2 | The sanitization drops mentions to actors not in the `known_actors` set; the rendered outbound payload never includes the un-sanitized `@mention`; the victim is never notified of the dropped mention (avoiding information leak) |

### 2.5 Denial of service

| Threat | L | I | Sev | Control |
| --- | --- | --- | --- | --- |
| Sanitization pipeline outage → inbound messages queued unbounded | L | M | P2 | Inbound messages are small + per-tenant; queue depth alarm at 10k; per-tenant rate cap (defense-in-depth on top of FORA-256 burst control + FORA-516/517/518 ratelimit) |
| Fuzzed Markdown input causes the sanitizer to OOM or hang (algorithmic complexity attack) | M | M | P2 | Sanitizer is bounded (no recursive Markdown expansion; max nesting depth = 10; max body size = 64 KB); property test fuzzer seeds 10k Markdown inputs + asserts completion < 100ms per body; Lint rule rejects unbounded regex backtracking patterns |
| **R-SYNC-03 (comment storm DoS)** — burst control missing per FORA-256 cancellation | M | C | P0 | **PARTIAL GAP**: FORA-256 (burst control, DAY-ONE P0 per ADR-0010 §7.1) is cancelled but per CTO modified Option A re-opens before Phase 2. **Absorbing in FORA-259**: per-tenant rate cap on the sanitization pipeline (default 60 messages/min/tenant), implemented via `@fora/sync-plane-ratelimit` v0.5.0 (FORA-518 weighted mode). Defense-in-depth even after FORA-256 ships. |

### 2.6 Elevation of privilege

| Threat | L | I | Sev | Control |
| --- | --- | --- | --- | --- |
| Attacker injects a Markdown payload that, when rendered on a platform with high-privilege rendering (e.g., Jira admin macro), escalates from "user" to "admin" on the customer side | M | C | P0 | Render via vetted Markdown→ADF/GFM/ClickUp-flavored pipeline; **no third-party HTML passthrough**; platform-specific macros are stripped on ingest (Jira `{...}` macros, GitHub `<!-- HTML -->`, ClickUp custom blocks); fuzzed property test seeds 10k known-privilege-escalation payloads + asserts all are dropped |
| Attacker uses the cross-tenant vault key to mint a token for a victim tenant | L | C | P0 | Tenant-scoped secret ARN + per-tenant webhook secret + per-tenant RLS on all sanitization state; broker `assume()` validates `tenant_id` match; cross-tenant references denied by default (R-SYNC-04 control) |
| Tenant admin grants the platform-side service-account a scope outside the allow-list (FORA-258 control), then the broker refuses to use it → admin is "locked out" and blames Forge | M | M | P2 | This is the **same threat** as FORA-258 §2.6 EoP T-2; FORA-258 v0.1 taxonomy §4.1 + the tenant-facing UI at install time show the allow-list + the "this scope will be denied" warning; support runbook for "admin added scope outside allow-list, now can't sync" |

---

## 3. DREAD ranking (top 5)

| ID | Threat | D | R | E | A | D | Total | Sev |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **T-1** | Cross-platform comment injection via Markdown bypass | 8 | 7 | 5 | 7 | 8 | **35** | P0 |
| **T-2** | Privilege escalation via platform-specific macro (Jira `{admin}`, GitHub HTML, ClickUp custom block) | 7 | 6 | 5 | 7 | 7 | **32** | P0 |
| **T-3** | Webhook replay / spoofing to inject sanitization-bypass payload | 6 | 7 | 5 | 6 | 7 | **31** | P0 |
| **T-4** | Cross-tenant credential leak via broker vault key reuse | 6 | 8 | 4 | 6 | 7 | **31** | P0 |
| **T-5** | Sanitization pipeline OOM via algorithmic-complexity Markdown (e.g., `((((((…` * 10000) | 5 | 5 | 7 | 5 | 4 | **26** | P1 |

---

## 4. Risk → Control mapping (R-SYNC-01 + R-SYNC-07-revised traceability)

| Risk register ID | Risk | FORA-259 control | Verified by |
| --- | --- | --- | --- |
| **R-SYNC-01** | Cross-platform comment injection (P0) | Vetted Markdown→ADF/GFM/ClickUp-flavored pipeline (no third-party HTML passthrough); strip `<script>`, raw HTML, platform-specific macros on ingest; sanitize `@mentions` to known actor set | Fuzzed property test (10k Markdown inputs) + smoke gate per FORA-117 pattern |
| **R-SYNC-07-revised** | ClickUp threat model now well-known (P1 → P0 with FORA-258 allow-list as primary) | Per-tenant scope allow-list enforced at OAuth install (FORA-258 primary control); FORA-259 sanitization is defense-in-depth on the rendered Markdown | Daily sample (FORA-210) + cross-platform comment-mirror sample (FORA-204 §7.2 #4) |
| **R-SYNC-04** | Cross-tenant data leak (P0) | Per-tenant webhook secrets + per-tenant broker vault key + CI lint for `metadata.sync.authored_for_tenant` namespace (FORA-258 pattern reused) | Mirror-divergence sample (FORA-204 §7.2 #4) |
| **R-X1** | Per-platform token storage (P0) | All per-tenant OAuth tokens live in `apps/customer-cloud-broker` vault (FORA-126); never on Paperclip DB; per-platform rotation policy via FORA-128 secrets-mcp | Daily sample credential-inventory check (FORA-210) |
| **R6.1** | Audit entry-shape drift (P0) | `sanitization.event.*` events use the canonical `metadata.sync.*` keys per FORA-204 §6; no top-level schema fields; `AUDIT_SCHEMA_VERSION` bumped on breaking change | CI lint on `emit.mirror_event` call sites |

---

## 5. Acceptance criteria traceability

| FORA-259 AC | Threat model section | Spec owner |
| --- | --- | --- |
| Markdown sanitization strips all R-SYNC-01 test cases | §2.6 EoP T-1 + §2.2 Tampering | Security Engineer (sanitization pipeline) |
| No third-party HTML passthrough in the render path | §2.2 Tampering (third bullet) | Security Engineer (CI lint + signed build) |
| Remote credentials live in the FORA-126 vault | §1 asset model (OAuth tokens) + §2.1 Spoofing T-3 | SeniorEngineer (broker wiring) + Security Engineer (review) |
| Cross-tenant references denied by default; per-tenant webhook secrets wired | §2.6 EoP T-2 + §2.1 Spoofing T-1 | Security Engineer (broker + webhook config) |
| Property test for sanitization; smoke test for vault integration | §4 R-SYNC-01 + §4 R-X1 | Security Engineer + QA |
| Threat model walkthrough with Security Engineer before Epic Phase 2 ships | (this document) | Security Engineer (owner) |

---

## 6. Open questions for the CTO walkthrough (sequenced after FORA-258)

1. **Sanitization rendering pipeline ownership**: Security Engineer writes the pipeline, or DocAgent (per the FORA-253 author envelope) writes it? My recommendation: Security Engineer owns the sanitization step; DocAgent owns the rendering (per-platform flavor). This split mirrors FORA-253 §5.
2. **`@mention` sanitization source of truth**: tenant config YAML only, or also Paperclip-side `agent:<id>` registry? My recommendation: both — `known_actors.yaml` is the tenant-visible allow-list; Paperclip `agent:<id>` registry is the system-of-record for `agent` actors.
3. **Fuzzed property test corpus size**: 10k Markdown inputs (my v0.1) or larger (100k) for production-grade coverage? My recommendation: 10k in CI, 100k in nightly load test.
4. **Max body size**: 64 KB (my v0.1) or per-tenant configurable? My recommendation: 64 KB hard cap + per-tenant override for tenants that need larger bodies (rare).
5. **Third-party HTML passthrough enforcement**: CI lint rule, or signed build artifacts, or both? My recommendation: both — CI lint catches the regression; signed build prevents tampered binaries.
6. **Cross-tenant vault key isolation granularity**: per-tenant AWS Secrets Manager ARN (my v0.1) or per-(tenant, platform) ARN? My recommendation: per-(tenant, platform) ARN for tighter blast-radius isolation; cost: ~3× the secret count.
7. **R-SYNC-07-revised primary control = FORA-258 allow-list**: confirm the dependency on FORA-258 ships before FORA-259 — or design FORA-259 to absorb the gap if FORA-258 slips? (Same modified Option A question as FORA-258 v0.2 §6 #1.)
8. **Walkthrough format**: combined walkthrough with FORA-258, or separate? My recommendation: combined — saves 30 min and the scope allow-list is the upstream surface.

---

## 7. Out of scope (deliberately, for v1)

- Reaction sync (Jira thumbs-up, GitHub eyes, ClickUp emoji) — explicitly local to the platform per ADR-0010 §11.
- Attachment sync (binary round-trips) — defer to follow-up ADR per ADR-0010 §11.
- Sanitization of inbound user content on Paperclip-side (e.g., comments on Paperclip issues) — that's an ADR-0008/Epic 1 concern, not FORA-259.
- Per-tenant custom sanitization rules (e.g., a tenant that wants to allow a specific macro) — defer to v2; v1 is global sanitization policy.

---

## 8. References

- [ADR-0010 §8.2 R-SYNC-01 + R-SYNC-07-revised](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) — binding spec
- [FORA-126 customer-cloud-broker v1](/FORA/issues/FORA-126) — vault + audit + deny-list pattern
- [FORA-128 secrets-mcp AWS SM adapter](/FORA/issues/FORA-128) — per-tenant secret storage
- [FORA-161 IdP Revoke Webhook](/FORA/issues/FORA-161) — HMAC-SHA256 per-tenant pattern (template)
- [FORA-204 sync-plane audit + risk register](/FORA/issues/FORA-204) — `metadata.sync.*` schema + invariants
- [FORA-210 daily audit sample](/FORA/issues/FORA-210) — daily verification path
- [FORA-253 canonical comment envelope](/FORA/issues/FORA-253) — author attribution + per-platform rendering
- [FORA-258 service-account scope allow-list](/FORA/issues/FORA-258) — primary control for R-SYNC-07-revised; sibling ticket
- [FORA-168 approvals pg adapter](/FORA/issues/FORA-168) — property test pattern
- [forge/sync-plane/risk_register.md](./risk_register.md) — 19 P0 controls (R-SYNC-01 + R-SYNC-07-revised primary)
- [forge/sync-plane/threat-model-FORA-258.md](./threat-model-FORA-258.md) — sibling threat model
- [forge/sync-plane/allowlist-taxonomy-FORA-258.md](./allowlist-taxonomy-FORA-258.md) — primary control for R-SYNC-07-revised

---

**Change log**

| Rev | Date | Author | What |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 | Security Engineer (`231cc5ae`) | Initial draft. STRIDE + DREAD for FORA-259 scope (R-SYNC-01 + R-SYNC-07-revised); 14 threats, 6 categories; DREAD top 5 with P0/P1; R-SYNC-01 + R-SYNC-07-revised control mapping; 8 walkthrough questions. Sibling companion to [threat-model-FORA-258.md](./threat-model-FORA-258.md). |