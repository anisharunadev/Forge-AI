"""Tests for the JSON Schema 2020-12 manifest validator."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.seeds.framework.exceptions import InvalidManifestError
from backend.seeds.framework.seed_runner import SeedRunner

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "seeds" / "framework" / "manifest_schema.json"


def _valid_manifest() -> dict:
    return {
        "name": "kn-base",
        "version": 1,
        "tenant_type": "reference",
        "description": "KnackForge baseline reference seed.",
        "data_files": [
            {
                "file": "001_standards.json",
                "table": "standards",
                "order": 1,
                "idempotency_key": ["name"],
                "description": "KFG baseline standards.",
            },
            {
                "file": "002_templates.json",
                "table": "templates",
                "order": 2,
                "idempotency_key": ["type", "name"],
                "depends_on_files": ["001_standards.json"],
            },
        ],
        "row_counts_expected": {"standards": 4, "templates": 3},
        "production_safety": {"allow_in_prod": False},
    }


def _runner_with_tmp_seeds(tmp_path: Path) -> SeedRunner:
    """Construct a SeedRunner with an empty seeds root.

    Uses mocks because the runner's ``_validate_manifest`` doesn't
    touch the DB.
    """
    from unittest.mock import MagicMock

    mock_factory = MagicMock()
    mock_audit = MagicMock()
    return SeedRunner(
        session_factory=mock_factory,
        audit_service=mock_audit,
        env="test",
        seeds_root=tmp_path,
        schema_path=SCHEMA_PATH,
    )


def test_schema_path_exists() -> None:
    assert SCHEMA_PATH.exists(), "manifest_schema.json must be checked in"


def test_valid_manifest_passes() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    runner._validate_manifest(_valid_manifest())  # noqa: SLF001 — unit test


def test_rejects_missing_data_files() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    m = _valid_manifest()
    del m["data_files"]
    with pytest.raises(InvalidManifestError):
        runner._validate_manifest(m)  # noqa: SLF001


def test_rejects_empty_data_files() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    m = _valid_manifest()
    m["data_files"] = []
    with pytest.raises(InvalidManifestError):
        runner._validate_manifest(m)  # noqa: SLF001


def test_rejects_bad_name_pattern() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    m = _valid_manifest()
    m["name"] = "Kn-Base"  # uppercase not allowed
    with pytest.raises(InvalidManifestError):
        runner._validate_manifest(m)  # noqa: SLF001


def test_rejects_bad_tenant_type() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    m = _valid_manifest()
    m["tenant_type"] = "staging"  # not in enum
    with pytest.raises(InvalidManifestError):
        runner._validate_manifest(m)  # noqa: SLF001


def test_rejects_non_monotonic_version() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    m = _valid_manifest()
    m["version"] = 0
    with pytest.raises(InvalidManifestError):
        runner._validate_manifest(m)  # noqa: SLF001


def test_rejects_bad_file_pattern() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    m = _valid_manifest()
    m["data_files"][0]["file"] = "standards.json"  # missing NN_ prefix
    with pytest.raises(InvalidManifestError):
        runner._validate_manifest(m)  # noqa: SLF001


def test_rejects_unknown_top_level_property() -> None:
    runner = _runner_with_tmp_seeds(Path("/tmp"))
    m = _valid_manifest()
    m["mystery_key"] = "nope"
    with pytest.raises(InvalidManifestError):
        runner._validate_manifest(m)  # noqa: SLF001


def test_schema_is_draft_202012() -> None:
    payload = json.loads(SCHEMA_PATH.read_text())
    assert payload["$schema"].endswith("draft/2020-12/schema")
    assert payload["type"] == "object"
    assert "data_files" in payload["required"]
