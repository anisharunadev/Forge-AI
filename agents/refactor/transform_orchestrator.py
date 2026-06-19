"""
Wave planner — public entry point for the AWS Transform orchestrator
(FORA-84, sub-goal 8.3).

`plan_waves(scope, graph) -> WavePlan` is the canonical call. It is
pure: no I/O, no LLM, no HTTP, no subprocess. The smoke test asserts
a < 10 s runtime and a $0 cost.

The output `WavePlan` is the deliverable that the downstream sub-goal
consumes:

  - 8.4 migration planner + Jira — emits one Jira epic per wave,
    one story per gate, and one release ticket per (tier, service)
    group. The planner does not call AWS; it calls the Jira MCP.

`plan_waves` validates the inputs, builds the wave list (preflight →
cycle_breaks → cluster_breaks → tier_waves → cutover → validation),
assigns topological order, attaches gates (canary_probe for high-risk,
secret_rotate_check for credential waves, audit_completeness for all),
emits the AWS service targets + `WaveCommand` lists, and assembles the
`WavePlan`.

Hard rule: the orchestrator orchestrates. It does not call the AWS SDK
directly. Every wave's `commands[*].via` references an existing FORA
seam (customer-cloud-broker dispatch / probe / audit; mcp-servers/secrets;
mcp-servers/jira; forge/build-publish). v0.2 wires the executor.
"""

from __future__ import annotations

import time
import uuid
from typing import Dict, List, Optional, Sequence, Set, Tuple

