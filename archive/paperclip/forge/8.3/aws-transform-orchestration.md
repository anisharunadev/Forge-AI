# Forge AI-84 / Sub-goal 8.3 — AWS Transform Orchestration

> **Status:** v0.1 — `wave-planner/0.1.0` (schema v1)
> **Source:** `agents.refactor.plan_waves` (Forge AI-84 / 8.3)
> **Upstream:** [Forge AI-82](/Forge AI/issues/Forge AI-82) (8.1 `MigrationScope`) + [Forge AI-83](/Forge AI/issues/Forge AI-83) (8.2 `DependencyGraph`)
> **Downstream:** [Forge AI-85](/Forge AI/issues/Forge AI-85) (8.4 migration planner + Jira)
> **BMAD role:** Cloud Architect
> **Target hire:** `aws-transform-agent` (deferred — orchestrator is shipped as a pure planner until that role is filled)

---

## 0. Posture — orchestrate, do not rebuild

The single most important decision in this sub-goal is **what the orchestrator is and what it is not**.

The orchestrator is **a planner**, not an executor. v0.1 ships:

- A pure-Python `plan_waves(scope, graph) -> WavePlan` that emits a sequenced plan.
- The WavePlan is **the input contract** AWS Application Migration Service (MGN), AWS Database Migration Service (DMS), AWS Migration Hub, and AWS Migration Hub Refactor Spaces already understand.
- A per-wave **command list** that names the existing Forge AI seams (CCB v1 dispatch, secrets MCP, canary probe, MCP servers). v0.2 will execute that command list through those seams; v0.1 only plans it.

The orchestrator does **not**:

- Rebuild AWS MGN, DMS, Migration Hub, or Refactor Spaces logic.
- Reimplement the trust / OIDC federation already in `apps/customer-cloud-broker/` (Forge AI-126).
- Reimplement the per-service AWS dispatch already in `apps/customer-cloud-broker/` `dist/` (Forge AI-126.5).
- Reimplement the canary probe already in `apps/customer-cloud-broker/probe-signer.ts` (Forge AI-194).
- Reimplement the secrets-fetch already in `mcp-servers/secrets/` (Forge AI-128).
- Make outbound network calls or invoke the LLM.

If the orchestrator ever grows an LLM call, a `subprocess`, or an `import boto3` outside the `command_list`, that PR is rejected. The orchestrator is the same shape as the code analyzer: a typed seam that produces a deterministic artefact.

This posture is captured by the **build vs. orchestrate** lens in the CTO charter, and it is the only way the system stays diffable and reviewable. Orchestrating AWS Transform with our own reimplementation would defeat the point.

---

## 1. Scope and contract

`plan_waves(scope, graph) -> WavePlan` is the canonical call. It is:

- **Pure** — no I/O, no LLM, no HTTP, no `subprocess`.
- **Deterministic** — same `(scope, graph)` ⇒ byte-identical output modulo `report_id` and `planner_runtime_ms`.
- **Bounded** — runtime budget `< 10,000 ms`, `cost_usd == 0`.
- **Stable** — `planner_version = "wave-planner/0.1.0"`; schema v1 is closed; bump version on breaking changes.

```python
from agents.refactor import plan_waves, render_wave_plan
from agents.refactor import (
    MigrationScope,            # 8.1 input
    DependencyGraph,           # 8.2 input
    WavePlan,                  # 8.3 output (typed)
    TransformWave,
    WaveCommand,
    WaveGate,
)

scope: MigrationScope = analyze_scope(repo)         # 8.1
graph: DependencyGraph = build_graph(scope)         # 8.2
plan: WavePlan = plan_waves(scope, graph)           # 8.3
md: str = render_wave_plan(plan)                     # for Confluence / docs
```

`plan_waves` accepts:

1. `MigrationScope` + `DependencyGraph` — canonical, full fidelity (the smoke-test path).
2. `RepoScope` alone — orchestrator rebuilds the graph internally (slower but works for fixtures).

---

## 2. Why this is the right scope for 8.3

The cross-Epic gate says: previous sub-goal in Epic 8 must be done first.

- Forge AI-82 (8.1) — `analyze_scope` ships `MigrationScope` with categorisations, transform mappings (unit + tier), and risk assessments. v0.1 of that sub-goal is `in_review` per memory; we treat it as the contract the orchestrator consumes.
- Forge AI-83 (8.2) — `build_graph` ships `DependencyGraph` with fan-in / fan-out / blast-radius / Tarjan SCC cycles / service-level graph / tightly-coupled clusters. The wake for Forge AI-84 (`issue_blockers_resolved`) cleared when Forge AI-83 reached the gate. Orchestration without the graph would force us to guess at cycles and clusters — the same anti-pattern that 8.1's deterministic mapper was designed to eliminate.

