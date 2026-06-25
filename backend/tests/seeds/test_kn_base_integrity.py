"""Integrity suite for the kn-base reference seed (F-821 / Plan D).

The tests run against the filesystem only — no database — and validate:

- manifest.json conforms to the JSON Schema 2020-12 contract,
- every file declared in the manifest exists on disk,
- every row carries the columns in its natural key,
- row counts match the manifest's ``row_counts_expected``,
- natural keys are unique within each file,
- re-loading the same data produces an idempotent result set,
- enums (status, severity, tier) are within the allowed value set.

The DB-driven UPSERT path is covered by ``test_seed_runner.py``; this
suite focuses on the static invariants the runner assumes are true.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_DIR = BACKEND_ROOT / "seeds" / "packages" / "kn-base"
MANIFEST_PATH = PACKAGE_DIR / "manifest.json"
DATA_DIR = PACKAGE_DIR / "data"
SCHEMA_PATH = BACKEND_ROOT / "seeds" / "framework" / "manifest_schema.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text())


def _load_data_file(name: str) -> list[dict]:
    return json.loads((DATA_DIR / name).read_text()).get("rows", [])


# ---------------------------------------------------------------------------
# Tests — manifest contract
# ---------------------------------------------------------------------------


def test_manifest_validates_against_schema() -> None:
    manifest = _load_manifest()
    schema = json.loads(SCHEMA_PATH.read_text())
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(manifest), key=lambda e: e.path)
    assert not errors, (
        f"kn-base manifest failed schema validation: "
        + "; ".join(f"{'/'.join(map(str, e.path))}: {e.message}" for e in errors)
    )


def test_manifest_name_matches_directory() -> None:
    """The seed slug must equal the directory name."""
    assert _load_manifest()["name"] == PACKAGE_DIR.name == "kn-base"


def test_manifest_is_reference_and_production_safe() -> None:
    m = _load_manifest()
    assert m["tenant_type"] == "reference"
    assert m["production_safety"]["allow_in_prod"] is True


def test_all_data_files_exist() -> None:
    manifest = _load_manifest()
    for df in manifest["data_files"]:
        path = DATA_DIR / df["file"]
        assert path.exists(), f"Manifest references missing data file: {df['file']!r}"


def test_data_files_sorted_by_order() -> None:
    manifest = _load_manifest()
    orders = [df["order"] for df in manifest["data_files"]]
    assert orders == sorted(orders), "data_files must be ordered ascending"


def test_data_files_have_unique_orders() -> None:
    manifest = _load_manifest()
    orders = [df["order"] for df in manifest["data_files"]]
    assert len(orders) == len(set(orders)), "data_files orders must be unique"


# ---------------------------------------------------------------------------
# Tests — natural keys and row counts
# ---------------------------------------------------------------------------


def test_all_rows_have_natural_key() -> None:
    manifest = _load_manifest()
    for df in manifest["data_files"]:
        rows = _load_data_file(df["file"])
        for i, row in enumerate(rows):
            for col in df["idempotency_key"]:
                assert col in row, (
                    f"Row {i} of {df['file']!r} missing natural-key column {col!r}"
                )
                assert row[col] is not None, (
                    f"Row {i} of {df['file']!r} has null natural-key column {col!r}"
                )


def test_row_counts_match_expected() -> None:
    manifest = _load_manifest()
    expected = manifest.get("row_counts_expected", {})
    for table, n in expected.items():
        # Find the data file that targets this table.
        df = next((d for d in manifest["data_files"] if d["table"] == table), None)
        assert df is not None, f"row_counts_expected references unknown table {table!r}"
        rows = _load_data_file(df["file"])
        assert len(rows) == n, (
            f"Table {table!r}: expected {n} rows, found {len(rows)} in {df['file']!r}"
        )


def test_total_row_count_matches_sum() -> None:
    manifest = _load_manifest()
    total = sum(manifest["row_counts_expected"].values())
    assert total == 23, f"kn-base expected 23 rows total, got {total}"


def test_no_duplicate_natural_keys_within_file() -> None:
    manifest = _load_manifest()
    for df in manifest["data_files"]:
        rows = _load_data_file(df["file"])
        seen: set[tuple] = set()
        for i, row in enumerate(rows):
            key = tuple(row.get(c) for c in df["idempotency_key"])
            assert key not in seen, (
                f"Duplicate natural key {key!r} in {df['file']!r} at row {i}"
            )
            seen.add(key)


# ---------------------------------------------------------------------------
# Tests — re-apply idempotency at the data-file level
# ---------------------------------------------------------------------------


def test_idempotent_re_apply() -> None:
    """Loading the same data file twice yields the same set of natural keys.

    This is the filesystem-level analogue of the UPSERT idempotency that
    the runner guarantees at the DB level. The set of natural keys
    after N applies must equal the set after 1 apply.
    """
    manifest = _load_manifest()
    for df in manifest["data_files"]:
        first = _load_data_file(df["file"])
        # Re-read from disk — represents a second apply that produced the
        # same UPSERT result set.
        second = _load_data_file(df["file"])
        keys_first = {tuple(r.get(c) for c in df["idempotency_key"]) for r in first}
        keys_second = {tuple(r.get(c) for c in df["idempotency_key"]) for r in second}
        assert keys_first == keys_second, (
            f"Natural keys diverge between two loads of {df['file']!r}"
        )
        # Idempotency: the multiset of natural keys is also stable.
        assert len(keys_first) == len(first), (
            f"{df['file']!r}: duplicate natural keys within a single load"
        )


# ---------------------------------------------------------------------------
# Tests — per-table invariants
# ---------------------------------------------------------------------------


_STANDARD_STATUSES = {"draft", "published", "deprecated", "active", "archived"}


def test_standards_have_unique_names() -> None:
    rows = _load_data_file("001_standards.json")
    names = [r["name"] for r in rows]
    assert len(names) == 8, f"expected 8 standards, found {len(names)}"
    assert len(names) == len(set(names)), (
        f"duplicate standard names: {[n for n in names if names.count(n) > 1]}"
    )


def test_standards_have_valid_status() -> None:
    rows = _load_data_file("001_standards.json")
    for r in rows:
        assert r["status"] in _STANDARD_STATUSES, (
            f"Standard {r['name']!r} has invalid status {r['status']!r}"
        )


def test_standards_have_non_empty_content() -> None:
    rows = _load_data_file("001_standards.json")
    for r in rows:
        assert isinstance(r["content"], str), (
            f"Standard {r['name']!r} content must be a string"
        )
        assert r["content"].strip(), (
            f"Standard {r['name']!r} content must not be empty"
        )


def test_templates_have_unique_type_name_version() -> None:
    rows = _load_data_file("002_templates.json")
    keys = [(r["type"], r["name"], r["version"]) for r in rows]
    assert len(keys) == 5, f"expected 5 templates, found {len(keys)}"
    assert len(keys) == len(set(keys)), "duplicate (type, name, version) tuples"


def test_templates_have_content_and_variables() -> None:
    rows = _load_data_file("002_templates.json")
    for r in rows:
        assert isinstance(r["content"], dict), (
            f"Template {r['name']!r} content must be a JSON object"
        )
        assert isinstance(r["variables"], list), (
            f"Template {r['name']!r} variables must be a list"
        )


_POLICY_SEVERITIES = {"info", "warn", "block"}


def test_policies_have_valid_severity() -> None:
    rows = _load_data_file("003_policies.json")
    assert len(rows) == 4, f"expected 4 policies, found {len(rows)}"
    for r in rows:
        assert r["severity"] in _POLICY_SEVERITIES, (
            f"Policy {r['name']!r} severity {r['severity']!r} not in {sorted(_POLICY_SEVERITIES)}"
        )


def test_policies_have_unique_names() -> None:
    rows = _load_data_file("003_policies.json")
    names = [r["name"] for r in rows]
    assert len(names) == len(set(names)), (
        f"duplicate policy names: {[n for n in names if names.count(n) > 1]}"
    )


def test_policies_have_expression_and_enabled() -> None:
    rows = _load_data_file("003_policies.json")
    for r in rows:
        assert isinstance(r["expression"], dict), (
            f"Policy {r['name']!r} expression must be a JSONLogic object"
        )
        assert "enabled" in r, f"Policy {r['name']!r} missing enabled flag"


_BUNDLE_TIERS = {"read_only", "propose", "write", "execute", "gated"}


def test_tool_bundles_have_valid_tier() -> None:
    rows = _load_data_file("004_tool_bundles.json")
    assert len(rows) == 6, f"expected 6 tool bundles, found {len(rows)}"
    for r in rows:
        assert r["tier"] in _BUNDLE_TIERS, (
            f"Bundle {r['bundle_key']!r} tier {r['tier']!r} not in {sorted(_BUNDLE_TIERS)}"
        )


def test_tool_bundles_have_unique_keys() -> None:
    rows = _load_data_file("004_tool_bundles.json")
    keys = [r["bundle_key"] for r in rows]
    assert len(keys) == len(set(keys)), (
        f"duplicate bundle_keys: {[k for k in keys if keys.count(k) > 1]}"
    )


def test_tool_bundles_have_tools_list() -> None:
    rows = _load_data_file("004_tool_bundles.json")
    for r in rows:
        assert isinstance(r["tools"], list), (
            f"Bundle {r['bundle_key']!r} tools must be a list"
        )
        assert r["tools"], f"Bundle {r['bundle_key']!r} tools must not be empty"
        for t in r["tools"]:
            assert "name" in t, f"Tool entry in {r['bundle_key']!r} missing name"
            assert "args" in t, f"Tool entry in {r['bundle_key']!r} missing args"


# ---------------------------------------------------------------------------
# Tests — required bundle roster (regression guard)
# ---------------------------------------------------------------------------


_REQUIRED_BUNDLES = {
    "architecture-readonly",
    "development-write",
    "security-scan",
    "deployment-prod-gated",
    "ideation-propose",
    "refactor-execute",
}


def test_required_tool_bundles_present() -> None:
    """The 6 bundles the day-one bootstrap expects MUST be present."""
    rows = _load_data_file("004_tool_bundles.json")
    actual = {r["bundle_key"] for r in rows}
    missing = _REQUIRED_BUNDLES - actual
    assert not missing, f"Missing required bundles: {sorted(missing)}"


def test_deployment_bundle_is_gated_and_requires_approval() -> None:
    """The production deployment bundle MUST be gated (Forge Rule 3)."""
    rows = _load_data_file("004_tool_bundles.json")
    bundle = next(r for r in rows if r["bundle_key"] == "deployment-prod-gated")
    assert bundle["tier"] == "gated"
    assert bundle["requires_approval"] is True
