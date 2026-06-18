# FORA-83 / Sub-goal 8.2 — Dependency Graph Schema

> **Status:** v0.1 — `dep-graph/0.1.0` (schema v1)
> **Source:** `agents.refactor.build_graph` (FORA-83 / 8.2)
> **Consumers:** [FORA-84](/FORA/issues/FORA-84) (8.3 AWS Transform orchestration), [FORA-85](/FORA/issues/FORA-85) (8.4 migration planner + Jira)
> **Upstream:** [FORA-82](/FORA/issues/FORA-82) (8.1 Code analyzer — provides `MigrationScope` and the normalised `RepoScope`)

---

## 1. Scope and contract

The dependency graph is **pure, deterministic, and zero-cost**:

- **Pure** — `build_graph(scope)` does no I/O, no LLM, no HTTP, no `subprocess`.
- **Deterministic** — same input ⇒ byte-identical output modulo `report_id` and `graph_runtime_ms`.
- **Bounded** — runtime budget `< 10,000 ms`, `cost_usd == 0`.
- **Stable** — `graph_version = "dep-graph/0.1.0"`; schema v1 is closed; bump version on breaking changes.

The canonical entry point is:

```python
from agents.refactor import build_graph, render_mermaid
from agents.refactor import (
    DependencyGraph, GraphNode, GraphEdge,
    CycleReport, ServiceGraph, ServiceGraphNode,
    ServiceGraphEdge, ServiceCluster,
)

graph: DependencyGraph = build_graph(repo_scope)        # canonical path
graph_mermaid: str = render_mermaid(graph)              # for Confluence / docs
```

`build_graph` accepts three input shapes:

1. `RepoScope` (8.1 input) — canonical, full fidelity.
2. `MigrationScope` (8.1 output) — recovers FileRecord metadata from categorisation rationales (best-effort; prefer `RepoScope`).
3. `Sequence[FileRecord]` — ad-hoc fixture for the smoke test.

---

## 2. Top-level shape

