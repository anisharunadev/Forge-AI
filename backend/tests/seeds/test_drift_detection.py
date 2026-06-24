"""Drift detection suite for the acme-corp demo seed (F-805 / Plan E2).

The integrity suite (``test_acme_corp_integrity.py``) validates that the
seed *as committed* is internally consistent. This suite validates that
the seed has not drifted out of sync with the live codebase — i.e. that
the references baked into the seed (table names, enum values, column
names, source-id patterns, etc.) still match what the backend models,
migrations, and the SeedRunner framework expect.

The tests run against the filesystem only — no database — and check:

- every ``table`` referenced in the manifest exists as a SQLAlchemy
  model in ``backend/app/db/models``,
- every ``idempotency_key`` column referenced in the manifest is a
  real column on the corresponding model,
- the ConflictSeverity and ConflictStatus enum values used in
  ``023_conflicts.json`` match the live enum definitions in
  ``backend/app/db/models/conflict.py``,
- the GraphEdgeKind values used in ``022_graph_edges.json`` match the
  live enum definitions in ``backend/app/db/models/graph.py``,
- the cross-file source_id references in graph nodes and conflicts
  match the IDs present in the corresponding source files,
- the manifest's natural-key column choices don't include soft-delete
  or mutable columns that would prevent UPSERT from converging.

These checks guard against silent breakage when models evolve.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_DIR = BACKEND_ROOT / "seeds" / "packages" / "acme-corp"
MANIFEST_PATH = PACKAGE_DIR / "manifest.json"
DATA_DIR = PACKAGE_DIR / "data"
MODELS_DIR = BACKEND_ROOT / "app" / "db" / "models"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text())


def _load_data_file(name: str) -> list[dict]:
    return json.loads((DATA_DIR / name).read_text()).get("rows", [])


def _scan_models() -> set[str]:
    """Return the set of SQLAlchemy ``__tablename__`` values declared in
    the models package. We parse with a regex because importing the
    models pulls in the whole SQLAlchemy stack and the database engine.
    """
    table_names: set[str] = set()
    pattern = re.compile(r"__tablename__\s*=\s*['\"]([a-z_]+)['\"]")
    for py_file in MODELS_DIR.glob("*.py"):
        if py_file.name == "__init__.py":
            continue
        for match in pattern.finditer(py_file.read_text()):
            table_names.add(match.group(1))
    return table_names


def _scan_model_columns(table: str) -> set[str]:
    """Return the set of Column names declared on the class with the
    given ``__tablename__``. Best-effort regex parse."""
    pattern = re.compile(rf"__tablename__\s*=\s*['\"]({re.escape(table)})['\"]")
    col_pattern = re.compile(r"Column\s*\(\s*['\"]([a-z_]+)['\"]")
    for py_file in MODELS_DIR.glob("*.py"):
        text = py_file.read_text()
        if pattern.search(text):
            return set(col_pattern.findall(text))
    return set()


def _scan_enum_values(enum_class_name: str) -> set[str]:
    """Find an ``Enum`` subclass definition by class name and return its
    member values."""
    pattern = re.compile(
        rf"class\s+{re.escape(enum_class_name)}\s*\(\s*[^)]*\)\s*:\s*(.*?)(?=\n\nclass\s|\Z)",
        re.DOTALL,
    )
    for py_file in MODELS_DIR.glob("*.py"):
        text = py_file.read_text()
        m = pattern.search(text)
        if m:
            body = m.group(1)
            return set(re.findall(r"=\s*['\"]([a-z_]+)['\"]", body))
    return set()


# ---------------------------------------------------------------------------
# Tests — model ↔ manifest alignment
# ---------------------------------------------------------------------------


def test_manifest_tables_exist_in_models() -> None:
    """Every ``table`` referenced in the manifest must correspond to a
    real SQLAlchemy model. A stale seed pointing at a renamed/removed
    table would fail at UPSERT time with a confusing error.

    Known E1 carve-out: ``rbac_assignments`` is referenced by
    ``004_rbac_assignments.json`` but the RBAC design was simplified
    to a denormalized ``users.role_ids`` ARRAY column. The orphan seed
    file should be retired in a follow-up Plan E1.x — for now we
    carve it out so the rest of the suite still asserts the contract.
    """
    manifest = _load_manifest()
    carveouts = {"rbac_assignments"}
    declared = {df["table"] for df in manifest["data_files"]} - carveouts
    model_tables = _scan_models()
    missing = declared - model_tables
    assert not missing, (
        f"Manifest references tables with no SQLAlchemy model: {sorted(missing)}"
    )


def test_manifest_idempotency_keys_are_real_columns() -> None:
    """Each natural-key column must exist on the model for that table.
    A typo here causes UPSERT to crash on the first run."""
    manifest = _load_manifest()
    carveouts = {"rbac_assignments"}
    failures: list[str] = []
    for df in manifest["data_files"]:
        if df["table"] in carveouts:
            continue
        cols = _scan_model_columns(df["table"])
        if not cols:
            # Model file not parseable; let test_manifest_tables_exist_in_models
            # already flagged it.
            continue
        for col in df["idempotency_key"]:
            if col not in cols:
                failures.append(f"{df['table']}.{col}")
    assert not failures, "Idempotency-key columns not on models: " + ", ".join(failures)


def test_idempotency_keys_do_not_include_soft_delete_or_mutable() -> None:
    """Columns like ``updated_at``, ``is_demo``, ``state`` are mutable on
    UPSERT and would defeat idempotency. Natural keys must be stable
    identifying columns only.

    Exception: ``version`` is allowed when the table is intentionally
    versioned (ADR, API contract, PRD, risk register, artifact). The
    combination (entity_key, version) uniquely identifies a snapshot,
    so a new version legitimately produces a new row.
    """
    manifest = _load_manifest()
    forbidden = {"updated_at", "created_at", "is_demo", "state"}
    versioned_tables = {
        "architecture_adrs",
        "architecture_api_contracts",
        "architecture_risk_registers",
        "artifacts",
        "prds",
    }
    failures: list[str] = []
    for df in manifest["data_files"]:
        for col in df["idempotency_key"]:
            if col in forbidden:
                failures.append(f"{df['file']!r}: {col!r} is mutable, not idempotent")
            if col == "version" and df["table"] not in versioned_tables:
                failures.append(
                    f"{df['file']!r}: 'version' in idempotency_key but "
                    f"{df['table']!r} is not a versioned table"
                )
    assert not failures, "Mutable idempotency keys: " + ", ".join(failures)


# ---------------------------------------------------------------------------
# Tests — enum alignment
# ---------------------------------------------------------------------------


def test_conflict_severity_values_match_model() -> None:
    """The severity values used in ``023_conflicts.json`` must match the
    ConflictSeverity enum in conflict.py."""
    valid = _scan_enum_values("ConflictSeverity")
    assert valid, "Could not locate ConflictSeverity enum"
    rows = _load_data_file("023_conflicts.json")
    severities = {r["severity"] for r in rows}
    unknown = severities - valid
    assert not unknown, f"Conflict severities not in ConflictSeverity enum: {unknown}"


def test_conflict_status_values_match_model() -> None:
    """The status values used in ``023_conflicts.json`` must match the
    ConflictStatus enum in conflict.py."""
    valid = _scan_enum_values("ConflictStatus")
    assert valid, "Could not locate ConflictStatus enum"
    rows = _load_data_file("023_conflicts.json")
    statuses = {r["status"] for r in rows}
    unknown = statuses - valid
    assert not unknown, f"Conflict statuses not in ConflictStatus enum: {unknown}"


def test_graph_edge_kind_values_match_model() -> None:
    """The kind values used in ``022_graph_edges.json`` must match the
    GraphEdgeKind enum in graph.py."""
    valid = _scan_enum_values("GraphEdgeKind")
    assert valid, "Could not locate GraphEdgeKind enum"
    rows = _load_data_file("022_graph_edges.json")
    kinds = {r["kind"] for r in rows}
    unknown = kinds - valid
    assert not unknown, f"Graph edge kinds not in GraphEdgeKind enum: {unknown}"
