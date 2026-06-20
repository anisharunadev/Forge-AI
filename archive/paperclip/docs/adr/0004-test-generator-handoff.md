# ADR-0004: Test Generator Handoff Contract (Dev → QA → Security)

| Field             | Value                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------|
| **Status**        | **Accepted**                                                                                   |
| **Date**          | 2026-06-17                                                                                     |
| **Author**        | CTO (f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)                                                     |
| **Reviewer**      | CTO (one-way door; per architecture.md §5, CTO signs every one-way-door ADR)                   |
| **Issue**         | [Forge AI-41](/Forge AI/issues/Forge AI-41)                                                                |
| **Parent ADR**    | [ADR-0001](./../architecture/adr-0001-master-orchestrator-sdlc-architecture.md)                |
| **Supersedes**    | none                                                                                           |
| **Superseded by** | none                                                                                           |
| **Schema version**| `1.0.0`                                                                                        |

---

## 1. Context

[ADR-0001](./../architecture/adr-0001-master-orchestrator-sdlc-architecture.md) §3
defines the staged workflow:

```
Ideation → Architect → Dev → QA → Security → DevOps → Docs
```

ADR-0001 §5 and §7 also define the **gates** between stages and the **Handoff
Contract v1.0** that every sub-agent must honour. The Dev → QA and QA → Security
gates are the most heavily exercised gates in the platform, and both currently
have **no typed contract**:

- The **Dev → QA gate** is triggered by "PR merged, CI green" — but the QA
  agent has no versioned schema for the PR diff, the acceptance criteria, or
  the runtime environment it is expected to exercise. Every QA run becomes
  bespoke; a new sub-agent hire cannot re-derive the contract from prompts
  alone.
- The **QA → Security gate** is triggered by "Tests pass, eval cases pass" — but
  the Security agent has no versioned schema for the **test verdict**, the
  per-tier pass/fail record, or the **coverage report** it must consume to
  decide whether the surface is safe to scan.

The result: every QA run emits a different shape, downstream consumers (Security,
DevOps, Docs, Audit) write bespoke parsers, and a schema change silently breaks
multiple stages at once. The contract is the only place this should be modelled.

This is a **one-way door** per the issue's explicit framing. A QA run is
replayable (per architecture.md §2 principle 3 — idempotent stages), and replay
means "same input contract, same observable output." That is impossible without
a versioned schema.

## 2. Decision

We adopt the **`AgentHandoff` pattern from architecture.md §4** for the
**Dev → QA → Security** slice of the pipeline and publish it in
[`agents/qa/schemas.py`](../../agents/qa/schemas.py):

| Schema             | Producer | Consumer                          | Purpose                                                                 |
|--------------------|----------|-----------------------------------|-------------------------------------------------------------------------|
| **`TestPlan`**     | QA Agent | QA Agent itself, Audit            | What the QA agent intends to run, per tier, with framework and command. |
| **`TestRun`**      | QA Agent | Security, DevOps, Docs, Audit     | What actually happened: per-tier pass/fail, durations, sample failures.  |
| **`CoverageReport`** | QA Agent | Security, DevOps, Docs, Audit   | Line / branch / mutation coverage, attached as a typed artifact.        |

A **worked example** is committed alongside the schemas at
[`agents/qa/example.json`](../../agents/qa/example.json) and is the source of
truth for shape. The schema is the validator; the example is the spec.

### 2.1 Contract anchors (cross-references)

- The **`contractId`** and **`runId`** fields on every `TestPlan` / `TestRun` /
  `CoverageReport` are the join keys back to the Handoff Contract v1.0
  (ADR-0001 §7). The Audit agent indexes on these.
- The **`branch`** and **`commitSha`** fields on `TestPlan` are the join keys
  to the Dev stage's output (the merged PR). Security consumes the same keys
  when it scans.
- The **`verdict`** field on `TestRun` is the **gate token** for the QA →
  Security transition. Values: `pass`, `fail`, `needs_attention`.

### 2.2 Why dataclasses in `agents/qa/schemas.py`, not JSON Schema files

ADR-0001 §4 prescribes `input.schema.json` + `output.schema.json` + `example.json`
as the three artefacts. We diverge deliberately for the QA stage:

| Aspect                    | JSON Schema files (ADR-0001 §4 default)         | Python `dataclass` (this ADR)                              |
|---------------------------|--------------------------------------------------|-----------------------------------------------------------|
| **Author surface**        | Hand-written JSON; drifts from code              | Lives next to the agent code that emits it                |
| **Validation**            | External validator (jsonschema)                  | `dataclass.validate()` — same call, same errors, tests    |
| **Redaction**             | Manual, easy to forget                           | Centralised in `to_dict()` (one place to redact)          |
| **Lang chain**            | Imported as data; no autocomplete                | Static type-checked; IDE sees the field names             |
| **Tooling**               | Re-implement validators in every consumer        | Consumers `import` the same Python class                  |
| **JSON portability**      | Native                                           | Native — `to_dict()` returns the wire shape               |