```jsonc
{
  "schema_version": 1,
  "report_id": "<uuid>",
  "generated_at": "<iso-8601>",
  "source": "<mirror of RepoScope.source>",
  "graph_version": "dep-graph/0.1.0",
  "repo_fingerprint": "<16-char sha256>",
  "deterministic": true,
  "graph_runtime_ms": 0.4,
  "cost_usd": 0.0,
  "nodes": [GraphNode, ...],       // file-level graph
  "edges": [GraphEdge, ...],       // file-level edges
  "cycles": [CycleReport, ...],    // Tarjan SCC, non-trivial only
  "service_graph": ServiceGraph,   // aggregated per-service graph
  "clusters": [ServiceCluster, ...], // tightly-coupled groups
  "notes": [string, ...]
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | int | Closed at v1. Bump on breaking change. |
| `report_id` | string (uuid4) | Volatile — excluded from determinism check. |
| `graph_runtime_ms` | float | Volatile — excluded from determinism check. |
| `cost_usd` | float | Always 0.0 in v0.1 (no LLM spend). |
| `repo_fingerprint` | string (16 hex chars) | sha256 over sorted `(path, language, loc, role)` tuples; mirrors the 8.1 fingerprint so 8.1 + 8.2 outputs can be cross-referenced. |

---

## 3. File-level graph — `nodes` and `edges`

### 3.1 `GraphNode`

```jsonc
{
  "path": "src/main/java/.../BillingService.java",
  "service": "billing",
  "role": "service",
  "loc": 480,
  "language": "java",
  "fan_in": 4,          // inbound edge count
  "fan_out": 4,         // outbound edge count
  "blast_radius": 5,    // |{ u : node →* u }| incl. self
  "in_cycle": false,
  "cycle_id": null      // int when in_cycle is true
}
```

- `service` is `"<unassigned>"` when the file has no service tag.
- `blast_radius` is computed by a BFS along outbound edges (failure model: the node goes down, transitively-importing files are affected).
- Single-node SCCs without self-loops are **not** cycles; `in_cycle` stays `false`.

### 3.2 `GraphEdge`

```jsonc
{
  "source": "src/main/java/.../BillingService.java",
  "target": "src/main/java/.../Customer.java",
  "weight": 2
}
```

- `weight` is the occurrence count of the import edge (imports can list the same target more than once when the file imports multiple symbols from the same module).
- Self-edges are allowed (`source == target`) and produce a 1-node self-loop cycle.
- Edges pointing at files not in the input set are dropped (we only model the in-repo graph).
- When a `FileRecord.imports` is empty, the implementation back-fills forward edges from `imported_by` so partial fixtures still produce a connected graph.

### 3.3 Consumers

- **8.3 (AWS Transform orchestration)** uses `top_fan_in` / `top_fan_out` / `top_blast_radius` to pick the first service boundaries to break.
- **8.4 (migration planner)** uses `files_in_cycles()` to size Jira epics — every file in a cycle needs a break-out story before the migration can land.

---

## 4. Cycles — `cycles`

```jsonc
{
  "cycle_id": 0,
  "members": ["svc/a.py", "svc/b.py", "svc/c.py"],
  "is_self_loop": false,
  "edges_in_cycle": [
    {"source": "svc/a.py", "target": "svc/b.py", "weight": 1},
    ...
  ]
}
```

- **Algorithm** — Tarjan SCC.
- **Non-trivial SCC** — size ≥ 2, **or** size 1 with a self-loop.
- Sorted descending by `len(members)`, then ascending by first member path.
- `files_in_cycles()` flattens all `members` lists (sorted) for downstream tools that want a flat path list.

---

## 5. Service-level graph — `service_graph`

Aggregated by service. The same `RepoScope.service` field that drives 8.1 drives 8.2.

```jsonc
{
  "schema_version": 1,
  "nodes": [ServiceGraphNode, ...],
  "edges": [ServiceGraphEdge, ...]
}
```

### 5.1 `ServiceGraphNode`

```jsonc
{
  "service": "billing",
  "file_count": 10,
  "total_loc": 1330,
  "fan_in": 2,
  "fan_out": 1,
  "blast_radius_files": 24,
  "risk_level": "high",
  "dominant_tier": "T1",
  "cluster_id": null      // int when part of a ServiceCluster
}
```

- `risk_level` and `dominant_tier` are sourced from `MigrationScope` via `attach_risk_and_tier_to_services(graph, scope)`. Default values are `low` / `skip` when the graph was built from a bare `RepoScope` and the call wasn't made.
- `fan_in` / `fan_out` count inter-service file-level edges (intra-service edges collapse into a single `service → service` self-edge with `weight = file-edge-count`).

### 5.2 `ServiceGraphEdge`

```jsonc
{ "source": "billing", "target": "shared", "weight": 1 }
```

- `weight` is the number of distinct file-level edges between the two services.

### 5.3 Consumers

- **8.3** uses `service_graph.edges` to plan service-boundary breaks — services connected by heavy edges get migrated together or with explicit dependency wiring.
- **8.4** uses `service_graph.nodes[*].blast_radius_files` to estimate blast radius at the service level.

---

## 6. Tightly-coupled clusters — `clusters`

```jsonc
{
  "cluster_id": 0,
  "services": ["billing", "shared"],   // sorted
  "edge_count": 4,
  "avg_edges_per_pair": 4.0            // edge_count / pair_count
}
```

- **Rule (v0.1):** two services are "tightly coupled" when `service_graph.edges` between them has `weight >= CLUSTER_MIN_EDGE_COUNT` (default **3**).
- **Clusters** are the connected components of the tightly-coupled relation.
- v0.2 will swap the rule for Louvain / label-propagation community detection.

---

## 7. Helper methods on `DependencyGraph`

| Method | Returns | Notes |
| --- | --- | --- |
| `top_fan_in(n=10)` | `List[GraphNode]` | Descending by `fan_in`, ascending by `path`. Excludes `fan_in == 0`. |
| `top_fan_out(n=10)` | `List[GraphNode]` | Descending by `fan_out`, ascending by `path`. Excludes `fan_out == 0`. |
| `top_blast_radius(n=10)` | `List[GraphNode]` | Descending by `blast_radius`, ascending by `path`. |
| `files_in_cycles()` | `List[str]` | Sorted flat list of every file path that appears in any `CycleReport.members`. |

`render_mermaid(graph, max_nodes=60)` returns a `flowchart LR` block ready to paste into a Confluence page. Top-N services by `blast_radius_files` are kept; the rest collapse into a single `__others__` stub.

---

## 8. Artefacts produced by the smoke test

| Path | Purpose |
| --- | --- |
| `forge/8.2/dep-graph.json` | Canonical `DependencyGraph.to_dict()`. |
| `forge/8.2/cycles.json` | Slim view: cycles + `files_in_cycles()` for 8.4. |
| `forge/8.2/services.json` | Slim view: service graph + clusters for 8.3. |
| `forge/8.2/dependency-graph.md` | Human-readable report (Mermaid + top-N tables + cluster / cycle roster). |
| `forge/8.2/schema.md` | This document. |
| `agents/refactor/evidence/smoke_dep_graph_<ts>/result.json` | Per-run evidence: AC check booleans, fixture summaries, top fan-in / blast-radius. |

The smoke test (`agents/refactor/smoke_test_dep_graph.py`) asserts **33 acceptance criteria** across four fixtures:

- `sample_legacy_monolith()` — 22 files / 7 services, exercises full file-coverage, fan counts, blast radius, cost bound, service-graph aggregation.
- 3-node cycle (A→B→C→A) — Tarjan SCC size 3.
- Self-loop (A→A) — Tarjan SCC size 1 with self-loop.
- Cluster (billing↔shared, 4 file-edges each way) — triggers `CLUSTER_MIN_EDGE_COUNT ≥ 3`.

---

## 9. v0.2 roadmap (out of scope for 8.2)

- Weighted edges from real import-frequency data (GitHub MCP).
- Real community detection (Louvain / label-propagation) instead of the ≥3-edge rule.
- Cross-language edges (e.g. JS frontend → Python backend).
- Annotation overlay from the 8.1 `RiskAssessment` / `TransformMapping` — currently the canonical fixture path is the cleaner `RepoScope → build_graph` route; `attach_risk_and_tier_to_services` is the hook for ad-hoc merging.
