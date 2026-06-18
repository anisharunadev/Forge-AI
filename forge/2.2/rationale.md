# Architecture Style Detection — Rationale

- **Source graph:** `/home/arunachalam.v@knackforge.com/.paperclip/instances/default/projects/3fde3945-9dcb-4c43-95b3-4e4e9db6ffe9/bb09220b-5ed2-47b3-9c58-d3e05cefb413/_default` (`schemaVersion=1`, `345` nodes, `1325` edges)
- **Graph generated at:** 2026-06-17T17:19:54Z
- **Detector:** `arch-style-detector/0.1.0` (runtime = 2.522 ms, model spend = $0.00)
- **Deterministic:** yes

## Headline

**Top tag: `microservices` (confidence = 0.90).**

_5 services, 0 cross-service file imports, 11 per-service entry points._

## Tags (sorted by confidence, descending)

| Style | Confidence | Rationale |
|-------|-----------:|-----------|
| `microservices` | 0.90 | 5 services, 0 cross-service file imports, 11 per-service entry points. |
| `hexagonal-clean` | 0.80 | ports=3, adapters=8, central types fan-in ≥ 10: 4. |
| `modular-monolith` | 0.50 | services=5, has_apps=True, has_packages=True, cross-service file imports = 0. (capped — services are microservice-shaped, not classic modular monolith). |
| `pipeline` | 0.35 | pipeline paths = 2; pipeline library fan-in = 0. |
| `layered` | 0.20 | 1 layer keyword(s) present; 0 layering violations. |
| `event-driven` | 0.15 | broker fan-in = 0 across 0 packages; 25 event-bus/bridge paths. |
| `cqrs` | 0.00 | 0 CQRS-shaped paths; CQRS library fan-in = 0. |
| `ddd` | 0.00 | 0 DDD-shaped paths; 0 value-object file(s). |
| `monolith` | 0.00 | 5 service group(s); 2 cycle(s); cross-service file imports = 0. |
| `serverless` | 0.00 | serverless paths = 0; serverless SDK fan-in = 0. |

## Evidence (per tag)

### `microservices` — confidence 0.90

  - *positive* — 5 top-level service groups — independently buildable. (`service_count` = 5)
  - *positive* — Zero cross-service file imports — services share only via packages.
  - *positive* — 11 entry points under apps/ or mcp-servers/ — multiple runnable services.

### `hexagonal-clean` — confidence 0.80

  - *positive* — 3 ports file(s) and 8 adapter file(s). (`port_adapter_count` = 11)
    - `apps/agent-runtime/src/orchestrator/memory-ports.ts`
    - `apps/agent-runtime/src/orchestrator/ports.ts`
    - `apps/customer-cloud-broker/src/adapters/aws.ts`
    - … and 8 more
  - *positive* — 4 central types/ports file(s) with inDegree ≥ 10.
    - `apps/agent-runtime/src/types.ts`
    - `apps/customer-cloud-broker/src/types.ts`
    - `apps/orchestrator/src/ports.ts`
    - … and 1 more
  - *positive* — ports interface file(s) act as the dependency-inversion seam.
    - `apps/agent-runtime/src/orchestrator/memory-ports.ts`
    - `apps/agent-runtime/src/orchestrator/ports.ts`
    - `apps/orchestrator/src/ports.ts`

### `modular-monolith` — confidence 0.50

  - *positive* — apps/ + packages/ layout with zero cross-service file imports. (`cross_service_file_imports` = 0)
  - *neutral* — 5 service groups — more microservice-shaped than classic modular monolith.
  - *cross-adjustment* — Capped at 0.5 because microservices scored ≥ 0.5.

### `pipeline` — confidence 0.35

  - *positive* — 2 pipeline/stage/transform paths.
    - `apps/agent-runtime/src/orchestrator/stage-table.ts`
    - `apps/agent-runtime/src/stages.ts`

### `layered` — confidence 0.20

  - *neutral* — Only one layer-style keyword: repository.

### `event-driven` — confidence 0.15

  - *negative* — No broker / pub-sub packages in top external deps.
  - *positive* — 25 event-bus / bridge related paths.
    - `apps/event-bus-bridge/src/config.ts`
    - `apps/event-bus-bridge/src/index.ts`
    - `apps/event-bus-bridge/src/sns-publisher.ts`
    - … and 22 more

### `cqrs` — confidence 0.00

  - *negative* — No command/query/ read-model/write-model paths and no CQRS libraries in top deps.

### `ddd` — confidence 0.00

  - *negative* — No /domain, /aggregate, /entities or /bounded-context paths detected.

### `monolith` — confidence 0.00

  - *negative* — 5 service groups (apps/packages/mcp-servers/agents/...) — not a monolith. (`service_count` = 5)
  - *negative* — Zero cross-service file imports — boundaries are enforced.

### `serverless` — confidence 0.00

  - *negative* — No lambda/serverless/handler paths and no serverless SDKs in top deps.

## Notes

- Detector is pure-Python; no LLM, no network. Same input -> same output.
- Scores are a clamped sum of weighted positive/negative signals per style; see scorers.py for weights.
- Cross-adjustment resolves mutually-exclusive pairs (monolith <-> microservices, modular-monolith cap when microservices is high).