The wire format is still JSON. The Python class is the source of truth; the
JSON is the on-the-wire projection. Every emitted JSON validates through
`TestPlan.validate()` / `TestRun.validate()` / `CoverageReport.validate()` before
it leaves the agent.

A future ADR (out of scope here) may add a generated `JSON Schema` file beside
each `dataclass` for non-Python consumers; until then, `to_dict()` is the schema.

### 2.3 Versioning

- The package is at **schema version `1.0.0`**. The `SCHEMA_VERSION` constant in
  `agents/qa/schemas.py` is the single source of truth.
- **Additive changes** (new optional field, new tier value) → minor version bump.
- **Breaking changes** (rename, remove, semantic change to an existing field,
  re-ordering of required fields) → major version bump, and a new ADR that
  supersedes this one.
- The `validate()` method **rejects** any payload that claims a newer major
  version than the running code knows about (fail closed). Older minor versions
  are accepted for 2 minor versions after the bump.

### 2.4 Idempotency

- The `idempotencyKey` on `TestPlan` is **derived from** `(runId, contractId,
  branch, commitSha, planRevision)` — see `agents/qa/schemas.py:_deterministic_key`.
  A re-run of the same plan produces the same key, which the Audit agent
  uses to dedupe runs.
- Re-emitting the same `TestRun` for a given `TestPlan.id` is a no-op. The Audit
  agent deduplicates on `testRunId`.

## 3. The contract in detail

### 3.1 `TestPlan` — what the QA agent intends to run

```python
@dataclass
class TestPlan:
    schema_version: str         # "1.0.0"
    plan_id: str                # "tplan-<uuid>"
    run_id: str                 # ADR-0001 §7 run id
    contract_id: str            # ADR-0001 §7 contract id
    branch: str                 # "qa/test-gen"
    commit_sha: str             # 40-char hex
    base_branch: str            # "main"
    tiers: List[TestTier]       # unit | integration | e2e | contract
    issued_at: str              # ISO 8601 UTC
    issued_by: str              # "agent:qa"
    idempotency_key: str
```

`TestTier` carries the **framework**, the **command line** to run, the
**files in scope**, and the **framework version**. Downstream consumers replay
the command; they do not re-derive it.

### 3.2 `TestRun` — what actually happened

```python
@dataclass
class TestRun:
    schema_version: str
    test_run_id: str            # "trun-<uuid>"
    test_plan_id: str           # join back to TestPlan
    started_at: str
    finished_at: str
    duration_ms: int
    tier_results: List[TierResult]
    verdict: str                # "pass" | "fail" | "needs_attention"
    failure_summary: str
```

`TierResult` carries **per-tier** pass/fail counts, **p50 / p99 duration**,
**status** (`passed` / `failed` / `not_implemented` / `errored`), and a
**sample of failures** (truncated; full failures go to the Audit agent).

### 3.3 `CoverageReport` — typed coverage artifact

```python
@dataclass
class CoverageReport:
    schema_version: str
    coverage_id: str            # "cov-<uuid>"
    test_run_id: str            # join back to TestRun
    line_coverage: float        # 0.0–1.0
    branch_coverage: float      # 0.0–1.0, may be null
    mutation_score: float       # 0.0–1.0, may be null
    files: List[FileCoverage]
    produced_at: str
```

