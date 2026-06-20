# Threat Model Addendum — FORA-589 (11.9.6 — Re-provisioning workflow + tenant-facing UI)

| Field | Value |
| --- | --- |
| **Status** | v0.1 — initial addendum; **pending CTO walkthrough + FORA-256 ship + Designer hire** |
| **Date** | 2026-06-20 |
| **Author** | Security Engineer (`231cc5ae-3235-482c-a791-d8ff3e217c8e`) |
| **Companion to** | [threat-model-FORA-258.md](./threat-model-FORA-258.md) (parent Phase-2 threat model) |
| **Companion to** | [implementation-spec-FORA-258.md §1 `reprovision/`](./implementation-spec-FORA-258.md) (the WHAT/HOW) |
| **Issue** | [FORA-589](/FORA/issues/FORA-589) |
| **Parent** | [FORA-258](/FORA/issues/FORA-258) sub-task #6 |
| **Risk register** | [forge/sync-plane/risk_register.md](./risk_register.md) — entries **R-SYNC-02a** … **R-SYNC-02f** (added by this addendum) |
| **Binding spec** | ADR-0010 §8.2 R-SYNC-02; companion to FORA-258 AC #5 |

---

## 0. Why this addendum exists

The parent [threat-model-FORA-258.md](./threat-model-FORA-258.md) names the re-provisioning workflow as an asset (Medium sensitivity — drives tenant-visible UX) and lists `scope.reprovision_scheduled` + `scope.reprovision_completed` companion events (§3 of the parent doc). What the parent threat model does **not** enumerate is the threat surface introduced by:

1. The **state machine itself** — `active → consent_scheduled → re_consenting → active` OR `active → de_provisioning → de_provisioned$`. Each transition is an opportunity for replay, race, or transition ambiguity.
2. The **tenant-facing UI** — in-app banner + email digest. These are external-to-Paperclip rendered surfaces that carry a per-tenant identity, a consent-grant payload, and a de-provision rationale. Without a focused model, R-X6 (no prompt-injection regression set for mirror payloads) and R3.2 (XSS via mirror Markdown) get reused without checking whether the re-consent flow opens a new injection vector.
3. The **per-tenant opt-out flag** — a defensive control that, if abused or misconfigured, turns drift detection into a silent credential-sprawl channel.

This addendum complements the parent threat model; it does **not** duplicate §2 STRIDE entries. It introduces **6 new risks (R-SYNC-02a…f)** and ties each to a control that must land before FORA-589 v0.1 ships.

**Status:** implementation paused. This addendum is the input to the CTO walkthrough (combined with the parent spec, per interaction `a2626fba-c597-410e-8fad-f80ec6a92d08`).

---

## 1. Asset model — additions to §1 of the parent

