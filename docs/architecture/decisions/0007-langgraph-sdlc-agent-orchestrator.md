# ADR-007: LangGraph as SDLC agent orchestrator

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group

## Context and Problem Statement

The Forge SDLC Agent must execute a full SDLC cycle (discover -> plan -> build -> test -> review -> deploy) with:

- Stateful, multi-step execution across multiple LLM calls.
- Human approval gates at Architecture, Security, and Deployment boundaries (Rule 3, NFR-032, DL-002).
- Tool use (MCP tools, knowledge graph queries, `forge-*` command invocations, file operations).
- Resumability: a long-running agent must survive a process restart and resume from where it left off.
- Strong typing of state across steps.
- Observability via OpenTelemetry (Rule 7).

We must choose the orchestration framework.

The forces at play:

- The agent is the central user-visible artifact of the platform; its behavior shapes customer trust.
- Custom state machines are powerful but require substantial boilerplate (cycle handling, checkpointing, tool registration).
- Rule 3 mandates human approval gates; the framework must support pause-and-resume natively.
- Rule 1 mandates that all LLM traffic flow through LiteLLM; the orchestrator must integrate cleanly with LiteLLM.

## Decision Drivers

- Rule 3: Mandatory human approval gates
- Rule 1: Model-provider agnosticism (LiteLLM integration)
- Rule 7: Mandatory observability (OpenTelemetry)
- F-205: Approval workflow integration
- Resumability across long-running runs (hours to days)

## Considered Options

- LangGraph (Python) - chosen
- Custom state machine (in-house)
- AutoGen (Microsoft)
- CrewAI
- Raw LangChain (chains only, no native cycles)

## Decision Outcome

Chosen option: **LangGraph (Python) as the SDLC agent orchestrator**.

Architecture:

- `SDLCState` (Pydantic v2 model) is the typed state object passed between nodes.
- Each GSD phase becomes a LangGraph node: `discover`, `plan`, `build`, `test`, `review`, `deploy`.
- A supervisor graph routes between phases based on state and policy.
- Human approval gates are graph nodes that pause for input (`interrupt_before` / `interrupt_after`).
- Tools are registered as `ToolNode`s: `gsd_wrapper` (white-labeled `forge-*` invocations, ADR-004), `mcp_client`, `knowledge_graph`, `repomix_wrapper`, `cost_tracker`.
- Checkpointing uses LangGraph's built-in persistence (Postgres-backed) for resumability.
- OpenTelemetry spans wrap each node; LLM calls go through LiteLLM (ADR-005).

### Consequences

Positive:

- Explicit graph: the SDLC flow is visible in code, not implicit in control flow.
- Native checkpointing: long runs survive restarts.
- Strong typing via Pydantic v2 reduces bugs in state transitions.
- Built-in human-in-the-loop via `interrupt_before` / `interrupt_after` directly satisfies Rule 3.
- Clean integration with LiteLLM (LangChain-compatible chat models use LiteLLM via the proxy URL).
- OpenTelemetry hooks exist for tracing and metrics.

Negative:

- LangGraph-specific learning curve; new engineers must learn the framework.
- Some abstractions (channels, conditional edges) take time to internalize.
- Versioning: LangGraph is evolving; pinning to a stable version is mandatory.

Neutral:

- The graph shape itself becomes a reviewable artifact subject to ADR-style governance.

## Alternatives Considered

### Custom state machine (in-house)

Pros:

- Exactly fits Forge's needs.
- No framework dependency.

Cons:

- Significant boilerplate: cycle handling, checkpointing, tool registration, error retry.
- Reinventing primitives that LangGraph already provides and tests.
- Rejected: too much boilerplate for too little gain.

### AutoGen (Microsoft)

Pros:

- Multi-agent conversation patterns.
- Production usage at Microsoft.

Cons:

- Less production-ready than LangGraph for long-running, stateful workflows.
- Human-in-the-loop support is weaker than LangGraph's `interrupt` primitives.
- Rejected: weaker HITL story for a Rule 3-mandated use case.

### CrewAI

Pros:

- High-level role-based agent abstractions.
- Quick to prototype.

Cons:

- Weak human-in-the-loop support (no native pause/resume graph).
- Less mature observability story.
- Rejected: weak HITL is disqualifying.

### Raw LangChain (chains only, no native cycles)

Pros:

- Already in the stack.

Cons:

- No native cycle handling; multi-step stateful workflows must be hand-rolled.
- Rejected: reinventing what LangGraph already provides.

## Pros and Cons of the Chosen Option

Pros:

- Native graph abstraction matches the SDLC topology directly.
- Native checkpointing for long-running resumability.
- Native HITL primitives satisfy Rule 3.
- Pydantic v2 state typing reduces cross-step bugs.
- LiteLLM integration via LangChain-compatible chat models satisfies Rule 1.

Cons:

- LangGraph-specific learning curve.
- Framework versioning must be managed.

## References

- ADR-004: GSD white-labeling (GSD phases wrapped as `forge-*`)
- ADR-005: LiteLLM Proxy as Provider Abstraction Layer (all LLM calls go through here)
- ADR-003: Hybrid MDM + Steward priority conflict resolution (graph nodes are state fields)
- ADR-008: Append-only WORM audit trail (every node execution audited)
- Constitution Rule 1, Rule 3, Rule 7
- PRD F-205, NFR-032, DL-002