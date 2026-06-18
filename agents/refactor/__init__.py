"""
Refactor Agent (FORA-82 / 8.1 + FORA-83 / 8.2).

Public surface:

Sub-goal 8.1 (FORA-82 — code analyzer):
  - `RepoScope`, `FileRecord`                — input shapes
  - `MigrationScope`, `MigrationSummary`     — output shapes
  - `CategoryAssignment`, `TransformMapping`,
    `RiskAssessment`, `Evidence`             — verdict shapes
  - `analyze_scope(repo_scope) -> MigrationScope` — the canonical call
  - `render_risk_register(scope) -> str`     — Markdown risk register
  - `sample_legacy_monolith()`              — the v0.1 smoke-test fixture

Sub-goal 8.2 (FORA-83 — dependency graph):
  - `DependencyGraph`, `GraphNode`, `GraphEdge`,
    `CycleReport`, `ServiceGraph`,
    `ServiceGraphNode`, `ServiceGraphEdge`,
    `ServiceCluster`                          — output shapes
  - `build_graph(scope) -> DependencyGraph`  — the canonical call
  - `render_mermaid(graph)`                  — Mermaid flowchart
  - `attach_risk_and_tier_to_services(graph, scope)`
"""

from .analyzer import (
    ANALYZER_VERSION,
    analyze_scope,
    render_risk_register,
)
from .categorizer import categorize
from .dependency_graph import (
    CLUSTER_MIN_EDGE_COUNT,
    GRAPH_VERSION,
    attach_risk_and_tier_to_services,
    build_graph,
    render_mermaid,
)
from .mock_fixtures import sample_legacy_monolith
from .risk_scorer import assess_risks, repo_risk_score
from .schemas import (
    CATEGORIES,
    RISK_LEVELS,
    TRANSFORM_TIERS,
    TRANSFORM_UNITS,
    CategoryAssignment,
    CycleReport,
    DependencyGraph,
    Evidence,
    FileRecord,
    GraphEdge,
    GraphNode,
    MigrationScope,
    MigrationSummary,
    RepoScope,
    RiskAssessment,
    ServiceCluster,
    ServiceGraph,
    ServiceGraphEdge,
    ServiceGraphNode,
    TransformMapping,
)
from .transform_mapper import map_transform


__all__ = [
    # Analyzer (8.1)
    "ANALYZER_VERSION",
    "analyze_scope",
    "render_risk_register",
    # Dependency graph (8.2)
    "GRAPH_VERSION",
    "CLUSTER_MIN_EDGE_COUNT",
    "build_graph",
    "render_mermaid",
    "attach_risk_and_tier_to_services",
    # Categorizer / risk / mapper (exposed for downstream 8.2/8.3/8.4)
    "categorize",
    "assess_risks",
    "repo_risk_score",
    "map_transform",
    # Schemas (8.1)
    "CATEGORIES",
    "RISK_LEVELS",
    "TRANSFORM_TIERS",
    "TRANSFORM_UNITS",
    "CategoryAssignment",
    "Evidence",
    "FileRecord",
    "MigrationScope",
    "MigrationSummary",
    "RepoScope",
    "RiskAssessment",
    "TransformMapping",
    # Schemas (8.2)
    "CycleReport",
    "DependencyGraph",
    "GraphEdge",
    "GraphNode",
    "ServiceCluster",
    "ServiceGraph",
    "ServiceGraphEdge",
    "ServiceGraphNode",
    # Fixtures
    "sample_legacy_monolith",
]
