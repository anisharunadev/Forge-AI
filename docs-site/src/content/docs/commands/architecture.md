---
title: Architecture Commands
description: The 6 architecture commands — diagram, component-map, contract-spec, data-model, adr, drift.
---

The architecture category has 6 commands that produce architectural artifacts from the knowledge graph or the codebase.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-arch-diagram` | user | no | Render a system diagram from the model |
| `forge-arch-component-map` | user | no | List components and their dependencies |
| `forge-arch-contract-spec` | admin | yes | Draft API/data contracts between components |
| `forge-arch-data-model` | admin | yes | Generate or update the data model |
| `forge-arch-adr` | admin | yes | Record an architectural decision record |
| `forge-arch-drift` | user | no | Detect drift between code and architecture |

## What is this category for?

Architecture is the **typed middle layer** between ideation and development. Every artifact produced here is reviewable at the Architecture approval gate.

## How to use

### Diagram

```bash
pnpm forge:exec forge-arch-diagram \
  --args '{"scope":"project","format":"mermaid"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Renders a system diagram from the project intelligence graph. Output is Mermaid by default; C4 and graphviz are supported.

### Component map

```bash
pnpm forge:exec forge-arch-component-map \
  --args '{"repo_id":"acme-api"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Lists components (services, databases, queues) and their dependencies. Output is a structured list and a graph.

### Contract spec (admin, requires approval)

```bash
pnpm forge:exec forge-arch-contract-spec \
  --args '{"service_a":"orders","service_b":"billing","version":"v2"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Drafts an API/data contract between two services. Output is an `API Contract` typed artifact. The HITL gate ensures the contract is reviewed before development starts.

### Data model (admin, requires approval)

```bash
pnpm forge:exec forge-arch-data-model \
  --args '{"service":"orders","operation":"add_idempotency_key","target":"orders.events"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Generates or updates a data model. Output is a SQL migration preview (not applied) and an `ADR` describing the change.

### ADR (admin, requires approval)

```bash
pnpm forge:exec forge-arch-adr \
  --args '{"title":"Use idempotency keys for orders events","context_ref":"ctx-001","decision_ref":"idea-001"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Produces an ADR typed artifact. The decision is grounded in the referenced context and idea. The HITL gate is mandatory.

### Drift

```bash
pnpm forge:exec forge-arch-drift \
  --args '{"repo_id":"acme-api","baseline":"main"}' \
  --tenant-id acme-corp --project-id acme-api --user-id architect@acme.com
```

Compares the current codebase against the architectural record and reports drift. Drift includes: services in code but not in the architecture, services in the architecture but not in code, contract drift, ownership drift.

## When to use

| Scenario | Command |
|---|---|
| Update the system diagram | `forge-arch-diagram` |
| Onboard a new architect to the system | `forge-arch-component-map` |
| Define a contract between two services | `forge-arch-contract-spec` (admin) |
| Add a column or table | `forge-arch-data-model` (admin) |
| Record a decision | `forge-arch-adr` (admin) |
| Detect undocumented code | `forge-arch-drift` |

## Output

Architecture commands produce typed artifacts:

- `forge-arch-adr` → ADR (see [Typed artifacts](/concepts/typed-artifacts/))
- `forge-arch-contract-spec` → API Contract
- `forge-arch-data-model` → Data Model Change + ADR
- `forge-arch-diagram` / `-component-map` / `-drift` → Reports

## Related

- [Ideation commands](/commands/ideation/) — `forge-ideate-crystallize` seeds an ADR
- [Typed artifacts](/concepts/typed-artifacts/)
- [Approval gates](/concepts/approval-gates/)
- [ADR-007: LangGraph SDLC orchestrator](/architecture/adr-007-langgraph/)
