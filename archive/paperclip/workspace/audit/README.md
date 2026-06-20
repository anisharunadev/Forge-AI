# Forge AI — Runtime Audit

**Status:** v1.0 (production bar, 2026-06-17) — meets the Knowledge Layer bar in [../README.md](../README.md#3-the-acceptance-bar)
**Owner:** The Audit Agent owns writes (per [memory/architecture.md §1](../memory/architecture.md#1-the-shape-we-are-building)). CTO owns the schema, the retention, and the cross-account shipping. The Security sub-agent is the merge gate; the on-call SRE co-signs the incident-response section.
**Stage gate:** The audit log is **the only place the customer can prove what the platform did**. The SOC 2 audit, the GDPR data-subject access request, and the customer-facing incident postmortem all read from this folder. There is no path that bypasses it.
**Glossary:** Every acronym below (SOC 2, ISO 27001, GDPR, CCPA, DPA, DPIA, SoA, PII, MCP, SHA-256, KMS, IAM, OIDC, SIEM) is defined in [../customer/glossary.md](../customer/glossary.md). If you find a term used here that is not in the glossary, file a glossary PR; do not redefine it in this file.
**Linked Paperclip issues:**
- Parent Epic: [Forge AI-26](/Forge AI/issues/Forge AI-26) — Epic 10 — Knowledge Layer
- Sub-goal: [Forge AI-101](/Forge AI/issues/Forge AI-101) — 10.4 Runtime output mounts
- Plan of record: [Forge AI-15](/Forge AI/issues/Forge AI-15#document-plan) — BMAD → Paperclip Hierarchy Plan (G0.1.4 Audit Agent)
- Compliance baseline: [customer/standards.md](../customer/standards.md) (SOC 2, ISO 27001, GDPR inheritance)
**Related:** [sessions/README.md](../sessions/README.md) (the event log this folder cross-references), [artifacts/README.md](../artifacts/README.md) (the artifact writes this folder records), [../memory/security.md](../memory/security.md) (the threat model and the auth/tenancy rules this folder defends)

---

## 1. What this folder is

`audit/` is the **runtime's accountability volume**. While `artifacts/` answers "what did the platform produce?" and `sessions/` answers "what did the platform do?", `audit/` answers "who did what, when, with which credentials, and at what cost — and can the customer prove it?" The folder is the SOC 2 audit trail, the GDPR data-subject access response, and the forensic record for every incident.

The folder is **append-only, immutable, and cross-account**. A compromise of the runtime account cannot rewrite history; the audit log lives in a separate AWS account with its own IAM boundary (per [memory/security.md §7](../memory/security.md#7-audit-logging)). The runtime is the only writer; the customer is the only reader. Sub-agents do not read this folder; the Security sub-agent reads it through a dedicated audit-only IAM role.

## 2. The layout

```
audit/
├── README.md                       # this file — the schema, the lifecycle, the contract
├── SCHEMA.md                       # the canonical JSON Schema for an audit event
├── index.jsonl                     # append-only index; one row per event, ordered by ts
├── by-tenant/                      # events grouped by tenant for fast DSAR and audit response
│   └── <tenant_id>/
│       └── <YYYY>-<MM>.jsonl
├── by-run/                         # events grouped by run for fast run-level reconstruction
│   └── <run_id>/
│       └── <YYYY>-<MM>-<DD>.jsonl
└── shipped/                        # events that have been shipped to the audit account
    └── <YYYY>/<MM>/<DD>/
        └── <shard>.parquet
```

Three rules:

- **`by-tenant/` is the customer-facing read path.** A DSAR (Data Subject Access Request) reads from one tenant's directory. A SOC 2 auditor reads from one tenant's directory. The path is the tenant id; the file is the month.
- **`by-run/` is the SRE read path.** An incident postmortem reads from one run's directory. The cost agent reconciles one run's bill from one run's directory. The path is the run id; the file is the day.
- **`shipped/` is the cold tier.** Once an event is shipped to the audit account, the local copy is eligible for hot-tier expiry. The shipped copy is the one the customer can prove; the local copy is the one the runtime can read fast.

## 3. The audit event

Every agent action produces one audit event. The event is a single JSON object; the canonical shape is the one in [memory/security.md §7.1](../memory/security.md#7-audit-logging) and the JSON Schema is in `SCHEMA.md`. The record below is the worked example; the schema is the validator.

```json
{
  "event_id": "01J7Z3X4K2N9PQ8R5V6T0YBWAC",
  "schema_version": "1.0.0",
  "ts": "2026-06-17T14:23:08.142Z",
  "tenant_id": "acme-corp",
  "run_id": "run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "session_id": "sess_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "issue_id": "Forge AI-101",
  "stage": "architect",
  "actor": "agent:architect",
  "on_behalf_of": "user:cto@acme-corp",
  "tool": "github.create_pull_request",
  "args_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "args_redacted": {
    "redacted": true,
    "redaction_reason": "contains_pii",
    "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
  },
  "result": "success",
  "duration_ms": 412,
  "approval_id": null,
  "trace_id": "trace_01J7Z3X4K2N9PQ8R5V6T0YBWAD",
  "cost": {
    "tokens_in": 1842,
    "tokens_out": 3117,
    "usd": 0.0418
  },
  "shipped_at": "2026-06-17T14:23:11.502Z",
  "shipped_to": "arn:aws:s3:::fora-audit-acct-prod/acme-corp/2026/06/17/001.parquet"
}
```

Two non-obvious fields:

- **`args_hash` + `args_redacted`.** The hash is the SHA-256 of the **original** arguments; the `args_redacted` block tells the auditor why the body is not stored. A row with `redacted: false` carries the full arguments in a separate `args` field (see `SCHEMA.md`). The hash is verifiable; the body is not retrievable when redacted.
- **`shipped_to`.** The ARN of the audit-account S3 object the row was shipped to. An event that is not yet shipped has `shipped_at: null` and `shipped_to: null`; the runtime treats unshipped events as at-risk and pages the on-call if a row is older than 5 minutes.

## 4. The lifecycle

An audit event has exactly one state: it is written, it is shipped, it is retained. There is no edit, no overwrite, no delete. The lifecycle is a conveyor belt, not a state machine.

```
written  →  buffered  →  shipped  →  retained
   │           │           │           │
   │           │           │           └──►  hot (13 months)  →  cold (7 years)
   │           │           └──►  verified (signature check passed in audit account)
   │           └──►  at-risk (older than 5 minutes; on-call paged)
   └──►  rejected (schema validation failed; logged to a separate quarantine stream)
```

| Stage | Who writes it | When |
| --- | --- | --- |
| `written` | the Audit Agent | The agent action completes (success, failure, or deny). |
| `buffered` | the Audit Agent | The event is in the durable outbox, waiting to be shipped. |
| `shipped` | the shipper worker | The event has been written to the audit account and the signature has been verified. |
| `retained` | the retention worker | The event has reached the cold tier; the local hot copy is eligible for expiry. |
| `rejected` | the Audit Agent | The event failed schema validation. It is **not** in the customer-facing log; it is in `audit/quarantine/`, and a P0 incident is opened. |
| `at-risk` | the shipper worker | A buffered event older than 5 minutes. The on-call is paged. |

## 5. The runtime contract

The Audit Agent is the **only** writer of this folder. Sub-agents do not write audit rows; the Audit Agent writes audit rows on their behalf, in the same transactional unit as the action they audited. Three reasons:

1. **Atomicity.** An action and its audit row are written together. A partial write is a corruption; the runtime refuses to commit an action whose audit row is not durable.
2. **Completeness.** The customer-facing question is "can you prove what the platform did?" The answer is "every action has exactly one audit row, and the row is in the audit account within 5 minutes." A `deny` result is audited as aggressively as a `success`; a `paused` state is audited as aggressively as a `completed` state.
3. **Tenant isolation.** The audit row carries the `tenant_id` of the action, not the `tenant_id` of the agent. A cross-tenant audit write is a P0; the Audit Agent validates the tenant on every write.

The write API is a single function:

```typescript
// packages/contracts/src/audit-store.ts
export interface AuditStore {
  emit(input: {
    tenantId: TenantId;          // mandatory; the action's tenant, not the agent's
    runId: RunId;
    sessionId: SessionId;
    issueId: IssueId;
    stage: StageName;
    actor: ActorId;
    onBehalfOf: ActorId;
    tool: string;
    args: unknown;               // hashed; PII / secrets trigger automatic redaction
    result: "success" | "failure" | "denied";
    durationMs: number;
    approvalId?: ApprovalId;
    traceId: TraceId;
    cost: { tokensIn: number; tokensOut: number; usd: number };
  }): Promise<AuditEvent>;

  query(input: {
    tenantId: TenantId;          // mandatory; cross-tenant queries are rejected
    fromTs: ISOTimestamp;
    toTs: ISOTimestamp;
    filter?: { runId?: RunId; actor?: ActorId; tool?: string; result?: AuditResult };
  }): Promise<AuditEvent[]>;
}
```

The query path is **read-only** and is the only way the customer-facing surfaces (Forge console, audit export, DSAR endpoint) can read audit data. The query layer enforces the tenant check on every read; a query that does not carry a `tenant_id` is rejected.

## 6. Retention and immutability

| Tier | Window | Storage | Who can write | Who can delete |
| --- | --- | --- | --- | --- |
| **Local hot** | 13 months from `ts` | `by-tenant/`, `by-run/` (runtime account) | the Audit Agent | nobody |
| **Audit account hot** | 13 months from `shipped_at` | `shipped/<YYYY>/<MM>/<DD>/` (audit account) | the shipper worker | nobody (separate IAM boundary) |
| **Cold** | 7 years from `ts` | S3 Glacier Instant Retrieval (audit account) | the retention worker | nobody |
| **Quarantine** | 90 days from `ts` | `quarantine/` (runtime account) | the Audit Agent | the Security on-call, after review |

There is no delete operation. There is no overwrite. There is no edit. A compromise of the runtime account cannot rewrite history because the audit account has its own IAM boundary, its own KMS key, and its own retention worker; the runtime account does not have `s3:DeleteObject` on the audit bucket (per [memory/security.md §3](../memory/security.md#3-secrets-management) and §7).

## 7. Failure modes (the ones the runtime must defend against)

The runtime's contract with the customer is "every action has an audit row, and every row is in the audit account within 5 minutes." The known ways that contract breaks, and the defence for each:

- **The Audit Agent is down.** The action's write to `artifacts/` and `sessions/` is blocked until the Audit Agent is back. A customer-facing action without an audit row is forbidden (per [memory/security.md §2.3](../memory/security.md#2-security-principles) — "if an action is not in the audit log, the action did not happen").
- **The audit account is unreachable.** Events accumulate in the outbox; the shipper worker retries with exponential backoff. An outbox older than 5 minutes pages the on-call. A run that cannot ship its audit rows within 30 minutes is paused, not failed; the customer is paged.
- **An event fails schema validation.** The event is written to `quarantine/`, not to `by-tenant/`. A P0 incident is opened. The schema is fixed; the events are replayed from the source (`sessions/` and `artifacts/`), not from the quarantine stream.
- **A redaction filter misses PII.** The original payload is written to a sealed S3 object with a dedicated KMS key. The redacted copy is in `args_redacted`; the original is accessible only to the security on-call via a break-glass approval. A periodic re-scan (`packages/audit/rescan/`) replays the redacted bodies against the latest redaction rules and pages the on-call if it finds a miss.
- **The customer requests a DSAR.** The query layer returns all events for the `tenant_id` in the requested window. The export endpoint ships them as a single signed bundle; the bundle includes the hash chain so the customer can verify nothing was omitted.

## 8. Anti-patterns (auto-flag in review)

A PR that touches this folder or its schema is auto-flagged for Security and CTO review if it does any of the following:

- Adds a write path that does not go through the Audit Agent. (Direct sub-agent writes break atomicity and completeness.)
- Removes a required field from the event. (Field removals are a major version bump on `schema_version`; the runtime keeps the old schema validator for 13 months.)
- Adds a delete operation or an overwrite operation on the audit account bucket. (The bucket is append-only by IAM policy.)
- Cross-wires the runtime account to read from the audit account. (The runtime account does not have read access; the Security sub-agent reads via a dedicated audit-only IAM role.)
- Disables the redaction filter. (Disabling the filter is a P0; see [memory/security.md §3](../memory/security.md#3-secrets-management).)
- Changes the 5-minute shipping SLO without a corresponding runbook update and CTO sign-off. (The SLO is a customer commitment; missing it is a P1.)
- Adds a `result: "success"` row that does not have a matching `result: "failure"` or `result: "denied"` row in the same atomic unit. (A row's `result` is a fact; the customer must see the truth.)

## 9. Related

- The session volume whose events this folder records: [sessions/README.md](../sessions/README.md)
- The artifact volume whose writes this folder records: [artifacts/README.md](../artifacts/README.md)
- The audit-log shape (canonical source) and the threat model this folder defends: [../memory/security.md](../memory/security.md)
- The customer commitments (SOC 2, ISO 27001, GDPR) this folder satisfies: [../customer/standards.md](../customer/standards.md)
- The G0.1.4 Audit Agent contract in the Forge AI-15 plan: [Forge AI-15](/Forge AI/issues/Forge AI-15#document-plan)
- The Knowledge Layer bar this file is held to: [../README.md §3](../README.md#3-the-acceptance-bar)
- The product surface that surfaces audit data to the customer: [../project/PRD.md §5](../project/PRD.md#5-product-surface-v1)

---

## 10. Change log

- **v1.0 — 2026-06-17** — Initial production bar. Audit event shape (extends [memory/security.md §7.1](../memory/security.md#7-audit-logging) with `args_redacted`, `shipped_at`, `shipped_to`), lifecycle, runtime contract, retention (13 months hot, 7 years cold, separate audit account), failure modes, anti-patterns. Cross-references [memory/security.md §7](../memory/security.md#7-audit-logging) for the canonical audit-log shape, [customer/standards.md](../customer/standards.md) for the SOC 2 / ISO 27001 / GDPR baseline, and the G0.1.4 Audit Agent contract in the Forge AI-15 plan. Owned by Forge AI-101 (10.4 Runtime output mounts) under [Forge AI-26](/Forge AI/issues/Forge AI-26) (Epic 10 — Knowledge Layer).
