"""Tests for the audit system.  Each test prints OK or FAIL with a
list of failure messages and writes a JSON evidence file to
`agents/audit/evidence/`."""

from . import test_emit, test_chain, test_retention, test_read_api

__all__ = ["test_emit", "test_chain", "test_retention", "test_read_api"]
