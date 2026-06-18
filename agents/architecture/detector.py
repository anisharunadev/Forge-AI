"""
Detector entry point.

`detect_styles(graph)` is the public API. It:

  1. Validates the graph (schemaVersion, key presence).
  2. Builds a `GraphSummary` (normalised, sorted, deterministic).
  3. Runs every scorer in `scorers.SCORERS`.
  4. Cross-adjusts scores where styles are mutually exclusive
     (modular-monolith vs microservices, monolith vs microservices).
  5. Returns a `StyleReport` with all 10 tags + meta.

The function is pure: same input -> same output, no I/O, no LLM.
"""

from __future__ import annotations

import hashlib
import json as _json
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List

from .schemas import ALL_STYLES, Evidence, GraphSummary, StyleTag
from .scorers import SCORERS, assert_complete


SUPPORTED_SCHEMA_VERSIONS = (1,)


@dataclass
class StyleReport:
    """Top-level deliverable: 10 tags + run meta."""
    tags: List[StyleTag] = field(default_factory=list)
    generated_at: str = ""
    detector_version: str = "arch-style-detector/0.1.0"
    schema_version: int = 0
    target_root: str = ""
    graph_node_count: int = 0
    graph_edge_count: int = 0
    detector_runtime_ms: float = 0.0
    deterministic: bool = True
    cost_usd: float = 0.0      # always 0 — no model spend
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["tags"] = [t.to_dict() for t in self.tags]
        return d

    def top(self, n: int = 3, min_confidence: float = 0.4) -> List[StyleTag]:
        """Return the highest-confidence tags that beat the threshold."""
        ranked = sorted(self.tags, key=lambda t: t.confidence, reverse=True)
        return [t for t in ranked[:n] if t.confidence >= min_confidence]


def _validate_graph(graph: Dict[str, Any]) -> None:
    if not isinstance(graph, dict):
        raise ValueError("graph must be a dict (the 2.1 artefact root object).")
    sv = graph.get("schemaVersion")
    if sv not in SUPPORTED_SCHEMA_VERSIONS:
        raise ValueError(
            f"Unsupported graph schemaVersion={sv!r}; "
            f"detector supports {SUPPORTED_SCHEMA_VERSIONS}."
        )
    for required in ("nodes", "edges", "metrics", "generatedAt", "generator"):
        if required not in graph:
            raise ValueError(f"graph is missing required key: {required!r}")


def _cross_adjust(tags: List[StyleTag]) -> List[StyleTag]:
    """Resolve mutually-exclusive style pairs.

    Pairs we adjust:
      - monolith <-> microservices: when both are high, dampen the lower.
      - modular-monolith vs microservices: when microservices > 0.5, cap
        modular-monolith at 0.5 (because >=5 services is microservice-shaped).
    """
    by_name = {t.style: t for t in tags}

    mono = by_name.get("monolith")
    micro = by_name.get("microservices")
    if mono and micro:
        higher = max(mono.confidence, micro.confidence)
        if higher >= 0.5 and min(mono.confidence, micro.confidence) >= 0.4:
            lower_name = "monolith" if mono.confidence < micro.confidence else "microservices"
            target = by_name[lower_name]
            target.confidence = max(0.1, target.confidence - 0.15)
            target.evidence.append(Evidence(
                kind="cross-adjustment",
                description=f"Dampened because the opposite style scored {higher:.2f}.",
            ))
            target.rationale += f" (dampened vs opposite style at {higher:.2f})"

    mm = by_name.get("modular-monolith")
    if mm and micro and micro.confidence >= 0.5 and mm.confidence > 0.5:
        mm.confidence = 0.5
        mm.rationale += " (capped — services are microservice-shaped, not classic modular monolith)."
        mm.evidence.append(Evidence(
            kind="cross-adjustment",
            description="Capped at 0.5 because microservices scored ≥ 0.5.",
        ))

    return [by_name[name] for name in ALL_STYLES if name in by_name]


def detect_styles(graph: Dict[str, Any]) -> StyleReport:
    """Run all 10 style scorers and return a `StyleReport`.

    Pure function. No LLM. No I/O. Deterministic on the same input.
    Cost bound: < 10 seconds for any input the 2.1 generator produces.
    """
    assert_complete()
    _validate_graph(graph)

    t0 = time.perf_counter()
    summary = GraphSummary.from_graph(graph)
    tags: List[StyleTag] = []
    for style in ALL_STYLES:
        scorer = SCORERS[style]
        tag = scorer(graph, summary)
        tags.append(tag)
    tags = _cross_adjust(tags)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    # Determinism: a second pass must produce an identical hash of the report.
    payload = _json.dumps(
        [(t.style, round(t.confidence, 6), [e.to_dict() for e in t.evidence]) for t in tags],
        sort_keys=True,
    )
    _ = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    report = StyleReport(
        tags=tags,
        generated_at=summary.generated_at,
        schema_version=summary.schema_version,
        target_root=summary.target_root,
        graph_node_count=summary.node_count,
        graph_edge_count=summary.edge_count,
        detector_runtime_ms=round(elapsed_ms, 3),
        deterministic=True,
        cost_usd=0.0,
        notes=[
            "Detector is pure-Python; no LLM, no network. Same input -> same output.",
            "Scores are a clamped sum of weighted positive/negative signals per style; see scorers.py for weights.",
            "Cross-adjustment resolves mutually-exclusive pairs (monolith <-> microservices, "
            "modular-monolith cap when microservices is high).",
        ],
    )

    if elapsed_ms > 10_000:
        raise RuntimeError(
            f"Detector exceeded cost bound: {elapsed_ms:.1f} ms > 10,000 ms. "
            "This is a regression — see scorers.py for hot loops."
        )

    return report
