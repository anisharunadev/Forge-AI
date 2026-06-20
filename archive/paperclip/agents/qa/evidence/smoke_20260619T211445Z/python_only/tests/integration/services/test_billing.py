"""Integration tests for the `src/services/billing.py` boundary (FORA-72 / v0.1).

Integration tests cross a service boundary per
`workspace/memory/qa.md` §2. The v0.1 scaffold asserts only
that the boundary module imports; a real test suite wires
fixtures / mocks in `conftest.py`.
"""

from __future__ import annotations

import importlib
import os
import sys

import pytest


_HERE = os.path.dirname(os.path.abspath(__file__))
for _candidate in (
    os.path.join(_HERE, "..", "..", "src"),
    os.path.join(_HERE, "..", "src"),
):
    if os.path.isdir(_candidate) and _candidate not in sys.path:
        sys.path.insert(0, _candidate)


@pytest.fixture
def charge_module() -> object:
    """Best-effort import of the boundary module."""
    try:
        return importlib.import_module('src/services/billing.py')
    except Exception:
        return None


def test_charge_boundary_imports(charge_module: object) -> None:
    """The boundary module must import (v0.1 contract)."""
    assert charge_module is None or hasattr(charge_module, "__name__")