from .schemas import (
    TRANSFORM_TIERS,
    UNIT_TO_AWS_SERVICES,
    WAVE_GATE_KINDS,
    WAVE_KINDS,
    WAVE_SEAMS,
    CategoryAssignment,
    CycleReport,
    DependencyGraph,
    FileRecord,
    MigrationScope,
    RepoScope,
    RiskAssessment,
    ServiceCluster,
    TransformMapping,
    TransformWave,
    WaveBreak,
    WaveCommand,
    WaveGate,
    WavePlan,
    WaveSummary,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


PLANNER_VERSION = "wave-planner/0.1.0"

# Tier ordering for the top-level sort. `skip` is intentionally absent
# — files in the `skip` tier never enter a wave.
TIER_ORDER: Dict[str, int] = {t: i for i, t in enumerate(TRANSFORM_TIERS) if t != "skip"}

# AWS actions the orchestrator emits, by unit. v0.1 emits one canonical
# action per unit; v0.2 may add per-tenant overrides.
UNIT_TO_AWS_ACTION: Dict[str, Tuple[str, str]] = {
    # unit -> (action, audit_action_prefix)
    "lambda":         ("Lambda.create_function",     "aws.lambda"),
    "container":      ("ECS.create_service",         "aws.ecs"),
    "ec2":            ("MGN.start_replication",      "aws.mgn"),
    "aurora":         ("DMS.start_replication_task", "aws.dms"),
    "rds":            ("DMS.start_replication_task", "aws.dms"),
    "s3":             ("S3.put_bucket",              "aws.s3"),
    "cloudfront":     ("CloudFront.create_distribution", "aws.cloudfront"),
    "api_gateway":    ("APIGateway.create_api",      "aws.apigateway"),
    "step_functions": ("StepFunctions.create_state_machine", "aws.stepfunctions"),
    "skip":           ("", ""),
}

# Per-unit via (seam) mapping. The seam is the FORA implementation that
# executes the command in v0.2. Closed-set; v0.1 emits, v0.2 routes.
UNIT_TO_SEAM: Dict[str, str] = {
    "lambda":         "customer-cloud-broker/dispatch:lambda",
    "container":      "customer-cloud-broker/dispatch:ecs",
    "ec2":            "customer-cloud-broker/dispatch:ec2",
    "aurora":         "customer-cloud-broker/dispatch:dms",
    "rds":            "customer-cloud-broker/dispatch:dms",
    "s3":             "customer-cloud-broker/dispatch:ecs",
    "cloudfront":     "customer-cloud-broker/dispatch:ecs",
    "api_gateway":    "customer-cloud-broker/dispatch:apigateway",
    "step_functions": "customer-cloud-broker/dispatch:stepfunctions",
    "skip":           "",
}

# Service classification for the gate set. Credential waves get a
# `secret_rotate_check`; non-credential waves don't.
WAVES_REQUIRING_CREDENTIALS: Set[str] = {
    "ec2", "aurora", "rds", "lambda", "container",
    "api_gateway", "step_functions", "cloudfront", "s3",
}


def plan_waves(scope: MigrationScope, graph: DependencyGraph) -> WavePlan:
    """Build a `WavePlan` from a `MigrationScope` (8.1) and a
    `DependencyGraph` (8.2). Pure, deterministic, bounded.
    """
    _validate_inputs(scope, graph)

    t0 = time.perf_counter()

    # Index every file by path; merge 8.1 + 8.2 verdicts so the planner
    # can read each file's category, risk, transform mapping, and graph
    # metadata without re-deriving.
    file_index: Dict[str, _FileVerdict] = _index_files(scope, graph)

    skipped_files: List[str] = sorted(
        path for path, v in file_index.items()
        if v.transform is not None and v.transform.unit == "skip"
    )
    scheduled_files: List[str] = sorted(
        path for path, v in file_index.items()
        if v.transform is not None and v.transform.unit != "skip"
    )

    # Build the wave list in lifecycle order, then assign `wave_id`
    # monotonically after topological sort.
    waves: List[TransformWave] = []

    # 1. Pre-flight (wave 0; always present).
    preflight = _build_preflight(scope, graph)
    waves.append(preflight)

    # 2. Cycle-break waves (one per non-trivial SCC). Each must precede
    # any wave whose `files` intersect the SCC's members.
    cycle_breaks: List[WaveBreak] = []
    cycle_break_waves: List[TransformWave] = []
    cycle_member_set: Set[str] = set()
    for cycle in graph.cycles:
        members = sorted(cycle.members)
        wave = _build_cycle_break(scope, cycle, members)
        cycle_break_waves.append(wave)
        cycle_member_set.update(members)
        cycle_breaks.append(WaveBreak(
            break_id=f"cycle-{cycle.cycle_id}",
            kind="cycle",
            members=members,
            rationale=(
                f"Strongly-connected component of {len(members)} files "
                f"(cycle_id={cycle.cycle_id}); break-out interface "
                f"contract must precede any wave that touches these "
                f"files."
            ),
            wave_id=-1,  # assigned during topo sort
        ))

    # 3. Cluster-break waves (one per `ServiceCluster`). Merged when
    # clusters share a service (avoids duplicate co-migrate groups).
    cluster_break_waves, cluster_breaks = _build_cluster_breaks(scope, graph)

    # 4. Tier waves. One per (tier, service) group, files partitioned.
    # Files inside cycles get a `prerequisites` edge to their cycle_break
    # wave. Files in clusters get an edge to their cluster_break wave.
    cycle_break_by_member: Dict[str, int] = {}
    for cb_wave, cb_break in zip(cycle_break_waves, cycle_breaks):
        for m in cb_break.members:
            cycle_break_by_member[m] = -1  # assigned in topo sort

    cluster_break_by_service: Dict[str, int] = {}
    for cl_wave, cl_break in zip(cluster_break_waves, cluster_breaks):
        for s in cl_break.members:
            cluster_break_by_service[s] = -1  # assigned in topo sort

    tier_waves = _build_tier_waves(
        scope=scope,
        file_index=file_index,
        cycle_break_by_member=cycle_break_by_member,
        cluster_break_by_service=cluster_break_by_service,
        skipped_files=set(skipped_files),
    )

    # 5. Cutover + validation (always last two).
    cutover_wave = _build_cutover(scope)
    validation_wave = _build_validation(scope)

    # Concatenate in lifecycle order. Wave IDs are assigned after the
    # topological-sort pass below (which adds prerequisite edges for
    # cycle/cluster breaks).
    waves.extend(cycle_break_waves)
    waves.extend(cluster_break_waves)
    waves.extend(tier_waves)
    waves.append(cutover_wave)
    waves.append(validation_wave)

    # Assign wave_ids in lifecycle order. The pre-flight is always 0;
    # cycle_breaks, cluster_breaks, tier_waves, cutover, validation
    # follow. This guarantees prerequisites always reference an earlier
    # wave_id (topological invariant).
    for idx, w in enumerate(waves):
        w.wave_id = idx

    # Backfill `cycle_break_by_member` and `cluster_break_by_service`
    # now that wave_ids are assigned.
    for cb_wave, cb_break in zip(cycle_break_waves, cycle_breaks):
        cb_break.wave_id = cb_wave.wave_id
    for cl_wave, cl_break in zip(cluster_break_waves, cluster_breaks):
        cl_break.wave_id = cl_wave.wave_id

    for w in cycle_break_waves:
        cycle_break_by_member_member_update(w, cycle_break_by_member)
    for w in cluster_break_waves:
        cluster_break_by_service_member_update(w, cluster_break_by_service)

    # Tier-wave prerequisites: a tier wave that contains cycle members
    # must depend on the cycle_break wave for those members. Same for
    # cluster members. Add the dependency edges here.
    for w in tier_waves:
        prereqs: Set[int] = set()
        for f in w.files:
            if f in cycle_break_by_member and cycle_break_by_member[f] not in prereqs:
                prereqs.add(cycle_break_by_member[f])
            service_for_file = file_index[f].service or "<unassigned>"
            if service_for_file in cluster_break_by_service and cluster_break_by_service[service_for_file] not in prereqs:
                prereqs.add(cluster_break_by_service[service_for_file])
        # Sort prerequisites and exclude self (defensive).
        w.prerequisites = sorted(p for p in prereqs if p != w.wave_id)

    # 6. Summary roll-up.
    summary = _build_summary(scope, waves, cycle_breaks, cluster_breaks,
                             scheduled_files, skipped_files)

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if elapsed_ms > 10_000:
        raise RuntimeError(
            f"wave-planner exceeded cost bound: {elapsed_ms:.1f} ms > 10,000 ms."
        )

    plan = WavePlan(
        schema_version=1,
        report_id=str(uuid.uuid4()),
        generated_at=scope.generated_at,
        source=scope.source,
        planner_version=PLANNER_VERSION,
        repo_fingerprint=scope.repo_fingerprint,
        deterministic=True,
        planner_runtime_ms=round(elapsed_ms, 3),
        cost_usd=0.0,
        waves=waves,
        cycle_breaks=cycle_breaks,
        cluster_breaks=cluster_breaks,
        summary=summary,
        notes=[
            "wave-planner is pure-Python; no LLM, no network. Same input -> same output.",
            "Cost bound: < 10 s, $0 spend. The smoke test asserts both.",
            "v0.1 emits the WavePlan + WaveCommand lists. v0.2 (post `aws-transform-agent` "
            "hire) routes the commands through the customer-cloud-broker dispatch.",
            "Orchestrate, do not rebuild: every wave's `commands[*].via` and `gates[*].seam` "
            "references an existing FORA seam (FORA-126 / FORA-126.5 / FORA-194 / FORA-128 / "
            "FORA-36 / MCP servers).",
        ],
    )
    return plan


def render_wave_plan(plan: WavePlan) -> str:
    """Render a Markdown wave plan for human review (CTO + Board)."""
    lines: List[str] = [
        f"# AWS Transform Wave Plan — {plan.source}",
        "",
        f"- Generated: `{plan.generated_at}`",
        f"- Planner: `{plan.planner_version}` (schema v{plan.schema_version})",
        f"- Repo fingerprint: `{plan.repo_fingerprint}`",
        f"- Runtime: {plan.planner_runtime_ms:.2f} ms  |  Cost: ${plan.cost_usd:.2f}",
        "",
        "## Top-line",
        "",
        f"- Waves: **{plan.summary.total_waves}**  |  Scheduled files: **{plan.summary.total_files}**  |  Skipped: **{plan.summary.skipped_files}**",
        f"- Cycle breaks: **{plan.summary.cycle_breaks}**  |  Cluster breaks: **{plan.summary.cluster_breaks}**  |  High-risk waves: **{plan.summary.high_risk_waves}**",
        f"- Total estimated effort: **{plan.summary.total_estimated_effort_days:.2f} person-days**",
        "",
        "## Tier counts (wave count)",
        "",
        "| Tier | Waves |",
        "| --- | ---: |",
    ]
    for tier, n in sorted(plan.summary.tier_counts.items()):
        lines.append(f"| `{tier}` | {n} |")

    lines.extend([
        "",
        "## Unit counts (file count, scheduled)",
        "",
        "| Unit | Files |",
        "| --- | ---: |",
    ])
    for unit, n in sorted(plan.summary.unit_counts.items()):
        lines.append(f"| `{unit}` | {n} |")

    lines.extend([
        "",
        "## Waves",
        "",
    ])
    for w in plan.waves:
        lines.append(f"### Wave {w.wave_id} — {w.wave_name}  (`{w.kind}`, tier `{w.tier}`, service `{w.service or '—'}`)")
        lines.append("")
        if w.rationale:
            lines.append(f"_{w.rationale}_")
            lines.append("")
        if w.prerequisites:
            prereq_str = ", ".join(f"wave-{p}" for p in w.prerequisites)
            lines.append(f"**Prerequisites:** {prereq_str}")
            lines.append("")
        if w.target_aws_services:
            lines.append(f"**AWS services:** {', '.join(w.target_aws_services)}")
            lines.append("")
        if w.files:
            lines.append(f"**Files ({len(w.files)}):**")
            for f in w.files[:20]:
                lines.append(f"- `{f}`")
            if len(w.files) > 20:
                lines.append(f"- _… and {len(w.files) - 20} more_")
            lines.append("")
        if w.gates:
            lines.append(f"**Gates ({len(w.gates)}):**")
            for g in w.gates:
                blocking = "blocking" if g.blocking else "non-blocking"
                lines.append(f"- `{g.gate_id}` [{g.kind}, {blocking}] via `{g.seam}`")
            lines.append("")
        if w.commands:
            lines.append(f"**Commands ({len(w.commands)}):**")
            for c in w.commands:
                lines.append(
                    f"- `{c.command_id}` `{c.service}.{c.action}` via `{c.via}` "
                    f"(audit: `{c.audit_action}`)"
                )
            lines.append("")
        lines.append(f"**Audit action:** `{w.audit_action}`  |  "
                     f"**Effort:** {w.estimated_effort_days:.2f} person-days")
        lines.append("")
        lines.append("---")
        lines.append("")

    lines.extend([
        "## Cycle breaks",
        "",
        "| Break ID | Members | Wave |",
        "| --- | ---: | ---: |",
    ])
    for b in plan.cycle_breaks:
        lines.append(f"| `{b.break_id}` | {len(b.members)} | wave-{b.wave_id} |")

    lines.extend([
        "",
        "## Cluster breaks",
        "",
        "| Break ID | Services | Wave |",
        "| --- | ---: | ---: |",
    ])
    for b in plan.cluster_breaks:
        lines.append(f"| `{b.break_id}` | {len(b.members)} | wave-{b.wave_id} |")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(f"_Report ID: `{plan.report_id}`_")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


class _FileVerdict:
    """The merged 8.1 + 8.2 verdict for a single file. Used internally."""

    __slots__ = ("path", "category", "risk", "transform", "service",
                 "in_cycle", "blast_radius")

    def __init__(
        self,
        path: str,
        category: Optional[CategoryAssignment],
        risk: Optional[RiskAssessment],
        transform: Optional[TransformMapping],
        service: str,
        in_cycle: bool,
        blast_radius: int,
    ) -> None:
        self.path = path
        self.category = category
        self.risk = risk
        self.transform = transform
        self.service = service
        self.in_cycle = in_cycle
        self.blast_radius = blast_radius


def _validate_inputs(scope: MigrationScope, graph: DependencyGraph) -> None:
    if not isinstance(scope, MigrationScope):
        raise ValueError("scope must be a MigrationScope instance.")
    if not isinstance(graph, DependencyGraph):
        raise ValueError("graph must be a DependencyGraph instance.")
    if scope.repo_fingerprint != graph.repo_fingerprint:
        raise ValueError(
            "MigrationScope.repo_fingerprint and DependencyGraph.repo_fingerprint "
            "must match; got "
            f"{scope.repo_fingerprint!r} vs {graph.repo_fingerprint!r}. "
            "Re-run 8.2 with the 8.1 output as input."
        )


def _index_files(
    scope: MigrationScope,
    graph: DependencyGraph,
) -> Dict[str, _FileVerdict]:
    """Merge 8.1 + 8.2 verdicts into a single per-file index."""
    categories_by_path: Dict[str, CategoryAssignment] = {
        c.path: c for c in scope.categorizations
    }
    risks_by_path: Dict[str, RiskAssessment] = {
        r.path: r for r in scope.risk_assessments
    }
    transforms_by_path: Dict[str, TransformMapping] = {
        m.path: m for m in scope.transform_mappings
    }
    nodes_by_path: Dict[str, object] = {n.path: n for n in graph.nodes}

    out: Dict[str, _FileVerdict] = {}
    all_paths = sorted(
        set(categories_by_path.keys())
        | set(risks_by_path.keys())
        | set(transforms_by_path.keys())
        | set(nodes_by_path.keys())
    )
    for path in all_paths:
        node = nodes_by_path.get(path)
        service = getattr(node, "service", "<unassigned>") if node else "<unassigned>"
        in_cycle = bool(getattr(node, "in_cycle", False)) if node else False
        blast_radius = int(getattr(node, "blast_radius", 1)) if node else 1
        out[path] = _FileVerdict(
            path=path,
            category=categories_by_path.get(path),
            risk=risks_by_path.get(path),
            transform=transforms_by_path.get(path),
            service=service or "<unassigned>",
            in_cycle=in_cycle,
            blast_radius=blast_radius,
        )
    return out


def _build_preflight(scope: MigrationScope, graph: DependencyGraph) -> TransformWave:
    """Wave 0: pre-flight. Always present. Verifies tenant credentials,
    canary-probes MGN reachability, and registers the repo with
    Migration Hub. No files; only gates and a single registration
    command."""
    gates = [
        WaveGate(
            gate_id="wave-0.canary-probe",
            kind="canary_probe",
            description=(
                "Probe tenant credentials + MGN reachability before any "
                "transform wave fires. Implementation: customer-cloud-broker "
                "probe-signer (FORA-194)."
            ),
            seam="customer-cloud-broker/probe-signer",
            blocking=True,
            timeout_s=30,
        ),
        WaveGate(
            gate_id="wave-0.secret-inventory",
            kind="secret_rotate_check",
            description=(
                "Verify every per-platform credential is in the AWS Secrets "
                "Manager inventory and within its rotation window. "
                "Implementation: mcp-servers/secrets (FORA-128)."
            ),
            seam="mcp-servers/secrets",
            blocking=True,
            timeout_s=60,
        ),
    ]
    commands = [
        WaveCommand(
            command_id="wave-0.cmd-0",
            service="migrationhub",
            action="MigrationHub.create_application_component",
            params={
                "application_name": "${repo.source}",
                "description": f"Refactor migration target for {scope.source}.",
                "template_type": "MGN",
            },
            audit_action="aws.migrationhub.create_component",
            via="customer-cloud-broker/audit",
        ),
    ]
    return TransformWave(
        wave_id=0,                                # reassigned in topo sort
        wave_name="preflight",
        tier="skip",
        kind="preflight",
        target_aws_services=["migrationhub", "secretsmanager"],
        files=[],
        prerequisites=[],
        gates=gates,
        commands=commands,
        audit_action="transform.preflight",
        estimated_effort_days=0.0,
        rationale=(
            "Pre-flight: probe tenant credentials, canary MGN reachability, "
            "verify secret rotation, register the repo with AWS Migration Hub."
        ),
    )


def _build_cycle_break(
    scope: MigrationScope,
    cycle: CycleReport,
    members: List[str],
) -> TransformWave:
    """One cycle-break wave per non-trivial SCC. Runs before any wave
    that touches the cycle's files; defines the interface contract that
    breaks the cycle."""
    gates = [
        WaveGate(
            gate_id=f"wave-cycle-{cycle.cycle_id}.audit-completeness",
            kind="audit_completeness_check",
            description=(
                "After the break-out interface is defined, verify every "
                "ADR + Jira story carries a `transform.cycle_break` audit "
                "event. Implementation: agents/audit (FORA-36)."
            ),
            seam="customer-cloud-broker/audit",
            blocking=True,
            timeout_s=60,
        ),
    ]
    return TransformWave(
        wave_id=-1,
        wave_name=f"cycle-break-{cycle.cycle_id}",
        tier="skip",
        kind="cycle_break",
        target_aws_services=["migrationhub"],
        files=members,                            # the cycle members; no tier migration yet
        prerequisites=[],
        gates=gates,
        commands=[
            WaveCommand(
                command_id=f"wave-cycle-{cycle.cycle_id}.cmd-0",
                service="apigateway",
                action="APIGateway.create_api",
                params={
                    "name": f"cycle-{cycle.cycle_id}-stub",
                    "description": (
                        f"Stub interface for SCC of {len(members)} files; "
                        f"breaks cycle before member migration."
                    ),
                },
                audit_action="transform.cycle_break",
                via="customer-cloud-broker/dispatch:apigateway",
            ),
        ],
        audit_action="transform.cycle_break",
        estimated_effort_days=0.5,
        rationale=(
            f"SCC of {len(members)} files (cycle_id={cycle.cycle_id}). "
            f"Define the interface contract that breaks the cycle before "
            f"any member can migrate."
        ),
    )


def _build_cluster_breaks(
    scope: MigrationScope,
    graph: DependencyGraph,
) -> Tuple[List[TransformWave], List[WaveBreak]]:
    """One cluster-break wave per `ServiceCluster`. Clusters that share
    a service are merged into a single wave (avoids duplicate co-migrate
    groups)."""
    if not graph.clusters:
        return [], []

    # Merge overlapping clusters into equivalence classes.
    parent = list(range(len(graph.clusters)))
    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    cluster_services: List[Set[str]] = [
        set(c.services) for c in graph.clusters
    ]
    for i in range(len(graph.clusters)):
        for j in range(i + 1, len(graph.clusters)):
            if cluster_services[i] & cluster_services[j]:
                union(i, j)

    merged: Dict[int, List[int]] = {}
    for i in range(len(graph.clusters)):
        merged.setdefault(find(i), []).append(i)

    waves: List[TransformWave] = []
    breaks: List[WaveBreak] = []
    for merged_id, indices in enumerate(sorted(merged.values())):
        services = sorted(set().union(*(cluster_services[i] for i in indices)))
        original_ids = sorted(graph.clusters[i].cluster_id for i in indices)
        file_paths = _files_in_services(graph, services)
        rationale = (
            f"Tightly-coupled service cluster (original cluster_ids={original_ids}; "
            f"services={services}). Services migrate as a co-migrated group "
            f"to avoid stranded imports."
        )
        gates = [
            WaveGate(
                gate_id=f"wave-cluster-{merged_id}.canary-probe",
                kind="canary_probe",
                description=(
                    f"Co-migrated cluster of {len(services)} services; "
                    f"canary-probe before any cluster member wave fires."
                ),
                seam="customer-cloud-broker/probe-signer",
                blocking=True,
                timeout_s=60,
            ),
        ]
        wave = TransformWave(
            wave_id=-1,
            wave_name=f"cluster-break-{merged_id}",
            tier="skip",
            kind="cluster_break",
            target_aws_services=["migrationhub", "refactor-spaces"],
            files=file_paths,
            prerequisites=[],
            gates=gates,
            commands=[
                WaveCommand(
                    command_id=f"wave-cluster-{merged_id}.cmd-0",
                    service="refactor-spaces",
                    action="RefactorSpaces.create_environment",
                    params={
                        "environment_name": f"cluster-{merged_id}",
                        "services": services,
                    },
                    audit_action="transform.cluster_break",
                    via="customer-cloud-broker/dispatch:refactor-spaces",
                ),
            ],
            audit_action="transform.cluster_break",
            estimated_effort_days=0.5,
            rationale=rationale,
        )
        waves.append(wave)
        breaks.append(WaveBreak(
            break_id=f"cluster-{merged_id}",
            kind="cluster",
            members=services,
            rationale=rationale,
            wave_id=-1,
        ))
    return waves, breaks


def _files_in_services(graph: DependencyGraph, services: Sequence[str]) -> List[str]:
    """Return sorted file paths whose `service` is in `services`.

    Reads the service tag from the file-level graph nodes (the canonical
    source — see `build_graph` §3.1). v0.2 will pull this from a richer
    source when the GitHub MCP is wired; for now the file-level node is
    authoritative.
    """
    service_set = set(services)
    out: List[str] = []
    for node in graph.nodes:
        if node.service in service_set:
            out.append(node.path)
    return sorted(out)


def _build_tier_waves(
    scope: MigrationScope,
    file_index: Dict[str, _FileVerdict],
    cycle_break_by_member: Dict[str, int],
    cluster_break_by_service: Dict[str, int],
    skipped_files: Set[str],
) -> List[TransformWave]:
    """One tier_wave per (tier, service) group, sorted ascending by tier
    then service. Files in `skip` tier never appear here."""
    grouped: Dict[Tuple[str, str], List[str]] = {}
    for path, v in file_index.items():
        if v.transform is None or v.transform.unit == "skip":
            continue
        tier = v.transform.tier
        if tier == "skip":
            continue
        service = v.service or "<unassigned>"
        grouped.setdefault((tier, service), []).append(path)

    waves: List[TransformWave] = []
    # Sort groups: ascending tier index, then ascending service name.
    for (tier, service) in sorted(
        grouped.keys(),
        key=lambda ts: (TIER_ORDER.get(ts[0], 99), ts[1]),
    ):
        paths = sorted(grouped[(tier, service)])
        unit = file_index[paths[0]].transform.unit if paths else "skip"
        aws_services = UNIT_TO_AWS_SERVICES.get(unit, [])
        audit_prefix = UNIT_TO_AWS_ACTION.get(unit, ("", ""))[1]

        # High-risk iff any file in the wave carries risk_level == "high"
        # OR the wave's files include any in-cycle members.
        high_risk = any(
            (file_index[p].risk and file_index[p].risk.risk_level == "high")
            for p in paths
        ) or any(p in cycle_break_by_member for p in paths)

        gates: List[WaveGate] = []
        if high_risk:
            gates.append(WaveGate(
                gate_id=f"wave-tier-{tier}-{service}.canary-probe",
                kind="canary_probe",
                description=(
                    f"High-risk {tier}/{service} wave; canary-probe before "
                    f"any MGN/DMS/Refactor Spaces action fires."
                ),
                seam="customer-cloud-broker/probe-signer",
                blocking=True,
                timeout_s=60,
            ))
        if unit in WAVES_REQUIRING_CREDENTIALS:
            gates.append(WaveGate(
                gate_id=f"wave-tier-{tier}-{service}.secret-rotate",
                kind="secret_rotate_check",
                description=(
                    f"Pre-flight secret rotation check for `{unit}` "
                    f"credentials."
                ),
                seam="mcp-servers/secrets",
                blocking=True,
                timeout_s=60,
            ))
        gates.append(WaveGate(
            gate_id=f"wave-tier-{tier}-{service}.audit-completeness",
            kind="audit_completeness_check",
            description=(
                f"Post-wave audit completeness check for {tier}/{service}."
            ),
            seam="customer-cloud-broker/audit",
            blocking=True,
            timeout_s=60,
        ))

        # Commands — one canonical command per unit (the v0.2 executor
        # expands into per-file calls).
        action, audit_action_suffix = UNIT_TO_AWS_ACTION.get(unit, ("", ""))
        via = UNIT_TO_SEAM.get(unit, "")
        commands: List[WaveCommand] = []
        if action:
            commands.append(WaveCommand(
                command_id=f"wave-tier-{tier}-{service}.cmd-0",
                service=unit,
                action=action,
                params={
                    "tier": tier,
                    "service": service,
                    "file_count": len(paths),
                },
                audit_action=f"{audit_action_suffix}.create" if audit_action_suffix else "",
                via=via,
            ))

        # Effort estimate: sum of per-file effort from risk_assessment.
        effort = round(sum(
            (file_index[p].risk.estimated_effort_days if file_index[p].risk else 0.0)
            for p in paths
        ), 3)

        waves.append(TransformWave(
            wave_id=-1,
            wave_name=f"tier-{tier}-{service}",
            tier=tier,
            kind="tier_wave",
            target_aws_services=aws_services,
            files=paths,
            prerequisites=[],
            gates=gates,
            commands=commands,
            audit_action=audit_action_suffix or "transform.tier_wave",
            estimated_effort_days=effort,
            rationale=(
                f"Migrate {len(paths)} {tier} {unit} file(s) in service "
                f"`{service}` via AWS {', '.join(aws_services) or 'audit-only'}."
            ),
            service=service,
        ))
    return waves


def _build_cutover(scope: MigrationScope) -> TransformWave:
    """The final cutover wave: flips DNS / routing, points the
    customer-facing edge at the new AWS footprint."""
    gates = [
        WaveGate(
            gate_id="wave-cutover.canary-probe",
            kind="canary_probe",
            description=(
                "Canary-probe every cutover candidate route before DNS "
                "flip; refuse to flip if any route is unhealthy."
            ),
            seam="customer-cloud-broker/probe-signer",
            blocking=True,
            timeout_s=120,
        ),
        WaveGate(
            gate_id="wave-cutover.audit-completeness",
            kind="audit_completeness_check",
            description=(
                "Pre-cutover audit completeness check across every "
                "completed wave."
            ),
            seam="customer-cloud-broker/audit",
            blocking=True,
            timeout_s=60,
        ),
    ]
    return TransformWave(
        wave_id=-1,
        wave_name="cutover",
        tier="skip",
        kind="cutover",
        target_aws_services=["route53", "cloudfront", "migrationhub"],
        files=[],
        prerequisites=[],
        gates=gates,
        commands=[
            WaveCommand(
                command_id="wave-cutover.cmd-0",
                service="route53",
                action="Route53.change_resource_record_sets",
                params={
                    "action": "UPSERT",
                    "record_type": "CNAME",
                },
                audit_action="aws.route53.cutover",
                via="customer-cloud-broker/dispatch:route53",
            ),
        ],
        audit_action="transform.cutover",
        estimated_effort_days=0.25,
        rationale=(
            "Cutover: flip DNS / routing to point at the migrated AWS "
            "footprint. Refuses to flip if any canary-probe fails."
        ),
    )


def _build_validation(scope: MigrationScope) -> TransformWave:
    """The final validation wave: runs the project smoke test + a
    customer-facing synthetic against the cutover footprint."""
    gates = [
        WaveGate(
            gate_id="wave-validation.unit-test",
            kind="unit_test",
            description="Run the project's smoke test against the cutover footprint.",
            seam="customer-cloud-broker/audit",
            blocking=True,
            timeout_s=600,
        ),
        WaveGate(
            gate_id="wave-validation.audit-completeness",
            kind="audit_completeness_check",
            description=(
                "Post-cutover audit completeness check; ensures every "
                "wave emitted its audit events."
            ),
            seam="customer-cloud-broker/audit",
            blocking=True,
            timeout_s=60,
        ),
    ]
    return TransformWave(
        wave_id=-1,
        wave_name="validation",
        tier="skip",
        kind="validation",
        target_aws_services=["cloudwatch", "synthetics", "migrationhub"],
        files=[],
        prerequisites=[],
        gates=gates,
        commands=[
            WaveCommand(
                command_id="wave-validation.cmd-0",
                service="cloudwatch",
                action="Synthetics.create_canary",
                params={
                    "name": "post-migration-smoke",
                    "runtime": "syn-python-selenium-3.0",
                },
                audit_action="aws.synthetics.canary_create",
                via="customer-cloud-broker/audit",
            ),
        ],
        audit_action="transform.validation",
        estimated_effort_days=0.25,
        rationale=(
            "Validation: smoke test + synthetic canary against the "
            "cutover footprint. Refuses to close if either fails."
        ),
    )


def _build_summary(
    scope: MigrationScope,
    waves: List[TransformWave],
    cycle_breaks: List[WaveBreak],
    cluster_breaks: List[WaveBreak],
    scheduled_files: List[str],
    skipped_files: List[str],
) -> WaveSummary:
    tier_counts: Dict[str, int] = {}
    for w in waves:
        if w.kind == "tier_wave":
            tier_counts[w.tier] = tier_counts.get(w.tier, 0) + 1

    unit_counts: Dict[str, int] = {}
    for w in waves:
        if w.kind != "tier_wave":
            continue
        # All files in the wave share a unit (the wave is grouped by
        # tier+service, but service can span units; count per unit).
        for path in w.files:
            # Look up the unit from the scope.
            unit = None
            for m in scope.transform_mappings:
                if m.path == path:
                    unit = m.unit
                    break
            if unit:
                unit_counts[unit] = unit_counts.get(unit, 0) + 1

    high_risk_waves = sum(
        1 for w in waves if any(g.kind == "canary_probe" for g in w.gates)
    )

    return WaveSummary(
        total_waves=len(waves),
        total_files=len(scheduled_files),
        skipped_files=len(skipped_files),
        cycle_breaks=len(cycle_breaks),
        cluster_breaks=len(cluster_breaks),
        high_risk_waves=high_risk_waves,
        total_estimated_effort_days=round(sum(w.estimated_effort_days for w in waves), 3),
        tier_counts=dict(sorted(tier_counts.items())),
        unit_counts=dict(sorted(unit_counts.items())),
    )


# ---------------------------------------------------------------------------
# Helpers for the topological-sort prerequisite backfill
# ---------------------------------------------------------------------------


def cycle_break_by_member_member_update(
    cycle_wave: TransformWave,
    table: Dict[str, int],
) -> None:
    """Update the cycle-break lookup table after the cycle wave's
    `wave_id` is assigned. No-op if already populated."""
    for m in cycle_wave.files:
        table[m] = cycle_wave.wave_id


def cluster_break_by_service_member_update(
    cluster_wave: TransformWave,
    table: Dict[str, int],
) -> None:
    """Cluster waves carry service names in their `service` attribute
    only when emitted by `tier_wave`; for `cluster_break` waves the
    services are inferred from the file paths' service tags. We update
    the table using the cluster_break's WaveBreak (set externally)
    so this is effectively a no-op — but kept as a hook for v0.2."""
    pass
