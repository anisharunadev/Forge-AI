# ADR-0007: gRPC for Orchestrator ↔ Agent Runtime (and the typed seam)

| Field             | Value                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------|
| **Status**        | **Accepted**                                                                                   |
| **Date**          | 2026-06-17                                                                                     |
| **Author**        | CTO (f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)                                                     |
| **Reviewer**      | CTO (one-way door; per architecture.md §5) — CEO informational                                |
| **Issue**         | [FORA-50](/FORA/issues/FORA-50) Sub-goal 0.1 (Master Orchestrator)                            |
| **Sub-task**      | [FORA-135](/FORA/issues/FORA-135) (0.1.2 — Stage transition engine)                           |
| **Parent ADR**    | [ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md)                               |
| **Supersedes**    | none                                                                                           |
| **Superseded by** | none                                                                                           |

---

## 1. Context

[ADR-0001](./adr-0001-master-orchestrator-sdlc-architecture.md) §2.3 and §7 make the Master Orchestrator the **only component that talks to the Agent Runtime, Memory, Cost, and Audit directly**. Sub-agents do not call each other; the Orchestrator is the seam. [FORA-50 spec §4.2](/FORA/issues/FORA-50#document-spec) names this seam as a gRPC contract with five RPCs: `CreateRun`, `AdvanceStage`, `GetRunContext`, `ReportCost`, `HealthCheck`.

The seam is a one-way door per architecture.md §5: every stage-owner process, every future MCP integration, and every internal observability tool pins to its wire format. JSON over HTTP is rejected for this internal surface per architecture.md §7 ("gRPC or in-process typed calls for internal service-to-service. No JSON over HTTP inside the platform.").

This ADR decides the wire format, the IDL tool, the authn, the versioning, and the SLA on the seam.

## 2. Decision

We adopt **gRPC with Protocol Buffers v3 (proto3)** for the Orchestrator's internal service surface. The IDL is the single source of truth; generated TypeScript and Python stubs are checked into each consumer's repo.

### 2.1 One-line summary

> "gRPC + proto3 for Orchestrator ↔ Runtime; the IDL is the contract; the only seam is `GetRunContext`; p99 < 1 s on every stage transition."

## 3. The IDL (proto3)

The contract lives in `orchestrator.proto` and is the source of truth for the wire format. The generated TypeScript and Python stubs are checked into the consumer repos and the Orchestrator monorepo. The `.proto` file is the API documentation; the worked example is in §6.

```proto
syntax = "proto3";
package fora.orchestrator.v1;

import "google/protobuf/timestamp.proto";

// The header carried on every request.
message RunContext {
  string run_id = 1;
  string tenant_id = 2;        // from JWT (ADR-0003)
  string stage = 3;            // ideation | architect | dev | qa | security | devops | docs
  string status = 4;           // pending | running | waiting_approval | approved | rejected | returned | skipped
  google.protobuf.Timestamp started_at = 5;
  repeated ArtefactRef inputs = 6;       // typed pointers (ADR, PR, report)
  map<string, string> labels = 7;        // for ad-hoc annotation
  string idempotency_key = 8;            // echoed on every retry
}

message ArtefactRef {
  string kind = 1;             // adr | pr | report | page | jira
  string url = 2;
  string sha256 = 3;           // hex, 64 chars
}

message AdvanceStageRequest {
  string run_id = 1;
  string from_stage = 2;
  string to_stage = 3;
  Decision decision = 4;       // next | abort | return
  ArtefactRef artefact = 5;
  string idempotency_key = 6;
}

message Decision {
  enum Kind { NEXT = 0; ABORT = 1; RETURN = 2; }
  Kind kind = 1;
  string reason = 2;           // required for ABORT and RETURN
  string returned_to_stage = 3; // required when kind = RETURN
}

message StageDecision {
  string run_id = 1;
  string current_stage = 2;
  string status = 3;           // running | waiting_approval | finished
  string event_id = 4;         // the published event_id
}

message CreateRunRequest {
  string tenant_id = 1;        // from JWT, not from caller
  string goal_id = 2;
  string project_id = 3;
  Trigger trigger = 4;
  string idempotency_key = 5;
}

message Trigger {
  enum Kind { USER = 0; SLACK = 1; EMAIL = 2; SCHEDULE = 3; WEBHOOK = 4; }
  Kind kind = 1;
  string actor = 2;            // user id, channel, address, etc.
  string payload_ref = 3;      // pointer to the trigger payload
}

message Run {
  string run_id = 1;
  string tenant_id = 2;
  string status = 3;
  string current_stage = 4;
  google.protobuf.Timestamp created_at = 5;
}

message ReportCostRequest {
  string run_id = 1;
  string stage = 2;
  int64 tokens_in = 3;
  int64 tokens_out = 4;
  string currency = 5;         // ISO 4217, default "USD"
  Money cost = 6;
  string idempotency_key = 7;
}

message Money {
  int64 units = 1;             // dollars
  int64 nanos = 2;             // 1e-9 dollars
}

message Ack {
  bool ok = 1;
  string event_id = 2;         // cost_reported event id, on success
}

message HealthCheckRequest {}
message HealthCheckResponse {
  enum State { SERVING = 0; DEGRADED = 1; NOT_SERVING = 2; }
  State state = 1;
  string version = 2;
  map<string, string> deps = 3; // name → "ok" | "down" | "degraded"
}

service Orchestrator {
  rpc CreateRun(CreateRunRequest) returns (Run);
  rpc AdvanceStage(AdvanceStageRequest) returns (StageDecision);
  rpc GetRunContext(RunContextRequest) returns (RunContext);
  rpc ReportCost(ReportCostRequest) returns (Ack);
  rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
}

message RunContextRequest {
  string run_id = 1;
  string stage = 2;            // which stage's context to fetch
}
```

### 3.1 Why proto3, not Avro / Thrift / Cap'n Proto

- **Tooling.** gRPC has first-class generators for TypeScript and Python (the two languages the platform uses per [standards.md §1.1](/FORA/docs/engineering/standards.md)). Avro requires a separate schema-registry deployment; Thrift is fine but its generators are second-class for the languages we ship.
- **Streaming.** `AdvanceStage` is request/response today, but a future RPC for streaming per-stage tokens (Cost agent's live dashboard) is one-line. Avro and Thrift can do it; gRPC is the path of least resistance.
- **Industry.** Every MCP server in [mcp-servers/](/FORA/mcp-servers) is JSON-RPC; the Agent Runtime is Python. gRPC is the natural upgrade path when JSON over HTTP stops scaling.

## 4. Authn

- Every gRPC call carries the **FORA-issued JWT** from the identity broker (ADR-0003 §3.2).
- The Orchestrator's gRPC server validates the token via the broker's JWKS endpoint (cached 5 min, refreshed on `kid` rotation).
- The agent token has `aud: "forge-runtime"` and a 5-minute TTL; the broker re-issues per stage.
- The Orchestrator's gRPC server is reachable **only from the platform VPC**; no public listener.

## 5. Versioning

- The proto package is `fora.orchestrator.v1`. The major version is in the package name.
- **Additive change** (new optional field, new RPC, new enum value with `[(reserved)]` to prevent reuse) → minor bump on the proto file, regenerated stubs. No coordination.
- **Breaking change** (rename field, change type, remove RPC, change semantic) → major bump to `v2`, new service definition, parallel deployment. The `v1` server keeps running for 90 days; the `v2` server is the new default. A future ADR supersedes this one with the v2 wire format.
- Generated stubs are committed (not generated at build time) so a `git blame` lands on a contract change.

## 6. Worked example (one full AdvanceStage call)

```text
1. Dev stage agent finishes its work; calls
   Orchestrator.AdvanceStage({
     run_id: "run-9f0c…",
     from_stage: "dev",
     to_stage: "qa",
     decision: { kind: NEXT, reason: "" },
     artefact: { kind: "pr", url: "https://github.com/acme/app/pull/42", sha256: "abc…" },
     idempotency_key: "9f0c…-dev→qa-2026-06-17T12:34Z"
   })

2. Orchestrator receives. Validates JWT (aud=forge-runtime, tenant_id matches run.tenant_id).
   Validates from_stage = run.current_stage. Validates to_stage is the next in the spine
   (architecture.md §3; never a skip). Validates the decision kind matches the gate rule
   (FORA-50 spec §2.3). Validates artefact.sha256 is 64 lowercase hex.

3. Orchestrator begins a DB transaction:
     - UPDATE agent_run_stages SET status='approved', finished_at=now(), decision={...}
       WHERE run_id=? AND stage='dev';
     - UPDATE agent_runs SET current_stage='qa' WHERE id=?;
     - INSERT INTO agent_run_events (event_type='gate_passed', payload={from, to, artefact});
     - COMMIT.

4. Orchestrator publishes `gate_passed` to NATS (ADR-0006) inside a publisher confirm.
   event_id = uuidv7().

5. Orchestrator returns StageDecision{ current_stage: "qa", status: "running", event_id }.

6. Dev agent tears down its stage context; QA agent is woken by the run-state subscription
   (or by the platform scheduler; the wake path is out of scope for this ADR).
```

If step 4 fails after the DB COMMIT, the Orchestrator retries the publish on a backoff until the publisher confirm arrives; if it never arrives, the run is paused and an `error` event is emitted. The DB row exists, the bus eventually catches up.

If step 3 fails (DB error), the Orchestrator returns `INVALID_ARGUMENT` with a typed reason; the agent retries. The `Idempotency-Key` (here `idempotency_key`) makes a retry a no-op once step 3 succeeded.

## 7. SLA

Per [FORA-50 spec §2.3 acceptance](/FORA/issues/FORA-135) and architecture.md §8:

| RPC             | p50     | p99   | Notes                                              |
|-----------------|---------|-------|----------------------------------------------------|
| `CreateRun`     | < 200ms | < 1s  | One DB write + one NATS publish.                   |
| `AdvanceStage`  | < 200ms | < 1s  | Three DB writes (stages, runs, events) + NATS.     |
| `GetRunContext` | < 50ms  | < 200ms| One DB read; the **single seam** of the platform.  |
| `ReportCost`    | < 100ms | < 500ms| One DB write + one NATS publish.                   |
| `HealthCheck`   | < 20ms  | < 100ms| Cache the response for 5s.                        |

A missed budget is a P2 bug per architecture.md §8.

## 8. Failure modes

| Failure                          | Behavior                                                                                |
|----------------------------------|-----------------------------------------------------------------------------------------|
| Orchestrator down                | Stage agent cannot advance; run is checkpointed at the last successful stage; resumes when the Orchestrator returns. The `GetRunContext` call is a hard fail — the runtime is down — and the agent surfaces "runtime unavailable" to the user. |
| Auth broker down                 | The Orchestrator's gRPC server returns `UNAUTHENTICATED`; runs cannot start. This is the one failure mode that halts (per FORA-50 spec §7). |
| DB write fails                   | Typed `INTERNAL` error; agent retries with the same `Idempotency-Key`.                 |
| NATS publish fails (post-DB)     | Background retry; `error` event emitted; run continues (the audit row is the source of truth). |
| Stage agent crashes mid-call     | gRPC deadline (default 30s) trips; Orchestrator returns `DEADLINE_EXCEEDED`; the run remains in `running`; the next health check re-evaluates. |

## 9. Consequences

### Positive

- **The IDL is the contract.** A future sub-agent hire reads `orchestrator.proto` and knows the full surface. No "where is the API documented" chase.
- **Strong typing end-to-end.** A wrong field type fails at the stub boundary, not at runtime.
- **Streaming-ready.** When a future Cost agent needs live tokens, the streaming RPC is one line.
- **Cross-language.** TypeScript (Orchestrator), Python (Agent Runtime) both have first-class generators.

### Negative / risks

- **gRPC debugging is harder than REST.** We mitigate with `grpcurl` + a `health` RPC + structured logging on every request (with the JWT redacted). Every dev gets `grpcurl` in the image.
- **Generated stubs are committed.** A schema change touches every consumer repo. Mitigated by additive-only-by-default and the 90-day deprecation window for breaking changes.
- **The Orchestrator is the only place to change the contract.** Mitigated by code review on `orchestrator.proto` (the CTO reviews every PR) and by ADR-0001's principle that sub-agents never bypass the Orchestrator.

## 10. Alternatives considered

1. **REST + JSON over HTTP.** Rejected per architecture.md §7 ("no JSON over HTTP inside the platform"). Replaying the same surface in REST doubles the contract surface and forfeits the typed-stub property.
2. **In-process typed calls (Python, shared memory).** Rejected: the Agent Runtime is a separate process per ADR-0001 §2.1; the Orchestrator is a separate TypeScript service. In-process is not on the table.
3. **Apache Thrift.** Rejected: tooling for TypeScript + Python is fine, but gRPC's streaming and metadata story is better and the industry alignment is wider.
4. **Custom binary protocol.** Rejected: re-implementing a wire protocol is a maintainability disaster and buys nothing.
5. **GraphQL.** Rejected: GraphQL is great for public APIs where the consumer picks the fields. For a typed service-to-service seam, the consumer is fixed and the typed contract is more valuable than the field-pick property.

## 11. Out of scope (future ADRs / follow-ups)

- **Streaming RPCs** for live cost reporting. A v1.1 ADR when the Cost agent's dashboard needs it.
- **Bidirectional streaming** for the Forge console's live stage view. A v1.1 ADR.
- **gRPC-web** for the browser console. A v1.1 ADR; the console currently polls a thin REST adapter.
- **A second service surface for Memory, Cost, Audit.** Today those are the same Orchestrator process; if any one of them needs a different SLA or scale profile, it gets its own service and its own IDL, per ADR-0001 §2.1.

## 12. Reviewer sign-off

This ADR is a **one-way door** (per architecture.md §5). The CTO signs every one-way-door ADR; CEO sign-off is not required for this scoped decision because it is bounded to the internal wire format and does not touch the cross-stage spine defined in ADR-0001.

- [x] **CTO — approved as proposed on 2026-06-17** (author: f4d4bf77-2a6b-41e0-b3c5-4a688e2913f0)
- [ ] CEO — informational copy; this ADR does not require CEO sign-off per architecture.md §5

### Follow-up issues (opened on acceptance)

- [FORA-135](/FORA/issues/FORA-135) — Implement the state machine and `AdvanceStage` per this ADR
- [FORA-30](/FORA/issues/FORA-30) — Agent runtime uses this IDL as the seam
- A future ADR will publish the v1.0.0 `orchestrator.proto` file in the Orchestrator monorepo
