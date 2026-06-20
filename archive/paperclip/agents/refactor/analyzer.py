"""
Analyzer — public entry point for the code-analyzer (FORA-82, 8.1).

`analyze_scope(repo_scope)` is the canonical function. It is pure:
no I/O, no LLM, no HTTP, no subprocess. The smoke test asserts a
< 10 s runtime and a $0 cost.

The output `MigrationScope` is the deliverable that the downstream
sub-goals consume:

  - 8.2 dependency graph        : reads `summary.services` and the
                                  import-derived graph edges.
  - 8.3 AWS Transform orchestration: reads `transform_mappings` and
                                  submits Transform jobs based on
                                  `unit` + `tier`.
  - 8.4 migration planner + Jira: reads `categorizations` +
                                  `risk_assessments` to size Jira
                                  epics and stories.

`analyze_scope` validates the input, normalises it, runs the
categorizer + risk scorer + transform mapper, and assembles a
`MigrationScope` report.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any, Dict, List

from .categorizer import assert_all_categories_reachable, categorize
from .risk_scorer import assess_risks, repo_risk_score
from .schemas import (
    CATEGORIES,
    RISK_LEVELS,
    SUPPORTED_INPUT_SCHEMA_VERSIONS,
    TRANSFORM_TIERS,
    TRANSFORM_UNITS,
    CategoryAssignment,
    Evidence,
    MigrationScope,
    MigrationSummary,
    RepoScope,
    RiskAssessment,
    TransformMapping,
)
from .transform_mapper import map_transform


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


ANALYZER_VERSION = "code-analyzer/0.1.0"


def analyze_scope(repo_scope: RepoScope) -> MigrationScope:
    """Run the categorizer, risk scorer, and transform mapper against
    `repo_scope` and return a `MigrationScope`.

    This function is pure. It does not write files, make network
    calls, or invoke the LLM. The smoke test wraps it with the
    evidence-capture and artefact-emission logic.
    """
    assert_all_categories_reachable()
    _validate_repo_scope(repo_scope)

    t0 = time.perf_counter()

    # Run each stage. Each one is independently pure; the assembly
    # here is the only place that holds the orchestration knowledge.
    categorizations: List[CategoryAssignment] = categorize(repo_scope.files)
    risk_assessments: List[RiskAssessment] = assess_risks(repo_scope.files)
    transform_mappings: List[TransformMapping] = map_transform(repo_scope.files)

    # Top-line summary.
    category_counts: Dict[str, int] = {c: 0 for c in CATEGORIES}
    for c in categorizations:
        category_counts[c.category] = category_counts.get(c.category, 0) + 1

    unit_counts: Dict[str, int] = {u: 0 for u in TRANSFORM_UNITS}
    for m in transform_mappings:
        unit_counts[m.unit] = unit_counts.get(m.unit, 0) + 1

    tier_counts: Dict[str, int] = {t: 0 for t in TRANSFORM_TIERS}
    for m in transform_mappings:
        tier_counts[m.tier] = tier_counts.get(m.tier, 0) + 1

    risk_counts: Dict[str, int] = {r: 0 for r in RISK_LEVELS}
    for r in risk_assessments:
        risk_counts[r.risk_level] = risk_counts.get(r.risk_level, 0) + 1

    dominant_tier = _dominant(tier_counts)
    dominant_risk = _dominant(risk_counts)
    total_effort = round(sum(r.estimated_effort_days for r in risk_assessments), 3)

    summary = MigrationSummary(
        total_files=repo_scope.file_count,
        total_loc=repo_scope.total_loc,
        languages=repo_scope.languages,
        services=len(repo_scope.services),
        transform_tier=dominant_tier,
        risk_level=dominant_risk,
        estimated_effort_days=total_effort,
        category_counts=dict(sorted(category_counts.items())),
        unit_counts=dict(sorted(unit_counts.items())),
        tier_counts=dict(sorted(tier_counts.items())),
        risk_counts=dict(sorted(risk_counts.items())),
    )

    # Top-level evidence rollup. One evidence row per stage so the
    # downstream 8.2/8.3/8.4 stages can attribute the cost / choice
    # back to a specific stage.
    evidence: List[Evidence] = [
        Evidence(
            kind="summary",
            description=(
                f"Repo scope projected to {summary.total_files} files "
                f"({summary.total_loc} LoC) across "
                f"{summary.services} services / modules."
            ),
            metric="total_files",
            value=float(summary.total_files),
        ),
        Evidence(
            kind="summary",
            description=(
                f"Dominant transform tier {dominant_tier} covers "
                f"{tier_counts.get(dominant_tier, 0)} files."
            ),
            metric="dominant_tier",
            value=float(TRANSFORM_TIERS.index(dominant_tier)) if dominant_tier in TRANSFORM_TIERS else -1.0,
        ),
        Evidence(
            kind="summary",
            description=(
                f"Total estimated migration effort: {total_effort:.2f} person-days."
            ),
            metric="estimated_effort_days",
            value=total_effort,
        ),
    ]

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if elapsed_ms > 10_000:
        raise RuntimeError(
            f"Analyzer exceeded cost bound: {elapsed_ms:.1f} ms > 10,000 ms."
        )

    report = MigrationScope(
        schema_version=1,
        report_id=str(uuid.uuid4()),
        generated_at=repo_scope.generated_at,
        source=repo_scope.source,
        target_root=repo_scope.target_root,
        analyzer_version=ANALYZER_VERSION,
        repo_fingerprint=repo_scope.repo_fingerprint,
        deterministic=True,
        analyzer_runtime_ms=round(elapsed_ms, 3),
        cost_usd=0.0,
        summary=summary,
        categorizations=categorizations,
        transform_mappings=transform_mappings,
        risk_assessments=risk_assessments,
        evidence=evidence,
        notes=[
            "Analyzer is pure-Python; no LLM, no network. Same input -> same output.",
            "Cost bound: < 10 s, $0 spend. The smoke test asserts both.",
            "v0.1 ships a transparent rule-based mapper. v0.2 will add an LLM-backed "
            "reviewer pass for low-confidence categorizations; see /FORA/issues/FORA-71 "
            "for the pattern.",
        ],
    )

    return report


def render_risk_register(scope: MigrationScope) -> str:
    """Render a Markdown risk register for human review (CTO + Board)."""
    lines = [
        f"# Risk Register — {scope.source}",
        "",
        f"- Generated: `{scope.generated_at}`",
        f"- Analyzer: `{scope.analyzer_version}` (schema v{scope.schema_version})",
        f"- Repo fingerprint: `{scope.repo_fingerprint}`",
        f"- Runtime: {scope.analyzer_runtime_ms:.2f} ms  |  Cost: ${scope.cost_usd:.2f}",
        "",
        "## Top-line",
        "",
        f"- Files: **{scope.summary.total_files}**  |  LoC: **{scope.summary.total_loc}**  |  Services: **{scope.summary.services}**",
        f"- Languages: `{scope.summary.languages}`",
        f"- Dominant tier: **{scope.summary.transform_tier}**  |  Dominant risk: **{scope.summary.risk_level}**",
        f"- Estimated migration effort: **{scope.summary.estimated_effort_days:.2f} person-days**",
        "",
        "## Category counts",
        "",
        "| Category | Files |",
        "| --- | ---: |",
    ]
    for cat, n in scope.summary.category_counts.items():
        lines.append(f"| `{cat}` | {n} |")

    lines.extend([
        "",
        "## AWS Transform unit counts",
        "",
        "| Unit | Files |",
        "| --- | ---: |",
    ])
    for unit, n in scope.summary.unit_counts.items():
        lines.append(f"| `{unit}` | {n} |")

    lines.extend([
        "",
        "## Tier counts",
        "",
        "| Tier | Files |",
        "| --- | ---: |",
    ])
    for tier, n in scope.summary.tier_counts.items():
        lines.append(f"| `{tier}` | {n} |")

    lines.extend([
        "",
        "## Top 10 risk files",
        "",
        "| Path | Risk | Score | Effort (days) | Factors |",
        "| --- | --- | ---: | ---: | --- |",
    ])
    for r in scope.top_risks(10):
        factors = "; ".join(r.factors) if r.factors else "—"
        lines.append(
            f"| `{r.path}` | {r.risk_level} | {r.score:.2f} | {r.estimated_effort_days:.2f} | {factors} |"
        )

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(f"_Report ID: `{scope.report_id}`_")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _validate_repo_scope(repo_scope: RepoScope) -> None:
    if not isinstance(repo_scope, RepoScope):
        raise ValueError("repo_scope must be a RepoScope instance.")
    if repo_scope.schema_version not in SUPPORTED_INPUT_SCHEMA_VERSIONS:
        raise ValueError(
            f"Unsupported RepoScope schemaVersion={repo_scope.schema_version!r}; "
            f"analyzer supports {SUPPORTED_INPUT_SCHEMA_VERSIONS}."
        )
    if repo_scope.total_loc_estimate < 0:
        raise ValueError("repo_scope.total_loc_estimate must be non-negative.")
    for f in repo_scope.files:
        if f.loc < 0:
            raise ValueError(f"file {f.path!r} has negative LoC.")


def _dominant(counts: Dict[str, int]) -> str:
    """Return the key with the highest count, breaking ties by lexical
    order. Returns a stable sentinel when the input is empty."""
    if not counts:
        return "skip"
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
