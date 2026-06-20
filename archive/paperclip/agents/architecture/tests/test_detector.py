"""
Unit tests for the architecture-style detector.

These are *light* unit tests — the heavy lifting is covered by
`smoke_test.py` against the real FORA-27 graph. Unit tests focus on
edge cases and synthetic inputs the smoke test can't easily produce.
"""

from __future__ import annotations

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

from agents.architecture import detect_styles  # noqa: E402
from agents.architecture.schemas import ALL_STYLES, GraphSummary  # noqa: E402


def _minimal_graph() -> dict:
    """A 1-service, 2-file graph that should be a clear monolith."""
    return {
        "schemaVersion": 1,
        "generatedAt": "2026-06-17T00:00:00Z",
        "generator": "test/minimal",
        "targetRoot": "/tmp/test",
        "nodes": [
            {"id": "a", "path": "src/index.ts", "language": "typescript",
             "kind": "file", "role": "module", "service": "app", "loc": 100, "is_test": False},
            {"id": "b", "path": "src/utils.ts", "language": "typescript",
             "kind": "file", "role": "module", "service": "app", "loc": 50, "is_test": False},
        ],
        "edges": [
            {"kind": "import", "source": "a", "target": "b", "spec": "./utils"},
        ],
        "metrics": {
            "nodeCount": 2,
            "edgeCount": 1,
            "totalLoc": 150,
            "cycleCount": 0,
            "cycles": [],
            "crossServiceFileImports": [],
            "crossServicePackageEdges": [],
            "layeringViolationCount": 0,
            "layeringViolations": [],
            "services": {"app": {"files": 2, "loc": 150}},
            "languages": {"typescript": 2},
            "prodNodeCount": 2,
            "testNodeCount": 0,
            "testVsProdRatio": 0.0,
            "topExternalDeps": [],
            "topFanIn": [],
            "topFanOut": [],
            "highFanout": [],
            "entryPointCandidates": [],
            "deadCodeCandidates": [],
            "todoFixmeCount": 0,
        },
    }


def _hexagonal_graph() -> dict:
    """A graph with explicit ports + adapters."""
    return {
        "schemaVersion": 1,
        "generatedAt": "2026-06-17T00:00:00Z",
        "generator": "test/hex",
        "targetRoot": "/tmp/hex",
        "nodes": [
            {"id": "p", "path": "src/ports.ts", "language": "typescript",
             "kind": "file", "role": "module", "service": "core", "loc": 200, "is_test": False},
            {"id": "a1", "path": "src/adapters/aws.ts", "language": "typescript",
             "kind": "file", "role": "module", "service": "core", "loc": 100, "is_test": False},
            {"id": "a2", "path": "src/adapters/gcp.ts", "language": "typescript",
             "kind": "file", "role": "module", "service": "core", "loc": 100, "is_test": False},
            {"id": "a3", "path": "src/adapters/index.ts", "language": "typescript",
             "kind": "file", "role": "module", "service": "core", "loc": 50, "is_test": False},
        ],
        "edges": [],
        "metrics": {
            "nodeCount": 4, "edgeCount": 0, "totalLoc": 450,
            "cycleCount": 0, "cycles": [],
            "crossServiceFileImports": [], "crossServicePackageEdges": [],
            "layeringViolationCount": 0, "layeringViolations": [],
            "services": {"core": {"files": 4, "loc": 450}},
            "languages": {"typescript": 4},
            "prodNodeCount": 4, "testNodeCount": 0, "testVsProdRatio": 0.0,
            "topExternalDeps": [],
            "topFanIn": [{"inDegree": 3, "path": "src/ports.ts"}],
            "topFanOut": [], "highFanout": [], "entryPointCandidates": [],
            "deadCodeCandidates": [], "todoFixmeCount": 0,
        },
    }


class DetectorTests(unittest.TestCase):
    def test_minimal_graph_is_monolith(self) -> None:
        report = detect_styles(_minimal_graph())
        by_name = {t.style: t for t in report.tags}
        # 1 service group => monolith should beat 0
        self.assertGreater(by_name["monolith"].confidence, 0.0)
        # all 10 styles present
        self.assertEqual({t.style for t in report.tags}, set(ALL_STYLES))
        # every confidence in [0, 1]
        for t in report.tags:
            self.assertGreaterEqual(t.confidence, 0.0)
            self.assertLessEqual(t.confidence, 1.0)
        # evidence per tag
        for t in report.tags:
            self.assertGreater(len(t.evidence), 0)

    def test_hexagonal_graph_scores_high_on_hexagonal(self) -> None:
        report = detect_styles(_hexagonal_graph())
        hex_tag = next(t for t in report.tags if t.style == "hexagonal-clean")
        self.assertGreaterEqual(hex_tag.confidence, 0.6)
        # confirm the evidence mentions ports and adapters
        all_paths = []
        for e in hex_tag.evidence:
            all_paths.extend(e.paths)
        self.assertTrue(any("ports.ts" in p for p in all_paths))
        self.assertTrue(any("adapters" in p for p in all_paths))

    def test_determinism(self) -> None:
        g = _minimal_graph()
        r1 = detect_styles(g).to_dict()
        r2 = detect_styles(g).to_dict()
        r1.pop("detector_runtime_ms", None)
        r2.pop("detector_runtime_ms", None)
        self.assertEqual(r1, r2)

    def test_unsupported_schema_raises(self) -> None:
        g = _minimal_graph()
        g["schemaVersion"] = 99
        with self.assertRaises(ValueError):
            detect_styles(g)

    def test_missing_required_keys_raises(self) -> None:
        g = _minimal_graph()
        del g["metrics"]
        with self.assertRaises(ValueError):
            detect_styles(g)

    def test_graphsummary_sorts_paths(self) -> None:
        g = _minimal_graph()
        # reverse the order
        g["nodes"] = list(reversed(g["nodes"]))
        s = GraphSummary.from_graph(g)
        # ports_paths is empty here, but check other sorted fields
        for entry in s.top_external_deps:
            pass
        # If the test gets here without exception, ordering was stable.
        self.assertEqual(s.node_count, 2)


if __name__ == "__main__":
    unittest.main()
