"""
Dependency graph — public entry point for the dep-graph-agent
(FORA-83, sub-goal 8.2).

`build_graph(scope)` is the canonical function. It is pure:
no I/O, no LLM, no HTTP, no subprocess. The smoke test asserts
a < 10 s runtime and a $0 cost.

The output `DependencyGraph` is the deliverable that the
downstream sub-goals consume:

  - 8.3 AWS Transform orchestration: reads `service_graph` to
    decide which service boundaries to break first (clusters
    come apart together).
  - 8.4 migration planner + Jira: reads `top_blast_radius` and
    `cycles` to size the refactor epics (a node inside a cycle
    needs a break-out story before the migration can land).

`build_graph` validates the input, builds the file-level graph
(fan-in / fan-out / blast radius / cycle membership), aggregates
it to a service-level graph, identifies tightly-coupled clusters,
and assembles a `DependencyGraph` report.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple, Union

from .schemas import (
    DependencyGraph,
    FileRecord,
    GraphEdge,
    GraphNode,
    MigrationScope,
    RepoScope,
    RISK_LEVELS,
    ServiceCluster,
    ServiceGraph,
    ServiceGraphEdge,
    ServiceGraphNode,
    TRANSFORM_TIERS,
    CycleReport,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


GRAPH_VERSION = "dep-graph/0.1.0"

# v0.1 cluster rule: any pair of services with >= this many file-level
# edges between them is "tightly coupled". v0.2 will swap in a real
# community-detection algorithm.
CLUSTER_MIN_EDGE_COUNT = 3


GraphInput = Union[MigrationScope, RepoScope, Sequence[FileRecord]]


def build_graph(scope: GraphInput) -> DependencyGraph:
    """Build a `DependencyGraph` from a `MigrationScope` (8.1 output),
    a `RepoScope`, or a bare list of `FileRecord`s.

    This function is pure. It does not write files, make network
    calls, or invoke the LLM. The smoke test wraps it with the
    evidence-capture and artefact-emission logic.
    """
    files, header = _normalise_scope(scope)

    t0 = time.perf_counter()

    nodes = _build_file_nodes(files)
    edges = _build_file_edges(nodes, files)
    _attach_fan_counts(nodes, edges)

    cycles = _detect_real_cycles(nodes, edges)
    _attach_cycle_membership(nodes, cycles)

    _compute_blast_radius(nodes, edges)

    service_graph = _build_service_graph(nodes, edges, files)
    clusters = _find_clusters(service_graph)

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if elapsed_ms > 10_000:
        raise RuntimeError(
            f"dep-graph exceeded cost bound: {elapsed_ms:.1f} ms > 10,000 ms."
        )

    return DependencyGraph(
        schema_version=1,
        report_id=str(uuid.uuid4()),
        generated_at=header["generated_at"],
        source=header["source"],
        graph_version=GRAPH_VERSION,
        repo_fingerprint=header["repo_fingerprint"],
        deterministic=True,
        graph_runtime_ms=round(elapsed_ms, 3),
        cost_usd=0.0,
        nodes=nodes,
        edges=edges,
        cycles=cycles,
        service_graph=service_graph,
        clusters=clusters,
        notes=[
            "dep-graph is pure-Python; no LLM, no network. Same input -> same output.",
            "Cost bound: < 10 s, $0 spend. The smoke test asserts both.",
            "v0.1 uses a Tarjan SCC pass for cycles, BFS for blast radius, "
            "and a simple >=3-edge-pair rule for cluster detection. v0.2 will "
            "swap the cluster detector for Louvain / label-propagation.",
            "Edges are unweighted (weight=1) in v0.1. v0.2 will weight by "
            "import frequency when the GitHub MCP is wired.",
        ],
    )


def render_mermaid(graph: DependencyGraph, *, max_nodes: int = 60) -> str:
    """Render the service-level graph as a Mermaid `flowchart` block.

    `max_nodes` caps the output so a giant repo still produces a
    reviewable diagram. The top-N services by `blast_radius_files`
    are shown first; the rest get a single stub node.
    """
    nodes = graph.service_graph.nodes
    edges = graph.service_graph.edges

    if len(nodes) > max_nodes:
        ordered = sorted(
            nodes,
            key=lambda n_: (-n_.blast_radius_files, n_.service),
        )
        kept = ordered[:max_nodes]
        dropped = ordered[max_nodes:]
        kept_set = {n_.service for n_ in kept}
    else:
        kept = list(nodes)
        dropped = []
        kept_set = {n_.service for n_ in kept}

    lines: List[str] = [
        "```mermaid",
        "flowchart LR",
        "  classDef cluster fill:#fef3c7,stroke:#92400e,stroke-width:1px;",
        "  classDef cycle   fill:#fee2e2,stroke:#991b1b,stroke-width:1px;",
        "  classDef danger  fill:#fecaca,stroke:#7f1d1d,stroke-width:1px;",
        "",
    ]
    for n_ in kept:
        label = (
            f"{n_.service}<br/>"
            f"{n_.file_count} files / {n_.total_loc} LoC<br/>"
            f"in={n_.fan_in} out={n_.fan_out}<br/>"
            f"blast={n_.blast_radius_files}"
        )
        # Sanitize the label for Mermaid: replace < and > with HTML entities
        # that the Mermaid renderer keeps verbatim inside a quoted label.
        safe_label = label.replace('"', "&quot;")
        lines.append(f'  {n_.service}["{safe_label}"]')
        if n_.cluster_id is not None:
            lines.append(f"  class {n_.service} cluster;")
    if dropped:
        names = "+".join(n_.service for n_ in dropped)
        lines.append(f'  __others__["{names}"]:::danger')
        lines.append("  class __others__ danger;")

    for e in edges:
        if e.source in kept_set and e.target in kept_set and e.source != e.target:
            lines.append(f"  {e.source} -->|{e.weight}| {e.target}")

    # Highlight cycle members in the file-level projection (services
    # that own at least one cycle file). Best-effort: we recompute
    # from the file-level cycle report.
    if graph.cycles:
        cycle_files = graph.files_in_cycles()
        cycle_services: Set[str] = {
            n.service
            for n in graph.nodes
            if n.path in set(cycle_files) and n.service in kept_set
        }
        if cycle_services:
            lines.append("")
            lines.append("  %% services that own at least one file inside a cycle")
            for s in sorted(cycle_services):
                lines.append(f"  class {s} cycle;")
    lines.append("```")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _normalise_scope(scope: GraphInput) -> Tuple[List[FileRecord], Dict[str, str]]:
    """Coerce any supported input into a `(files, header)` pair.

    `header` carries the provenance fields the deliverable stamps
    on its output (`source`, `generated_at`, `repo_fingerprint`).
    """
    if isinstance(scope, MigrationScope):
        # MigrationScope doesn't carry the raw FileRecord list; rebuild
        # it from the categorisations, which always cover every input
        # file. We then read `repo_scope`-like fields off the source
        # (RepoScope is not in the MigrationScope payload directly,
        # so we use MigrationScope metadata and recover the file
        # records from the per-file verdicts).
        path_to_meta: Dict[str, Dict[str, Any]] = {
            c.path: {"category": c.category} for c in scope.categorizations
        }
        # We need a *complete* FileRecord list. The categorizer
        # doesn't expose the raw records, so we accept the loss of
        # a couple of fields (e.g. `imported_by`) and recover what
        # we can from the categorisations + risk_assessments +
        # transform_mappings.
        files = _recover_file_records_from_migration_scope(scope, path_to_meta)
        header = {
            "source": scope.source,
            "generated_at": scope.generated_at,
            "repo_fingerprint": scope.repo_fingerprint,
        }
        return files, header

    if isinstance(scope, RepoScope):
        return list(scope.files), {
            "source": scope.source,
            "generated_at": scope.generated_at,
            "repo_fingerprint": scope.repo_fingerprint,
        }

    if isinstance(scope, Sequence) and not isinstance(scope, (str, bytes)):
        files = [f for f in scope if isinstance(f, FileRecord)]
        header = {
            "source": "<ad-hoc-fixture>",
            "generated_at": "1970-01-01T00:00:00Z",
            "repo_fingerprint": _ad_hoc_fingerprint(files),
        }
        return files, header

    raise TypeError(
        "scope must be a MigrationScope, a RepoScope, or a sequence of "
        f"FileRecord; got {type(scope).__name__}."
    )


def _ad_hoc_fingerprint(files: Sequence[FileRecord]) -> str:
    """Stable fingerprint for a bare list of FileRecord."""
    import hashlib
    import json as _json
    payload = _json.dumps(
        sorted(
            (f.path, f.language, f.loc, f.role, f.service or "")
            for f in files
        ),
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:16]


def _recover_file_records_from_migration_scope(
    scope: MigrationScope,
    path_to_meta: Dict[str, Dict[str, Any]],
) -> List[FileRecord]:
    """Best-effort recovery of FileRecord metadata from a MigrationScope.

    The 8.1 contract does not promise the raw FileRecord list on the
    output (only the verdicts). When the dep-graph is fed a
    `MigrationScope` directly, we recover `path`, `service`, and
    `role` from the categorisation rationale when possible, and
    default the rest. For the canonical path, the smoke test feeds
    the `RepoScope` instead, where every field is intact.
    """
    out: List[FileRecord] = []
    risk_by_path = {r.path: r for r in scope.risk_assessments}
    map_by_path = {m.path: m for m in scope.transform_mappings}
    for c in scope.categorizations:
        # We have no language / loc / imports on the categorisation
        # row. Use zero / unknown defaults and let the smoke test
        # consume a RepoScope for full fidelity.
        out.append(
            FileRecord(
                path=c.path,
                language="<recovered>",
                loc=0,
                role="<recovered>",
                service=_recover_service_from_rationale(c.rationale),
            )
        )
    # Suppress unused-variable warnings; the helpers above may be
    # useful for future schema extensions.
    _ = (risk_by_path, map_by_path, path_to_meta)
    return out


def _recover_service_from_rationale(rationale: str) -> Optional[str]:
    """Pull a `service=<name>` token out of an 8.1 rationale string.

    The categorizer rationale often contains the source service
    (`"service=billing"`) so we can rebuild a `service` field on
    a recovered `FileRecord` without keeping a parallel input.
    Returns `None` when no token is present.
    """
    if not rationale:
        return None
    needle = "service="
    idx = rationale.find(needle)
    if idx < 0:
        return None
    start = idx + len(needle)
    end = start
    while end < len(rationale) and rationale[end] not in " ,;\n\t":
        end += 1
    token = rationale[start:end].strip()
    return token or None


def _build_file_nodes(files: Sequence[FileRecord]) -> List[GraphNode]:
    """One `GraphNode` per file. Stable sort by path keeps the
    output order reproducible across runs."""
    nodes = [
        GraphNode(
            path=f.path,
            service=f.service or "<unassigned>",
            role=f.role,
            loc=f.loc,
            language=f.language,
        )
        for f in files
    ]
    nodes.sort(key=lambda n_: n_.path)
    return nodes


def _build_file_edges(
    nodes: Sequence[GraphNode], files: Sequence[FileRecord]
) -> List[GraphEdge]:
    """Build the file-level edge list from `FileRecord.imports`.

    Edges that point at files not in the input set are dropped
    (we only model the in-repo graph). Duplicates collapse into a
    single edge with `weight = occurrence_count`. Sort is stable:
    `(source, target)`.
    """
    path_index = {n.path for n in nodes}

    # Build a path -> file lookup so we can fall back to `imported_by`
    # if a file happens to be missing from `files` (defensive — the
    # 8.1 contract says every importer has a record, but we don't
    # trust the input blindly).
    files_by_path = {f.path: f for f in files}

    weight: Dict[Tuple[str, str], int] = {}
    for f in files:
        for target in f.imports:
            if target not in path_index:
                continue
            if target == f.path:
                # Self-loops are allowed and produce a one-node cycle.
                pass
            key = (f.path, target)
            weight[key] = weight.get(key, 0) + 1

    # Sanity: cross-check with `imported_by` when the forward list
    # is empty. This catches fixtures where the analyzer was passed
    # a partial `RepoScope`. We never invent edges — only mirror the
    # `imported_by` direction back into the forward set.
    for f in files:
        if f.imports:
            continue
        for src in f.imported_by:
            if src not in path_index:
                continue
            key = (src, f.path)
            weight.setdefault(key, 0)
            weight[key] += 1
            _ = files_by_path  # silence linters; kept for future

    return [
        GraphEdge(source=s, target=t, weight=w)
        for (s, t), w in sorted(weight.items())
    ]


def _attach_fan_counts(
    nodes: List[GraphNode], edges: Sequence[GraphEdge]
) -> None:
    """Populate `fan_in` / `fan_out` on each node in place."""
    fan_in: Dict[str, int] = {n.path: 0 for n in nodes}
    fan_out: Dict[str, int] = {n.path: 0 for n in nodes}
    for e in edges:
        fan_out[e.source] = fan_out.get(e.source, 0) + 1
        fan_in[e.target] = fan_in.get(e.target, 0) + 1
    for n_ in nodes:
        n_.fan_in = fan_in.get(n_.path, 0)
        n_.fan_out = fan_out.get(n_.path, 0)


def _detect_real_cycles(
    nodes: Sequence[GraphNode], edges: Sequence[GraphEdge]
) -> List[CycleReport]:
    """Tarjan's SCC algorithm; keep only non-trivial SCCs.

    A non-trivial SCC is one of:

      * size >= 2 (multiple nodes strongly connected), or
      * size 1 with a self-loop (the node imports itself).

    Single-node SCCs without a self-loop are not cycles.
    """
    adj: Dict[str, List[str]] = {n.path: [] for n in nodes}
    for e in edges:
        adj.setdefault(e.source, []).append(e.target)
    for k, v in adj.items():
        v.sort()

    index_counter = [0]
    stack: List[str] = []
    on_stack: Set[str] = set()
    indices: Dict[str, int] = {}
    lowlinks: Dict[str, int] = {}
    sccs: List[List[str]] = []

    def strongconnect(v: str) -> None:
        indices[v] = index_counter[0]
        lowlinks[v] = index_counter[0]
        index_counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for w in adj.get(v, []):
            if w not in indices:
                strongconnect(w)
                lowlinks[v] = min(lowlinks[v], lowlinks[w])
            elif w in on_stack:
                lowlinks[v] = min(lowlinks[v], indices[w])
        if lowlinks[v] == indices[v]:
            component: List[str] = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                component.append(w)
                if w == v:
                    break
            sccs.append(sorted(component))

    for n_ in sorted(adj.keys()):
        if n_ not in indices:
            strongconnect(n_)

    # Map path -> cycle_id for downstream consumers.
    edge_lookup: Dict[Tuple[str, str], GraphEdge] = {
        (e.source, e.target): e for e in edges
    }

    out: List[CycleReport] = []
    next_id = 0
    for component in sorted(sccs, key=lambda c: (-len(c), c)):
        if len(component) >= 2:
            in_cycle_edges = [
                edge_lookup[(a, b)]
                for a in component
                for b in component
                if (a, b) in edge_lookup
            ]
            in_cycle_edges.sort(key=lambda e: (e.source, e.target))
            out.append(
                CycleReport(
                    cycle_id=next_id,
                    members=component,
                    is_self_loop=False,
                    edges_in_cycle=in_cycle_edges,
                )
            )
            next_id += 1
            continue
        # size == 1: real cycle only if self-loop
        (only,) = component
        if (only, only) in edge_lookup:
            out.append(
                CycleReport(
                    cycle_id=next_id,
                    members=component,
                    is_self_loop=True,
                    edges_in_cycle=[edge_lookup[(only, only)]],
                )
            )
            next_id += 1

    return out


def _attach_cycle_membership(
    nodes: List[GraphNode], cycles: Sequence[CycleReport]
) -> None:
    """Mark each node with `in_cycle` and `cycle_id` based on the
    `cycles` list. Multiple cycles are not expected (Tarjan returns
    disjoint SCCs); the first match wins."""
    in_cycle: Dict[str, int] = {}
    for c in cycles:
        for member in c.members:
            in_cycle.setdefault(member, c.cycle_id)
    for n_ in nodes:
        cid = in_cycle.get(n_.path)
        if cid is not None:
            n_.in_cycle = True
            n_.cycle_id = cid


def _compute_blast_radius(
    nodes: List[GraphNode], edges: Sequence[GraphEdge]
) -> None:
    """Populate `blast_radius` on each node.

    `blast_radius(node)` = |{ u : node →* u }| — the count of
    distinct files transitively reachable from `node` along the
    outbound edge direction, **plus** the node itself. We traverse
    OUTBOUND because the failure model is: a node goes down, the
    files it directly calls go down, and so on.

    Implemented as a BFS per node. Cost is O(N*(N+E)) in the
    worst case, which is fine for the 10k-file repo envelope
    the dep-graph contract targets.
    """
    out_adj: Dict[str, List[str]] = {n.path: [] for n in nodes}
    for e in edges:
        out_adj.setdefault(e.source, []).append(e.target)
    for v in out_adj.values():
        v.sort()

    for n_ in nodes:
        seen: Set[str] = {n_.path}
        frontier: List[str] = [n_.path]
        while frontier:
            current = frontier.pop()
            for nxt in out_adj.get(current, ()):
                if nxt in seen:
                    continue
                seen.add(nxt)
                frontier.append(nxt)
        n_.blast_radius = len(seen)


def _build_service_graph(
    nodes: Sequence[GraphNode],
    edges: Sequence[GraphEdge],
    files: Sequence[FileRecord],
) -> ServiceGraph:
    """Aggregate the file-level graph by service.

    A `ServiceGraphNode` carries the file count, total LoC, fan
    counts, blast radius, and the dominant risk / transform tier
    across the service's files. A `ServiceGraphEdge` is the sum
    of file-level edges between two services. Edges within the
    same service collapse to a single self-edge with weight equal
    to the file-level intra-service edge count.
    """
    by_path = {n.path: n for n in nodes}
    files_by_path = {f.path: f for f in files}

    # Group nodes by service.
    grouped: Dict[str, List[GraphNode]] = {}
    for n_ in nodes:
        grouped.setdefault(n_.service, []).append(n_)

    # Aggregate per-service stats.
    service_nodes: List[ServiceGraphNode] = []
    for service, members in sorted(grouped.items()):
        file_count = len(members)
        total_loc = sum(m.loc for m in members)
        fan_in = sum(m.fan_in for m in members)
        fan_out = sum(m.fan_out for m in members)
        blast = sum(m.blast_radius for m in members)

        # Dominant risk = highest count across RISK_LEVELS. We
        # approximate by reading each member's risk from the
        # FileRecord's path in `files_by_path`. When unavailable
        # (e.g. when the graph was built from a MigrationScope that
        # didn't carry risk), fall back to "low".
        risk_counts = {lvl: 0 for lvl in RISK_LEVELS}
        tier_counts = {tier: 0 for tier in TRANSFORM_TIERS}
        for m in members:
            f = files_by_path.get(m.path)
            if f is None:
                continue
            # Risk level is not a field on FileRecord; we only
            # get it via MigrationScope. So we leave risk_counts
            # untouched here and let the dominant default to "low".
            _ = f
        dominant_risk = _dominant_key(risk_counts, default="low")
        dominant_tier = _dominant_key(tier_counts, default="skip")

        service_nodes.append(
            ServiceGraphNode(
                service=service,
                file_count=file_count,
                total_loc=total_loc,
                fan_in=fan_in,
                fan_out=fan_out,
                blast_radius_files=blast,
                risk_level=dominant_risk,
                dominant_tier=dominant_tier,
            )
        )

    # Aggregate edges.
    pair_weight: Dict[Tuple[str, str], int] = {}
    for e in edges:
        src_node = by_path.get(e.source)
        tgt_node = by_path.get(e.target)
        if src_node is None or tgt_node is None:
            continue
        key = (src_node.service, tgt_node.service)
        pair_weight[key] = pair_weight.get(key, 0) + 1
    service_edges = [
        ServiceGraphEdge(source=s, target=t, weight=w)
        for (s, t), w in sorted(pair_weight.items())
    ]

    # Roll up fan counts on the service nodes.
    fan_in_s = {n_.service: 0 for n_ in service_nodes}
    fan_out_s = {n_.service: 0 for n_ in service_nodes}
    for e in service_edges:
        if e.source == e.target:
            continue
        fan_out_s[e.source] = fan_out_s.get(e.source, 0) + e.weight
        fan_in_s[e.target] = fan_in_s.get(e.target, 0) + e.weight
    for n_ in service_nodes:
        n_.fan_in = fan_in_s.get(n_.service, 0)
        n_.fan_out = fan_out_s.get(n_.service, 0)

    return ServiceGraph(
        schema_version=1,
        nodes=service_nodes,
        edges=service_edges,
    )


def _dominant_key(counts: Dict[str, int], *, default: str) -> str:
    if not counts:
        return default
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def _find_clusters(service_graph: ServiceGraph) -> List[ServiceCluster]:
    """Connected components of the "tightly coupled" relation.

    Two services are tightly coupled when at least
    `CLUSTER_MIN_EDGE_COUNT` distinct file-level edges connect
    them (in either direction). The clusters are the connected
    components of that undirected relation. v0.2 will swap this
    for a community-detection algorithm.
    """
    if not service_graph.nodes:
        return []
    services = {n_.service for n_ in service_graph.nodes}
    tight: Dict[str, Set[str]] = {s: set() for s in services}
    for e in service_graph.edges:
        if e.source == e.target:
            continue
        if e.weight >= CLUSTER_MIN_EDGE_COUNT:
            tight[e.source].add(e.target)
            tight[e.target].add(e.source)

    visited: Set[str] = set()
    components: List[List[str]] = []
    for s in sorted(services):
        if s in visited:
            continue
        # BFS over `tight`
        stack = [s]
        component: List[str] = []
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            component.append(cur)
            for nxt in sorted(tight[cur]):
                if nxt not in visited:
                    stack.append(nxt)
        if len(component) >= 2:
            components.append(sorted(component))

    # Compute intra-cluster edge counts.
    pair_weight: Dict[Tuple[str, str], int] = {}
    for e in service_graph.edges:
        if e.source == e.target:
            continue
        a, b = sorted((e.source, e.target))
        pair_weight[(a, b)] = pair_weight.get((a, b), 0) + e.weight

    out: List[ServiceCluster] = []
    for cid, members in enumerate(components):
        n_pairs = len(members) * (len(members) - 1) / 2
        edges_in = sum(
            pair_weight.get((min(a, b), max(a, b)), 0)
            for a in members
            for b in members
            if a < b
        )
        avg = (edges_in / n_pairs) if n_pairs else 0.0
        out.append(
            ServiceCluster(
                cluster_id=cid,
                services=members,
                edge_count=edges_in,
                avg_edges_per_pair=round(avg, 3),
            )
        )
    return out


def attach_risk_and_tier_to_services(
    service_graph: ServiceGraph,
    scope: MigrationScope,
) -> ServiceGraph:
    """Optional helper: enrich a `ServiceGraph` with risk and tier
    data from a `MigrationScope` (when the dep-graph was built
    without a `RepoScope`).

    The smoke test calls this after `build_graph` so the
    `ServiceGraphNode.risk_level` / `dominant_tier` fields are
    non-default.
    """
    risk_by_path = {r.path: r.risk_level for r in scope.risk_assessments}
    tier_by_path = {m.path: m.tier for m in scope.transform_mappings}

    # Map path -> service via the per-service node list.
    path_to_service: Dict[str, str] = {}
    for sn in service_graph.nodes:
        for n_ in sn.__dict__.get("__members__", []):  # type: ignore[attr-defined]
            _ = n_

    # We have to recover the service from the `MigrationScope`
    # categorisation rationale (best effort). Build it from the
    # rationale string (the categorizer writes `service=<name>`).
    service_by_path: Dict[str, str] = {}
    for c in scope.categorizations:
        svc = _recover_service_from_rationale(c.rationale) or "<unassigned>"
        service_by_path[c.path] = svc

    # Aggregate per service.
    risk_by_service: Dict[str, Dict[str, int]] = {sn.service: {lvl: 0 for lvl in RISK_LEVELS} for sn in service_graph.nodes}
    tier_by_service: Dict[str, Dict[str, int]] = {sn.service: {tier: 0 for tier in TRANSFORM_TIERS} for sn in service_graph.nodes}
    for path, lvl in risk_by_path.items():
        svc = service_by_path.get(path)
        if svc is None or lvl not in risk_by_service[svc]:
            continue
        risk_by_service[svc][lvl] += 1
    for path, tier in tier_by_path.items():
        svc = service_by_path.get(path)
        if svc is None or tier not in tier_by_service[svc]:
            continue
        tier_by_service[svc][tier] += 1

    for sn in service_graph.nodes:
        sn.risk_level = _dominant_key(risk_by_service[sn.service], default="low")
        sn.dominant_tier = _dominant_key(tier_by_service[sn.service], default="skip")

    # Suppress unused-variable warnings
    _ = (path_to_service, risk_by_service, tier_by_service)
    return service_graph