| Asset | Sensitivity | Storage | Owner | New? |
| --- | --- | --- | --- | --- |
| **Re-provisioning state per (tenant, platform, sa_external_id)** | Medium — drives tenant-visible UX + audit chain | `sync_service_account.reprovision_state` (impl spec §2) | Security + tenant admin | yes |
| **Consent grant receipt** (the signed `consent_token` returned by the platform's OAuth flow on re-consent) | High — gates re-provisioned state | `apps/customer-cloud-broker` vault (FORA-126); never on Paperclip DB; never in `process.env` | Tenant admin (grants); broker (validates HMAC + freshness) | yes |
| **Tenant-facing banner HTML payload** (the rendered drift alert + re-consent CTA) | Medium — renders in customer app; XSS surface | Generated server-side from canonical drift event; Markdown → safe HTML (R3.2 control) | DocAgent (renderer); Security (review) | yes |
| **Email digest subscription** (per-tenant email of pending re-consents) | Medium — supplies the out-of-band notification | Tenant-configured address; bounce → opt-out | Tenant admin | yes |
| **Per-tenant opt-out flag** (skip the re-consent UI entirely) | Medium — single-switch bypass | `sync_scope_allowlist` extension (proposed: `reprovision_opt_out: bool`); per-tenant RLS | Tenant admin (toggle); Security (default-off) | yes |

---

## 2. STRIDE — additions to §2 of the parent

### 2.1 Spoofing

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| **R-SYNC-02a** — Attacker replays a previous `consent_token` against the broker to skip re-consent on a removed-from-allow-list scope | M | H | **P0** | The broker treats every `consent_token` as single-use + freshness-bounded (`≤ 10 min` between OAuth flow start and broker `assume()` call). Replay → 401 + audit `auth.login.failed reason:consent_token_replay`. Tenant-scoped `consent_token_id` (UUID) + broker-side single-use ledger (FORA-126 vault). Property test (memory-dump-scan pattern from FORA-126) verifies no `consent_token` byte shape in process memory after `assume()` returns. |

### 2.3 Repudiation (deepens parent §2.3)

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| **R-SYNC-02b** — Tenant admin denies granting re-consent for a scope the audit trail shows they granted | L | M | P2 (carries from parent) | Every `re_consenting → active` transition records (a) the OAuth consent timestamp from the platform, (b) the scope snapshot at consent time, (c) a `consent_token_id` that resolves to the broker's signed receipt. Tenant-facing UI displays the grant history at the consent-grant moment; consent record signed by tenant admin at install time (per parent §2.3 R-SYNC-02 row 1). |
| **R-SYNC-02c** — Security Engineer denies scheduling re-consent (state machine driven by drift detector, not by human) | L | M | P2 (carries from parent) | Drift detector's transition decision is recorded in `sync_scope_drift_audit` with the input digest (the drift event), the policy version (git hash of the allow-list YAML), and the decision rule (which entry in the drift table triggered the transition). Audit chain is append-only (FORA-36). |

### 2.4 Information disclosure

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| **R-SYNC-02d** — Email digest leaks the granted scope list (which is itself sensitive) to a forwarding tenant-internal address | M | M | P2 | Email digest body carries scope *names* (e.g., `repo`, `admin:org`) — never the OAuth `client_secret`, never the broker-vault ARN. Digest subject is opaque (`Forge re-consent needed`); the body links to the in-app banner for full detail. DKIM + DMARC `reject` on the sending domain; bounce handling auto-disables the digest for that tenant (does **not** opt them out of re-consent — only out of the email channel). |

### 2.5 Denial of service

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| **R-SYNC-02e** — Drift detector triggers `de_provisioning` while the broker cannot reach the platform (AWS regional outage, GCP IAM propagation lag); partial state (audit says de-provisioned, platform still has the token) | M | H | **P0** | The `de_provisioning → de_provisioned` transition is **broker-confirmed** — the state machine waits for a broker `de_provision_ok` response. On broker timeout: state machine emits `audit.reprovision_stalled` (a new event) and re-tries with exponential backoff (max 5 attempts over 24 h). After 24 h: PagerDuty alert (per FORA-258 AC #2 wiring) + manual runbook (`agents/runbooks/reprovision_stalled.md`, written by Security Engineer). The audit row records the broker's last error; daily sample (FORA-210) verifies no (tenant, sa) sits in `de_provisioning` for > 24 h. |

### 2.6 Elevation of privilege

| Threat | Likelihood | Impact | Severity | Control |
| --- | --- | --- | --- | --- |
| **R-SYNC-02f** — Tenant admin sets `reprovision_opt_out = true` to suppress drift detection entirely → silent credential sprawl resumes | M | C | **P0** | The opt-out flag **suppresses the re-consent UI, not the drift detector**. Drift events still emit; PagerDuty still pages; the audit row still records `opted_out: true`. Tenant admin must explicitly ack each drift in the Forge console (read-only acknowledgement — not a re-grant). Annual tenant-facing reminder; per-tenant opt-in revocation by Security Engineer on `> 90d` of unreviewed opt-out drift (runbook). |

---

## 3. New event payloads (extends parent §3)

Two new `tool` values on the canonical `metadata.sync.*` envelope. Both reuse the parent's emitter (`@fora/sync-plane-scope/src/audit/emitter.ts`) — no schema bump needed.

```jsonc
// Event: reprovision_scheduled
{
  "tool": "scope.reprovision_scheduled",
  "metadata": {
    "sync.target_platform": "jira",
    "sync.sa_external_id": "paperclip:agent:security-engineer-agent",
    "sync.reprovision_from_state": "active",
    "sync.reprovision_to_state": "consent_scheduled",  // or "de_provisioning"
    "sync.reprovision_trigger_drift_id": "<uuid>",     // refs sync_scope_drift_audit.id
    "sync.reprovision_consent_token_id": null,         // set only after re_consenting
    "sync.reprovision_opted_out": false,
    "sync.tenant_opt_out_present": false
  }
}

// Event: reprovision_completed
{
  "tool": "scope.reprovision_completed",
  "metadata": {
    "sync.target_platform": "jira",
    "sync.sa_external_id": "paperclip:agent:security-engineer-agent",
    "sync.reprovision_from_state": "re_consenting",  // or "de_provisioning"
    "sync.reprovision_to_state": "active",           // or "de_provisioned"
    "sync.reprovision_consent_token_id": "<uuid>",   // set only on re_consenting path
    "sync.reprovision_duration_ms": 12480,
    "sync.reprovision_broker_confirmed": true        // false → PagerDuty
  }
}
```

---

## 4. State machine — diagram + transition table

```
                        drift on removed scope
       active ─────────────────────────────────┐
         │                                    ▼
         │ (no drift)              consent_scheduled
         │                                    │
         ▼                                    │ tenant grants consent
   (steady state)                             ▼
                                       re_consenting
                                              │
                                ┌─────────────┴─────────────┐
                                ▼                           ▼
                              active                  de_provisioning
                            (re-consent                   │
                             landed +                     │ broker confirms
                             broker ack)                  ▼
                                                  de_provisioned$  (terminal)
```

| From | To | Trigger | Audit event | Atomicity invariant |
| --- | --- | --- | --- | --- |
| `active` | `consent_scheduled` | drift detector: removed-from-allow-list scope | `scope.reprovision_scheduled` | drift audit row + state row in same DB transaction |
| `consent_scheduled` | `re_consenting` | tenant clicks "re-consent" CTA in-app banner | `scope.reprovision_scheduled` (transition log) | OAuth flow start + state row in same tenant-scoped request |
| `re_consenting` | `active` | broker `assume()` returns valid token on the new (still allowed) scope set | `scope.reprovision_completed` | broker ack + state row in same DB transaction; `consent_token_id` captured |
| `re_consenting` | `de_provisioning` | tenant explicitly chooses to de-provision instead OR `consent_token` validation fails after retries | `scope.reprovision_completed` (with `consent_token_id = null`) | explicit choice recorded; re-consent UI marks the consent as `declined` |
| `active` | `de_provisioning` | drift detector: scope is *removed-from-platform* (not just removed-from-allow-list) | `scope.reprovision_scheduled` | broker `de_provision_init` call records the start time |
| `de_provisioning` | `de_provisioned$` | broker `de_provision_ok` | `scope.reprovision_completed` | broker ack + state row + drift audit row `resolved_at` in same transaction |
| any | (timeout) | `consent_scheduled` > 30d → auto-transition to `de_provisioning` | `scope.reprovision_scheduled` (with `reason: consent_timeout`) | timeout recorded; PagerDuty only fires if the auto-transition also stalls (R-SYNC-02e) |

**Atomicity invariant:** every transition is a single DB transaction covering `sync_service_account.reprovision_state` + the matching `sync_scope_drift_audit` row + the audit event emission. A failed audit emission fails the transition (fail-closed; the daily sample catches any drift).

---

## 5. Tenant-facing UI — controls per surface

| Surface | Threat | Control |
| --- | --- | --- |
| In-app banner (Markdown → HTML) | XSS in scope name or drift rationale (R3.2 analogue) | Render via the existing Markdown sanitiser (DocAgent renderer, FORA-259 implementation; uses `sanitize-html` allowlist — no `<script>`, no `on*` handlers, no `javascript:` URLs). CSP `script-src 'self'` per parent §1.1. Pinned unit test injects 20 XSS payloads per scope field; renderer must reject all 20. |
| In-app banner — re-consent CTA | Clickjacking (an attacker iframes the banner + tricks admin into granting) | X-Frame-Options `DENY` on the consent page; CSP `frame-ancestors 'none'`. Tenant admin must enter their password (re-auth) before the OAuth redirect — no one-click consent. |
| In-app banner — consent grant | CSRF on the consent POST | SameSite=Strict session cookie + double-submit CSRF token (per `apps/customer-cloud-broker` pattern). |
| Email digest | Header injection / DMARC bypass | Subject + body are server-rendered; user input is escaped per RFC 5322; DKIM + DMARC `reject` policy. Body links use HMAC-signed URLs (per FORA-161 pattern) — no opaque `tenant_id` in the URL. |
| Per-tenant opt-out toggle | CSRF / privilege escalation | Toggle is a POST to `/_admin/reprovision/opt_out` requiring `role: tenant_admin` AND a fresh re-auth within the last 5 min. PATCH is audit-logged with the actor's identity (R5.1 invariant). |
| Banner displayed to non-admin user | Information disclosure (drift rationale leaks to non-admin tenant users) | Banner is **gated on `role: tenant_admin`**; non-admin users see a generic "Service-account maintenance scheduled" stub without scope names or drift details. |

---

## 6. Acceptance criteria traceability (extends parent §5)

| FORA-589 AC | Threat model section | Spec owner |
| --- | --- | --- |
| State machine implemented per impl spec §1 `reprovision/state.ts` | §4 transition table | Security Engineer |
| Drift on removed-from-allow-list → de-provision OR schedule re-consent | §4 + R-SYNC-02 (parent §4) | Security Engineer + SeniorEngineer |
| Tenant-facing UI: in-app banner + email digest; per-tenant opt-out flag | §5 (UI controls) + R-SYNC-02f | Security Engineer (no Designer hired) |
| Audit row per state transition (`scope.reprovision_scheduled` + `scope.reprovision_completed`) | §3 event payloads + §4 atomicity invariant | Security Engineer + DevOps (audit wedge) |
| Designer hire gap acknowledged; downstream handoff | Issue description | CEO (hire) → Designer (handoff) |

---

## 7. Open questions for the combined CTO walkthrough (additions to parent §6)

1. **Per-tenant opt-out default** (R-SYNC-02f): default-on (drift detection remains) or default-off (tenant must opt in to drift detection)? My recommendation: **default-on**, with explicit acknowledgement on every opt-out transition (no silent toggling). Ties to parent §6 #1 (PagerDuty routing key scope) — opt-out tenants still page Forge on-call.
2. **Consent timeout** (R-SYNC-02e timeout row): 30d feels long; 7d matches the FORA-526 JWT-validation weekly cadence. My recommendation: **14d**, with a tenant-facing reminder at day 7 and day 12.
3. **In-app banner placement** (R-SYNC-02 + §5): top-of-page (high visibility, low clickjacking protection), bottom-of-page (low visibility, higher trust), or modal (highest visibility, clickjacking risk requires password re-auth)? My recommendation: **bottom-of-page for non-admins; modal for admins (re-auth required)**.
4. **Email digest opt-in vs opt-out**: tenant admin email is **opt-in** (tenant explicitly subscribes during onboarding or in the admin settings). Default-off; no surprise emails.
5. **Risk register update**: should **R-SYNC-02 controls** be promoted from "5 controls" (per parent §6 #7 open question, v0.2) to "11 controls" with the addition of R-SYNC-02a…f? KnowledgeSteward owns the promotion; Security Engineer supplies the entries (this doc §2).

---

## 8. References

- [threat-model-FORA-258.md](./threat-model-FORA-258.md) — parent Phase-2 threat model (the WHY)
- [implementation-spec-FORA-258.md](./implementation-spec-FORA-258.md) — companion WHAT/HOW (includes §1 `reprovision/`)
- [forge/sync-plane/risk_register.md](./risk_register.md) — extended with R-SYNC-02a…f by this doc
- ADR-0010 §8.2 R-SYNC-02 — binding spec
- [FORA-126 customer-cloud-broker v1](/FORA/issues/FORA-126) — vault + single-use consent_token ledger
- [FORA-161 IdP Revoke Webhook](/FORA/issues/FORA-161) — HMAC-SHA256 per-tenant pattern (template for signed email URLs)
- [FORA-204 sync-plane audit + risk register](/FORA/issues/FORA-204) — `metadata.sync.*` envelope + per-tenant namespace
- [FORA-210 daily audit sample](/FORA/issues/FORA-210) — verifier for the state-machine atomicity invariant
- [FORA-259 Markdown sanitisation + remote-credential vault](/FORA/issues/FORA-259) — sibling Phase-2 sub-task; owns the sanitiser DocAgent will use to render the banner
- [FORA-258 parent](/FORA/issues/FORA-258) — implementation owner of the `@fora/sync-plane-scope` package
- [FORA-572 disposition](/FORA/issues/FORA-572) — CTO modified Option A (re-open FORA-256 + ship before Phase 2); still pending CEO relay + Board adjudication

---

## 9. Residual risk after proposed controls

- **R-SYNC-02a (replay)** — closed by single-use consent_token ledger + broker freshness check. Residual: ledger corruption → fail-closed (broker refuses `assume()`, daily sample flags the inconsistency).
- **R-SYNC-02e (broker unreachable)** — partial close via broker-confirmed transition + retry. Residual: extended AWS outage (> 24 h) leaves the SA in `de_provisioning`; tenant-side token still valid but audit row records the stall; manual runbook required. Mitigation: DevOps multi-region broker (FORA-126 v2 backlog).
- **R-SYNC-02f (opt-out abuse)** — partial close via audit trail + annual review. Residual: determined tenant admin can ack-drift forever; Security Engineer revocation on `> 90d` is the backstop. Operational burden: ~5 tenants/quarter expected.

**Total residual risk:** **P2** (was P0 before the controls; lowered from 4 P0s to 1 P0 + 3 P2s).

---

**Change log**

| Rev | Date | Author | What |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 | Security Engineer (`231cc5ae`) | Initial addendum. 6 new risks (R-SYNC-02a…f); state-machine transition table; UI controls per surface; 2 new event payloads; 5 walkthrough questions; residual-risk summary. Companion to [threat-model-FORA-258.md](./threat-model-FORA-258.md). Status: pending CTO walkthrough + FORA-256 ship + Designer hire. |
