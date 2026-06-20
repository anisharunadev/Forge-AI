# Threat Model — FORA-258 (11.9 — Service-account scope allow-list + quarterly audit pipeline)

| Field | Value |
| --- | --- |
| **Status** | v0.2 — **fact-corrected after CTO disposition on FORA-572** (FORA-257 polling backstop is `done`, not cancelled; only FORA-256 burst control is cancelled). Pending Phase-2 threat-model walkthrough with CTO. |
| **Date** | 2026-06-20 (rev 17:15Z) |
| **Author** | Security Engineer (`231cc5ae-3235-482c-a791-d8ff3e217c8e`) |
| **Reviewer** | CTO (`f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0`) — threat-model walkthrough gate |
| **Issue** | [FORA-258](/FORA/issues/FORA-258) |
| **Parent** | [FORA-249 Epic 11 — Forge Integration Layer](/FORA/issues/FORA-249) sub-task #9 (Phase 2) |
| **Binding spec** | [ADR-0010 §8.2 R-SYNC-02](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) |
| **Risk register** | [forge/sync-plane/risk_register.md](./risk_register.md) (FORA-204) — primary control for R-SYNC-02 |

---

## 0. Why this document exists

ADR-0010 §8.2 R-SYNC-02 names the P0 control for service-account token sprawl: per-platform install-time OAuth with explicit scope list; deny scopes outside the Sync Plane allow-list (FORA-125 IAM policy DSL); quarterly scope audit. FORA-258 is the implementation. Before any code lands, this document enumerates the threats, the candidate controls, the residual risk, and the open questions for the CTO walkthrough.

Implementation remains paused until this spec is signed off (per Security Engineer AGENTS.md "threat-model walkthrough is a hard gate before code lands"). Reading + planning is unblocked.

---

## 1. Asset model

| Asset | Sensitivity | Storage | Owner |
| --- | --- | --- | --- |
| **Per-tenant service-account OAuth tokens** (Jira / GitHub / ClickUp) | High — full read+write on customer's issue tracker | `apps/customer-cloud-broker` vault (AWS Secrets Manager via FORA-128 secrets-mcp); never on Paperclip DB; never in `process.env` of agent runtime | Tenant admin (grants); broker (mints per-action short-lived) |
| **Per-platform scope allow-list** (the Sync Plane policy) | Medium — controls what can be granted | `tenants/<tenant>/sync_scope_allowlist.yaml`; versioned; deny-by-default | Security Engineer + Architect |
| **Audit event `sync.scope_drift.detected`** | High — drives PagerDuty + customer alert | Forge Postgres `audit_events` table (FORA-36 forwarder) | Security + audit team |
| **Per-tenant webhook secret** (for platform-side "scope changed" notifications) | High — gates the out-of-band detection signal | Broker `BrokerConfig.tenants[tenant].webhook_secret` (mirrors FORA-161 pattern) | Tenant admin (rotates); broker (validates HMAC) |
| **Re-provisioning workflow state** (consent scheduled / de-provisioned / etc.) | Medium — drives tenant-visible UX | `tenants/<tenant>/service_accounts.<sa>.reprovision_state` | Security + tenant admin |

---

## 2. STRIDE analysis

### 2.1 Spoofing

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| Attacker presents a fake `sync.scope_drift.detected` audit event to trigger spurious PagerDuty alerts (DoS on the on-call rotation) | M | M | P2 | Audit-event writer takes `tenant_id` as first arg + refuses `metadata.sync.*` events whose `authored_for_tenant` doesn't match (per FORA-204 R6.3 invariant). Daily sample (FORA-210) verifies schema completeness; any missing-key row is P0; any forged-authored event is P0 |
| Attacker replays a captured `POST /auth/idp-revoke` webhook (or new scope-changed webhook) from another tenant to revoke a victim's service account | M | H | P0 | HMAC-SHA256 per-tenant webhook secret (FORA-161 pattern); 401 + audit `auth.login.failed` `reason: webhook_signature_mismatch` on mismatch; timestamp window (5 min) + nonce to prevent replay; tenant-scoped secret rotation via `BrokerConfig.tenants` |
| Attacker spoofs a service-account identity in the broker vault to mint tokens for a different tenant | L | C | P0 | Tenant-scoped secret ARN; broker `assume()` validates `tenant_id` match; cross-tenant references denied by default (R-SYNC-04 control); CI lint walks every `emit.mirror_event` call site for the per-tenant namespace invariant |

