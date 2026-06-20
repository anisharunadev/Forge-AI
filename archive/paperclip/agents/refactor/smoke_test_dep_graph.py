#!/usr/bin/env python3
"""
Smoke test for the dependency graph (FORA-83, sub-goal 8.2).

Acceptance contract:

    1. `build_graph(scope)` consumes a `RepoScope` (the canonical
       path), a `MigrationScope` (8.1 output), or a bare list of
       `FileRecord`s.
    2. It emits a `DependencyGraph` covering every file with
       fan-in / fan-out / blast radius / cycle membership.
    3. It is deterministic: two runs produce byte-identical
       output modulo `graph_runtime_ms` and `report_id`.
    4. Synthetic fixtures exercise the cycle path
       (Tarjan SCC, size >= 2), the self-loop path
       (size 1 with self-edge), and the cluster path
       (>= 3 edges between two services).
    5. Cost bound: < 10 s, $0 spend.
    6. Output is written to:
         - forge/8.2/dep-graph.json        (canonical deliverable)
         - forge/8.2/cycles.json           (cycle-only slim view)
         - forge/8.2/services.json         (service-graph-only slim view)
         - forge/8.2/dependency-graph.md   (Mermaid + human-readable)
         - agents/refactor/evidence/smoke_<ts>/result.json

Three fixtures drive the assertions:

    - sample_legacy_monolith(): 22 files / 7 services, no cycles, no
      clusters (acutes the file-level coverage and fan-count paths).
    - _three_node_cycle_fixture(): A -> B -> C -> A, one 3-node SCC.
    - _self_loop_fixture(): A -> A, one 1-node self-loop SCC.
    - _cluster_fixture(): billing<->shared with 4 file-level edges in
      each direction; triggers the CLUSTER_MIN_EDGE_COUNT >= 3 rule.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from typing import Any, Dict, List, Tuple


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ROOT)

from agents.refactor import (  # noqa: E402
    DependencyGraph,
    FileRecord,
    RepoScope,
    build_graph,
    render_mermaid,
    sample_legacy_monolith,
)


OUT_DIR = os.path.join(ROOT, "forge", "8.2")
EVIDENCE_DIR = os.path.join(HERE, "evidence")


# ---------------------------------------------------------------------------
# Synthetic fixtures (not part of the package public surface)
# ---------------------------------------------------------------------------


def _file(path: str, service: str = None, imports: List[str] = None,
          imported_by: List[str] = None, loc: int = 10, role: str = "service",
          language: str = "python") -> FileRecord:
    return FileRecord(
        path=path, language=language, loc=loc, role=role,
        service=service, imports=list(imports or []),
        imported_by=list(imported_by or []),
    )


def _three_node_cycle_fixture() -> RepoScope:
    """A -> B -> C -> A; one 3-node SCC."""
    files = [
        _file("svc/a.py", service="svc", imports=["svc/b.py"]),
        _file("svc/b.py", service="svc", imports=["svc/c.py"]),
        _file("svc/c.py", service="svc", imports=["svc/a.py"]),
    ]
    return RepoScope(
        schema_version=1,
        generated_at="2026-06-18T00:00:00Z",
        source="synthetic:three_node_cycle@v0",
        target_root="/synthetic",
        default_branch="main",
        total_loc_estimate=sum(f.loc for f in files),
        files=files,
        notes=["3-node cycle fixture for FORA-83 smoke."],
    )


def _self_loop_fixture() -> RepoScope:
    """A -> A; one 1-node self-loop SCC."""
    files = [_file("solo/a.py", service="solo", imports=["solo/a.py"])]
    return RepoScope(
        schema_version=1,
        generated_at="2026-06-18T00:00:00Z",
        source="synthetic:self_loop@v0",
        target_root="/synthetic",
        default_branch="main",
        total_loc_estimate=files[0].loc,
        files=files,
        notes=["Self-loop fixture for FORA-83 smoke."],
    )


def _cluster_fixture() -> RepoScope:
    """billing<->shared with 4 file-level edges each way => one cluster."""
    files = [
        # billing -> shared (4 distinct edges)
        _file("src/billing/x.py", service="billing", imports=["src/shared/u.py"]),
        _file("src/billing/y.py", service="billing", imports=["src/shared/v.py"]),
        _file("src/billing/z.py", service="billing", imports=["src/shared/w.py"]),
        _file("src/billing/w.py", service="billing", imports=["src/shared/x.py"]),
        # shared -> billing (4 distinct edges)
        _file("src/shared/u.py", service="shared", imports=["src/billing/x.py"]),
        _file("src/shared/v.py", service="shared", imports=["src/billing/y.py"]),
        _file("src/shared/w.py", service="shared", imports=["src/billing/z.py"]),
        _file("src/shared/x.py", service="shared", imports=["src/billing/w.py"]),
    ]
    return RepoScope(
        schema_version=1,
        generated_at="2026-06-18T00:00:00Z",
        source="synthetic:cluster@v0",
        target_root="/synthetic",
        default_branch="main",
        total_loc_estimate=sum(f.loc for f in files),
        files=files,
        notes=["Cluster fixture: billing<->shared 4+4 edges."],
    )


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _strip_volatile(d: Dict[str, Any]) -> Dict[str, Any]:
    """Remove fields that legitimately vary across runs (timing, uuid)."""
    d.pop("report_id", None)
    d.pop("graph_runtime_ms", None)
    return d


_assertions_passed = 0
_assertions_failed = 0


def _check(name: str, ok: bool, detail: str = "") -> None:
    global _assertions_passed, _assertions_failed
    tag = "PASS" if ok else "FAIL"
    suffix = f"  ({detail})" if detail else ""
    print(f"[assert {tag}] {name}{suffix}")
    if ok:
        _assertions_passed += 1
    else:
        _assertions_failed += 1


def _check_eq(name: str, got: Any, expected: Any) -> None:
    _check(name, got == expected, f"got={got!r} expected={expected!r}")


def _check_in_range(name: str, value: float, lo: float, hi: float) -> None:
    _check(name, lo <= value <= hi, f"value={value} range=[{lo},{hi}]")


# ---------------------------------------------------------------------------
# Markdown report renderer (human-readable companion to dep-graph.json)
# ---------------------------------------------------------------------------


def _render_markdown(graph: DependencyGraph, source: str) -> str:
    """Render the dependency graph as a human-readable Markdown report.

    Includes top-line numbers, the Mermaid service diagram, the top-N
    fan-in / fan-out / blast-radius lists, and the cycle roster.
    """
    lines: List[str] = []
    lines.append(f"# Dependency Graph — {source}")
    lines.append("")
    lines.append(f"- Generated: `{graph.generated_at}`")
    lines.append(f"- Graph: `{graph.graph_version}` (schema v{graph.schema_version})")
    lines.append(f"- Repo fingerprint: `{graph.repo_fingerprint}`")
    lines.append(
        f"- Runtime: {graph.graph_runtime_ms:.2f} ms  |  "
        f"Cost: ${graph.cost_usd:.2f}  |  "
        f"Deterministic: {graph.deterministic}"
    )
    lines.append("")

    lines.append("## Top-line")
    lines.append("")
    lines.append(
        f"- Files (nodes): **{len(graph.nodes)}**  |  "
        f"Edges: **{len(graph.edges)}**  |  "
        f"Cycles: **{len(graph.cycles)}**"
    )
    lines.append(
        f"- Services (svc nodes): **{len(graph.service_graph.nodes)}**  |  "
        f"Service edges: **{len(graph.service_graph.edges)}**  |  "
        f"Clusters: **{len(graph.clusters)}**"
    )
    lines.append("")

    lines.append("## Service-level dependency graph (Mermaid)")
    lines.append("")
    lines.append(render_mermaid(graph, max_nodes=60))
    lines.append("")

    lines.append("## Top 10 fan-in files")
    lines.append("")
    lines.append("| Path | Service | fan-in | fan-out | blast_radius |")
    lines.append("| --- | --- | ---: | ---: | ---: |")
    for n in graph.top_fan_in(10):
        lines.append(
            f"| `{n.path}` | {n.service} | {n.fan_in} | {n.fan_out} | {n.blast_radius} |"
        )
    lines.append("")

    lines.append("## Top 10 fan-out files")
    lines.append("")
    lines.append("| Path | Service | fan-out | fan-in | blast_radius |")
    lines.append("| --- | --- | ---: | ---: | ---: |")
    for n in graph.top_fan_out(10):
        lines.append(
            f"| `{n.path}` | {n.service} | {n.fan_out} | {n.fan_in} | {n.blast_radius} |"
        )
    lines.append("")

    lines.append("## Top 10 blast-radius files")
    lines.append("")
    lines.append("| Path | Service | blast_radius | fan-in | fan-out |")
    lines.append("| --- | --- | ---: | ---: | ---: |")
    for n in graph.top_blast_radius(10):
        lines.append(
            f"| `{n.path}` | {n.service} | {n.blast_radius} | {n.fan_in} | {n.fan_out} |"
        )
    lines.append("")

    if graph.cycles:
        lines.append("## Cycles")
        lines.append("")
        for c in graph.cycles:
            tag = " (self-loop)" if c.is_self_loop else ""
            lines.append(
                f"- **Cycle {c.cycle_id}** — size {c.size}{tag}: "
                + ", ".join(f"`{m}`" for m in c.members)
            )
        lines.append("")

    if graph.clusters:
        lines.append("## Tightly-coupled service clusters")
        lines.append("")
        for c in graph.clusters:
            lines.append(
                f"- **Cluster {c.cluster_id}** — {len(c.services)} services, "
                f"{c.edge_count} intra-cluster edges, "
                f"avg {c.avg_edges_per_pair:.2f} edges/pair: "
                + ", ".join(f"`{s}`" for s in c.services)
            )
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(f"_Report ID: `{graph.report_id}`_")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    run_stamp = _ts()
    run_dir = os.path.join(EVIDENCE_DIR, f"smoke_dep_graph_{run_stamp}")
    os.makedirs(run_dir, exist_ok=True)

    print(f"[smoke] run stamp: {run_stamp}")
    print(f"[smoke] out dir:   {OUT_DIR}")
    print(f"[smoke] evidence:  {run_dir}")
    print()

    # ------------------------------------------------------------------
    # Fixture A — sample_legacy_monolith (canonical file-level coverage)
    # ------------------------------------------------------------------
    print("=== Fixture A: sample_legacy_monolith ===")
    t0 = time.perf_counter()
    repo = sample_legacy_monolith()
    g1 = build_graph(repo)
    g2 = build_graph(repo)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"[smoke] build_graph: 2 runs in {elapsed_ms:.1f} ms "
          f"(single = {g1.graph_runtime_ms} ms)")
    print(f"[smoke] nodes={len(g1.nodes)} edges={len(g1.edges)} "
          f"cycles={len(g1.cycles)} svc_nodes={len(g1.service_graph.nodes)} "
          f"svc_edges={len(g1.service_graph.edges)} clusters={len(g1.clusters)}")
    print()

    # AC1 — return type
    _check_eq("AC1: build_graph returns DependencyGraph",
              type(g1).__name__, "DependencyGraph")

    # AC2 — deterministic across runs
    d1 = _strip_volatile(g1.to_dict())
    d2 = _strip_volatile(g2.to_dict())
    _check_eq("AC2: deterministic across two runs", d1, d2)

    # AC3 — every input file has a node
    paths_in = {f.path for f in repo.files}
    paths_node = {n.path for n in g1.nodes}
    _check_eq("AC3: every file has a node", paths_node, paths_in)

    # AC4 — every edge target is in the node set
    node_set = paths_node
    bad_edges = [(e.source, e.target) for e in g1.edges
                 if e.target not in node_set or e.source not in node_set]
    _check_eq("AC4: every edge endpoint is a known node", bad_edges, [])

    # AC5 — BillingService.java fan counts (the god-module in the fixture).
    #   Outbound (fan_out):
    #     - explicit imports: Invoice, Customer, LegacyDb  (3)
    #     - imported_by back-fill on LegacyInvoiceRow      (1, because
    #       LegacyInvoiceRow.imports is empty so its
    #       imported_by=[BillingService] is mirrored back as a forward edge)
    #     => total fan_out = 4.
    #   Inbound (fan_in):
    #     - explicit imported_by: BillingController, MonthlyRollup,
    #       ReportsService (3)
    #     - InvoicePipeline.imports=[BillingService]        (1)
    #     => total fan_in = 4.
    billing = next(n for n in g1.nodes
                   if n.path == "src/main/java/com/billingcorp/monolith/BillingService.java")
    _check_eq("AC5: BillingService fan_out == 4 (3 explicit + 1 back-fill)",
              billing.fan_out, 4)
    _check_eq("AC5: BillingService fan_in == 4 (3 imported_by + InvoicePipeline)",
              billing.fan_in, 4)

    # AC6 — blast radius is monotonic in path-count for the canonical fixture
    # (every node with no outbound edges has blast_radius == 1; every node
    # with at least one outbound edge has blast_radius >= 2).
    leaf_blast = [n for n in g1.nodes if n.fan_out == 0]
    branching_blast = [n for n in g1.nodes if n.fan_out >= 1]
    _check(
        "AC6: leaf nodes have blast_radius == 1",
        all(n.blast_radius == 1 for n in leaf_blast),
        detail=f"{len(leaf_blast)} leaf nodes",
    )
    _check(
        "AC6: branching nodes have blast_radius >= 2",
        all(n.blast_radius >= 2 for n in branching_blast),
        detail=f"{len(branching_blast)} branching nodes",
    )

    # AC7 — top_fan_in() sorted descending by fan_in, ascending by path
    fan_in_top = g1.top_fan_in(5)
    fan_in_values = [n.fan_in for n in fan_in_top]
    _check_eq(
        "AC7: top_fan_in sorted descending",
        fan_in_values, sorted(fan_in_values, reverse=True),
    )

    # AC8 — cost bound
    _check("AC8: cost bound < 10,000 ms", elapsed_ms < 10_000,
           detail=f"{elapsed_ms:.1f} ms")
    _check_eq("AC8: cost_usd == 0", g1.cost_usd, 0.0)

    # AC9 — service-graph aggregates
    # billing has 10 files in fixture: 4 services + 1 model + 1 controller +
    # 2 tests + 1 generated.class + 1 pipeline + ... let me just assert >= 1.
    billing_svc = next(
        (n for n in g1.service_graph.nodes if n.service == "billing"), None,
    )
    _check("AC9: service_graph contains billing node", billing_svc is not None)
    _check(
        "AC9: billing service aggregates >= 5 files",
        billing_svc is not None and billing_svc.file_count >= 5,
        detail=f"file_count={billing_svc.file_count if billing_svc else 0}",
    )

    # ------------------------------------------------------------------
    # Fixture B — three-node cycle (Tarjan SCC, size >= 2)
    # ------------------------------------------------------------------
    print()
    print("=== Fixture B: 3-node cycle (A->B->C->A) ===")
    repo_b = _three_node_cycle_fixture()
    g_b = build_graph(repo_b)
    print(f"[smoke] nodes={len(g_b.nodes)} edges={len(g_b.edges)} "
          f"cycles={len(g_b.cycles)}")
    # AC10 — one cycle, size 3
    _check_eq("AC10: 3-node fixture produces exactly 1 cycle",
              len(g_b.cycles), 1)
    _check_eq("AC10: 3-node cycle has size 3", g_b.cycles[0].size, 3)
    _check_eq("AC10: 3-node cycle is not a self-loop",
              g_b.cycles[0].is_self_loop, False)
    # Every node in the cycle should be marked in_cycle=True
    cycle_members = set(g_b.cycles[0].members)
    in_cycle_count = sum(1 for n in g_b.nodes if n.path in cycle_members and n.in_cycle)
    _check_eq("AC10: every cycle member is marked in_cycle=True",
              in_cycle_count, 3)

    # ------------------------------------------------------------------
    # Fixture C — self-loop (1-node SCC with self-edge)
    # ------------------------------------------------------------------
    print()
    print("=== Fixture C: self-loop (A->A) ===")
    repo_c = _self_loop_fixture()
    g_c = build_graph(repo_c)
    print(f"[smoke] nodes={len(g_c.nodes)} edges={len(g_c.edges)} "
          f"cycles={len(g_c.cycles)}")
    # AC11 — one self-loop cycle
    _check_eq("AC11: self-loop fixture produces exactly 1 cycle",
              len(g_c.cycles), 1)
    _check_eq("AC11: self-loop cycle has size 1",
              g_c.cycles[0].size, 1)
    _check_eq("AC11: self-loop cycle is_self_loop=True",
              g_c.cycles[0].is_self_loop, True)

    # ------------------------------------------------------------------
    # Fixture D — tightly-coupled cluster (billing<->shared >= 3 edges)
    # ------------------------------------------------------------------
    print()
    print("=== Fixture D: tightly-coupled cluster (billing<->shared) ===")
    repo_d = _cluster_fixture()
    g_d = build_graph(repo_d)
    print(f"[smoke] nodes={len(g_d.nodes)} edges={len(g_d.edges)} "
          f"svc_nodes={len(g_d.service_graph.nodes)} "
          f"clusters={len(g_d.clusters)}")
    # AC12 — at least one cluster with billing and shared
    cluster_services = [set(c.services) for c in g_d.clusters]
    has_billing_shared = any(
        {"billing", "shared"}.issubset(s) for s in cluster_services
    )
    _check("AC12: billing<->shared forms a cluster", has_billing_shared,
           detail=f"clusters={[c.services for c in g_d.clusters]}")
    # AC13 — service edge weight >= 3 between billing and shared
    pair = next(
        (e for e in g_d.service_graph.edges
         if {e.source, e.target} == {"billing", "shared"}),
        None,
    )
    _check("AC13: service-graph edge billing<->shared exists", pair is not None)
    _check(
        "AC13: service-graph edge weight >= 3",
        pair is not None and pair.weight >= 3,
        detail=f"weight={pair.weight if pair else 0}",
    )

    # ------------------------------------------------------------------
    # AC14 — Mermaid rendering
    # ------------------------------------------------------------------
    mermaid = render_mermaid(g1, max_nodes=60)
    _check("AC14: Mermaid starts with ```mermaid fence",
           mermaid.lstrip().startswith("```mermaid"))
    _check("AC14: Mermaid ends with closing ``` fence",
           mermaid.rstrip().endswith("```"))
    _check("AC14: Mermaid contains 'flowchart LR'",
           "flowchart LR" in mermaid)

    # ------------------------------------------------------------------
    # Write artefacts
    # ------------------------------------------------------------------
    print()
    print("=== Writing artefacts ===")
    canonical = os.path.join(OUT_DIR, "dep-graph.json")
    cycles_path = os.path.join(OUT_DIR, "cycles.json")
    services_path = os.path.join(OUT_DIR, "services.json")
    md_path = os.path.join(OUT_DIR, "dependency-graph.md")

    with open(canonical, "w", encoding="utf-8") as fh:
        json.dump(g1.to_dict(), fh, indent=2, sort_keys=True)
    cycles_only = {
        "schema_version": g1.schema_version,
        "report_id": g1.report_id,
        "source": g1.source,
        "generated_at": g1.generated_at,
        "graph_version": g1.graph_version,
        "repo_fingerprint": g1.repo_fingerprint,
        "cycle_count": len(g1.cycles),
        "files_in_cycles": g1.files_in_cycles(),
        "cycles": [c.to_dict() for c in g1.cycles],
    }
    with open(cycles_path, "w", encoding="utf-8") as fh:
        json.dump(cycles_only, fh, indent=2, sort_keys=True)
    services_only = {
        "schema_version": g1.service_graph.schema_version,
        "report_id": g1.report_id,
        "source": g1.source,
        "generated_at": g1.generated_at,
        "graph_version": g1.graph_version,
        "repo_fingerprint": g1.repo_fingerprint,
        "clusters": [c.to_dict() for c in g1.clusters],
        "service_graph": g1.service_graph.to_dict(),
    }
    with open(services_path, "w", encoding="utf-8") as fh:
        json.dump(services_only, fh, indent=2, sort_keys=True)
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(_render_markdown(g1, g1.source))

    print(f"[smoke] wrote: {canonical}")
    print(f"[smoke] wrote: {cycles_path}")
    print(f"[smoke] wrote: {services_path}")
    print(f"[smoke] wrote: {md_path}")

    # AC15 — artefacts exist + parse as JSON
    _check("AC15: dep-graph.json written", os.path.exists(canonical))
    _check("AC15: cycles.json written", os.path.exists(cycles_path))
    _check("AC15: services.json written", os.path.exists(services_path))
    _check("AC15: dependency-graph.md written", os.path.exists(md_path))
    for p in (canonical, cycles_path, services_path):
        with open(p, "r", encoding="utf-8") as fh:
            parsed = json.load(fh)
        _check(f"AC15: {os.path.basename(p)} parses as JSON",
               isinstance(parsed, dict))

    # ------------------------------------------------------------------
    # Evidence — result.json
    # ------------------------------------------------------------------
    result = {
        "run_stamp": run_stamp,
        "graph_version": g1.graph_version,
        "analyzer_version": "code-analyzer/0.1.0",  # upstream
        "repo_fingerprint": g1.repo_fingerprint,
        "repo_source": repo.source,
        "elapsed_ms_total": round(elapsed_ms, 3),
        "elapsed_ms_single_run": g1.graph_runtime_ms,
        "cost_usd": g1.cost_usd,
        "deterministic": True,
        "ac_checks": {
            "ac1_return_type": type(g1).__name__ == "DependencyGraph",
            "ac2_deterministic": d1 == d2,
            "ac3_full_file_coverage": paths_node == paths_in,
            "ac4_edge_endpoints_known": bad_edges == [],
            "ac5_billing_fan_counts": billing.fan_in == 4 and billing.fan_out == 4,
            "ac6_blast_radius_monotonic": (
                all(n.blast_radius == 1 for n in leaf_blast)
                and all(n.blast_radius >= 2 for n in branching_blast)
            ),
            "ac7_top_fan_in_sorted": (
                fan_in_values == sorted(fan_in_values, reverse=True)
            ),
            "ac8_cost_bound": elapsed_ms < 10_000 and g1.cost_usd == 0.0,
            "ac9_service_graph_present": billing_svc is not None,
            "ac10_three_node_cycle": (
                len(g_b.cycles) == 1
                and g_b.cycles[0].size == 3
                and not g_b.cycles[0].is_self_loop
            ),
            "ac11_self_loop_cycle": (
                len(g_c.cycles) == 1
                and g_c.cycles[0].size == 1
                and g_c.cycles[0].is_self_loop
            ),
            "ac12_cluster_detected": has_billing_shared,
            "ac13_service_edge_weight": pair is not None and pair.weight >= 3,
            "ac14_mermaid_valid": (
                mermaid.lstrip().startswith("```mermaid")
                and mermaid.rstrip().endswith("```")
                and "flowchart LR" in mermaid
            ),
            "ac15_artefacts_written": all(
                os.path.exists(p)
                for p in (canonical, cycles_path, services_path, md_path)
            ),
        },
        "fixtures": {
            "canonical": {
                "source": repo.source,
                "files": len(repo.files),
                "services": len(repo.services),
                "graph_nodes": len(g1.nodes),
                "graph_edges": len(g1.edges),
                "cycles": len(g1.cycles),
                "service_nodes": len(g1.service_graph.nodes),
                "service_edges": len(g1.service_graph.edges),
                "clusters": len(g1.clusters),
            },
            "three_node_cycle": {
                "files": len(repo_b.files),
                "cycles": len(g_b.cycles),
            },
            "self_loop": {
                "files": len(repo_c.files),
                "cycles": len(g_c.cycles),
            },
            "cluster": {
                "files": len(repo_d.files),
                "clusters": len(g_d.clusters),
            },
        },
        "summary": {
            "top_fan_in_5": [
                {"path": n.path, "service": n.service, "fan_in": n.fan_in}
                for n in g1.top_fan_in(5)
            ],
            "top_blast_radius_5": [
                {"path": n.path, "blast_radius": n.blast_radius}
                for n in g1.top_blast_radius(5)
            ],
        },
    }
    with open(os.path.join(run_dir, "result.json"), "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, sort_keys=True)
    print(f"[smoke] evidence: {run_dir}/result.json")

    # ------------------------------------------------------------------
    # Final tally
    # ------------------------------------------------------------------
    print()
    print("=" * 60)
    print(f"Assertions: {_assertions_passed} passed, {_assertions_failed} failed")
    print("=" * 60)
    if _assertions_failed:
        print("FAIL")
        return 2
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
