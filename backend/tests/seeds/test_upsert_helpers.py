"""Tests for pure helpers — build_upsert_sql, chunk_rows, flatten_row."""

from __future__ import annotations

import pytest

from backend.seeds.framework.upsert_helpers import (
    build_upsert_sql,
    chunk_rows,
    flatten_row,
)


def test_build_upsert_sql_basic() -> None:
    sql, params = build_upsert_sql("standards", ["name", "content", "version"], ["name"])
    assert "INSERT INTO standards" in sql
    assert "(name, content, version)" in sql
    assert "VALUES (:name, :content, :version)" in sql
    assert "ON CONFLICT (name)" in sql
    assert "DO UPDATE SET content = EXCLUDED.content, version = EXCLUDED.version" in sql
    assert params == {}


def test_build_upsert_sql_composite_key() -> None:
    sql, _ = build_upsert_sql("templates", ["type", "name", "content"], ["type", "name"])
    assert "ON CONFLICT (type, name)" in sql
    assert "DO UPDATE SET content = EXCLUDED.content" in sql


def test_build_upsert_sql_rejects_empty_columns() -> None:
    with pytest.raises(ValueError):
        build_upsert_sql("standards", [], ["name"])


def test_build_upsert_sql_rejects_empty_key() -> None:
    with pytest.raises(ValueError):
        build_upsert_sql("standards", ["name"], [])


def test_build_upsert_sql_rejects_key_not_in_columns() -> None:
    with pytest.raises(ValueError):
        build_upsert_sql("standards", ["name"], ["name", "missing"])


def test_build_upsert_sql_rejects_bad_table_name() -> None:
    with pytest.raises(ValueError):
        build_upsert_sql("DROP TABLE standards;--", ["name"], ["name"])


def test_build_upsert_sql_pure_key_only() -> None:
    """When columns == natural_key, the SET clause must still be non-empty."""
    sql, _ = build_upsert_sql("standards", ["name"], ["name"])
    assert "DO UPDATE SET name = EXCLUDED.name" in sql


def test_chunk_rows_default() -> None:
    rows = [{"i": i} for i in range(450)]
    chunks = chunk_rows(rows)
    assert len(chunks) == 3
    assert len(chunks[0]) == 200
    assert len(chunks[1]) == 200
    assert len(chunks[2]) == 50


def test_chunk_rows_small_input() -> None:
    rows = [{"i": i} for i in range(5)]
    chunks = chunk_rows(rows)
    assert chunks == [[{"i": 0}, {"i": 1}, {"i": 2}, {"i": 3}, {"i": 4}]]


def test_chunk_rows_empty() -> None:
    assert chunk_rows([]) == []


def test_chunk_rows_rejects_zero_batch() -> None:
    with pytest.raises(ValueError):
        chunk_rows([{"a": 1}], batch_size=0)


def test_flatten_row_id_ref_convention() -> None:
    row = {"tenant_id_ref": "acme-corp", "name": "Tech Lead"}
    out = flatten_row(row, parent_keys=["slug"])
    # Convention: <entity>_id_ref → <entity>_id (strip _ref suffix).
    assert out == {"tenant_id": "acme-corp", "name": "Tech Lead"}


def test_flatten_row_preserves_other_keys() -> None:
    row = {
        "tenant_id_ref": "abc",
        "project_id_ref": "def",
        "content": "x",
    }
    out = flatten_row(row, parent_keys=[])
    # Each _id_ref stays in <entity>_id form.
    assert out == {"tenant_id": "abc", "project_id": "def", "content": "x"}


def test_flatten_row_passthrough_non_refs() -> None:
    row = {"name": "KFG-STD-001", "version": 1}
    out = flatten_row(row, parent_keys=["name"])
    assert out == {"name": "KFG-STD-001", "version": 1}


def test_flatten_row_rejects_non_dict() -> None:
    with pytest.raises(TypeError):
        flatten_row(["not", "a", "dict"], parent_keys=[])  # type: ignore[arg-type]
