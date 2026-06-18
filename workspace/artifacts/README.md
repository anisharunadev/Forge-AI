# FORA — Runtime Artifacts

**Status:** v1.0 (production bar, 2026-06-17) — meets the Knowledge Layer bar in [../README.md](../README.md#3-the-acceptance-bar)
**Owner:** Runtime owns writes (artifact storage layer, the Master Orchestrator). CTO owns the schema, the lifecycle, and the cross-stage contract. The Doc agent (Epic 7) is the merge gate for documentation artifacts.
**Stage gate:** An artifact is the **output** of a stage and the **input** of the next one (per [memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine)). A stage is `done` only when its artifact is in `artifacts/` with `status: "approved"` and the handoff contract is signed (per [memory/architecture.md §4](../memory/architecture.md#4-the-agent-handoff-contract)).
**Glossary:** Every acronym below (MCP, OIDC, SLA, SLO, ACL, KMS, KMS-key, ARN, CIDR, JSONL, SHA-256, p50, p99) is defined in [../customer/glossary.md](../customer/glossary.md). If you find a term used here that is not in the glossary, file a glossary PR; do not redefine it in this file.
**Linked Paperclip issues:**
- Parent Epic: [FORA-26](/FORA/issues/FORA-26) — Epic 10 — Knowledge Layer
- Sub-goal: [FORA-101](/FORA/issues/FORA-101) — 10.4 Runtime output mounts
- Plan of record: [FORA-15](/FORA/issues/FORA-15#document-plan) — BMAD → Paperclip Hierarchy Plan
**Related:** [sessions/README.md](../sessions/README.md) (who wrote this, when, and in what state), [audit/README.md](../audit/README.md) (every write here has a matching audit row), [../memory/architecture.md](../memory/architecture.md) (the staged workflow that produces these)

---

## 1. What this folder is

`artifacts/` is the **runtime's output volume**. Every stage of the staged workflow writes its output here, and the next stage reads it from here. The folder is the durable, customer-visible record of what the platform produced. Without it, every run is a black box; with it, every run is reproducible, auditable, and billable.

It is the **only** folder where the runtime writes knowledge artefacts. The Knowledge Layer convention is "humans write, agents read" (per [README §7](../README.md#7-out-of-scope-v1)) — `artifacts/`, `sessions/`, and `audit/` are the documented exceptions, and only because the alternative is the platform having no memory at all.

## 2. The layout

```
artifacts/
├── README.md                       # this file — the schema, the lifecycle, the contract
├── SCHEMA.md                       # the canonical JSON Schema for an artifact record
├── catalog.jsonl                   # append-only index; one record per artifact (latest at the bottom)
├── by-stage/                       # artifacts grouped by the stage that produced them
│   ├── ideation/
│   ├── architect/
│   ├── dev/
│   ├── qa/
│   ├── security/
│   ├── devops/
│   └── docs/
├── by-issue/                       # artifacts grouped by the Paperclip issue that requested the run
│   └── <issue-identifier>/
└── archived/                       # terminal artifacts older than the hot retention window
    └── <YYYY>/<MM>/
```

Three rules:

- **`by-stage/`** is the natural read path. The next stage asks "what did the previous stage hand me?" and reads from `by-stage/<previous-stage>/`.
- **`by-issue/`** is the customer-facing read path. The Forge console renders an issue's run as a timeline of artifacts.
- **`archived/`** is the cold tier. The runtime moves artifacts here when the run is `done` and the hot retention window expires; the customer can still request them, the runtime just has to look in two places.

## 3. The artifact record

Every artifact is a single JSON object. The runtime writes the record to `catalog.jsonl` (append-only) and the payload to `by-stage/<stage>/<artifact-id>.json`. The record is the truth; the payload is the body. If they disagree, the record wins.

```json
{
  "artifact_id": "art_01J7Z3X4K2N9PQ8R5V6T0YBWAC",
  "schema_version": "1.0.0",
  "tenant_id": "acme-corp",
  "run_id": "run_01J7Z3R8M4F1Q9B2C7D5E6H7K0",
  "issue_id": "FORA-101",
  "stage": "architect",
  "kind": "adr",
  "title": "ADR-0014 — Runtime output mounts",
  "status": "approved",
  "lifecycle": "approved",
  "produced_by": "agent:architect",
  "approved_by": "user:cto@acme-corp",
  "approval_id": "appr_01J7Z3X4K2N9PQ8R5V6T0YBWAD",
  "input_contract": {
    "from_stage": "ideation",
    "contract_version": "1.0.0",
    "input_artifact_id": "art_01J7Z3X4K2N9PQ8R5V6T0YBWAB"
  },
  "output_contract": {
    "to_stage": "dev",
    "contract_version": "1.0.0"
  },
  "storage": {
    "primary_path": "by-stage/architect/art_01J7Z3X4K2N9PQ8R5V6T0YBWAC.json",
    "byte_size": 12480,
    "content_sha256": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "content_encoding": "utf-8"
  },
  "audit": {
    "audit_event_id": "01J7Z3X4K2N9PQ8R5V6T0YBWAE",
    "audit_log_path": "../audit/by-tenant/acme-corp/2026-06.jsonl"
  },
  "cost": {
    "tokens_in": 1842,
    "tokens_out": 3117,
    "usd": 0.0418
  },
  "created_at": "2026-06-17T14:23:08.142Z",
  "approved_at": "2026-06-17T14:31:55.001Z",
  "expires_at": "2027-06-17T14:31:55.001Z"
}
```

`SCHEMA.md` carries the full JSON Schema (draft 2020-12). The record above is the worked example; the schema is the validator. A record that does not validate is rejected at write time and the run halts.

## 4. The lifecycle

A `kind` is the **type** of artifact. A `lifecycle` is the **state** of this instance. Lifecycle transitions are unidirectional; there is no path back from `archived` to `approved`.

```
draft  →  review  →  approved  →  archived
   │        │           │
   │        │           └────►  superseded  (replaced by a newer version)
   │        └────────────────►  rejected   (rejected at the gate; sent back to the producer)
   └─────────────────────────►  cancelled  (run cancelled; artifact preserved for forensics)
```

| State | Who can write it | Who can read it | Triggers |
| --- | --- | --- | --- |
| `draft` | the producing sub-agent | the producing sub-agent, the orchestrator | The stage starts; the agent emits a plan, then the artifact. |
| `review` | the orchestrator (gate) | the producer, the gate owner, the orchestrator | The stage emits the artifact; the orchestrator moves it to `review` and pings the gate owner. |
| `approved` | the orchestrator (terminal) | everyone in the tenant | The gate owner (human or agent) approves; the orchestrator moves it to `approved` and the next stage can read it. |
| `rejected` | the orchestrator (terminal) | the producer, the gate owner, the orchestrator | The gate owner rejects with a reason; the producer is woken with the reason in the resume payload. |
| `superseded` | the orchestrator (terminal) | everyone in the tenant | A newer artifact of the same `kind` reaches `approved`; the old one is marked `superseded` but never deleted. |
| `cancelled` | the orchestrator (terminal) | the security sub-agent, the orchestrator | The run is cancelled; the artifact is preserved for forensic review. |
| `archived` | the retention worker | everyone in the tenant (read-only, cold tier) | The hot retention window expires; the runtime moves the payload to `archived/<YYYY>/<MM>/`. |

## 5. The runtime contract

The Master Orchestrator is the **only** writer of `artifacts/`. Sub-agents never call the storage layer directly; they call the Orchestrator, and the Orchestrator writes. Three reasons:

1. **Idempotency.** A stage that retries must not produce two `draft` records. The Orchestrator keys writes on `(run_id, stage, kind)` and returns the existing record if the key already exists.
2. **Audit coupling.** Every write to `artifacts/` produces a write to `audit/`. The two are written in a single transactional unit. There is no path where an artifact exists without an audit row, and there is no path where an audit row exists without an artifact (per [memory/security.md §2.3](../memory/security.md#2-security-principles)).
3. **Tenant isolation.** The Orchestrator rejects an artifact write that does not carry a `tenant_id` matching the run's tenant. A bug in the storage layer that lets one tenant's run write to another tenant's folder is a P0 (per [memory/security.md §4](../memory/security.md#4-authentication-authorisation-tenancy)).

The write API is a single function:

```typescript
// packages/contracts/src/artifact-store.ts
export interface ArtifactStore {
  write(input: {
    runId: RunId;
    issueId: IssueId;
    stage: StageName;
    kind: ArtifactKind;
    title: string;
    payload: unknown;        // validated against the kind's JSON Schema
    producedBy: ActorId;
  }): Promise<ArtifactRecord>;

  read(input: {
    artifactId: ArtifactId;
    tenantId: TenantId;      // mandatory; the store rejects cross-tenant reads
  }): Promise<{ record: ArtifactRecord; payload: unknown }>;

  list(input: {
    tenantId: TenantId;
    stage?: StageName;
    issueId?: IssueId;
    lifecycle?: Lifecycle;
  }): Promise<ArtifactRecord[]>;  // read from catalog.jsonl, filtered
}
```

The schema is the contract. A handoff between two stages that does not produce an artifact of the right `kind`, with the right `schema_version`, signed by the right `produced_by`, fails the gate (per [memory/architecture.md §4](../memory/architecture.md#4-the-agent-handoff-contract)).

## 6. Retention and immutability

| Tier | Window | Storage | Who can write | Who can delete |
| --- | --- | --- | --- | --- |
| **Hot** | 13 months from `approved_at` | `by-stage/`, `by-issue/` | the orchestrator (writes), the retention worker (transitions) | nobody |
| **Cold** | 7 years from `approved_at` | `archived/<YYYY>/<MM>/` | the retention worker (transitions) | nobody |
| **Audit** | 13 months hot, 7 years cold | `../audit/` (separate account) | the audit sub-agent | nobody (separate account, separate IAM boundary) |

There is no delete operation on this folder. There is no overwrite. A `rejected` artifact is preserved because the next attempt must learn from the previous one; a `superseded` artifact is preserved because the audit team must be able to reconstruct what the customer saw at any point in the past. The customer cannot delete artifacts; they can request a redaction (PII, accidental secret) and the runtime ships a redacted copy with a forward pointer in `audit/`.

## 7. Failure modes (the ones the runtime must defend against)

The runtime's contract with the customer is "every run produces an artifact trail." The known ways that contract breaks, and the defence for each:

- **The agent emits a payload that fails schema validation.** The Orchestrator rejects the write, the run halts, the audit log records the validation failure with the schema path. The agent is woken with the schema error in its resume payload.
- **The storage layer is down.** The Orchestrator buffers the write in an outbox table keyed on `artifact_id`. The next write retry drains the outbox in order. A run that cannot drain its outbox within 5 minutes is paused, not failed; the customer is paged.
- **The agent writes a payload that contains PII or a secret.** The storage layer runs the payload through the redaction filter (per [memory/security.md §3](../memory/security.md#3-secrets-management)) before writing the payload to disk and writes the redacted copy to `audit/`. The original payload is held in a sealed S3 object with KMS-key isolation, accessible only to the security on-call via a break-glass approval.
- **Two stages race to write the same `(run_id, kind)` pair.** The Orchestrator serialises on `run_id`. The second writer blocks until the first commits, then reads the existing record. The `kind` and `schema_version` decide whether the second write is a new draft or a `superseded` transition.
- **The customer's tenant is suspended mid-run.** The Orchestrator finishes the in-flight artifact (it is already in `review`), then halts the run. The customer sees the artifact trail; the next attempt resumes from the last approved state.

## 8. Anti-patterns (auto-flag in review)

A PR that touches this folder or its schema is auto-flagged for CTO review if it does any of the following:

- Adds a write path that does not go through the Orchestrator. (Direct sub-agent writes break idempotency and audit coupling.)
- Loosens the lifecycle (e.g., allows `approved → draft`). (Lifecycle is unidirectional; the only way to redo a stage is to start a new run with a new `run_id`.)
- Adds a delete operation or an overwrite operation. (The folder is append-only by contract.)
- Removes a required field from the record. (Field removals are a major version bump on `schema_version`; the runtime keeps the old schema validator for 13 months.)
- Cross-wires a customer-facing surface (Forge console, customer email) to read directly from `by-stage/`. (Customer surfaces read from `by-issue/`; the cross-stage staging area is internal.)

## 9. Related

- The sessions volume that tracks **who is writing and when**: [sessions/README.md](../sessions/README.md)
- The audit volume that records **every write and every read**: [audit/README.md](../audit/README.md)
- The staged workflow that produces these artifacts: [../memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine)
- The agent handoff contract that validates them: [../memory/architecture.md §4](../memory/architecture.md#4-the-agent-handoff-contract)
- The audit-log shape that this folder cross-references: [../memory/security.md §7](../memory/security.md#7-audit-logging)
- The Knowledge Layer bar this file is held to: [../README.md §3](../README.md#3-the-acceptance-bar)
- The product surface that renders these to the customer: [../project/PRD.md §5](../project/PRD.md#5-product-surface-v1)

---

## 10. Change log

- **v1.0 — 2026-06-17** — Initial production bar. Schema, lifecycle, runtime contract, retention, failure modes, anti-patterns. Cross-references [memory/security.md §7](../memory/security.md#7-audit-logging) for the audit-log shape, [memory/architecture.md §3](../memory/architecture.md#3-the-staged-workflow-the-spine) for the staged workflow that produces these. Owned by FORA-101 (10.4 Runtime output mounts) under [FORA-26](/FORA/issues/FORA-26) (Epic 10 — Knowledge Layer).
