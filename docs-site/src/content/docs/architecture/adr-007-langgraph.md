---
title: ADR-007 — LangGraph SDLC agent orchestrator
description: Workflows are LangGraph state machines with checkpoints and HITL gates.
---

## Status

Accepted — 2026-06-20

## What is this?

The binding decision that the workflow runtime is **LangGraph** with a typed `SDLCState`, checkpointing for resumability, and HITL gate nodes.

## Context

Forge workflows compose multiple agents into a single multi-step run. They need to:

- Maintain typed state across nodes.
- Resume from the last successful node on failure.
- Pause at HITL gates and resume on human approval.
- Emit audit rows on every transition.
- Compose with the connector framework and the data layer.

The forces at play:

- Rule R3 (mandatory approval gates) requires a runtime that can pause and resume.
- Rule R6 (mandatory auditability) requires a runtime that emits typed transitions.
- Long-running workflows (hours) require durable checkpoints, not in-memory state.
- Time-to-pilot is reduced if we use a battle-tested framework rather than build our own.

## Decision drivers

- Rule R3: Mandatory approval gates
- Rule R6: Mandatory auditability
- NFR-032, DL-002: HITL at architecture, security, deployment
- F-019: Forge Command Map
- Pilot requirement for resumable workflows

## Considered options

- LangGraph — **chosen**
- Custom-built orchestrator
- Temporal
- Apache Airflow

## Decision outcome

Chosen option: **LangGraph**.

| Aspect | Detail |
|---|---|
| State | `SDLCState` (Pydantic v2) per workflow run |
| Persistence | PostgreSQL checkpoints |
| Gates | HITL nodes with typed approval |
| Composition | `StateGraph` with conditional edges |
| Tooling | LangChain utilities for LLM I/O |

## SDLCState

The state is a Pydantic v2 model:

```python
class SDLCState(BaseModel):
    tenant_id: UUID
    project_id: UUID
    workflow_id: str
    user_id: str

    # Typed artifacts produced so far
    artifacts: list[Artifact] = []

    # The current gate, if any
    gate: GateState | None = None

    # Cost accumulated
    cost_actual: Decimal = Decimal("0")

    # Free-form scratch space for agents
    scratch: dict = {}

    # Audit-friendly timestamp of last transition
    last_transition_at: datetime
```

## Graph shape

```python
def build_graph() -> StateGraph:
    g = StateGraph(SDLCState)

    g.add_node("ideate",       IdeateAgent())
    g.add_node("architect",    ArchitectAgent())
    g.add_node("arch_gate",    HITLGate(artifact_type="ADR"))
    g.add_node("develop",      DevelopAgent())
    g.add_node("test",         TestAgent())
    g.add_node("security",     SecurityAgent())
    g.add_node("sec_gate",     HITLGate(artifact_type="SecurityReport"))
    g.add_node("deploy_plan",  DeployPlanAgent())
    g.add_node("deploy_gate",  HITLGate(artifact_type="DeploymentPlan"))
    g.add_node("deploy",       DeployAgent())

    g.add_edge("ideate",    "architect")
    g.add_edge("architect", "arch_gate")
    g.add_conditional_edges(
        "arch_gate",
        lambda s: "develop" if s.gate.decision == "approve" else "abort",
    )
    g.add_edge("develop",   "test")
    g.add_edge("test",      "security")
    g.add_edge("security",  "sec_gate")
    g.add_conditional_edges(
        "sec_gate",
        lambda s: "deploy_plan" if s.gate.decision == "approve" else "abort",
    )
    g.add_edge("deploy_plan", "deploy_gate")
    g.add_conditional_edges(
        "deploy_gate",
        lambda s: "deploy" if s.gate.decision == "approve" else "abort",
    )

    g.set_entry_point("ideate")
    return g
```

## HITL gates

A gate node:

1. Marks the state as `awaiting_gate`.
2. Emits an audit row (`gate_opened`).
3. Pauses until a human decision arrives.
4. On decision, validates, applies, emits `gate_decided`, and routes via conditional edge.

Decisions are typed: `approve | approve_with_changes | reject`.

## Checkpointing

Every node transition writes a checkpoint to PostgreSQL. On failure:

- The workflow restarts from the last successful checkpoint.
- The state is reconstructed.
- Audit rows are preserved.

This is the durability story for long-running workflows.

## Composition with `forge-*` commands

Each agent node may invoke one or more `forge-*` commands via the wrapper. The wrapper:

- Resolves the user-facing name to the internal action.
- Sets the tenant and project context.
- Emits an audit row.
- Returns the result to the agent.

## Consequences

**Positive:**

- Battle-tested framework; no build cost.
- Typed state preserves data shape across nodes.
- Checkpointing gives durability for free.
- HITL gates are first-class (LangGraph supports them natively).
- OpenTelemetry instrumentation is built-in.

**Negative:**

- The orchestrator is a single point of failure; needs HA.
- LangGraph's API is evolving; we track upstream releases.

**Neutral:**

- The state shape is specific to Forge; not generic.

## Alternatives considered

### Custom-built orchestrator

Pros: Tailored.

Cons: Build cost; we re-invent LangGraph.

### Temporal

Pros: Mature; durable; widely deployed.

Cons: Different paradigm (activity-based, not graph-based); harder to express conditional edges per HITL outcome; extra operational surface.

### Apache Airflow

Pros: Mature.

Cons: Batch-oriented; not real-time; poor fit for interactive workflows.

## Related

- [ADR-005: LiteLLM Proxy](/architecture/adr-005-litellm/)
- [ADR-008: Append-only WORM audit](/architecture/adr-008-worm-audit/)
- [Agent operating system](/concepts/agent-operating-system/)
- [Approval model](/architecture/approval-model/)
