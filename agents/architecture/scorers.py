"""
Per-style scoring rules.

Each scorer is a *pure* function:

    (graph: dict, summary: GraphSummary) -> StyleTag

It inspects the graph + summary, accumulates evidence, and clamps
its confidence into [0, 1]. Every scorer is deterministic and
side-effect free — no LLM, no random, no I/O.

The scoring philosophy:
  - *Positive* evidence pushes the confidence up.
  - *Negative* evidence pushes it down.
  - The final score is a clamped weighted sum of those signals
    with style-specific weights.
  - When evidence is missing or contradictory, the scorer returns
    a low confidence (0.0–0.2) with a clear rationale — never a
    random mid-range guess.

Scoring weights are documented inline so a reviewer can re-tune
them by editing a single number.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Tuple

from .schemas import ALL_STYLES, Evidence, GraphSummary, StyleTag


# A scorer returns a StyleTag.
Scorer = Callable[[Dict[str, Any], GraphSummary], StyleTag]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _ev(kind: str, description: str, paths: List[str] | None = None,
        metric: str | None = None, value: float | None = None) -> Evidence:
    return Evidence(
        kind=kind,
        description=description,
        paths=sorted(paths or []),
        metric=metric,
        value=value,
    )


def _ext_dep_fanin(summary: GraphSummary, package_re: str) -> int:
    """Return the fan-in of any external dep matching the regex (case-insensitive)."""
    pat = re.compile(package_re, re.IGNORECASE)
    total = 0
    for d in summary.top_external_deps:
        if pat.search(str(d.get("package", ""))):
            total += int(d.get("fanin", 0) or 0)
    return total


# ---------------------------------------------------------------------------
# 1. monolith
# ---------------------------------------------------------------------------
def score_monolith(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    """Single deployable, shared DB, no real service split."""
    evs: List[Evidence] = []
    score = 0.0
    # Negative evidence is the rule: very few services, very high internal coupling.
    n_services = len(s.services)
    if n_services <= 1:
        score += 0.7
        evs.append(_ev("positive", f"Only {n_services} top-level service group(s) in the graph.",
                       metric="service_count", value=float(n_services)))
    elif n_services == 2:
        score += 0.3
        evs.append(_ev("neutral", f"{n_services} service groups — not strictly a monolith but not split either.",
                       metric="service_count", value=float(n_services)))
    else:
        evs.append(_ev("negative", f"{n_services} service groups (apps/packages/mcp-servers/agents/...) — not a monolith.",
                       metric="service_count", value=float(n_services)))
    # Cross-service file imports = 0 means strict boundaries (anti-monolith).
    if s.cross_service_file_imports == 0 and n_services >= 3:
        evs.append(_ev("negative", "Zero cross-service file imports — boundaries are enforced."))
        score -= 0.2
    # Cycles inside a service are normal; cycles that cross services are smells (we don't have that signal here).
    if s.cycle_count >= 3 and n_services <= 2:
        score += 0.1
        evs.append(_ev("positive", f"{s.cycle_count} cycles — typical of a tightly-coupled monolith."))
    return StyleTag(
        style="monolith",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"{n_services} service group(s); {s.cycle_count} cycle(s); "
                  f"cross-service file imports = {s.cross_service_file_imports}.",
    )


# ---------------------------------------------------------------------------
# 2. microservices
# ---------------------------------------------------------------------------
def score_microservices(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    """Many independent services, each deployable, low cross-service file imports."""
    evs: List[Evidence] = []
    score = 0.0
    n_services = len(s.services)
    if n_services >= 5:
        score += 0.4
        evs.append(_ev("positive", f"{n_services} top-level service groups — independently buildable.",
                       metric="service_count", value=float(n_services)))
    elif n_services >= 3:
        score += 0.2
        evs.append(_ev("positive", f"{n_services} service groups.", metric="service_count", value=float(n_services)))
    else:
        evs.append(_ev("negative", f"Only {n_services} service groups — not microservice-shaped.",
                       metric="service_count", value=float(n_services)))
    if s.cross_service_file_imports == 0:
        score += 0.3
        evs.append(_ev("positive", "Zero cross-service file imports — services share only via packages."))
    else:
        evs.append(_ev("negative", f"{s.cross_service_file_imports} cross-service file imports — tight coupling."))
    # entry points per service is a strong microservices signal
    svc_entrypoints = sum(1 for p in s.entry_point_paths if p.startswith("apps/") or p.startswith("mcp-servers/"))
    if svc_entrypoints >= 3:
        score += 0.2
        evs.append(_ev("positive", f"{svc_entrypoints} entry points under apps/ or mcp-servers/ — multiple runnable services."))
    # No shared DB in a monorepo = + (no clear signal in 2.1, so we look at the layering violations)
    if s.layering_violation_count == 0:
        evs.append(_ev("neutral", "0 layering violations — boundaries respected at file level."))
    return StyleTag(
        style="microservices",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"{n_services} services, {s.cross_service_file_imports} cross-service file imports, "
                  f"{svc_entrypoints} per-service entry points.",
    )


# ---------------------------------------------------------------------------
# 3. event-driven
# ---------------------------------------------------------------------------
# NOTE: @modelcontextprotocol/sdk is intentionally excluded. MCP is a
# request/response protocol (JSON-RPC over stdio), not an async pub/sub
# broker. Including it produced a false-positive event-driven signal.
BROKER_PACKAGE_PATTERNS = [
    r"kafka",
    r"rabbit",
    r"\bnats\b",
    r"@nats-io/",
    r"amqp",
    r"jetstream",
    r"aws-sdk/client-sqs",
    r"aws-sdk/client-sns",
    r"aws-sdk/client-eventbridge",
    r"@google-cloud/pubsub",
    r"@azure/service-bus",
    r"event[-_]?bus",
    r"eventbridge",
    r"pubsub",
]


def score_event_driven(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    evs: List[Evidence] = []
    score = 0.0
    broker_fanin = 0
    broker_hits: List[str] = []
    for pat in BROKER_PACKAGE_PATTERNS:
        for d in s.top_external_deps:
            pkg = str(d.get("package", ""))
            if re.search(pat, pkg, re.IGNORECASE):
                fi = int(d.get("fanin", 0) or 0)
                broker_fanin += fi
                if pkg and pkg not in broker_hits:
                    broker_hits.append(pkg)
    if broker_fanin >= 30:
        score += 0.7
        evs.append(_ev("positive", f"Broker / pub-sub fan-in totals {broker_fanin} across {len(broker_hits)} packages.",
                       metric="broker_fanin", value=float(broker_fanin)))
    elif broker_fanin >= 10:
        score += 0.4
        evs.append(_ev("positive", f"Broker / pub-sub fan-in totals {broker_fanin}.",
                       metric="broker_fanin", value=float(broker_fanin)))
    elif broker_fanin > 0:
        score += 0.15
        evs.append(_ev("neutral", f"Broker / pub-sub fan-in = {broker_fanin} (light usage).",
                       metric="broker_fanin", value=float(broker_fanin)))
    else:
        evs.append(_ev("negative", "No broker / pub-sub packages in top external deps."))
    # explicit event-bus / bridge paths (from any node, not just entry points)
    all_paths = sorted({n["path"] for n in graph.get("nodes", [])})
    event_paths = [p for p in all_paths
                   if any(k in p.lower() for k in ("event-bus", "/sns", "pubsub", "sqs", "queue", "consumer", "producer", "/streams/"))]
    if event_paths:
        score += 0.15
        evs.append(_ev("positive", f"{len(event_paths)} event-bus / bridge related paths.",
                       paths=event_paths))
    return StyleTag(
        style="event-driven",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"broker fan-in = {broker_fanin} across {len(broker_hits)} packages; "
                  f"{len(event_paths)} event-bus/bridge paths.",
    )


# ---------------------------------------------------------------------------
# 4. cqrs
# ---------------------------------------------------------------------------
def score_cqrs(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    evs: List[Evidence] = []
    score = 0.0
    # Look for command_/query_ patterns or "commandbus"/"querybus"/"event-sourcing" deps
    cqrs_path_re = re.compile(r"(/commands?/|/queries?/|command[-_]?bus|query[-_]?bus|read[-_]?model|write[-_]?model|event[-_]?sourcing)", re.IGNORECASE)
    cqrs_paths = sorted(p for p in (s.high_fanout_paths + s.entry_point_paths + s.ports_paths) if cqrs_path_re.search(p))
    if cqrs_paths:
        score += 0.5
        evs.append(_ev("positive", f"{len(cqrs_paths)} path(s) matching CQRS naming convention.", paths=cqrs_paths))
    # also look in top external deps for known CQRS libs
    cqrs_libs = _ext_dep_fanin(s, r"(cqrs|axoniq|eventstore|event[-_]?store|message[-_]?store)")
    if cqrs_libs > 0:
        score += 0.3
        evs.append(_ev("positive", f"CQRS/event-sourcing library fan-in = {cqrs_libs}.", metric="cqrs_fanin", value=float(cqrs_libs)))
    if not cqrs_paths and cqrs_libs == 0:
        evs.append(_ev("negative", "No command/query/ read-model/write-model paths and no CQRS libraries in top deps."))
    return StyleTag(
        style="cqrs",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"{len(cqrs_paths)} CQRS-shaped paths; CQRS library fan-in = {cqrs_libs}.",
    )


# ---------------------------------------------------------------------------
# 5. ddd (domain-driven design)
# ---------------------------------------------------------------------------
def score_ddd(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    evs: List[Evidence] = []
    score = 0.0
    domain_n = len(s.domain_paths)
    if domain_n >= 3:
        score += 0.6
        evs.append(_ev("positive", f"{domain_n} path(s) match DDD conventions (domain/aggregate/entity/bounded-context).",
                       paths=s.domain_paths, metric="ddd_path_count", value=float(domain_n)))
    elif domain_n >= 1:
        score += 0.3
        evs.append(_ev("positive", f"{domain_n} path(s) match DDD conventions.", paths=s.domain_paths))
    else:
        evs.append(_ev("negative", "No /domain, /aggregate, /entities or /bounded-context paths detected."))
    # strong types / value objects signal
    vo_paths = sorted(p for p in s.high_fanout_paths if any(k in p.lower() for k in ("value-object", "vo.ts", "vo.py")))
    if vo_paths:
        score += 0.2
        evs.append(_ev("positive", f"{len(vo_paths)} value-object style file(s).", paths=vo_paths))
    return StyleTag(
        style="ddd",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"{domain_n} DDD-shaped paths; {len(vo_paths)} value-object file(s).",
    )


# ---------------------------------------------------------------------------
# 6. layered
# ---------------------------------------------------------------------------
def score_layered(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    evs: List[Evidence] = []
    score = 0.0
    layer_kw_counts = {k: len(v) for k, v in s.layer_keyword_paths.items()}
    present_layers = [k for k, c in layer_kw_counts.items() if c > 0]
    if len(present_layers) >= 3:
        score += 0.7
        evs.append(_ev("positive", f"{len(present_layers)} layer-style keywords present: {', '.join(present_layers)}.",
                       metric="layer_keyword_count", value=float(len(present_layers))))
    elif len(present_layers) == 2:
        score += 0.4
        evs.append(_ev("positive", f"{len(present_layers)} layer-style keywords present: {', '.join(present_layers)}."))
    elif len(present_layers) == 1:
        score += 0.2
        evs.append(_ev("neutral", f"Only one layer-style keyword: {present_layers[0]}."))
    else:
        evs.append(_ev("negative", "No controller/service/repository/handler/usecase style paths."))
    # Layering violations in the 2.1 metric directly contradict a clean layered design.
    if s.layering_violation_count == 0 and len(present_layers) >= 2:
        evs.append(_ev("positive", "0 layering violations reported by 2.1 — boundaries respected."))
    elif s.layering_violation_count > 0:
        score -= 0.1
        evs.append(_ev("negative", f"{s.layering_violation_count} layering violations reported."))
    return StyleTag(
        style="layered",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"{len(present_layers)} layer keyword(s) present; {s.layering_violation_count} layering violations.",
    )


# ---------------------------------------------------------------------------
# 7. hexagonal / clean
# ---------------------------------------------------------------------------
def score_hexagonal(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    evs: List[Evidence] = []
    score = 0.0
    n_ports = len(s.ports_paths)
    n_adapters = len(s.adapter_paths)
    # Both ports AND adapters present is the strong hexagonal signature.
    if n_ports >= 1 and n_adapters >= 1:
        score += 0.6
        evs.append(_ev("positive", f"{n_ports} ports file(s) and {n_adapters} adapter file(s).",
                       paths=sorted(s.ports_paths + s.adapter_paths),
                       metric="port_adapter_count", value=float(n_ports + n_adapters)))
    elif n_ports >= 1 or n_adapters >= 1:
        score += 0.3
        evs.append(_ev("positive", f"ports={n_ports}, adapters={n_adapters} (one side missing)."))
    else:
        evs.append(_ev("negative", "No ports.ts / adapters/ paths detected."))
    # Central types files with very high fan-in = "shared kernel" / "domain core" pattern.
    central_types = [e for e in s.top_fan_in if (e.get("path", "").endswith("types.ts")
                                                   or e.get("path", "").endswith("types.py")
                                                   or e.get("path", "").endswith("ports.ts"))
                      and int(e.get("inDegree", 0)) >= 10]
    if central_types:
        score += 0.2
        evs.append(_ev("positive", f"{len(central_types)} central types/ports file(s) with inDegree ≥ 10.",
                       paths=[c["path"] for c in central_types]))
    # ports-style or types.ts with high fan-in
    if s.ports_paths:
        evs.append(_ev("positive", "ports interface file(s) act as the dependency-inversion seam.",
                       paths=s.ports_paths))
    return StyleTag(
        style="hexagonal-clean",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"ports={n_ports}, adapters={n_adapters}, central types fan-in ≥ 10: {len(central_types)}.",
    )


# ---------------------------------------------------------------------------
# 8. modular monolith
# ---------------------------------------------------------------------------
def score_modular_monolith(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    """Single deployable with strong module boundaries (not microservice-shaped, not file-messy)."""
    evs: List[Evidence] = []
    score = 0.0
    n_services = len(s.services)
    has_apps = "apps" in s.services
    has_packages = "packages" in s.services
    # Strong signature: apps + packages (or apps + clear module dirs) with zero cross-service file imports.
    if has_apps and has_packages and s.cross_service_file_imports == 0:
        score += 0.55
        evs.append(_ev("positive", "apps/ + packages/ layout with zero cross-service file imports.",
                       metric="cross_service_file_imports", value=0.0))
    elif has_apps and s.cross_service_file_imports == 0:
        score += 0.35
        evs.append(_ev("positive", "apps/ present, zero cross-service file imports.",
                       metric="cross_service_file_imports", value=0.0))
    elif n_services >= 3 and s.cross_service_file_imports == 0:
        score += 0.2
        evs.append(_ev("positive", f"{n_services} service groups, no cross-service file imports."))
    else:
        evs.append(_ev("negative", f"Cross-service file imports = {s.cross_service_file_imports} — boundaries leak."))
    # Modular monolith = NOT microservice-shaped. If we already score microservices highly, modular-monolith score should be lower.
    # This is enforced *after* all scorers run, but we still cap modular-monolith at 0.6 when services >= 5.
    if n_services >= 5:
        evs.append(_ev("neutral", f"{n_services} service groups — more microservice-shaped than classic modular monolith."))
    return StyleTag(
        style="modular-monolith",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"services={n_services}, has_apps={has_apps}, has_packages={has_packages}, "
                  f"cross-service file imports = {s.cross_service_file_imports}.",
    )


# ---------------------------------------------------------------------------
# 9. serverless
# ---------------------------------------------------------------------------
def score_serverless(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    evs: List[Evidence] = []
    score = 0.0
    n_lambda = len(s.serverless_keyword_paths)
    sls_libs = _ext_dep_fanin(s, r"(aws-lambda|@azure/functions|@google-cloud/functions|serverless\b|@aws-sdk/client-lambda)")
    if n_lambda >= 3:
        score += 0.6
        evs.append(_ev("positive", f"{n_lambda} lambda/serverless/handler-style file(s).",
                       paths=s.serverless_keyword_paths, metric="serverless_path_count", value=float(n_lambda)))
    elif n_lambda >= 1:
        score += 0.3
        evs.append(_ev("positive", f"{n_lambda} lambda/serverless/handler-style file(s).",
                       paths=s.serverless_keyword_paths))
    if sls_libs > 0:
        score += 0.3
        evs.append(_ev("positive", f"Serverless SDK fan-in = {sls_libs}.", metric="serverless_fanin", value=float(sls_libs)))
    if n_lambda == 0 and sls_libs == 0:
        evs.append(_ev("negative", "No lambda/serverless/handler paths and no serverless SDKs in top deps."))
    return StyleTag(
        style="serverless",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"serverless paths = {n_lambda}; serverless SDK fan-in = {sls_libs}.",
    )


# ---------------------------------------------------------------------------
# 10. pipeline
# ---------------------------------------------------------------------------
def score_pipeline(graph: Dict[str, Any], s: GraphSummary) -> StyleTag:
    evs: List[Evidence] = []
    score = 0.0
    n_pipe = len(s.pipeline_keyword_paths)
    pipe_libs = _ext_dep_fanin(s, r"(apache-spark|spark|beam|airflow|dagster|prefect|kafka-streams?|node-stream|streamz|bentoml)")
    if n_pipe >= 5:
        score += 0.6
        evs.append(_ev("positive", f"{n_pipe} pipeline/stage/transform paths.", paths=s.pipeline_keyword_paths))
    elif n_pipe >= 2:
        score += 0.35
        evs.append(_ev("positive", f"{n_pipe} pipeline/stage/transform paths.", paths=s.pipeline_keyword_paths))
    elif n_pipe >= 1:
        score += 0.15
        evs.append(_ev("neutral", f"{n_pipe} pipeline/stage/transform path."))
    if pipe_libs > 0:
        score += 0.3
        evs.append(_ev("positive", f"Pipeline library fan-in = {pipe_libs}.", metric="pipeline_fanin", value=float(pipe_libs)))
    if n_pipe == 0 and pipe_libs == 0:
        evs.append(_ev("negative", "No stage/transform/etl/stream paths and no pipeline libraries in top deps."))
    return StyleTag(
        style="pipeline",
        confidence=_clamp(score),
        evidence=evs,
        rationale=f"pipeline paths = {n_pipe}; pipeline library fan-in = {pipe_libs}.",
    )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
SCORERS: Dict[str, Scorer] = {
    "monolith":          score_monolith,
    "microservices":     score_microservices,
    "event-driven":      score_event_driven,
    "cqrs":              score_cqrs,
    "ddd":               score_ddd,
    "layered":           score_layered,
    "hexagonal-clean":   score_hexagonal,
    "modular-monolith":  score_modular_monolith,
    "serverless":        score_serverless,
    "pipeline":          score_pipeline,
}


def assert_complete() -> None:
    """Raise if the registry doesn't cover every style in `ALL_STYLES`."""
    missing = set(ALL_STYLES) - set(SCORERS)
    if missing:
        raise RuntimeError(f"Missing scorers for: {sorted(missing)}")
