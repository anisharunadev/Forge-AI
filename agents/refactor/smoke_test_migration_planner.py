#!/usr/bin/env python3
"""
Smoke test for the migration planner (FORA-85, sub-goal 8.4).

Acceptance contract (24 ACs):

    1.  Consumes a `WavePlan` (8.3 output) and an optional `DependencyGraph` (8.2).
    2.  Emits a `MigrationPlan` with 1 epic + >= 1 wave stories + break stories.
    3.  Deterministic: two runs on the same WavePlan produce byte-identical
        `plan_sha` and identical idempotency_keys (modulo `report_id` +
        `generated_at` + `planner_runtime_ms`).
    4.  The first story in `stories[]` is always the epic.
    5.  Cycle/cluster break stories carry `source_break_id` and `source_wave_id`.
    6.  Cycle/cluster break stories are emitted BEFORE the waves they gate
        (lower `story_id` ordinal in the sort order).
    7.  Wave stories carry `source_wave_id` matching the source `TransformWave.wave_id`.
    8.  High-risk waves (carrying a `canary_probe` gate) get `priority="high"`.
    9.  Standard tier waves (no canary_probe) get `priority="medium"`.
    10. Cutover + validation waves get `priority="low"`.
    11. Every story has a non-empty `idempotency_key` and a non-empty `body`.
    12. Every `JiraMutation` has `idempotency_key` matching its story.
    13. The mutation list is JSON-serialisable (round-trip equal).
    14. Cost bound: < 10 s and $0 per run.
    15. Output is written to forge/8.4/migration-plan.json + migration-plan.md + evidence.
    16. Idempotency: re-running on the same WavePlan yields identical
        idempotency_keys for every story (no duplicates, no drift).
    17. The epic's `idempotency_key` is unique across plans (different
        `plan_sha` → different epic key).
    18. The mutation list's `depends_on` chain is consistent (no
        forward references; epic is referenced by all non-epic stories).
    19. Cycle breaks with non-empty `members` get a non-zero `effort_days`.
    20. Wave stories' `effort_days` equal the source wave's `estimated_effort_days`.
    21. The summary's `total_stories` equals `len(stories)`.
    22. The summary's `priority_counts` sum equals `total_stories` (epic included).
    23. No mutation references `boto3`, `subprocess`, `urllib`, `requests`,
        or any HTTP layer (the planner plans; the adapter dispatches).
    24. `render_migration_plan(migration)` produces a non-empty Markdown
        string that contains the epic title and every story title.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.refactor import (  # noqa: E402
    MIGRATION_PLAN_SCHEMA_VERSION,
    MIGRATION_PLANNER_VERSION,
    MIGRATION_STORY_KINDS,
    DependencyGraph,
    JiraEpic,
    JiraMutation,
    JiraStory,
    MigrationPlan,
    MigrationPlanSummary,
    MigrationScope,
    MigrationSummary,
    TransformWave,
    WaveBreak,
    WaveCommand,
    WaveGate,
    WavePlan,
    WaveSummary,
    analyze_scope,
    build_graph,
    build_migration_plan,
    plan_waves,
    render_migration_plan,
    render_wave_plan,
    sample_legacy_monolith,
)


# ---------------------------------------------------------------------------
# Output paths
# ---------------------------------------------------------------------------

OUT_DIR = os.path.abspath(os.path.join(ROOT, "forge", "8.4"))
PLAN_JSON_PATH = os.path.join(OUT_DIR, "migration-plan.json")
PLAN_MD_PATH = os.path.join(OUT_DIR, "migration-plan.md")
EVIDENCE_DIR = os.path.abspath(
    os.path.join(ROOT, "agents", "refactor", "evidence",
                 f"smoke_migration_planner_{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}")
)


# ---------------------------------------------------------------------------
# Acceptance check helpers
# ---------------------------------------------------------------------------


class ACResult:
    def __init__(self, ac_id: str, note: str, ok: bool):
        self.ac_id = ac_id
        self.note = note
        self.ok = ok

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.ac_id, "note": self.note, "ok": self.ok}


def _check(ac_id: str, condition: bool, note: str) -> ACResult:
    return ACResult(ac_id, note, bool(condition))


def _seed_inputs() -> Tuple[WavePlan, DependencyGraph]:
    """Build the canonical inputs: a fresh MigrationScope (8.1), a
    fresh DependencyGraph (8.2), and a fresh WavePlan (8.3) from the
    legacy-monolith fixture. Identical to the wave-planner smoke seed
    so the artefact diffs are minimal.
    """
    scope = analyze_scope(sample_legacy_monolith())
    graph = build_graph(scope)
    plan = plan_waves(scope, graph)
    return plan, graph


# ---------------------------------------------------------------------------
# Acceptance checks
# ---------------------------------------------------------------------------


def run_acceptance_checks(plan: WavePlan, graph: DependencyGraph, migration: MigrationPlan) -> List[ACResult]:
    results: List[ACResult] = []

    # 1. Inputs are typed.
    results.append(_check(
        "1",
        isinstance(plan, WavePlan) and isinstance(graph, DependencyGraph) and isinstance(migration, MigrationPlan),
        "plan + graph + migration are typed WavePlan + DependencyGraph + MigrationPlan",
    ))

    # 2. Migration plan shape: 1 epic + >=1 wave stories + break stories.
    stories = migration.stories
    n_epic = sum(1 for s in stories if s.kind == "epic")
    n_wave = sum(1 for s in stories if s.kind == "wave")
    n_cycle = sum(1 for s in stories if s.kind == "cycle_break")
    n_cluster = sum(1 for s in stories if s.kind == "cluster_break")
    results.append(_check(
        "2",
        n_epic == 1 and n_wave >= 1 and (n_cycle + n_cluster) == (len(plan.cycle_breaks) + len(plan.cluster_breaks)),
        f"epic=1, waves={n_wave}, cycle_breaks={n_cycle}, cluster_breaks={n_cluster}",
    ))

    # 3. Determinism: re-run yields identical plan_sha + identical idempotency_keys.
    t0 = time.perf_counter()
    again = build_migration_plan(plan, graph)
    t1 = time.perf_counter()
    keys_first = [s.idempotency_key for s in migration.stories]
    keys_again = [s.idempotency_key for s in again.stories]
    results.append(_check(
        "3",
        migration.plan_sha == again.plan_sha and keys_first == keys_again,
        f"plan_sha stable; idempotency_keys identical across re-runs ({(t1-t0)*1000:.1f} ms)",
    ))

    # 4. First story is the epic.
    results.append(_check(
        "4",
        stories[0].kind == "epic",
        f"first story kind = {stories[0].kind}",
    ))

    # 5. Break stories carry source_break_id + source_wave_id.
    breaks = [s for s in stories if s.kind in ("cycle_break", "cluster_break")]
    results.append(_check(
        "5",
        all(s.source_break_id and s.source_wave_id is not None for s in breaks),
        f"{len(breaks)} break stories, all carry source_break_id + source_wave_id",
    ))

    # 6. Breaks are emitted before the waves they gate.
    break_wave_ids = {s.source_wave_id for s in breaks}
    if break_wave_ids:
        max_break_ordinal = max(stories.index(s) for s in breaks)
        min_blocked_wave_ordinal = min(
            (stories.index(s) for s in stories
             if s.kind == "wave" and s.source_wave_id in break_wave_ids),
            default=len(stories),
        )
        results.append(_check(
            "6",
            max_break_ordinal < min_blocked_wave_ordinal,
            f"all {len(breaks)} breaks emitted before their gated waves",
        ))
    else:
        results.append(_check(
            "6",
            True,
            "no breaks in canonical fixture (trivially satisfied)",
        ))

    # 7. Wave stories carry source_wave_id matching the source wave.
    wave_stories = [s for s in stories if s.kind == "wave"]
    plan_wave_ids = {w.wave_id for w in plan.waves}
    results.append(_check(
        "7",
        all(s.source_wave_id in plan_wave_ids for s in wave_stories),
        f"{len(wave_stories)} wave stories, all source_wave_id match plan.waves",
    ))

    # 8. High-risk waves → priority=high.
    high_risk_wave_ids = {
        w.wave_id for w in plan.waves
        if any(g.kind == "canary_probe" for g in w.gates)
    }
    high_stories = [s for s in wave_stories if s.source_wave_id in high_risk_wave_ids]
    results.append(_check(
        "8",
        all(s.priority == "high" for s in high_stories),
        f"{len(high_stories)} high-risk wave stories, all priority=high",
    ))

    # 9. Non-high-risk tier_wave stories → priority=medium.
    non_high_tier = [
        s for s in wave_stories
        if s.source_wave_id in {w.wave_id for w in plan.waves if w.kind == "tier_wave"}
        and s.source_wave_id not in high_risk_wave_ids
    ]
    results.append(_check(
        "9",
        all(s.priority == "medium" for s in non_high_tier),
        f"{len(non_high_tier)} non-high-risk tier_wave stories, all priority=medium",
    ))

    # 10. Cutover + validation waves → priority=low (when NOT high-risk).
    #     A cutover that carries canary_probe (genuine high-risk cutover)
    #     is correctly bumped to "high"; the contract here is only that
    #     non-high-risk cutover/validation stay at the default "low".
    cv_ids = {w.wave_id for w in plan.waves if w.kind in ("cutover", "validation")}
    cv_stories = [s for s in wave_stories
                  if s.source_wave_id in cv_ids
                  and s.source_wave_id not in high_risk_wave_ids]
    results.append(_check(
        "10",
        all(s.priority == "low" for s in cv_stories),
        f"{len(cv_stories)} non-high-risk cutover/validation wave stories, all priority=low",
    ))

    # 11. Every story has non-empty idempotency_key + body.
    results.append(_check(
        "11",
        all(s.idempotency_key and s.body for s in stories),
        f"{len(stories)} stories, all carry non-empty idempotency_key + body",
    ))

    # 12. Every mutation's idempotency_key matches its story.
    story_keys = {s.idempotency_key for s in stories}
    mut_keys = {m.idempotency_key for m in migration.mutations}
    results.append(_check(
        "12",
        mut_keys <= story_keys and len(mut_keys) == len(migration.mutations),
        f"{len(migration.mutations)} mutations, idempotency_keys ⊆ story_keys (1:1)",
    ))

    # 13. Mutation list round-trips through JSON.
    payload = json.dumps([m.to_dict() for m in migration.mutations], sort_keys=True)
    again_payload = json.dumps(json.loads(payload), sort_keys=True)
    results.append(_check(
        "13",
        payload == again_payload,
        f"{len(migration.mutations)} mutations, JSON round-trip equal ({len(payload)} bytes)",
    ))

    # 14. Cost + runtime bounds.
    results.append(_check(
        "14",
        migration.cost_usd == 0.0 and migration.planner_runtime_ms < 10_000.0,
        f"runtime={migration.planner_runtime_ms} ms, cost=${migration.cost_usd:.2f}",
    ))

    # 15. Output written.
    json_exists = os.path.exists(PLAN_JSON_PATH)
    md_exists = os.path.exists(PLAN_MD_PATH)
    results.append(_check(
        "15",
        json_exists and md_exists,
        f"forge/8.4/migration-plan.json={json_exists}, migration-plan.md={md_exists}",
    ))

    # 16. Idempotency: re-running yields identical idempotency_keys (already
    #     covered in AC #3, but spelled out separately for the contract).
    results.append(_check(
        "16",
        keys_first == keys_again,
        f"re-run on same WavePlan yields identical {len(keys_first)} idempotency_keys",
    ))

    # 17. Different WavePlan SHA → different epic key. Tweak the
    #     underlying scope's summary effort estimate and re-run; the
    #     wave planner consumes the MigrationScope summary, so a delta
    #     there MUST change the plan_sha (and therefore the epic key).
    tweaked = analyze_scope(sample_legacy_monolith())
    object.__setattr__(
        tweaked.summary,
        "estimated_effort_days",
        tweaked.summary.estimated_effort_days + 0.5,
    )
    plan2 = plan_waves(tweaked, build_graph(tweaked))
    migration2 = build_migration_plan(plan2, graph)
    epic1 = migration.stories[0].idempotency_key
    epic2 = migration2.stories[0].idempotency_key
    results.append(_check(
        "17",
        epic1 != epic2,
        f"epic key changes when underlying WavePlan changes ({epic1[:32]}… vs {epic2[:32]}…)",
    ))

    # 18. Mutation depends_on chain is consistent (epic is the only
    #     story with no depends_on, except possibly orphan breaks).
    mut_by_id = {m.mutation_id: m for m in migration.mutations}
    epic_mut = next(
        (m for m in migration.mutations if m.idempotency_key == migration.stories[0].idempotency_key),
        None,
    )
    epic_mid = epic_mut.mutation_id if epic_mut else None
    bad = []
    for m in migration.mutations:
        for dep in m.depends_on:
            if dep not in mut_by_id:
                bad.append(f"{m.mutation_id} -> unknown {dep}")
            elif dep == m.mutation_id:
                bad.append(f"{m.mutation_id} -> self")
    non_epic_without_epic = [
        m for m in migration.mutations
        if m is not epic_mut and epic_mid and epic_mid not in m.depends_on
    ]
    results.append(_check(
        "18",
        not bad and not non_epic_without_epic,
        f"{len(migration.mutations)} mutations, depends_on chain consistent, all reference epic ({bad or 'OK'})",
    ))

    # 19. Cycle breaks with members have non-zero effort_days.
    cb_stories = [s for s in stories if s.kind == "cycle_break"]
    results.append(_check(
        "19",
        all(s.effort_days > 0.0 for s in cb_stories) or not cb_stories,
        f"{len(cb_stories)} cycle_break stories, "
        + (f"all effort > 0 (min={min(s.effort_days for s in cb_stories):.1f})" if cb_stories else "no cycle breaks in fixture"),
    ))

    # 20. Wave stories' effort_days match source wave's estimated_effort_days.
    effort_match = []
    for s in wave_stories:
        w = plan.wave_by_id(s.source_wave_id)
        if w is not None:
            effort_match.append(abs(s.effort_days - w.estimated_effort_days) < 1e-6)
    results.append(_check(
        "20",
        all(effort_match),
        f"{len(effort_match)} wave stories, all effort_days match source wave",
    ))

    # 21. Summary total_stories = len(stories).
    results.append(_check(
        "21",
        migration.summary.total_stories == len(stories),
        f"summary.total_stories={migration.summary.total_stories} == len(stories)={len(stories)}",
    ))

    # 22. Summary priority_counts sum equals total_stories.
    sum_pc = sum(migration.summary.priority_counts.values())
    results.append(_check(
        "22",
        sum_pc == migration.summary.total_stories,
        f"sum(priority_counts)={sum_pc} == total_stories={migration.summary.total_stories}",
    ))

    # 23. No mutation references boto3, subprocess, urllib, requests, or HTTP.
    blob = json.dumps([m.to_dict() for m in migration.mutations])
    forbidden = ["boto3", "subprocess", "urllib", "requests", "http://", "https://"]
    hits = [w for w in forbidden if w in blob]
    results.append(_check(
        "23",
        not hits,
        f"no HTTP / SDK references in mutations ({hits or 'clean'})",
    ))

    # 24. render_migration_plan produces a non-empty Markdown with all titles.
    md = render_migration_plan(migration)
    all_titles = [migration.epic.title] + [s.title for s in stories]
    missing = [t for t in all_titles if t and t not in md]
    results.append(_check(
        "24",
        len(md) > 0 and not missing,
        f"render_migration_plan -> {len(md)} chars, all {len(all_titles)} titles present",
    ))

    return results


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


def _write_artifacts(migration: MigrationPlan) -> Dict[str, str]:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(EVIDENCE_DIR, exist_ok=True)

    plan_json_path = os.path.join(OUT_DIR, "migration-plan.json")
    with open(plan_json_path, "w", encoding="utf-8") as fh:
        json.dump(migration.to_dict(), fh, indent=2, sort_keys=True)
        fh.write("\n")

    plan_md_path = os.path.join(OUT_DIR, "migration-plan.md")
    with open(plan_md_path, "w", encoding="utf-8") as fh:
        fh.write(render_migration_plan(migration))
        fh.write("\n")

    return {"json": plan_json_path, "md": plan_md_path}


def _write_evidence(results: List[ACResult], migration: MigrationPlan) -> str:
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    sha = hashlib.sha256(
        json.dumps(migration.to_dict(), sort_keys=True).encode("utf-8")
    ).hexdigest()
    payload = {
        "smoke": "smoke_test_migration_planner",
        "version": MIGRATION_PLANNER_VERSION,
        "schema_version": MIGRATION_PLAN_SCHEMA_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "migration_plan_id": migration.report_id,
        "plan_sha": migration.plan_sha,
        "source_sha": migration.source_sha,
        "wave_plan_id": migration.wave_plan_id,
        "repo_fingerprint": migration.repo_fingerprint,
        "planner_runtime_ms": migration.planner_runtime_ms,
        "cost_usd": migration.cost_usd,
        "story_count": len(migration.stories),
        "mutation_count": len(migration.mutations),
        "summary": migration.summary.to_dict(),
        "acs": [r.to_dict() for r in results],
        "ok_count": sum(1 for r in results if r.ok),
        "fail_count": sum(1 for r in results if not r.ok),
    }
    evidence_path = os.path.join(EVIDENCE_DIR, "result.json")
    with open(evidence_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
        fh.write("\n")
    return evidence_path


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def main() -> int:
    t_total = time.perf_counter()

    plan, graph = _seed_inputs()
    migration = build_migration_plan(plan, graph)

    # Write the artefacts BEFORE the AC checks so AC #15 can see them.
    paths = _write_artifacts(migration)

    results = run_acceptance_checks(plan, graph, migration)
    evidence_path = _write_evidence(results, migration)

    elapsed_ms = (time.perf_counter() - t_total) * 1000.0
    ok = sum(1 for r in results if r.ok)
    fail = sum(1 for r in results if not r.ok)

    print(f"=== smoke_test_migration_planner ({MIGRATION_PLANNER_VERSION}) ===")
    print(f"plan_id         : {migration.report_id}")
    print(f"plan_sha        : {migration.plan_sha[:24]}…")
    print(f"stories emitted : {len(migration.stories)}")
    print(f"mutations       : {len(migration.mutations)}")
    print(f"runtime (planner): {migration.planner_runtime_ms} ms")
    print(f"runtime (total)  : {elapsed_ms:.1f} ms")
    print(f"cost (USD)       : {migration.cost_usd:.2f}")
    print(f"artifacts        : {paths['json']} | {paths['md']}")
    print(f"evidence         : {evidence_path}")
    print()
    for r in results:
        marker = "PASS" if r.ok else "FAIL"
        print(f"  AC {r.ac_id:>3s}  [{marker}]  {r.note}")
    print()
    print(f"=== {ok}/{ok + fail} acceptance checks passed ===")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
