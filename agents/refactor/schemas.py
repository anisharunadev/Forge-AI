"""
Schemas for the code-analyzer (FORA-82, sub-goal 8.1).

`RepoScope` is the normalized input — the GitHub MCP (or a mock fixture
for v0.1 tests) projects a repository down to this shape so the
analyzer stays a pure function of well-typed data.

`MigrationScope` is the canonical output. It is the deliverable the
downstream sub-goals (8.2 dependency graph, 8.3 AWS Transform
orchestration, 8.4 migration planner) consume. Schema v1 is closed;
add new fields by bumping `schemaVersion` and extending
`MigrationScope` in a single place.

All dataclasses have `to_dict()` so the JSON serializer can flatten
them deterministically.
"""

from __future__ import annotations

import hashlib
import json as _json
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Input — RepoScope
# ---------------------------------------------------------------------------

# Schema version for RepoScope. The detector is forward-compatible: if the
# GitHub MCP starts emitting more fields, we can fold them into a new
# summary builder without breaking older fixtures.
SUPPORTED_INPUT_SCHEMA_VERSIONS = (1,)


# Close-set categories the categorizer can assign to a file.
CATEGORIES: List[str] = [
    "keep_as_is",
    "refactor_in_place",
    "replace",
    "rewrite",
    "remove",
]

# Close-set risk levels. Score thresholds are documented in risk_scorer.py.
RISK_LEVELS: List[str] = ["low", "medium", "high"]

# AWS Transform tier codes (T1..T4 + skip for "no migration needed").
TRANSFORM_TIERS: List[str] = ["T1", "T2", "T3", "T4", "skip"]

# AWS Transform unit kinds the mapper can recommend. Kept as a closed set
# so reports are easy to diff and easy for 8.3 to orchestrate.
TRANSFORM_UNITS: List[str] = [
    "lambda",         # serverless function
    "container",      # ECS/Fargate or EKS pod
    "ec2",            # legacy lift-and-shift target
    "aurora",         # managed DB
    "rds",            # managed DB (non-Aurora)
    "s3",             # object storage / static assets
    "cloudfront",     # CDN / static delivery
    "api_gateway",    # public edge
    "step_functions", # workflow orchestrator
    "skip",           # no AWS mapping (kept in-place, e.g. tests)
]