### 2.2 Tampering

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| Attacker modifies the scope allow-list YAML to add a broad scope (e.g., `*:admin`) | L | H | P0 | Allow-list YAML is versioned + signed (git tree hash + signed manifest); deny-by-default means a missing scope is denied, not an extra scope allowed; lint rule rejects any allow-list change without an explicit `signed_by: security-engineer-agent` tag; quarterly audit (the very pipeline being designed) emits `sync.scope_drift.detected` for any platform-side grant that exceeds the signed allow-list |
| Attacker modifies a recorded audit event to hide a scope-drift incident | L | C | P0 | Append-only audit wedge (FORA-36); hash chain + Merkle root; admin override requires dual-control; any historical edit emits `audit.event.amended` |
| Attacker manipulates the tenant-side OAuth client_secret to extend the scope grant offline | L | H | P0 | Tenant onboarding step verifies the client_secret is stored only in AWS Secrets Manager via `mcp-servers/secrets/` (FORA-128); broker `assume()` re-verifies on every mint; quarterly audit cross-checks the customer-side grant list against the broker's last-issued scope |

### 2.3 Repudiation

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| Tenant admin claims they did not grant a scope that the broker minted | L | M | P2 | Every `cloud.brokered` audit event records the OAuth consent timestamp + scope snapshot; tenant-facing UI displays the grant history; consent record signed by tenant admin at install time |
| Security Engineer denies editing the scope allow-list | L | M | P2 | Allow-list is git-versioned; every change has a commit hash + author + reviewer; `signed_by` tag enforced by CI lint |

### 2.4 Information disclosure

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| `sync.scope_drift.detected` audit event leaks the granted scope list (which is itself sensitive) | M | M | P2 | Audit detail payload contains scope names but not secrets; daily sample (FORA-210) is tenant-scoped; cross-tenant aggregation lives only in `agents/audit/reader.py` and is read-only; no customer-side reader can see another tenant's drift events |
| Per-tenant webhook secret leaked via error log | L | H | P0 | Broker logs redaction guard (per `apps/customer-cloud-broker/src/audit.ts` pattern); `cloud.brokered` audit envelope never carries the secret; property test (memory-dump-scan pattern from FORA-126) verifies no AWS-shaped credential in process memory after a webhook verify |

### 2.5 Denial of service

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| Audit pipeline outage → drift events queued unbounded | L | M | P2 | Drift events are small + append-only; queue depth alarm at 10k; idempotency-key on every event prevents duplicate PagerDuty alerts |
| Quarterly audit job takes longer than the 24h schedule window → next run starts before previous completes | M | M | P2 | Cron uses advisory lock + single-flight semaphore; overlap is logged `audit.drift_job.overlap` and skipped; quarterly cadence is configurable per tenant |
| **R-SYNC-03 (comment storm DoS) — burst control missing** | M | C | P0 | **GAP**: FORA-256 (burst control, DAY-ONE P0 per ADR-0010 §7.1) is `cancelled`, not shipped. Without it, a misconfigured tenant could trigger `sync.platform.degraded` events that themselves amplify via the audit forwarder. **Ask CTO**: ship FORA-256 before FORA-258, or document residual risk and absorb into FORA-258 (spec a Phase-2 rate limit on `sync.scope_drift.detected` events per tenant) |