The orchestrator is **pure planning** for v0.1 because:

- It is the cheapest path that produces a Board-reviewable artefact.
- It does not require AWS credentials, a tenant, or the GitHub MCP to be wired — those land in v0.2.
- It produces a deterministic JSON the migration planner (8.4) can diff against Jira epics without re-running the planner.

---

## 3. Top-level shape — `WavePlan`

```jsonc
{
  "schema_version": 1,
  "report_id": "<uuid>",
  "generated_at": "<iso-8601>",
  "source": "<mirror of MigrationScope.source>",
  "planner_version": "wave-planner/0.1.0",
  "repo_fingerprint": "<16-char sha256>",
  "deterministic": true,
  "planner_runtime_ms": 1.2,
  "cost_usd": 0.0,
  "waves": [TransformWave, ...],          // ordered, topologically sorted
  "cycle_breaks": [WaveBreak, ...],       // one per non-trivial SCC
  "cluster_breaks": [WaveBreak, ...],     // one per ServiceCluster
  "summary": WaveSummary,
  "notes": [string, ...]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | int | Closed at v1. Bump on breaking change. |
| `report_id` | string (uuid4) | Volatile — excluded from determinism check. |
| `planner_runtime_ms` | float | Volatile — excluded from determinism check. |
| `cost_usd` | float | Always 0.0 in v0.1 (no LLM, no AWS spend). |
| `repo_fingerprint` | string (16 hex chars) | sha256 over sorted `(path, language, loc, role)` tuples; mirrors 8.1 + 8.2 so the chain is end-to-end stable. |
| `waves` | list, sorted | Topological order. Wave 0 is the pre-flight; later waves fire only when prerequisites complete. |
| `cycle_breaks` | list | One entry per non-trivial SCC. Each break is itself a wave prepended before any wave that touches the cycle's members. |
| `cluster_breaks` | list | One entry per `ServiceCluster`. Forces the cluster's services to migrate as a co-migrated group. |

---

## 4. Wave shape — `TransformWave`

```jsonc
{
  "wave_id": 0,
  "wave_name": "preflight",
  "tier": "skip",
  "kind": "preflight",
  "target_aws_services": ["migrationhub", "secretsmanager"],
  "files": [],
  "prerequisites": [],
  "gates": [WaveGate, ...],
  "commands": [WaveCommand, ...],
  "audit_action": "transform.preflight",
  "estimated_effort_days": 0.0,
  "rationale": "Pre-flight: probe tenant credentials, canary MGN reachability, register repo with Migration Hub."
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `wave_id` | int | 0 is always pre-flight. Later waves get monotonically increasing ids. |
| `kind` | enum | `preflight` \| `cycle_break` \| `cluster_break` \| `tier_wave` \| `cutover` \| `validation`. |
| `tier` | enum | One of `TRANSFORM_TIERS`. `skip` for pre-flight / cycle-break / cutover. |
| `target_aws_services` | list | The AWS services this wave touches. v0.2 wires these to CCB dispatch. |
| `files` | list | File paths in the wave. Empty for pre-flight, cycle-break, cutover, validation. |
| `prerequisites` | list of `wave_id` | Hard topological dependency. |
| `gates` | list of `WaveGate` | Pre-flight + post-flight checks. A failed gate blocks the next wave. |
| `commands` | list of `WaveCommand` | The action list — typed, but not executed in v0.1. |
| `audit_action` | string | The audit-event name this wave emits on completion (per `agents/audit/schema.py`). |

### 4.1 `WaveGate`

```jsonc
{
  "gate_id": "wave-0.canary-probe",
  "kind": "canary_probe",
  "description": "Probe MGN reachability for the tenant before any wave fires.",
  "seam": "customer-cloud-broker/probe-signer",   // where the gate is implemented
  "blocking": true,
  "timeout_s": 30
}
```

`kind` is closed: `canary_probe` (Forge AI-194), `compile` (run the project's build), `unit_test` (run the smoke test), `lint`, `dep_check`, `secret_rotate_check` (Forge AI-128), `audit_completeness_check` (Forge AI-36). v0.1 emits the gate list; v0.2 wires the executor.

### 4.2 `WaveCommand`

```jsonc
{
  "command_id": "wave-2.cmd-0",
  "service": "ec2",
  "action": "MGN.start_replication",
  "params": {
    "source_server_id": "${repo.source_server_id}",
    "launch_template": "lt-t1-rehost"
  },
  "audit_action": "aws.mgn.start_replication",
  "via": "customer-cloud-broker/dispatch:ec2"
}
```

`service` is the AWS service the command targets. `action` is the AWS API call. `params` reference upstream values via `${repo.*}` or `${tenant.*}` (the broker resolves at execution). `via` names the Forge AI seam that executes it. v0.1 emits; v0.2 executes through the seam.

---

## 5. Sequencing algorithm

The orchestrator produces a topologically-sorted wave list with three orthogonal axes:

### 5.1 Tier axis — `T1 → T2 → T3 → T4`

The mapper (8.1) assigns every file a tier. The orchestrator groups files by tier and orders waves **ascending by tier**:

- **T1 (re-host)** — lift-and-shift. Goes through MGN. Lowest blast-radius per file; cheapest to roll back.
- **T2 (re-platform)** — managed runtime swap. Goes through DMS (for DB) or direct compute migrate.
- **T3 (re-architect)** — decomposed services. Goes through Refactor Spaces + ECS/Fargate containers.
- **T4 (re-imagine)** — greenfield rewrite. Goes through a greenfield deployment pipeline (the existing `apps/forge/` build / publish).

Files in the `skip` tier never enter a wave; the migration planner (8.4) emits a "no-op" Jira story instead.

### 5.2 Service-axis — clusters migrate together

A `ServiceCluster` from 8.2 (≥3 file-level edges between two services) means the services cannot be migrated independently — moving one without the other strands imports. The orchestrator emits a `cluster_break` wave that wires the cluster's services as a co-migrated group. The cluster's files land in a single wave (or split by tier within the cluster, if the cluster spans tiers).

### 5.3 Risk axis — high-risk waves get a canary probe

A wave is **high-risk** when it contains any `RiskAssessment.risk_level == "high"` file OR is a cycle-break wave (cycles are intrinsically high-risk). High-risk waves add `WaveGate` entries that:

1. Run the canary probe (`apps/customer-cloud-broker/probe-signer.ts`, Forge AI-194) before the wave fires.
2. Run a `secret_rotate_check` (Forge AI-128) before any wave that touches RDS / Aurora credentials.
3. Run a `audit_completeness_check` (Forge AI-36) after the wave completes.

### 5.4 Cycle axis — break-out waves fire first

For every non-trivial SCC (size ≥ 2, OR size 1 with self-loop), the orchestrator emits a `cycle_break` wave that runs **before** any other wave whose `files` set intersects the SCC's `members`. The break-out wave's `commands` define the interface contract that lets the cycle's members migrate independently (an ADR for each break is the v0.2 follow-up).

### 5.5 Topological sort

After the four axes are applied, waves are sorted:

```
preflight (wave 0)
  → cycle_breaks (sorted by cycle_id, ascending)
  → cluster_breaks (sorted by cluster_id, ascending)
  → tier_waves grouped by tier, then by service within tier
  → cutover (one final wave that flips DNS / routing)
  → validation (post-cutover smoke run)
```

Tie-breakers: ascending `tier`, ascending `service` (lexical), ascending `wave_id`. The output is **fully deterministic**.

---

## 6. AWS Transform mapping (orchestrate, not rebuild)

Every wave's `target_aws_services` is a closed-set mapping from the orchestrator's planning vocabulary to the AWS migration portfolio:

| Wave kind | Target AWS service(s) | Forge AI seam |
| --- | --- | --- |
| `preflight` | `migrationhub`, `secretsmanager`, `s3` (audit log) | `customer-cloud-broker/audit` |
| `cycle_break` | `migrationhub` (task tracker), `apigateway` (stub interface), `lambda` (contract) | `customer-cloud-broker/dispatch:apigateway`, `mcp-servers/jira` (story) |
| `cluster_break` | `migrationhub`, `refactor-spaces` (env wiring) | `customer-cloud-broker/dispatch:refactor-spaces` |
| T1 `ec2` (re-host) | `mgn`, `ec2`, `migrationhub` | `customer-cloud-broker/dispatch:ec2` |
| T2 `rds` / `aurora` (re-platform DB) | `dms`, `rds`, `aurora` | `customer-cloud-broker/dispatch:dms` |
| T2 `lambda` (light re-platform) | `lambda`, `apigateway` | `customer-cloud-broker/dispatch:lambda` |
| T3 `container` (re-architect) | `ecs`, `fargate`, `ecr`, `refactor-spaces` | `customer-cloud-broker/dispatch:ecs` |
| T3 `api_gateway` | `apigateway`, `lambda` | `customer-cloud-broker/dispatch:apigateway` |
| T3 `step_functions` | `stepfunctions`, `lambda` | `customer-cloud-broker/dispatch:stepfunctions` |
| T4 `container` (greenfield) | `ecs`, `fargate`, `ecr`, `s3` (artefact store) | `customer-cloud-broker/dispatch:ecs` + `forge/` build/publish |
| `cutover` | `route53`, `cloudfront`, `migrationhub` | `customer-cloud-broker/dispatch:route53` |
| `validation` | `cloudwatch`, `synthetics` canaries, `migrationhub` | `customer-cloud-broker/audit` |

The orchestrator **does not** import the AWS SDK. It emits `WaveCommand` lists. v0.2 executes those lists through the CCB dispatch table — never through direct SDK calls.

This is the seam-by-seam proof that "orchestrate, do not rebuild" is honoured: every wave's execution path is a Forge AI seam that already exists.

---

## 7. Secrets, credentials, and audit posture

Every wave that touches a credential carries:

- A `WaveGate.secret_rotate_check` referencing `mcp-servers/secrets/` (Forge AI-128). The orchestrator emits the gate; v0.2 runs it.
- A `WaveCommand.audit_action` referencing the canonical `agents/audit/schema.py` event name (Forge AI-36). The CCB audit emitter (`apps/customer-cloud-broker/audit.ts`) writes the event.

The orchestrator never holds a credential, never logs a credential, never references `process.env.AWS_*`. The "orchestrate, do not rebuild" posture extends to credentials: AWS calls happen in the CCB, where the existing `deny-list.ts` + `trust.ts` + `probe-signer.ts` already enforce the right posture.

Per-tenant isolation is preserved by the existing CCB trust model (Forge AI-126 §"OIDC federation broker" + the per-tenant deny-list). The orchestrator emits `WaveCommand.params.${tenant.*}` placeholders; the CCB resolves them against the tenant's broker context.

---

## 8. Outputs and acceptance contract

The smoke test (`agents/refactor/smoke_test_wave_planner.py`) asserts **≥24 acceptance criteria** across the canonical fixture plus four edge-case fixtures:

| # | AC | Verifier |
| --- | --- | --- |
| 1 | Consumes `(MigrationScope, DependencyGraph)`. | input shape check |
| 2 | Emits a `WavePlan` with ≥1 wave (pre-flight + content). | output shape check |
| 3 | Deterministic: two runs ⇒ byte-identical output (modulo volatile). | hash-equal |
| 4 | Wave 0 is always `preflight`. | first-wave invariant |
| 5 | Every non-trivial SCC has a `cycle_break` wave prepended before any wave touching its members. | topological check |
| 6 | Every `ServiceCluster` has a `cluster_break` wave. | coverage check |
| 7 | T1 waves come before T2, T2 before T3, T3 before T4. | tier order |
| 8 | `cutover` is the second-to-last wave; `validation` is last. | tail invariant |
| 9 | High-risk files (or any wave containing them) carry a `canary_probe` gate. | gate coverage |
| 10 | Every wave that touches a credential carries a `secret_rotate_check` gate. | gate coverage |
| 11 | Every wave has a non-empty `audit_action` referencing `transform.*` or `aws.*`. | audit completeness |
| 12 | Wave plan is JSON-serialisable (round-trip equal). | serializer |
| 13 | Cost bound: < 10 s and $0 per run. | timing + cost |
| 14 | Output is written to `forge/8.3/wave-plan.json` + `forge/8.3/wave-plan.md` + `agents/refactor/evidence/smoke_<ts>/result.json`. | artefact emission |
| 15 | Files in `skip` tier never appear in any wave. | coverage invariant |
| 16 | Each wave's `prerequisites` are all `wave_id < self.wave_id`. | topological invariant |
| 17 | Two ServiceClusters with overlapping services are merged into one `cluster_break`. | merge rule |
| 18 | Cycles of size 1 with self-loop produce a `cycle_break` with one file. | edge case |
| 19 | Empty graph (no files) produces exactly one `preflight` wave + one `cutover` + one `validation`. | edge case |
| 20 | Files whose transform mapping is `skip` are not scheduled; they appear in a `skipped` summary list. | skip semantics |
| 21 | Cluster break wave contains files from all services in the cluster. | coverage invariant |
| 22 | Cycle break wave's `audit_action` is `transform.cycle_break`. | naming invariant |
| 23 | No command references `boto3`, `subprocess`, `urllib`, `requests`, or any HTTP layer. | lint rule |
| 24 | The WavePlan's `repo_fingerprint` matches the upstream `MigrationScope.repo_fingerprint`. | fingerprint stability |

---

## 9. Artefacts produced by the smoke test

| Path | Purpose |
| --- | --- |
| `forge/8.3/wave-plan.json` | Canonical `WavePlan.to_dict()`. |
| `forge/8.3/wave-plan.md` | Human-readable wave-by-wave plan (Mermaid + table + command list). |
| `forge/8.3/aws-transform-orchestration.md` | This document — design + orchestrate-not-rebuild posture. |
| `agents/refactor/evidence/smoke_wave_<ts>/result.json` | Per-run evidence: AC booleans, fixture summaries, wave count, top-level runtime. |

---

## 10. Hand-off to Forge AI-85 (8.4 migration planner + Jira)

The migration planner consumes:

- `WavePlan.waves[*].files` — emits one Jira epic per wave.
- `WavePlan.waves[*].gates` — emits one Jira acceptance-criterion row per gate.
- `WavePlan.cycle_breaks` — emits one Jira epic per cycle, with a "break-out story" sub-task.
- `WavePlan.cluster_breaks` — emits one Jira epic per cluster, with the co-migrated services as linked issues.
- `WavePlan.summary` — emits a Jira release ticket per `(tier, service)` group.

The migration planner does **not** call AWS. It calls the Jira MCP (shipped via Forge AI-25) and writes stories whose AC text references the `audit_action` from each wave. The Forge AI-85 sub-goal inherits the same "orchestrate, do not rebuild" posture — it orchestrates Jira through the MCP, never rebuilds Jira fields locally.

---

## 11. What is explicitly out of scope for 8.3

- **AWS SDK calls** — v0.2 (post-`aws-transform-agent` hire). v0.1 emits `WaveCommand` lists; v0.2 routes them through CCB dispatch.
- **GitHub MCP wiring** — the orchestrator already consumes `MigrationScope` (8.1), which the GitHub MCP will populate in 8.1 v0.2. We do not duplicate that wiring here.
- **Cross-language edges** — same deferral as 8.2 §9. v0.1 only models the file-level graph 8.2 emits.
- **Per-tenant cost ceilings** — Forge AI-204 sync-plane R-X7 owns the cost-attribution work; 8.3 emits the right `audit_action` so cost events can be attributed per wave, but the per-tenant budget gate is owned by the sync-plane risk register.
- **Cluster community detection v0.2** — same deferral as 8.2. The ≥3-edge rule is the v0.1 contract.

---

## 12. Why this plan does not need a new agent hire to ship v0.1

The BMAD target hire is `aws-transform-agent`. We are not blocking v0.1 on that hire because:

1. The orchestrator is a pure planner. It does not need an agent runtime to ship.
2. The seams it orchestrates (CCB, secrets MCP, MCP servers) already exist and are tested.
3. The hire becomes a v0.2 question: an agent who can read this plan, drive the CCB, and handle the operator prompts (canary-probe failures, gate re-runs, cutover aborts). That's a runtime concern; this artefact is the planning contract that runtime consumes.

When the CEO proposes the hire, the acceptance criteria are: agent can read `forge/8.3/wave-plan.json`, drive `apps/customer-cloud-broker/` dispatch through the MCP layer, and emit `agents/audit/schema.py` events. Until then, v0.1 ships without the agent.

---

## 13. Summary — the orchestrate-not-rebuild check

A reviewer can audit "orchestrate, do not rebuild" by checking:

- [x] No `import boto3`, `import botocore`, `import aws-sdk` in `agents/refactor/`.
- [x] No `subprocess`, `urllib`, `requests`, `httpx` in `agents/refactor/`.
- [x] No LLM call (`anthropic`, `openai`, `litellm`) in `agents/refactor/`.
- [x] Every wave's `target_aws_services` maps to a CCB dispatch seam that already exists (Forge AI-126, Forge AI-126.5, Forge AI-194, Forge AI-128).
- [x] The WavePlan is a JSON artefact, not an executor. v0.2 (post-hire) is the executor.
- [x] `cost_usd == 0` always in v0.1.

If any of those checks fail, the PR is rejected. The posture is the contract.
