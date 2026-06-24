"""Deterministic checksums for seed drift detection.

Two flavors:

- :func:`compute_checksum` — sha256 of concatenated data-file bytes
  (sorted by filename). The seed's "what changed" fingerprint.
- :func:`compute_row_count_checksum` — sha256 of sorted JSON for the
  manifest's ``row_counts_expected``. Anchors the expected state so a
  later drift detector can compare.

Both functions are pure: no DB, no I/O beyond reading the supplied paths.
The runner calls them after a successful apply and stores the result on
the ``SeedRun.checksum_after`` column. The Playwright nightly drift
detector compares ``checksum_after`` to a freshly-computed checksum.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


def compute_checksum(data_files: list[Path]) -> str:
    """sha256 of concatenated file bytes, sorted by filename.

    ``data_files`` may be ``Path`` objects or strings; missing files
    raise ``FileNotFoundError`` so a typo is caught loudly.
    """
    resolved = [Path(p) for p in data_files]
    sorted_paths = sorted(resolved, key=lambda p: str(p))
    digest = hashlib.sha256()
    for p in sorted_paths:
        if not p.exists():
            raise FileNotFoundError(f"compute_checksum: data file missing: {p}")
        digest.update(p.read_bytes())
    return digest.hexdigest()


def compute_row_count_checksum(row_counts: dict[str, int]) -> str:
    """sha256 of sorted-JSON serialization of expected row counts.

    Sorting the keys before hashing makes the checksum stable across
    Python versions and platforms (Python 3.13 sorts dicts but the
    order of dict insertion is preserved across runs; we sort anyway
    so a re-shuffled manifest produces the same checksum).
    """
    payload = json.dumps(row_counts, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


__all__ = [
    "compute_checksum",
    "compute_row_count_checksum",
]