`mutation_score` is **typed as `Optional[float]`** and a tier that does not
support mutation testing reports `not_implemented` — it does **not** silently
return a fake pass. (Per `qa.md` §4.4: "A `not_implemented` status is a real
status.")

### 3.4 Worked example

[`agents/qa/example.json`](../../agents/qa/example.json) is the canonical worked
example. It contains a `TestPlan`, a matching `TestRun` (verdict: `pass`), and a
matching `CoverageReport`. Every field is populated. The example is also used
as a fixture by `agents/qa/smoke_test.py` (see Forge AI-46).

## 4. Invariants (enforced by `validate()`)

1. **`plan_id`, `test_run_id`, `coverage_id` are non-empty and unique per
   `runId`.** The Audit agent dedupes on these.
2. **`commit_sha` is 40 lowercase hex characters.** A short SHA is rejected.
3. **`verdict` ∈ `{pass, fail, needs_attention}`.** A typo fails validation.
4. **`line_coverage`, `branch_coverage`, `mutation_score` ∈ `[0.0, 1.0]` or
   `null`.** Out-of-range is rejected.
5. **Every `TestRun.tier_results[i].tier` matches a tier in the source
   `TestPlan.tiers`.** Mismatched tiers are rejected; the contract is
   *what was planned* vs. *what was run*, and a silent tier swap is a bug.
6. **`duration_ms ≥ 0`** and **`p50_ms ≤ p99_ms`** in every `TierResult`.
7. **`started_at ≤ finished_at`** in `TestRun`. Reversed timestamps fail.
8. **`failure_summary` is non-empty when `verdict != pass`**. An empty summary
   on a failed run is rejected; the Security agent would have to guess.

## 5. Consequences

### Positive

- **One source of truth.** `agents/qa/schemas.py` is the contract; the JSON
  is the wire projection. Future sub-agent hires do not re-derive the
  contract from prompts.
- **Audit-friendly.** The `runId` / `contractId` / `planId` / `testRunId`
  / `coverageId` chain is the join key for the Audit agent's
  append-only log (Forge AI-21).
- **Redaction lives in one place.** `to_dict()` is the only place where
  secrets, customer data, or stack traces are filtered. The `rejected`
  alternative (Protobuf) does not have a clean human-redact path; this does.
- **The Security stage gets a typed input.** A `TestRun` with
  `verdict == pass` and a non-null `CoverageReport` is the gate. No bespoke
  parsing.
- **The DevOps stage gets a typed artifact.** A `CoverageReport` with
  `line_coverage >= customer_standards.threshold` is the "deploy" token.
- **Schema change is a one-place change.** Adding a field is a 4-line PR
  in `agents/qa/schemas.py` plus an update to `example.json` plus a test in
  `agents/qa/smoke_test.py`. No consumers break.

### Negative / risks

- **Python-only wire schema.** A future Go / TypeScript consumer has to
  re-implement the validator. We accept this for v1; a future ADR may add
  a generated JSON Schema file.
- **`to_dict()` is not a JSON Schema.** External tools that consume the JSON
  cannot validate it without importing Python. The acceptance criteria call
  for a Python module; the JSON Schema is a follow-on (see §7).
- **`not_implemented` is a real status.** A tier that does not yet support
  a metric (e.g., mutation in v1) returns `not_implemented`, not a fake pass.
  This is a feature, but it means Security has to be taught to read
  `not_implemented` as a real signal — see `qa.md` §5.
- **Dataclass drift.** If a contributor edits the wire shape directly
  (e.g., a hand-rolled JSON dump) without going through `to_dict()`, the
  validator cannot catch it. The review bar in `coding.md` enforces
  "emit via `to_dict()`" for QA payloads.

## 6. Alternatives considered

1. **Ad-hoc JSON blobs.** Rejected: no validation; consumers re-implement
   parsers; schema drift is invisible until a Security run breaks.
2. **Protobuf / Avro.** Rejected: no clean human-redact path. Per `qa.md`
   §4.4 ("a QA agent that cannot fail loudly is not safe to merge"), the
   on-disk artifact must be human-readable and human-redactable. Protobuf
   requires a separate toolchain; the Audit agent and the human reviewer
   both lose.
3. **One schema per consumer.** Rejected: drift across consumers. A single
   schema module, imported by all consumers, is the only way to keep the
   contract tight.
4. **JSON Schema files only (no Python class).** Rejected: imports across
   the agent code are awkward; the validator runs in a separate process;
   redaction has to be re-implemented in every emit site.
5. **Defer the contract to Forge AI-43 / Forge AI-46.** Rejected: per `qa.md` §3,
   the contract is the source of truth; without it, Forge AI-43 (the QA
   skeleton) and Forge AI-46 (the smoke test) cannot be reviewed against
   anything concrete. Writing the contract first is cheaper.

## 7. Out of scope (future ADRs)

These are intentionally **not** decided in this ADR:

- Generated **JSON Schema** files (`.schema.json`) alongside each Python
  dataclass, for non-Python consumers. A future ADR when we onboard the
  first Go or TypeScript consumer.
- The **Self-Healing Test** agent's `RepairProposal` contract
  (`agents/selfhealing/schemas.py`, Forge AI-91). Same pattern; not this ADR.
- The **Evaluation** agent's measurement of QA stage health (retry rate,
  flake rate, time-to-green). The Evaluation ADR owns this.
- The **DevOps** stage's "deploy token" derived from `CoverageReport`.
  Will be modelled in the DevOps stage's own ADR.

## 8. Reviewer sign-off

This ADR is a **one-way door** (per architecture.md §5). The CTO signs every
one-way-door ADR; CEO sign-off is not required for this scoped decision
because it is bounded to the QA stage's input/output shape and does not
touch the cross-stage spine defined in ADR-0001.

- [x] **CTO — approved as proposed on 2026-06-17** (author: f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)
- [ ] CEO — informational copy; this ADR does not require CEO sign-off per architecture.md §5

### Follow-up issues (opened on acceptance)

- [Forge AI-43](/Forge AI/issues/Forge AI-43) — Build Test Generator agent skeleton (`agents/qa/`)
- [Forge AI-46](/Forge AI/issues/Forge AI-46) — Smoke test for QA Agent (blocked by Forge AI-43)
- [Forge AI-49](/Forge AI/issues/Forge AI-49) — Wire QA Agent to @fora/mcp-github (blocked by Forge AI-43 and Forge AI-46)
- [Forge AI-65](/Forge AI/issues/Forge AI-65) — Document QA playbook in `workspace/memory/qa.md` (already drafted in this PR)
- [Forge AI-91](/Forge AI/issues/Forge AI-91) — Self-Healing v1 scaffold (Phase 4, separate contract)