@dataclass
class FileRecord:
    """A single file in the normalized repo scope."""
    path: str
    language: str                  # "python" | "typescript" | "java" | ...
    loc: int                       # non-negative
    role: str                      # "service" | "model" | "test" | "config" | "infra" | "doc" | "ui" | ...
    service: Optional[str] = None  # service / module name, when known
    imports: List[str] = field(default_factory=list)        # outbound import paths (in-repo)
    imported_by: List[str] = field(default_factory=list)    # inbound import paths (in-repo)
    has_tests: bool = False
    is_entrypoint: bool = False
    in_deprecated_path: bool = False  # path matches /legacy/, /deprecated/, /old/
    in_generated_path: bool = False   # path matches /generated/, /dist/, /build/

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class RepoScope:
    """The normalized input shape.

    A complete fixture (forge/8.1/input/repo-scope.json) or the
    GitHub MCP projection of a real repo lands in this shape. The
    analyzer never makes outbound calls — that is the v0.2 concern.
    """
    schema_version: int
    generated_at: str
    source: str                   # e.g. "github:owner/repo@sha"
    target_root: str              # e.g. "/repo"
    default_branch: str
    total_loc_estimate: int       # non-negative
    files: List[FileRecord] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["files"] = [f.to_dict() for f in self.files]
        return d

    @property
    def file_count(self) -> int:
        return len(self.files)

    @property
    def languages(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for f in self.files:
            out[f.language] = out.get(f.language, 0) + 1
        return dict(sorted(out.items()))

    @property
    def services(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for f in self.files:
            if f.service:
                out[f.service] = out.get(f.service, 0) + 1
        return dict(sorted(out.items()))

    @property
    def total_loc(self) -> int:
        return sum(f.loc for f in self.files)

    @property
    def repo_fingerprint(self) -> str:
        """Deterministic 16-char fingerprint for the input."""
        # Use sorted paths to make the fingerprint independent of the
        # input ordering.
        payload = _json.dumps(
            sorted([(f.path, f.language, f.loc, f.role) for f in self.files]),
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Output — MigrationScope
# ---------------------------------------------------------------------------


@dataclass
class Evidence:
    """A single piece of evidence that justifies a categorization, risk score,
    or transform mapping. Mirrors the FORA-29 Evidence shape so downstream
    tools (8.2, 8.3) can render reports uniformly."""
    kind: str               # "category" | "risk" | "transform" | "summary"
    description: str
    paths: List[str] = field(default_factory=list)
    metric: Optional[str] = None
    value: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CategoryAssignment:
    """The categorizer's verdict for a single file."""
    path: str
    category: str
    rationale: str
    evidence: List[Evidence] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["evidence"] = [e.to_dict() for e in self.evidence]
        return d


@dataclass
class TransformMapping:
    """The mapper's verdict for a single file."""
    path: str
    unit: str           # one of TRANSFORM_UNITS
    tier: str           # one of TRANSFORM_TIERS
    rationale: str
    evidence: List[Evidence] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["evidence"] = [e.to_dict() for e in self.evidence]
        return d


@dataclass
class RiskAssessment:
    """The risk scorer's verdict for a single file."""
    path: str
    risk_level: str        # one of RISK_LEVELS
    score: float           # in [0.0, 10.0]
    factors: List[str]     # ordered list of contributing factors
    estimated_effort_days: float
    evidence: List[Evidence] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["evidence"] = [e.to_dict() for e in self.evidence]
        return d


@dataclass
class MigrationSummary:
    """Top-line numbers for the migration scope report."""
    total_files: int
    total_loc: int
    languages: Dict[str, int]
    services: int
    transform_tier: str                  # dominant tier across the repo
    risk_level: str                      # dominant risk across the repo
    estimated_effort_days: float
    category_counts: Dict[str, int]      # category -> file count
    unit_counts: Dict[str, int]          # unit -> file count
    tier_counts: Dict[str, int]          # tier -> file count
    risk_counts: Dict[str, int]          # risk -> file count

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class MigrationScope:
    """Top-level deliverable: a complete migration scope for one repo."""
    schema_version: int
    report_id: str
    generated_at: str
    source: str
    target_root: str
    analyzer_version: str
    repo_fingerprint: str
    deterministic: bool
    analyzer_runtime_ms: float
    cost_usd: float                      # always 0 — pure-Python
    summary: MigrationSummary
    categorizations: List[CategoryAssignment]
    transform_mappings: List[TransformMapping]
    risk_assessments: List[RiskAssessment]
    evidence: List[Evidence]
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["summary"] = self.summary.to_dict()
        d["categorizations"] = [c.to_dict() for c in self.categorizations]
        d["transform_mappings"] = [m.to_dict() for m in self.transform_mappings]
        d["risk_assessments"] = [r.to_dict() for r in self.risk_assessments]
        d["evidence"] = [e.to_dict() for e in self.evidence]
        return d

    def files_by_category(self) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {c: [] for c in CATEGORIES}
        for c in self.categorizations:
            out.setdefault(c.category, []).append(c.path)
        for v in out.values():
            v.sort()
        return out

    def top_risks(self, n: int = 10) -> List[RiskAssessment]:
        """The N highest-risk files, sorted by score (desc) then path (asc)."""
        ranked = sorted(
            self.risk_assessments,
            key=lambda r: (-r.score, r.path),
        )
        return ranked[:n]


# ---------------------------------------------------------------------------
# Dependency graph (FORA-83, sub-goal 8.2)
# ---------------------------------------------------------------------------
#
# Schema v1 is closed; add new fields by bumping `schemaVersion` and
# extending the dataclasses in a single place. Downstream sub-goals
# (8.3 AWS Transform orchestration, 8.4 migration planner) consume
# the same shape.
#
# Two projections are emitted from the same `RepoScope`:
#
#   * **File-level graph** — one node per file with a `path`; edges
#     are the in-repo `imports` edges. The node carries the file's
#     `service` so the service graph can be derived without a second
#     pass.
#   * **Service-level graph** — one node per `service` (or
#     `<unassigned>` for files without a service); edges are
#     aggregated inter-service imports, weighted by edge count.
#
# `DependencyGraph` is the canonical output. `CycleReport`,
# `ServiceCluster`, and `ServiceGraph` are derived projections
# used by the human-readable artefacts (cycles.json, services.json,
# dependency-graph.md).


@dataclass
class GraphNode:
    """A single node in the file-level dependency graph."""
    path: str                              # unique; matches FileRecord.path
    service: str                           # "<unassigned>" when no service
    role: str                              # mirrors FileRecord.role
    loc: int                               # mirrors FileRecord.loc
    language: str                          # mirrors FileRecord.language
    fan_in: int = 0                        # inbound edge count
    fan_out: int = 0                       # outbound edge count
    blast_radius: int = 0                  # transitive fan-in size (incl. self)
    in_cycle: bool = False                 # part of a non-trivial SCC
    cycle_id: Optional[int] = None         # SCC id when in a cycle

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class GraphEdge:
    """A single directed edge in the file-level dependency graph."""
    source: str       # path
    target: str       # path
    weight: int = 1   # 1 for v0.1; reserved for v0.2 weighted imports

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CycleReport:
    """A strongly-connected component (Tarjan SCC) of the file graph.

    A cycle is a non-trivial SCC — size >= 2, OR size 1 with a
    self-loop. Single-node SCCs without self-loops are not cycles.
    """
    cycle_id: int
    members: List[str]                    # file paths in the SCC
    is_self_loop: bool = False            # True iff cycle is one node with self-edge
    edges_in_cycle: List[GraphEdge] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["edges_in_cycle"] = [e.to_dict() for e in self.edges_in_cycle]
        return d

    @property
    def size(self) -> int:
        return len(self.members)


@dataclass
class ServiceGraphNode:
    """A single node in the service-level dependency graph."""
    service: str                          # "<unassigned>" if no service
    file_count: int
    total_loc: int
    fan_in: int = 0                       # inbound service-to-service edges (count)
    fan_out: int = 0                      # outbound service-to-service edges (count)
    blast_radius_files: int = 0           # transitive file-level fan-in
    risk_level: str = "low"               # dominant risk across member files
    dominant_tier: str = "skip"           # dominant transform tier across member files
    cluster_id: Optional[int] = None      # set when the service is part of a cluster

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ServiceGraphEdge:
    """A single weighted edge in the service-level graph."""
    source: str           # source service
    target: str           # target service
    weight: int           # number of distinct file-level edges

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ServiceGraph:
    """The aggregated service-level graph."""
    schema_version: int
    nodes: List[ServiceGraphNode]
    edges: List[ServiceGraphEdge]

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["nodes"] = [n.to_dict() for n in self.nodes]
        d["edges"] = [e.to_dict() for e in self.edges]
        return d


@dataclass
class ServiceCluster:
    """A tightly-coupled cluster of services.

    v0.1 uses a simple rule: any pair of services with >= 3 file-level
    edges between them is "tightly coupled". Connected components
    of the tightly-coupled relation are the clusters. v0.2 will
    swap in Louvain / label-propagation.
    """
    cluster_id: int
    services: List[str]                   # sorted list of service names
    edge_count: int                       # intra-cluster edge count
    avg_edges_per_pair: float             # edge_count / pair_count

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DependencyGraph:
    """Top-level deliverable: the module dependency graph for a repo.

    Produced by `build_graph(scope)` from a `MigrationScope` (8.1)
    or directly from a `RepoScope`. Pure function of the input;
    deterministic.
    """
    schema_version: int
    report_id: str
    generated_at: str
    source: str                           # mirrors MigrationScope.source
    graph_version: str                    # "dep-graph/0.1.0"
    repo_fingerprint: str                 # mirrors MigrationScope.repo_fingerprint
    deterministic: bool
    graph_runtime_ms: float
    cost_usd: float                       # always 0 — pure-Python
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    cycles: List[CycleReport]
    service_graph: ServiceGraph
    clusters: List[ServiceCluster]
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["nodes"] = [n.to_dict() for n in self.nodes]
        d["edges"] = [e.to_dict() for e in self.edges]
        d["cycles"] = [c.to_dict() for c in self.cycles]
        d["service_graph"] = self.service_graph.to_dict()
        d["clusters"] = [c.to_dict() for c in self.clusters]
        return d

    def files_in_cycles(self) -> List[str]:
        out: List[str] = []
        for c in self.cycles:
            out.extend(c.members)
        return sorted(out)

    def top_fan_in(self, n: int = 10) -> List[GraphNode]:
        return sorted(
            (node for node in self.nodes if node.fan_in > 0),
            key=lambda n_: (-n_.fan_in, n_.path),
        )[:n]

    def top_fan_out(self, n: int = 10) -> List[GraphNode]:
        return sorted(
            (node for node in self.nodes if node.fan_out > 0),
            key=lambda n_: (-n_.fan_out, n_.path),
        )[:n]

    def top_blast_radius(self, n: int = 10) -> List[GraphNode]:
        return sorted(
            self.nodes,
            key=lambda n_: (-n_.blast_radius, n_.path),
        )[:n]


# ---------------------------------------------------------------------------
# Wave plan (FORA-84, sub-goal 8.3)
# ---------------------------------------------------------------------------
#
# Schema v1 is closed; the same extension rules as 8.1 / 8.2 apply:
# bump `schemaVersion` and extend the dataclasses in a single place
# on breaking changes.
#
# `WavePlan` is the deliverable that the downstream sub-goal consumes:
#
#   - 8.4 migration planner + Jira — emits one Jira epic per wave,
#     one story per gate, and one release ticket per (tier, service)
#     group. The planner does not call AWS; it calls the Jira MCP.
#
# v0.1 of the planner is pure: it does not execute any command. v0.2
# (post `aws-transform-agent` hire) routes the `WaveCommand` lists
# through the customer-cloud-broker dispatch (FORA-126 / FORA-126.5).

# Closed-set wave kinds. Ordered roughly by lifecycle phase so the
# `kind` value alone tells you where in the plan the wave sits.
WAVE_KINDS: List[str] = [
    "preflight",
    "cycle_break",
    "cluster_break",
    "tier_wave",
    "cutover",
    "validation",
]

# Closed-set gate kinds. v0.1 emits these; v0.2 wires the executor.
WAVE_GATE_KINDS: List[str] = [
    "canary_probe",          # FORA-194 canary probe via CCB
    "compile",               # run the project's build
    "unit_test",             # run the smoke test
    "lint",
    "dep_check",
    "secret_rotate_check",   # FORA-128 secrets MCP
    "audit_completeness_check",  # FORA-36 audit schema
]

# Mapping from `unit` (8.1 vocabulary) to the AWS service(s) the wave
# touches. Closed-set so plans are easy to diff.
UNIT_TO_AWS_SERVICES: Dict[str, List[str]] = {
    "lambda":         ["lambda", "apigateway"],
    "container":      ["ecs", "fargate", "ecr"],
    "ec2":            ["mgn", "ec2", "migrationhub"],
    "aurora":         ["dms", "aurora", "migrationhub"],
    "rds":            ["dms", "rds", "migrationhub"],
    "s3":             ["s3", "migrationhub"],
    "cloudfront":     ["cloudfront", "s3", "migrationhub"],
    "api_gateway":    ["apigateway", "lambda"],
    "step_functions": ["stepfunctions", "lambda"],
    "skip":           [],
}

# Closed-set of seams the orchestrator may reference. Each wave's
# `commands[*].via` and each `gates[*].seam` must be one of these.
WAVE_SEAMS: List[str] = [
    "customer-cloud-broker/audit",
    "customer-cloud-broker/dispatch:ec2",
    "customer-cloud-broker/dispatch:ecs",
    "customer-cloud-broker/dispatch:lambda",
    "customer-cloud-broker/dispatch:apigateway",
    "customer-cloud-broker/dispatch:stepfunctions",
    "customer-cloud-broker/dispatch:dms",
    "customer-cloud-broker/dispatch:refactor-spaces",
    "customer-cloud-broker/dispatch:route53",
    "customer-cloud-broker/probe-signer",
    "mcp-servers/secrets",
    "mcp-servers/jira",
    "forge/build-publish",
]


@dataclass
class WaveGate:
    """A pre-flight or post-flight gate on a wave."""
    gate_id: str
    kind: str                                # one of WAVE_GATE_KINDS
    description: str
    seam: str                                # one of WAVE_SEAMS
    blocking: bool = True                    # blocking gates stop the wave
    timeout_s: int = 60

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class WaveCommand:
    """A single AWS action in a wave. v0.1 emits; v0.2 executes via the seam."""
    command_id: str
    service: str                              # AWS service (e.g. "ec2", "dms")
    action: str                               # AWS API call (e.g. "MGN.start_replication")
    params: Dict[str, Any] = field(default_factory=dict)
    audit_action: str = ""                    # audit event name emitted on completion
    via: str = ""                             # one of WAVE_SEAMS

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class WaveBreak:
    """A summary of a cycle or cluster break, surfaced for 8.4 to size Jira epics."""
    break_id: str                             # "cycle-<id>" or "cluster-<id>"
    kind: str                                 # "cycle" | "cluster"
    members: List[str]                        # sorted; for cycle: file paths, for cluster: service names
    rationale: str
    wave_id: int                              # the wave this break lives in

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TransformWave:
    """A single wave in the WavePlan. Ordered topologically by `wave_id`."""
    wave_id: int
    wave_name: str                            # human-readable, used in render_wave_plan
    tier: str                                 # one of TRANSFORM_TIERS
    kind: str                                 # one of WAVE_KINDS
    target_aws_services: List[str] = field(default_factory=list)
    files: List[str] = field(default_factory=list)  # sorted
    prerequisites: List[int] = field(default_factory=list)  # wave_ids
    gates: List[WaveGate] = field(default_factory=list)
    commands: List[WaveCommand] = field(default_factory=list)
    audit_action: str = ""
    estimated_effort_days: float = 0.0
    rationale: str = ""
    service: str = ""                         # service tag for tier_wave; empty otherwise

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["gates"] = [g.to_dict() for g in self.gates]
        d["commands"] = [c.to_dict() for c in self.commands]
        return d


@dataclass
class WaveSummary:
    """Top-line numbers for the wave plan."""
    total_waves: int
    total_files: int                          # files that appear in some wave (skip files excluded)
    skipped_files: int                        # files in `skip` tier — never scheduled
    cycle_breaks: int                         # number of cycle_break waves
    cluster_breaks: int                       # number of cluster_break waves
    high_risk_waves: int                      # waves that carry a canary_probe gate
    total_estimated_effort_days: float
    tier_counts: Dict[str, int]               # tier -> wave count
    unit_counts: Dict[str, int]               # unit -> file count (across waves)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class WavePlan:
    """Top-level deliverable: the sequenced AWS Transform orchestration plan.

    Produced by `plan_waves(scope, graph)` from a `MigrationScope` (8.1)
    and a `DependencyGraph` (8.2). Pure function of the inputs;
    deterministic.
    """
    schema_version: int
    report_id: str
    generated_at: str
    source: str
    planner_version: str                      # "wave-planner/0.1.0"
    repo_fingerprint: str
    deterministic: bool
    planner_runtime_ms: float
    cost_usd: float                           # always 0 — pure-Python
    waves: List[TransformWave]
    cycle_breaks: List[WaveBreak]
    cluster_breaks: List[WaveBreak]
    summary: WaveSummary
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["waves"] = [w.to_dict() for w in self.waves]
        d["cycle_breaks"] = [b.to_dict() for b in self.cycle_breaks]
        d["cluster_breaks"] = [b.to_dict() for b in self.cluster_breaks]
        d["summary"] = self.summary.to_dict()
        return d

    def wave_by_id(self, wave_id: int) -> Optional[TransformWave]:
        for w in self.waves:
            if w.wave_id == wave_id:
                return w
        return None

    def high_risk_waves(self) -> List[TransformWave]:
        """Waves that carry a `canary_probe` gate (i.e. are high-risk)."""
        return [w for w in self.waves if any(g.kind == "canary_probe" for g in w.gates)]


# ---------------------------------------------------------------------------
# End of wave plan section (FORA-84, sub-goal 8.3).
# ---------------------------------------------------------------------------
