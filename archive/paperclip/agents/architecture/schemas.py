"""
Schemas for the architecture-style detector.

`GraphSummary` is the *normalised* view the scorers consume — it
extracts the fields the 2.1 artefact promises (see FORA-27
deliverable) into a flat shape that's easy to reason about. The
detector is therefore forward-compatible: if 2.1 grows new fields,
only this file changes.

The 10 style tags are a closed set (per FORA-29 AC #2). Adding a
new style means a new scorer in `scorers.py` and a one-line
addition to `ALL_STYLES`.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


# The 10 architecture styles FORA-29 promises to score.
ALL_STYLES: List[str] = [
    "monolith",
    "microservices",
    "event-driven",
    "cqrs",
    "ddd",
    "layered",
    "hexagonal-clean",
    "modular-monolith",
    "serverless",
    "pipeline",
]


@dataclass
class Evidence:
    """A single piece of evidence that pushed a style's score up or down."""
    kind: str               # e.g. "positive" | "negative" | "neutral"
    description: str        # human-readable
    paths: List[str] = field(default_factory=list)  # anchor paths (deterministic order)
    metric: Optional[str] = None   # name of the metric, if derived
    value: Optional[float] = None  # numeric value, if any

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class StyleTag:
    """One architecture-style tag with its confidence and evidence."""
    style: str
    confidence: float       # in [0.0, 1.0]
    evidence: List[Evidence] = field(default_factory=list)
    rationale: str = ""     # short sentence summarising why

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class GraphSummary:
    """A flattened view of the 2.1 graph artefact that scorers consume.

    All counts are non-negative ints. All path lists are sorted
    (so the detector is deterministic on the same input).
    """
    # top-level counts
    node_count: int
    edge_count: int
    total_loc: int
    schema_version: int
    generator: str
    generated_at: str
    target_root: str

    # service map: name -> {file_count, loc}
    services: Dict[str, Dict[str, int]]

    # language split
    languages: Dict[str, int]

    # role split
    role_counts: Dict[str, int]

    # graph-shape metrics
    cycle_count: int
    cycles: List[List[str]]                     # each cycle sorted lexicographically
    cross_service_file_imports: int             # file-to-file cross-service imports
    cross_service_package_edges: List[Dict[str, Any]]  # raw metric entries
    layering_violation_count: int

    # node lists (sorted by path)
    ports_paths: List[str]
    adapter_paths: List[str]
    domain_paths: List[str]                     # paths mentioning domain/aggregate/entity/bounded-context
    layer_keyword_paths: Dict[str, List[str]]   # layer keyword -> sorted paths
    serverless_keyword_paths: List[str]         # lambda/serverless/function/handler entrypoints
    pipeline_keyword_paths: List[str]           # stage/transform/etl/stream

    # external dependencies (raw metric: {fanin, package})
    top_external_deps: List[Dict[str, Any]]

    # centrality (raw metric entries)
    top_fan_in: List[Dict[str, Any]]
    top_fan_out: List[Dict[str, Any]]
    high_fanout_paths: List[str]
    entry_point_paths: List[str]
    dead_code_candidates: List[str]

    # test/prod balance
    test_count: int
    prod_count: int
    test_vs_prod_ratio: float

    @classmethod
    def from_graph(cls, graph: Dict[str, Any]) -> "GraphSummary":
        """Build a GraphSummary from a 2.1 codebase-graph.json payload."""
        nodes: List[Dict[str, Any]] = list(graph.get("nodes", []))
        edges: List[Dict[str, Any]] = list(graph.get("edges", []))
        metrics: Dict[str, Any] = dict(graph.get("metrics", {}))

        # service map — pull from graph.metrics.services when present, else
        # derive by counting nodes grouped by `service` field.
        services = dict(metrics.get("services") or {})
        if not services:
            by_svc: Dict[str, int] = {}
            for n in nodes:
                svc = n.get("service") or "_unknown"
                by_svc[svc] = by_svc.get(svc, 0) + 1
            services = {k: {"files": v, "loc": 0} for k, v in by_svc.items()}

        # language / role counts
        languages: Dict[str, int] = {}
        role_counts: Dict[str, int] = {}
        for n in nodes:
            languages[n.get("language") or "_unknown"] = (
                languages.get(n.get("language") or "_unknown", 0) + 1
            )
            role_counts[n.get("role") or "_unknown"] = (
                role_counts.get(n.get("role") or "_unknown", 0) + 1
            )

        # classify paths for style signals (deterministic, sorted)
        ports_paths = sorted(n["path"] for n in nodes
                              if "port" in n["path"].lower())
        adapter_paths = sorted(n["path"] for n in nodes
                                if "adapter" in n["path"].lower()
                                or n["path"].lower().endswith("/adapters/index.ts"))
        domain_paths = sorted(
            n["path"] for n in nodes
            if any(k in n["path"].lower()
                   for k in ("/domain/", "/aggregate", "/entities/", "/bounded-context"))
        )
        layer_kw = {
            "controller": sorted(n["path"] for n in nodes if "controller" in n["path"].lower()),
            "service":    sorted(n["path"] for n in nodes
                                 if "/services/" in n["path"].lower() or n["path"].lower().endswith("/service.ts")),
            "repository": sorted(n["path"] for n in nodes if "repository" in n["path"].lower() or "repo.ts" in n["path"].lower()),
            "usecase":    sorted(n["path"] for n in nodes if "usecase" in n["path"].lower() or "use_case" in n["path"].lower()),
            "handler":    sorted(n["path"] for n in nodes if "handler" in n["path"].lower()),
        }
        serverless_kw_paths = sorted(
            n["path"] for n in nodes
            if any(k in n["path"].lower()
                   for k in ("/lambda/", "/functions/", "/serverless/", "handler.py", "handler.ts", ".handler."))
        )
        pipeline_kw_paths = sorted(
            n["path"] for n in nodes
            if any(k in n["path"].lower()
                   for k in ("/stage", "/transform", "/etl", "/stream", "/pipeline"))
        )

        cycles_raw = list(metrics.get("cycles") or [])
        cycles = [sorted(c) for c in cycles_raw]
        cycles.sort()  # lexical over the sorted inner lists

        return cls(
            node_count=len(nodes),
            edge_count=len(edges),
            total_loc=int(metrics.get("totalLoc", 0) or 0),
            schema_version=int(graph.get("schemaVersion", 0) or 0),
            generator=str(graph.get("generator", "")),
            generated_at=str(graph.get("generatedAt", "")),
            target_root=str(graph.get("targetRoot", "")),
            services={k: {"files": int(v.get("files", 0)), "loc": int(v.get("loc", 0))} for k, v in services.items()},
            languages=dict(sorted(languages.items())),
            role_counts=dict(sorted(role_counts.items())),
            cycle_count=int(metrics.get("cycleCount", 0) or 0),
            cycles=cycles,
            cross_service_file_imports=len(list(metrics.get("crossServiceFileImports") or [])),
            cross_service_package_edges=list(metrics.get("crossServicePackageEdges") or []),
            layering_violation_count=int(metrics.get("layeringViolationCount", 0) or 0),
            ports_paths=ports_paths,
            adapter_paths=adapter_paths,
            domain_paths=domain_paths,
            layer_keyword_paths={k: v for k, v in layer_kw.items()},
            serverless_keyword_paths=serverless_kw_paths,
            pipeline_keyword_paths=pipeline_kw_paths,
            top_external_deps=list(metrics.get("topExternalDeps") or []),
            top_fan_in=list(metrics.get("topFanIn") or []),
            top_fan_out=list(metrics.get("topFanOut") or []),
            high_fanout_paths=sorted(metrics.get("highFanout") or []),
            entry_point_paths=sorted(
                e["path"] for e in (metrics.get("entryPointCandidates") or []) if isinstance(e, dict) and "path" in e
            ),
            dead_code_candidates=sorted(metrics.get("deadCodeCandidates") or []),
            test_count=int(metrics.get("testNodeCount", 0) or 0),
            prod_count=int(metrics.get("prodNodeCount", 0) or 0),
            test_vs_prod_ratio=float(metrics.get("testVsProdRatio", 0.0) or 0.0),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
