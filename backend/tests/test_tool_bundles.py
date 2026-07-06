"""F-505 per-agent ToolBundlesRegistry — pytest coverage (plan 01-06 Task 3).

Verifies the per-agent bundle registry (plan 01-06, distinct from the
stage-keyed ``ToolBundleRegistry`` in :mod:`app.services.tool_bundles`)
keeps the least-privilege invariant: default deny, exact-match on the
allowed_tools list.
"""

from __future__ import annotations

from app.services.tool_bundles import default_registry, is_tool_allowed


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_code_validator_bundle_allows_read_file():
    """code_validator can read files."""
    assert is_tool_allowed("code_validator", "read_file") is True


def test_code_validator_bundle_denies_write_file():
    """code_validator cannot write files (read-only scanner bundle)."""
    assert is_tool_allowed("code_validator", "write_file") is False


def test_unknown_agent_denies_by_default():
    """Unknown agent → default_allow=False → no tools."""
    assert is_tool_allowed("unknown_agent", "read_file") is False
    assert default_registry.default_allow is False


def test_refactor_agent_allows_write_file():
    """refactor_agent is in the write-permitted bundle."""
    assert is_tool_allowed("refactor_agent", "write_file") is True


def test_sdlc_agent_has_broadest_bundle():
    """sdlc_agent can write to the KG (broadest bundle per locked decision)."""
    assert is_tool_allowed("sdlc_agent", "kg_write") is True