### 2.6 Elevation of privilege

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| Attacker uses a granted scope to escalate on the customer side (e.g., Jira `admin:*` → tenant takeover) | L | C | P0 | Allow-list deny-by-default + per-platform scope taxonomy documented; quarterly audit catches grants that exceed the allow-list; customer-side IAM tier (e.g., GitHub `repo` vs `admin:org`) is enforced by the platform, not by us, but we audit |
| Tenant admin grants the platform-side service-account a scope outside the allow-list, then the broker refuses to use it → admin is "locked out" and blames Forge | M | M | P2 | Tenant-facing UI at install time shows the allow-list + the "this scope will be denied" warning; support runbook for "admin added scope outside allow-list, now can't sync" |
| **Out-of-band scope change not detected within 24h** (FORA-258 AC #3) | M | H | P1 (was P0) | **CONTROL SHIPPED**: FORA-257 polling backstop + daily divergence job are `done` (2026-06-20T16:54:30Z). The polling backstop catches GitHub's 24h redelivery window and admin-disabled webhooks; the daily job (§7.2 #4) catches missed events over 24h. **Residual**: webhook-only is the first signal, polling is the backstop; both are needed. The FORA-258 webhook receiver still ships as the primary signal, with FORA-257 polling as the safety net. |

---

## 3. DREAD ranking (top 5)

| ID | Threat | D | R | E | A | D | Total | Sev |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **T-1** | Spoofed webhook triggers false service-account revocation (cross-tenant) | 6 | 8 | 5 | 7 | 8 | **34** | P0 |
| **T-2** | Tampered allow-list YAML adds broad scope | 5 | 7 | 4 | 7 | 9 | **32** | P0 |
| **T-3** | Out-of-band scope change undetected for >24h | 7 | 5 | 4 | 5 | 5 | **26** | P1 (was P0; v0.2 lowered — FORA-257 polling + daily job shipped, primary control in place) |
| **T-4** | Burst control missing → comment storm amplifies to audit pipeline | 7 | 7 | 6 | 7 | 5 | **32** | P0 |
| **T-5** | Forged audit event triggers spurious PagerDuty (on-call rotation DoS) | 5 | 6 | 6 | 6 | 5 | **28** | P1 |

---

## 4. Risk → Control mapping (R-SYNC-02 traceability)

| Risk register ID | Risk | FORA-258 control | Verified by |
| --- | --- | --- | --- |
| **R-SYNC-02** | Service-account token sprawl (P0) | Per-platform install-time OAuth + deny-by-default allow-list + quarterly scope audit + `sync.scope_drift.detected` event + PagerDuty alert on >0 drifts + re-provisioning workflow | Daily sample (FORA-210) + 5/5 smoke per FORA-117 pattern + property test per FORA-168 pattern |
| **R-SYNC-04** | Cross-tenant data leak (P0) | Per-tenant webhook secrets + per-tenant broker vault key + CI lint for `metadata.sync.authored_for_tenant` namespace | Mirror-divergence sample (FORA-204 §7.2 #4) |
| **R-X1** | Per-platform token storage (P0) | All service-account tokens live in `apps/customer-cloud-broker` vault (FORA-126) — never on Paperclip DB; per-platform rotation policy via FORA-128 secrets-mcp | Daily sample credential-inventory check (FORA-210) |
| **R-X2** | Audit completeness across platforms (P0) | Daily audit sample verifies every mirror event references a credential that is in the inventory and within rotation window | Daily sample (FORA-210) |
| **R6.1** | Audit entry-shape drift (P0) | `sync.scope_drift.detected` event uses the canonical `metadata.sync.*` keys per FORA-204 §6 — no top-level schema fields; `AUDIT_SCHEMA_VERSION` bumped if breaking change | CI lint on `emit.mirror_event` call sites |

---

## 5. Acceptance criteria traceability

| FORA-258 AC | Threat model section | Spec owner |
| --- | --- | --- |
| Allow-list enforced at OAuth install time; deny-by-default | §2.2 T-2 (Tampering), §2.6 (EoP) | Security Engineer + Architect (allow-list taxonomy) |
| Quarterly audit job runs; `sync.scope_drift.detected` emitted; PagerDuty on >0 drifts | §4 R-SYNC-02 | Security Engineer + DevOps (PagerDuty wiring) |
| Out-of-band scope change detected within 24h | §2.6 (EoP), §3 T-3 | Security Engineer — **depends on FORA-257 disposition** |
| Re-provisioning workflow has tenant-visible UI + audit row per change | §1 asset model (reprovision_state), §2.3 (Repudiation) | Security Engineer + Designer |
| Smoke + property test per FORA-117 + FORA-168 patterns | §4 (every control) | Security Engineer + QA |

---

## 6. Open questions for CTO walkthrough

1. **FORA-256 disposition** (CTO already recommended modified Option A in FORA-572 close-out comment `255e2291-…`): re-open FORA-256 + ship before FORA-258. Work product on disk (5/6 ACs green, 20 unit + e2e smoke clean from 2026-06-17); re-open is a re-PATCH + close-out review-gate, not from-scratch. Board `ask_user_questions` `b465b8d8-…` needs re-issue reframed to FORA-256 only (FORA-257 is already shipped). **Awaiting CEO relay + Board adjudication.**
2. ~~**FORA-257 disposition**~~ — **RESOLVED 2026-06-20T16:54Z**: FORA-257 polling backstop + daily divergence job are `done` (Architect `c4654678`, v0.1 close-out comment `dba48956`). Primary control for R-SYNC-04 + R-SYNC-05 + FORA-258 AC #3. No action.
3. **PagerDuty routing key scope**: per-tenant routing keys (more isolation, more ops) vs single Forge-on-call rotation (less isolation, simpler)?
4. **Audit retention**: keep `sync.scope_drift.detected` events for 30d (match R-SYNC-04 default) or extend to 1y for compliance posture?
5. **Re-provisioning UX**: in-app banner + email digest, or PagerDuty-only for the security team?
6. **Threat-model walkthrough format**: 45-min live walkthrough (interaction `a2626fba-…`), or async review of this document with comments?
7. **Risk register update**: should R-SYNC-02 controls be promoted from "primary control: quarterly scope audit" to "primary controls: allow-list + audit + drift detection + re-provisioning"? (3 controls, not 1).

---

## 7. Out of scope (deliberately, for v1)

- Statistical sampling on the audit (n=all, not n=10) — the FORA-258 audit is small enough that exhaustive checks are cheap.
- Cross-tenant aggregation of drift events — single-tenant only in v1.
- Customer-side UI for allow-list editing — read-only in v1 (admin sees the snapshot but can't edit; Security Engineer + Architect own the canonical allow-list).
- Real-time drift detection (sub-minute) — quarterly cadence per ADR-0010 §8.2; out-of-band detection is webhook-driven, not stream-driven.

---

## 8. References

- [ADR-0010 §8.2 R-SYNC-02](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) — binding spec
- [FORA-126 customer-cloud-broker v1](/FORA/issues/FORA-126) — vault + audit + deny-list pattern
- [FORA-128 secrets-mcp AWS SM adapter](/FORA/issues/FORA-128) — per-tenant secret storage
- [FORA-161 IdP Revoke Webhook](/FORA/issues/FORA-161) — HMAC-SHA256 per-tenant webhook secret pattern (template for the new scope-changed webhook)
- [FORA-204 sync-plane audit + risk register](/FORA/issues/FORA-204) — `metadata.sync.*` schema + per-tenant namespace invariant
- [FORA-210 daily audit sample](/FORA/issues/FORA-210) — daily verification path for the controls in §4
- [FORA-256 burst control (cancelled 2026-06-19T21:04Z; CTO recommends re-open per modified Option A)](/FORA/issues/FORA-256) — primary control for R-SYNC-03, **not shipped**. See §6 #1.
- [FORA-257 polling backstop (done 2026-06-20T16:54:30Z)](/FORA/issues/FORA-257) — primary control for R-SYNC-04, R-SYNC-05, FORA-258 AC #3. **Shipped.**
- [FORA-117 DocIndex pattern](/FORA/issues/FORA-117) — smoke test pattern reference
- [FORA-168 approvals pg adapter](/FORA/issues/FORA-168) — property test pattern reference
- [forge/sync-plane/risk_register.md](./risk_register.md) — 19 P0 controls (R-SYNC-02 primary)

---

**Change log**

| Rev | Date | Author | What |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 | Security Engineer (`231cc5ae`) | Initial draft. STRIDE + DREAD for FORA-258 scope; R-SYNC-02 traceability; 7 open questions for CTO walkthrough; FORA-256/257 cancellation gaps flagged as blockers. |
| v0.2 | 2026-06-20T17:15Z | Security Engineer (`231cc5ae`) | **Fact correction** (per CTO disposition on FORA-572 close-out `255e2291-…`): FORA-257 polling backstop is `done` (2026-06-20T16:54:30Z), not cancelled. T-3 DREAD downgraded from 34/P0 to 26/P1. §2.6 EoP T-3 control description updated (FORA-257 polling + daily job shipped; webhook remains primary signal). §6 #2 (FORA-257 disposition) marked resolved. §6 #1 (FORA-256) updated to reflect CTO's modified Option A recommendation. §8 references updated. **No FORA-258 control changes** — the spec already accommodates FORA-257 as the primary control for FORA-258 AC #3. |