---
draft: false
title: Custom Agents
description: Add a new agent to the LangGraph SDLC orchestrator.
---

The LangGraph orchestrator composes multiple agents. This guide shows how to add a new one — what to subclass, how to register it, and how to test it.

## What is this?

A **custom agent** is a new node in the LangGraph `StateGraph` that performs a specific task: code review, documentation generation, security analysis, etc. It runs inside the orchestrator, gets `SDLCState` as input, returns a state update.

## When to add a custom agent

Add a custom agent when:

- The existing `forge-*` commands don't cover your workflow.
- You have a domain-specific need (e.g., a regulated industry check, a custom lint).
- You want to compose multiple existing commands into a single typed output.

Don't add a custom agent when:

- You can compose existing commands with `forge-flow-*` — that's the preferred path.
- Your agent is purely prompt engineering — extend the prompt templates instead.

## Anatomy of a custom agent

```python
# backend/app/agents/<area>/<name>.py

from backend.app.agents.base import SDLCAgent, SDLCState
from backend.app.services.forge_commands import route_to_gsd

class MyCustomAgent(SDLCAgent):
    name = "my_custom_agent"

    async def run(self, state: SDLCState) -> SDLCState:
        # Read from state
        tenant_id = state.tenant_id
        project_id = state.project_id
        context = state.context

        # Do work — possibly call a forge-* command
        result = await route_to_gsd(
            "forge-intel-summarize",
            {"repo_id": context["repo_id"]},
            tenant_id=tenant_id,
            project_id=project_id,
            user_id="system:agent:my_custom_agent",
        )

        # Update state
        state.artifacts.append(result.artifact)
        state.cost_actual += result.cost_usd
        return state
```

## Steps

### 1. Define the agent

Create the agent file under `backend/app/agents/<area>/`. The agent class:

- Extends `SDLCAgent`.
- Has a `name` attribute.
- Implements `async def run(self, state: SDLCState) -> SDLCState`.

### 2. Register in the orchestrator

Add the agent to the appropriate LangGraph `StateGraph`:

```python
# backend/app/agents/orchestrator.py

from backend.app.agents.area.my_custom_agent import MyCustomAgent

def build_graph() -> StateGraph:
    g = StateGraph(SDLCState)
    g.add_node("ideate", IdeateAgent())
    g.add_node("architect", ArchitectAgent())
    g.add_node("my_custom", MyCustomAgent())        # <-- new
    g.add_node("develop", DevelopAgent())
    # ...
    g.add_edge("architect", "my_custom")
    g.add_edge("my_custom", "develop")
    return g
```

### 3. Add HITL gate if needed

If the agent produces a typed artifact that should be reviewed, route the edge through a HITL gate:

```python
from backend.app.agents.gates import HITLGate

g.add_node("my_custom_gate", HITLGate(artifact_type="RiskRegister"))
g.add_edge("architect", "my_custom")
g.add_edge("my_custom", "my_custom_gate")
g.add_conditional_edges(
    "my_custom_gate",
    lambda state: "develop" if state.gate_decision == "approve" else "ideate",
)
```

### 4. Add a forge-* command (optional)

If the agent should be invocable directly (not just as part of a workflow), add a `forge-*` command:

```python
# backend/app/services/forge_commands.py
("forge-custom-my-task", "custom.my_task", "Run my custom task", "user", False),
```

### 5. Test

Three test layers:

- **Unit** — instantiate the agent with a fixture state and assert the output state.
- **Integration** — run the agent against a staging tenant and verify the typed artifact.
- **E2E** — run a workflow that includes the agent and verify the full graph.

### 6. Document

Add a page under `docs-site/src/content/docs/` describing the agent, its inputs, its outputs, and its approval posture.

## Anti-patterns

- **Don't bypass SDLCState.** The agent reads from and writes to `SDLCState`. Direct DB writes break the audit chain.
- **Don't call LLM APIs directly.** Go through the LiteLLM Proxy (see [ADR-005](/architecture/adr-005-litellm/)).
- **Don't write free-form prose.** Produce a typed artifact.
- **Don't hardcode tenant IDs.** Use the one in `state.tenant_id`.

## Observability

Every agent automatically emits OpenTelemetry spans with:

- `agent.name`
- `tenant.id`
- `project.id`
- `workflow.id`
- `cost.usd` (if applicable)

Plus an audit row on every state transition.

## Related

- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
- [Typed artifacts](/concepts/typed-artifacts/)
- [Adding connectors](/guides/adding-connectors/)
