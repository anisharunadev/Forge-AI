"""Tests for the widened steering glob + KnackForge steering files (Phase 3).

Verifies:
- After glob widening, ``steering/knackforge/coding-standards.md`` indexes.
- ``steering/personas/developer.md`` is also indexed.
- Front-matter parses cleanly (rule_id, scope, applies_to_stages).
"""

from __future__ import annotations

from pathlib import Path

from app.services.steering_rules import (
    DEFAULT_PATTERNS,
    SteeringEngine,
    parse_front_matter,
)


def test_default_patterns_widened():
    """Both the original and recursive patterns are present after Phase 3."""
    assert "**/steering/*.md" in DEFAULT_PATTERNS
    assert "**/steering/**/*.md" in DEFAULT_PATTERNS


def test_front_matter_parses_knackforge_file():
    """The KnackForge coding-standards file has well-formed front-matter."""
    repo_root = Path(__file__).resolve().parents[2]
    path = repo_root / "steering" / "knackforge" / "coding-standards.md"
    assert path.exists(), f"missing {path}"
    text = path.read_text(encoding="utf-8")
    meta, body = parse_front_matter(text)
    assert meta["rule_id"] == "knackforge-coding-standards"
    assert meta["scope"] == "project"
    assert "pre_code" in meta["applies_to_stages"]
    assert "ADR-001" in body


def test_front_matter_parses_persona_file():
    repo_root = Path(__file__).resolve().parents[2]
    path = repo_root / "steering" / "personas" / "developer.md"
    assert path.exists(), f"missing {path}"
    text = path.read_text(encoding="utf-8")
    meta, body = parse_front_matter(text)
    assert meta["rule_id"] == "persona-developer"
    assert meta["scope"] == "project"
    assert "pre_code" in meta["applies_to_stages"]


def test_engine_discovers_knackforge_files():
    """End-to-end discovery: engine picks up the new steering tree."""
    repo_root = Path(__file__).resolve().parents[2]
    engine = SteeringEngine()
    files = engine.discover_files(repo_root)
    rels = {f.relative_to(repo_root).as_posix() for f in files}
    assert "steering/knackforge/coding-standards.md" in rels
    assert "steering/personas/developer.md" in rels
