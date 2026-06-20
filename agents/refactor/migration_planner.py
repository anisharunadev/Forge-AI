"""
Migration planner — public entry point for the migration-planner agent
(FORA-85, sub-goal 8.4).

`build_migration_plan(plan, graph) -> MigrationPlan` is the canonical
call. It is pure: no I/O, no LLM, no HTTP, no subprocess. The smoke
test asserts a < 10 s runtime and a $0 cost.

The output `MigrationPlan` is the deliverable that the downstream
Jira sync adapter consumes:

  - one Jira epic per WavePlan (the "Refactor" / "Modernization" epic);
  - one Jira story per TransformWave, ordered by `wave_id`;
  - one Jira story per WaveBreak (cycle or cluster), referencing the
    break's wave so the SDLC pipeline picks the break up before any
    wave that depends on it;
  - one `JiraMutation` per planned write, tagged with a stable
    `idempotency_key` so the Jira MCP can dedupe re-runs.

`build_migration_plan` validates the inputs, derives an idempotency
key per story, builds the ordered mutation list, computes a
`MigrationSummary`, and assembles the `MigrationPlan`.

Hard rule: the migration planner plans. It does not call Jira. Every
mutation is a description; the Jira adapter (v0.2) routes the list
through `mcp-servers/jira/`. v0.1 emits; v0.2 dispatches.
"""

from __future__ import annotations

