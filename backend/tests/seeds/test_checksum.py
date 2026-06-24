"""Tests for the deterministic checksum helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.seeds.framework.checksum import (
    compute_checksum,
    compute_row_count_checksum,
)


def test_compute_checksum_is_deterministic(tmp_path: Path) -> None:
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text('{"rows": []}')
    b.write_text('{"rows": [{"name": "x"}]}')
    # Order-insensitive — sorted by filename before concatenation.
    assert compute_checksum([b, a]) == compute_checksum([a, b])


def test_compute_checksum_changes_on_content_change(tmp_path: Path) -> None:
    a = tmp_path / "a.json"
    a.write_text('{"rows": []}')
    checksum_v1 = compute_checksum([a])
    a.write_text('{"rows": [{"name": "x"}]}')
    checksum_v2 = compute_checksum([a])
    assert checksum_v1 != checksum_v2


def test_compute_checksum_raises_on_missing(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        compute_checksum([tmp_path / "missing.json"])


def test_compute_checksum_empty(tmp_path: Path) -> None:
    """No files → sha256 of empty input (well-defined)."""
    assert compute_checksum([]) == (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_compute_checksum_returns_64_hex(tmp_path: Path) -> None:
    p = tmp_path / "x.json"
    p.write_text('{"rows": []}')
    checksum = compute_checksum([p])
    assert len(checksum) == 64
    assert all(c in "0123456789abcdef" for c in checksum)


def test_compute_row_count_checksum_is_deterministic() -> None:
    a = {"standards": 4, "templates": 3}
    b = {"templates": 3, "standards": 4}  # key order swapped
    assert compute_row_count_checksum(a) == compute_row_count_checksum(b)


def test_compute_row_count_checksum_changes_on_value_change() -> None:
    a = {"standards": 4}
    b = {"standards": 5}
    assert compute_row_count_checksum(a) != compute_row_count_checksum(b)


def test_compute_row_count_checksum_empty() -> None:
    # sha256 of "{}" (the empty-dict JSON).
    assert compute_row_count_checksum({}) == (
        "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
    )


def test_compute_row_count_checksum_stable_under_reserialization() -> None:
    """Sanity: serialize → re-parse → checksum unchanged."""
    payload = {"a": 1, "b": [1, 2, 3], "c": {"nested": "yes"}}
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    reparsed = json.loads(serialized)
    assert compute_row_count_checksum(payload) == compute_row_count_checksum(reparsed)