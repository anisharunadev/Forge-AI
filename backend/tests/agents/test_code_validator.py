"""Tests for the F-501 Code Validator sub-graph.

Six unit tests, matching the ticket contract:

1. Empty scan returns PASS.
2. High-severity finding returns FAIL.
3. Scanner fan-out executes all 4 scanners in parallel (mock).
4. State isolation: CodeValidatorState does not import SDLCState.
5. Prompt template loads correctly.
6. Independence: code_validator cannot import from sdlc_agent
   (asserted at module-load time).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ensure_pythonpath() -> None:
    """Make sure ``backend`` is on sys.path so absolute imports resolve.

    The repository root contains both ``app/`` and ``backend/``; tests
    inside ``backend/tests`` reach modules via ``backend.app.*``. When
    pytest is invoked from elsewhere (e.g. the repo root), we add the
    backend directory to ``sys.path`` at module import time.
    """
    backend_dir = str(Path(__file__).resolve().parents[2])
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    repo_root = str(Path(__file__).resolve().parents[2])
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)


_ensure_pythonpath()


def _state(**overrides: Any):
    """Build a minimal CodeValidatorState for tests."""
    from app.agents.code_validator_state import (
        CodeValidatorState,
        ScanTarget,
    )

    defaults: dict[str, Any] = {
        "tenant_id": uuid.uuid4(),
        "project_id": uuid.uuid4(),
        "actor_id": uuid.uuid4(),
        "target": ScanTarget(repo_id="test-repo", commit_sha="deadbeef"),
    }
    defaults.update(overrides)
    return CodeValidatorState(**defaults)


def _finding(severity: str, **kwargs: Any):
    from app.agents.code_validator_state import (
        Severity,
        ValidationFinding,
    )

    return ValidationFinding(
        finding_id=kwargs.pop("finding_id", f"f-{uuid.uuid4()}"),
        severity=Severity(severity),
        file_path=kwargs.pop("file_path", "src/example.py"),
        line=kwargs.pop("line", 1),
        rule_id=kwargs.pop("rule_id", "TEST001"),
        evidence=kwargs.pop("evidence", "redacted"),
        recommended_fix=kwargs.pop("recommended_fix", "fix it"),
        standards_ref=kwargs.pop("standards_ref", "CWE-000"),
        scanner=kwargs.pop("scanner", "test"),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# 1. Empty scan returns PASS
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_scan_returns_pass():
    from app.agents.code_validator_state import ValidationReport
    from app.agents.code_validator_nodes.aggregate_findings import (
        aggregate_findings,
    )

    state = _state()
    result = await aggregate_findings(state)
    report: ValidationReport = result["report"]
    assert report.decision == "PASS"
    assert report.findings == []
    assert report.summary.total_findings == 0
    assert report.summary.by_severity == {}
    assert report.summary.by_scanner == {}
    assert report.summary.highest_severity is None


# ---------------------------------------------------------------------------
# 2. High-severity finding returns FAIL
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_high_severity_finding_returns_fail():
    from app.agents.code_validator_nodes.aggregate_findings import (
        aggregate_findings,
    )

    state = _state(
        vulns_partial=[
            _finding(
                "high",
                file_path="app/auth.py",
                line=42,
                rule_id="B105",
                scanner="vulns",
            )
        ]
    )
    result = await aggregate_findings(state)
    report = result["report"]
    assert report.decision == "FAIL"
    assert report.summary.total_findings == 1
    assert report.summary.by_severity.get("high") == 1
    assert report.summary.by_scanner.get("vulns") == 1
    assert report.summary.highest_severity.value == "high"


@pytest.mark.asyncio
async def test_low_severity_findings_pass():
    from app.agents.code_validator_nodes.aggregate_findings import (
        aggregate_findings,
    )

    state = _state(
        secrets_partial=[_finding("low", scanner="secrets")],
        vulns_partial=[_finding("medium", scanner="vulns")],
        standards_partial=[_finding("info", scanner="standards")],
    )
    result = await aggregate_findings(state)
    assert result["report"].decision == "PASS"


# ---------------------------------------------------------------------------
# 3. Scanner fan-out executes all 4 scanners in parallel (mock)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scanner_fan_out_invokes_all_four_scanners():
    """All four scanners must run when the sub-graph executes."""
    from app.agents.code_validator_nodes.scan_iac import scan_iac
    from app.agents.code_validator_nodes.scan_secrets import (
        TruffleHogScanner,
        scan_secrets,
    )
    from app.agents.code_validator_nodes.scan_standards import scan_standards
    from app.agents.code_validator_nodes.scan_vulns import scan_vulns

    secrets_scanner = TruffleHogScanner(findings=[_finding("medium", scanner="secrets")])
    secrets_mock = AsyncMock(wraps=scan_secrets)
    iac_mock = AsyncMock(wraps=scan_iac)
    vulns_mock = AsyncMock(wraps=scan_vulns)
    standards_mock = AsyncMock(wraps=scan_standards)

    state = _state()
    # Run the four scanner nodes concurrently — simulating the Send
    # fan-out behavior of the compiled graph.
    secrets_task = asyncio.create_task(secrets_mock(state, scanner=secrets_scanner))
    iac_task = asyncio.create_task(iac_mock(state))
    vulns_task = asyncio.create_task(vulns_mock(state))
    standards_task = asyncio.create_task(standards_mock(state))
    secrets_res, iac_res, vulns_res, standards_res = await asyncio.gather(
        secrets_task, iac_task, vulns_task, standards_task
    )

    assert secrets_mock.await_count == 1
    assert iac_mock.await_count == 1
    assert vulns_mock.await_count == 1
    assert standards_mock.await_count == 1

    # Each scanner returns a partial state update; the secrets scanner
    # must surface the medium-severity finding we injected.
    assert any(f.scanner == "secrets" for f in secrets_res["secrets_partial"])


@pytest.mark.asyncio
async def test_fan_out_compiles_graph_and_runs():
    """Compile the StateGraph and run it end-to-end with stub scanners."""
    from app.agents.code_validator import build_code_validator_graph
    from app.agents.code_validator_nodes.aggregate_findings import (
        aggregate_findings,
    )
    from app.agents.code_validator_nodes.scan_iac import (
        CheckovScanner,
        scan_iac,
    )
    from app.agents.code_validator_nodes.scan_secrets import (
        TruffleHogScanner,
        scan_secrets,
    )
    from app.agents.code_validator_nodes.scan_standards import (
        SemgrepScanner,
        scan_standards,
    )
    from app.agents.code_validator_nodes.scan_vulns import (
        BanditScanner,
        scan_vulns,
    )

    state = _state()
    graph = build_code_validator_graph(
        secrets_node=_make_stub_node(scan_secrets, TruffleHogScanner(findings=[])),
        iac_node=_make_stub_node(scan_iac, CheckovScanner(findings=[])),
        vulns_node=_make_stub_node(scan_vulns, BanditScanner(findings=[])),
        standards_node=_make_stub_node(scan_standards, SemgrepScanner(findings=[])),
        aggregator_node=aggregate_findings,
    )

    config = {"configurable": {"thread_id": str(uuid.uuid4())}}
    result = await graph.ainvoke(state.model_dump(mode="json"), config=config)
    assert result["report"].decision == "PASS"


def _make_stub_node(node_fn, scanner):
    """Build a LangGraph-compatible async stub node with a pre-bound scanner."""

    async def stub(state):
        return await node_fn(state, scanner=scanner)

    stub.__name__ = node_fn.__name__
    return stub


# ---------------------------------------------------------------------------
# 4. State isolation: CodeValidatorState does not import SDLCState
# ---------------------------------------------------------------------------

def test_code_validator_state_does_not_import_sdlc_state():
    """Assert at module-load time that SDLCState is not imported."""
    import app.agents.code_validator_state as cv_state

    # Direct attribute reference would fail if the import existed.
    assert not hasattr(cv_state, "SDLCState")
    # Scan the module source for the forbidden import.
    src_path = Path(cv_state.__file__).read_text(encoding="utf-8")
    forbidden_substrings = (
        "from app.agents.sdlc_state",
        "from backend.app.agents.sdlc_state",
        "import app.agents.sdlc_state",
        "import sdlc_state",
    )
    for needle in forbidden_substrings:
        assert needle not in src_path, (
            f"code_validator_state must not import SDLC state: {needle}"
        )


def test_code_validator_state_carries_tenant_and_project():
    state = _state()
    assert state.tenant_id is not None
    assert state.project_id is not None
    assert state.actor_id is not None
    assert state.target.repo_id == "test-repo"


# ---------------------------------------------------------------------------
# 5. Prompt template loads correctly
# ---------------------------------------------------------------------------

def test_prompt_template_loads():
    from app.agents.code_validator import load_prompt

    state = _state()
    prompt = load_prompt(state)
    assert "Forge Code Validator" in prompt
    assert "trufflehog" in prompt
    assert "checkov" in prompt
    assert "bandit" in prompt
    assert "semgrep" in prompt
    assert "PASS" in prompt
    assert "FAIL" in prompt
    assert state.target.repo_id in prompt


def test_prompt_template_renders_validator_version():
    from app.agents.code_validator import load_prompt

    state = _state()
    prompt = load_prompt(state)
    from app.agents.code_validator_state import VALIDATOR_VERSION

    assert VALIDATOR_VERSION in prompt


# ---------------------------------------------------------------------------
# 6. Independence: code_validator cannot import from sdlc_agent
# ---------------------------------------------------------------------------

def test_code_validator_does_not_import_sdlc_agent():
    import app.agents.code_validator as cv

    # No symbol from sdlc_agent must be re-exported.
    forbidden_attrs = (
        "SDLCState",
        "SDLCPhase",
        "GraphSpec",
        "run_sdlc",
        "build_sdlc_graph",
    )
    for attr in forbidden_attrs:
        assert not hasattr(cv, attr), f"code_validator leaked: {attr}"

    # Source scan for forbidden imports.
    src_path = Path(cv.__file__).read_text(encoding="utf-8")
    forbidden_substrings = (
        "from app.agents.sdlc_agent",
        "from backend.app.agents.sdlc_agent",
        "import app.agents.sdlc_agent",
        "import sdlc_agent",
    )
    for needle in forbidden_substrings:
        assert needle not in src_path, (
            f"code_validator must not import sdlc_agent: {needle}"
        )


def test_code_validator_nodes_do_not_import_sdlc_agent():
    """Each scanner node file must be free of sdlc_agent imports."""
    import app.agents.code_validator_nodes as nodes_pkg
    import inspect

    module_files = [
        nodes_pkg.__file__,
    ]
    nodes_dir = Path(nodes_pkg.__file__).parent
    module_files.extend(sorted(nodes_dir.glob("*.py")))

    forbidden_substrings = (
        "from app.agents.sdlc_agent",
        "from backend.app.agents.sdlc_agent",
        "import app.agents.sdlc_agent",
        "import sdlc_agent",
    )
    for f in module_files:
        if f is None:
            continue
        src = Path(f).read_text(encoding="utf-8")
        for needle in forbidden_substrings:
            assert needle not in src, (
                f"{f} must not import sdlc_agent: {needle}"
            )


# ---------------------------------------------------------------------------
# Bonus: virtual-key alias contract (NFR-043)
# ---------------------------------------------------------------------------

def test_validator_virtual_key_alias_format():
    from app.agents.code_validator import (
        VALIDATOR_VIRTUAL_KEY_PREFIX,
        validator_virtual_key_alias,
    )

    alias = validator_virtual_key_alias("tnt-1", "prj-2", actor_id="u-9")
    assert alias.startswith(VALIDATOR_VIRTUAL_KEY_PREFIX)
    assert alias == "forge_validator_tnt-1_prj-2_u-9"

    alias_no_actor = validator_virtual_key_alias("tnt-1", "prj-2")
    assert alias_no_actor == "forge_validator_tnt-1_prj-2"


# ---------------------------------------------------------------------------
# Bonus: state helpers (mutators)
# ---------------------------------------------------------------------------

def test_state_with_bucket_appends_findings():
    state = _state()
    new_state = state.with_bucket("secrets", [_finding("low", scanner="secrets")])
    assert len(new_state.findings.secrets) == 1
    # Original is untouched.
    assert len(state.findings.secrets) == 0


def test_state_with_unknown_bucket_raises():
    state = _state()
    with pytest.raises(ValueError):
        state.with_bucket("unknown", [_finding("low")])