import hashlib
import json as _json
import time
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .schemas import (
    DependencyGraph,
    JiraEpic,
    JiraMutation,
    JiraStory,
    MIGRATION_PRIORITIES,
    MIGRATION_STORY_KINDS,
    MigrationPlan,
    MigrationPlanSummary,
    STORY_KIND_RANK,
    TransformWave,
    WaveBreak,
    WaveCommand,
    WavePlan,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


PLANNER_VERSION = "migration-planner/0.1.0"
MIGRATION_PLAN_SCHEMA_VERSION = 1


# Wave-kind -> priority band. Cycle/cluster breaks are "highest" because
# they gate downstream waves; high-risk tier waves are "high" (canary
# probe gated); standard tier waves are "medium"; cutover + validation
# are "low" because they execute on already-prepared infra.
WAVE_KIND_PRIORITY: Dict[str, str] = {
    "preflight":    "medium",
    "cycle_break":  "highest",
    "cluster_break":"highest",
    "tier_wave":    "high",   # downgraded to "medium" for low-risk waves below
    "cutover":      "low",
    "validation":   "low",
}

# Per-day story body boilerplate. The Jira adapter injects this into
# the ADF body; keeping it here means the planner is the single source
# of truth for "what an acceptance criterion looks like."
STORY_ACCEPTANCE_DEFAULT: List[str] = [
    "Build compiles (no new warnings introduced).",
    "Smoke tests pass (no regression in adjacent modules).",
    "Lint is clean (no new rule violations).",
    "Audit log entry recorded for the wave's `audit_action`.",
]


def build_migration_plan(
    plan: WavePlan,
    graph: Optional[DependencyGraph] = None,
) -> MigrationPlan:
    """Build a `MigrationPlan` from a `WavePlan` (8.3 output) and an
    optional `DependencyGraph` (8.2 output). Pure function.

    The graph is used only to enrich story links (cycles / clusters)
    and to count break-blocked stories in the summary.
    """
    t0 = time.perf_counter()
    _validate_inputs(plan, graph)

    plan_sha = _compute_plan_sha(plan)
    source_sha = _compute_source_sha(plan)
    report_id = f"mig-{uuid.uuid4().hex[:12]}"

    # 1. Build the epic.
    epic = _build_epic(plan, plan_sha)

    # 2. Build break stories (cycle + cluster).
    break_stories = _build_break_stories(plan, plan_sha, epic.story_id)

    # 3. Build wave stories (one per TransformWave).
    wave_stories = _build_wave_stories(plan, plan_sha, epic.story_id)

    # 4. Order stories: epic first, then by (kind_rank, source_wave_id, story_id).
    all_stories: List[JiraStory] = [JiraStory(
        story_id=epic.story_id,
        kind="epic",
        title=epic.title,
        body=epic.body,
        epic_ref=epic.story_id,
        idempotency_key=epic.idempotency_key,
        priority="highest",
        effort_days=0.0,
        target_sprint=epic.target_sprint,
        links=epic.links,
    )]
    all_stories.extend(break_stories)
    all_stories.extend(wave_stories)
    all_stories.sort(key=_story_sort_key)

    # 5. Build the mutation list (one per story; depends_on chain is
    #    epic -> break (if any gates a wave) -> wave).
    mutations = _build_mutations(all_stories)

    # 6. Compute summary.
    summary = _build_summary(all_stories, plan)

    runtime_ms = round((time.perf_counter() - t0) * 1000.0, 3)

    return MigrationPlan(
        schema_version=MIGRATION_PLAN_SCHEMA_VERSION,
        report_id=report_id,
        generated_at=_utcnow_iso(),
        source=plan.source,
        planner_version=PLANNER_VERSION,
        wave_plan_id=plan.report_id,
        repo_fingerprint=plan.repo_fingerprint,
        plan_sha=plan_sha,
        source_sha=source_sha,
        deterministic=True,
        planner_runtime_ms=runtime_ms,
        cost_usd=0.0,
        epic=epic,
        stories=all_stories,
        mutations=mutations,
        summary=summary,
        notes=_build_notes(plan, plan_sha),
    )


def render_migration_plan(migration: MigrationPlan) -> str:
    """Render the migration plan as Markdown. Pure function of the input.

    Used by the CTO to review the plan before board approval, and by
    the Jira adapter to extract human-readable bodies. Mirrors the
    `render_wave_plan` pattern from 8.3.
    """
    lines: List[str] = []
    lines.append(f"# Migration plan `{migration.report_id}`")
    lines.append("")
    lines.append(f"- **Schema version:** `{migration.schema_version}`")
    lines.append(f"- **Planner version:** `{migration.planner_version}`")
    lines.append(f"- **Wave plan id:** `{migration.wave_plan_id}`")
    lines.append(f"- **Repo fingerprint:** `{migration.repo_fingerprint}`")
    lines.append(f"- **Plan SHA:** `{migration.plan_sha[:16]}…`")
    lines.append(f"- **Source SHA:** `{migration.source_sha[:16]}…`")
    lines.append(f"- **Stories:** {migration.summary.total_stories} "
                 f"(waves={migration.summary.wave_stories}, "
                 f"cycle_breaks={migration.summary.cycle_break_stories}, "
                 f"cluster_breaks={migration.summary.cluster_break_stories})")
    lines.append(f"- **Total effort:** {migration.summary.total_effort_days:.1f} d")
    lines.append(f"- **Deterministic:** `{migration.deterministic}`")
    lines.append(f"- **Cost (USD):** `{migration.cost_usd:.2f}`")
    lines.append("")
    lines.append("## Epic")
    lines.append("")
    lines.append(f"### {migration.epic.title}")
    lines.append("")
    lines.append(_indent(migration.epic.body, ""))
    lines.append("")
    lines.append("## Stories (in execution order)")
    lines.append("")
    for i, story in enumerate(migration.stories, start=1):
        lines.append(f"### {i}. {story.title}")
        lines.append("")
        lines.append(f"- **Kind:** `{story.kind}`  |  **Priority:** `{story.priority}`  |  "
                     f"**Effort:** {story.effort_days:.1f} d  |  "
                     f"**Sprint:** {story.target_sprint or 'unassigned'}")
        lines.append(f"- **Idempotency key:** `{story.idempotency_key}`")
        if story.source_wave_id is not None:
            lines.append(f"- **Source wave:** `{story.source_wave_id}`")
        if story.source_break_id:
            lines.append(f"- **Source break:** `{story.source_break_id}`")
        if story.links:
            links_md = ", ".join(f"`{k}` -> {v}" for k, v in sorted(story.links.items()))
            lines.append(f"- **Links:** {links_md}")
        if story.acceptance_criteria:
            lines.append("- **Acceptance criteria:**")
            for ac in story.acceptance_criteria:
                lines.append(f"  - {ac}")
        lines.append("")
        lines.append(_indent(story.body, ""))
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _validate_inputs(plan: WavePlan, graph: Optional[DependencyGraph]) -> None:
    if not isinstance(plan, WavePlan):
        raise TypeError(f"plan must be a WavePlan, got {type(plan).__name__}")
    if not plan.waves:
        raise ValueError("plan.waves is empty; cannot build a migration plan")
    if graph is not None and not isinstance(graph, DependencyGraph):
        raise TypeError(f"graph must be a DependencyGraph or None, got {type(graph).__name__}")


def _compute_plan_sha(plan: WavePlan) -> str:
    """Stable hash of the plan content (the input fingerprint that
    drives idempotency). Modulo `report_id` and `generated_at`.
    """
    payload = {
        "wave_plan_id": plan.report_id,
        "repo_fingerprint": plan.repo_fingerprint,
        "source": plan.source,
        "planner_version": plan.planner_version,
        "waves": [w.to_dict() for w in plan.waves],
        "cycle_breaks": [b.to_dict() for b in plan.cycle_breaks],
        "cluster_breaks": [b.to_dict() for b in plan.cluster_breaks],
    }
    canonical = _json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _compute_source_sha(plan: WavePlan) -> str:
    """Stable hash of the plan's identity (used to detect drift
    between the input artefact and the emitted plan)."""
    canonical = _json.dumps(
        {"report_id": plan.report_id, "repo_fingerprint": plan.repo_fingerprint},
        sort_keys=True, separators=(",", ":"),
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _build_epic(plan: WavePlan, plan_sha: str) -> JiraEpic:
    title = _epic_title(plan)
    body = _epic_body(plan)
    return JiraEpic(
        story_id="story-0",
        title=title,
        body=body,
        idempotency_key=_epic_idempotency_key(plan_sha),
        target_sprint="",
        links={
            "aws_transform_plan": f"forge/8.3/wave-plan.json#{plan.report_id}",
            "dependency_graph": f"forge/8.2/dep-graph.json#{plan.report_id}",
        },
    )


def _epic_title(plan: WavePlan) -> str:
    repo = plan.repo_fingerprint.split(":")[-1] if ":" in plan.repo_fingerprint else plan.repo_fingerprint
    return f"[Refactor] Modernize `{repo}` ({plan.summary.total_waves} waves, {plan.summary.total_files} files)"


def _epic_body(plan: WavePlan) -> str:
    s = plan.summary
    return (
        f"## Why\n"
        f"\n"
        f"Modernize `{plan.repo_fingerprint}` via the AWS Transform plan\n"
        f"emitted by [8.3](#) (wave plan `{plan.report_id}`).\n"
        f"\n"
        f"## Scope\n"
        f"\n"
        f"- **Waves:** {s.total_waves} (preflight + cutover + validation included)\n"
        f"- **Files in scope:** {s.total_files} (skip-tier files excluded)\n"
        f"- **Cycle breaks:** {s.cycle_breaks}\n"
        f"- **Cluster breaks:** {s.cluster_breaks}\n"
        f"- **High-risk waves:** {s.high_risk_waves}\n"
        f"- **Total estimated effort:** {s.total_estimated_effort_days:.1f} d\n"
        f"\n"
        f"## How\n"
        f"\n"
        f"This epic is generated by the FORA migration planner (8.4) from the\n"
        f"`wave-plan.json` artefact emitted by 8.3. Each child story is\n"
        f"deterministically derived from a single TransformWave or WaveBreak\n"
        f"and carries a stable `idempotency_key` so re-runs do not create\n"
        f"duplicates.\n"
        f"\n"
        f"## Board gate\n"
        f"\n"
        f"The first child story is the preflight wave; downstream Dev work\n"
        f"(Epic 3) is gated on the `request_confirmation` the migration\n"
        f"planner opens on FORA-85 after this epic lands in the sprint.\n"
    )


def _epic_idempotency_key(plan_sha: str) -> str:
    return f"fora:8.4:epic:{plan_sha[:32]}"


def _story_idempotency_key(plan_sha: str, kind: str, ref: str) -> str:
    return f"fora:8.4:{kind}:{plan_sha[:24]}:{ref}"


def _build_break_stories(
    plan: WavePlan, plan_sha: str, epic_story_id: str,
) -> List[JiraStory]:
    stories: List[JiraStory] = []
    for b in plan.cycle_breaks:
        stories.append(_break_to_story(b, plan_sha, epic_story_id, "cycle_break"))
    for b in plan.cluster_breaks:
        stories.append(_break_to_story(b, plan_sha, epic_story_id, "cluster_break"))
    return stories


def _break_to_story(
    b: WaveBreak, plan_sha: str, epic_story_id: str, kind: str,
) -> JiraStory:
    ordinal = f"{kind}-{b.break_id}"
    story_id = f"story-{ordinal}"
    title = _break_title(b, kind)
    body = _break_body(b, kind)
    return JiraStory(
        story_id=story_id,
        kind=kind,
        title=title,
        body=body,
        epic_ref=epic_story_id,
        idempotency_key=_story_idempotency_key(plan_sha, kind, b.break_id),
        priority="highest",
        effort_days=_break_effort(b, kind),
        source_break_id=b.break_id,
        source_wave_id=b.wave_id,
        target_sprint="",
        acceptance_criteria=list(STORY_ACCEPTANCE_DEFAULT) + [
            f"Remove the cycle/cluster so wave `{b.wave_id}` is unblocked.",
        ],
        links={
            "wave_plan": f"forge/8.3/wave-plan.json#{b.break_id}",
        },
    )


def _break_title(b: WaveBreak, kind: str) -> str:
    if kind == "cycle_break":
        return f"Break cycle `{b.break_id}` ({len(b.members)} files) — gates wave {b.wave_id}"
    return f"Break cluster `{b.break_id}` ({len(b.members)} services) — gates wave {b.wave_id}"


def _break_body(b: WaveBreak, kind: str) -> str:
    member_list = "\n".join(f"- `{m}`" for m in b.members)
    return (
        f"## Why\n"
        f"\n"
        f"{b.rationale}\n"
        f"\n"
        f"## Members\n"
        f"\n"
        f"{member_list}\n"
        f"\n"
        f"## Gates\n"
        f"\n"
        f"This break must land before wave `{b.wave_id}` runs. The migration\n"
        f"planner ordered it that way; the SDLC pipeline will pick the\n"
        f"prerequisite up automatically.\n"
    )


def _break_effort(b: WaveBreak, kind: str) -> float:
    # Trivial heuristic: 0.5 d per member, capped at 5.0 d per break.
    return float(min(5.0, 0.5 * max(1, len(b.members))))


def _build_wave_stories(
    plan: WavePlan, plan_sha: str, epic_story_id: str,
) -> List[JiraStory]:
    stories: List[JiraStory] = []
    for w in plan.waves:
        stories.append(_wave_to_story(w, plan, plan_sha, epic_story_id))
    return stories


def _wave_to_story(
    w: TransformWave, plan: WavePlan, plan_sha: str, epic_story_id: str,
) -> JiraStory:
    story_id = f"story-wave-{w.wave_id}"
    title = _wave_title(w)
    body = _wave_body(w, plan)
    priority = _wave_priority(w, plan)
    return JiraStory(
        story_id=story_id,
        kind="wave",
        title=title,
        body=body,
        epic_ref=epic_story_id,
        idempotency_key=_story_idempotency_key(plan_sha, "wave", f"w{w.wave_id}"),
        priority=priority,
        effort_days=w.estimated_effort_days,
        source_wave_id=w.wave_id,
        source_module=w.service,
        target_sprint="",
        acceptance_criteria=_wave_acceptance(w),
        links={
            "wave_plan": f"forge/8.3/wave-plan.json#wave-{w.wave_id}",
        },
    )


def _wave_title(w: TransformWave) -> str:
    if w.kind == "tier_wave":
        return f"Wave {w.wave_id} — {w.tier} `{w.service or 'shared'}` ({w.wave_name})"
    return f"Wave {w.wave_id} — `{w.kind}` ({w.wave_name})"


def _wave_priority(w: TransformWave, plan: WavePlan) -> str:
    base = WAVE_KIND_PRIORITY.get(w.kind, "medium")
    # A canary_probe gate is the canonical "high-risk" signal — any
    # wave carrying it (regardless of `kind`) must surface as `high`
    # so the board can prioritize it.
    if _is_high_risk(w, plan):
        return "high"
    if w.kind == "tier_wave":
        return "medium"
    return base


def _is_high_risk(w: TransformWave, plan: WavePlan) -> bool:
    return any(g.kind == "canary_probe" for g in w.gates)


def _wave_body(w: TransformWave, plan: WavePlan) -> str:
    prereq_md = (
        "\n".join(f"- wave `{pid}`" for pid in w.prerequisites)
        if w.prerequisites else "_none_"
    )
    services_md = (
        "\n".join(f"- `{s}`" for s in w.target_aws_services)
        if w.target_aws_services else "_none_"
    )
    files_md = (
        "\n".join(f"- `{f}`" for f in w.files[:20])
        if w.files else "_none — infra-only wave_"
    )
    if len(w.files) > 20:
        files_md += f"\n- …and {len(w.files) - 20} more"
    gates_md = (
        "\n".join(f"- `{g.kind}` ({g.description}, blocking={g.blocking})"
                  for g in w.gates)
        if w.gates else "_none_"
    )
    commands_md = (
        "\n".join(f"- `{c.service}.{c.action}` via `{c.via}` (audit: `{c.audit_action}`)"
                  for c in w.commands)
        if w.commands else "_none — validation-only wave_"
    )
    return (
        f"## Why\n"
        f"\n"
        f"{w.rationale or 'See wave plan rationale.'}\n"
        f"\n"
        f"## Prerequisites\n"
        f"\n"
        f"{prereq_md}\n"
        f"\n"
        f"## AWS services touched\n"
        f"\n"
        f"{services_md}\n"
        f"\n"
        f"## Files in scope ({len(w.files)})\n"
        f"\n"
        f"{files_md}\n"
        f"\n"
        f"## Gates\n"
        f"\n"
        f"{gates_md}\n"
        f"\n"
        f"## Commands (seam-routed, not executed by this story)\n"
        f"\n"
        f"{commands_md}\n"
        f"\n"
        f"## Effort\n"
        f"\n"
        f"`{w.estimated_effort_days:.1f}` d\n"
    )


def _wave_acceptance(w: TransformWave) -> List[str]:
    acs = list(STORY_ACCEPTANCE_DEFAULT)
    for g in w.gates:
        if g.kind == "canary_probe":
            acs.append("Canary probe green (FORA-194).")
        if g.kind == "secret_rotate_check":
            acs.append("Secret rotation check green (FORA-128).")
        if g.kind == "audit_completeness_check":
            acs.append("Audit log has the `transform.*` events for this wave.")
    return acs


def _story_sort_key(s: JiraStory) -> Tuple[int, int, str]:
    kind_rank = STORY_KIND_RANK.get(s.kind, 99)
    wave_id = s.source_wave_id if s.source_wave_id is not None else 1_000_000
    return (kind_rank, wave_id, s.story_id)


def _build_mutations(stories: List[JiraStory]) -> List[JiraMutation]:
    """Emit one mutation per story. The dependency chain is:
    epic -> cycle_breaks -> cluster_breaks -> waves (by wave_id)."""
    mutations: List[JiraMutation] = []
    last_mutation_per_kind: Dict[str, str] = {}
    for s in stories:
        depends_on: List[str] = []
        if s.kind == "epic":
            pass  # epic has no prereqs
        elif s.kind in ("cycle_break", "cluster_break"):
            # Breaks depend on the epic.
            epic_mut = last_mutation_per_kind.get("epic")
            if epic_mut:
                depends_on.append(epic_mut)
        else:  # wave
            # Waves depend on the epic + all breaks (cycle/cluster) whose
            # wave_id is <= this wave's wave_id. v0.1 simplification:
            # depend on epic + last break; the Jira adapter topologically
            # sorts the rest.
            for kind in ("epic", "cycle_break", "cluster_break"):
                prev = last_mutation_per_kind.get(kind)
                if prev:
                    depends_on.append(prev)
        if s.kind == "epic":
            kind = "create_epic"
        else:
            kind = "create_story"
        mutation = JiraMutation(
            mutation_id=f"mut-{s.story_id}",
            kind=kind,
            payload={
                "external_ref": s.idempotency_key,
                "title": s.title,
                "body": s.body,
                "epic_ref": s.epic_ref,
                "priority": s.priority,
                "effort_days": s.effort_days,
                "kind": s.kind,
                "source_wave_id": s.source_wave_id,
                "source_break_id": s.source_break_id,
                "source_module": s.source_module,
                "acceptance_criteria": s.acceptance_criteria,
                "links": s.links,
            },
            idempotency_key=s.idempotency_key,
            depends_on=depends_on,
        )
        mutations.append(mutation)
        last_mutation_per_kind[s.kind] = mutation.mutation_id
    return mutations


def _build_summary(stories: List[JiraStory], plan: WavePlan) -> MigrationSummary:
    wave_stories = [s for s in stories if s.kind == "wave"]
    cycle_break_stories = [s for s in stories if s.kind == "cycle_break"]
    cluster_break_stories = [s for s in stories if s.kind == "cluster_break"]

    cycle_break_wave_ids = {b.wave_id for b in plan.cycle_breaks}
    cluster_break_wave_ids = {b.wave_id for b in plan.cluster_breaks}
    waves_in_plan = {w.wave_id for w in plan.waves}
    cycle_breaks_blocked = sum(
        1 for wid in cycle_break_wave_ids
        if any(p == wid for w in plan.waves for p in w.prerequisites)
    )
    cluster_breaks_blocked = sum(
        1 for wid in cluster_break_wave_ids
        if any(p == wid for w in plan.waves for p in w.prerequisites)
    )

    priority_counts: Dict[str, int] = {p: 0 for p in MIGRATION_PRIORITIES}
    for s in stories:
        if s.priority in priority_counts:
            priority_counts[s.priority] += 1
    # `epic` priority is "highest" but not in MIGRATION_PRIORITIES; count it under "highest".
    if any(s.kind == "epic" for s in stories):
        priority_counts["highest"] = sum(1 for s in stories if s.priority == "highest")

    total_effort = sum(s.effort_days for s in stories)

    return MigrationPlanSummary(
        total_stories=len(stories),
        wave_stories=len(wave_stories),
        cycle_break_stories=len(cycle_break_stories),
        cluster_break_stories=len(cluster_break_stories),
        total_effort_days=round(total_effort, 2),
        priority_counts=priority_counts,
        cycle_breaks_blocked=cycle_breaks_blocked,
        cluster_breaks_blocked=cluster_breaks_blocked,
    )


def _build_notes(plan: WavePlan, plan_sha: str) -> List[str]:
    notes = [
        f"plan_sha={plan_sha[:16]}…",
        f"waves={len(plan.waves)}, cycle_breaks={len(plan.cycle_breaks)}, "
        f"cluster_breaks={len(plan.cluster_breaks)}",
        "Idempotency: re-runs on the same plan_sha yield identical "
        "idempotency_keys; the Jira adapter dedupes via external_ref.",
        "Board gate: open a request_confirmation on FORA-85 after the "
        "Jira adapter confirms the epic + stories landed in the sprint.",
    ]
    return notes


def _utcnow_iso() -> str:
    import datetime as dt
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _indent(text: str, prefix: str) -> str:
    if not text:
        return ""
    return "\n".join((prefix + line) if line else line for line in text.splitlines())
