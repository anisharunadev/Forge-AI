"""F-501 Code Validator sub-graph — pytest coverage (plan 01-05 Task 3).

Tests:

1. ``test_subgraph_produces_validation_report`` — full pipeline
   produces a :class:`ValidationReport` with all required fields.
2. ``test_subgraph_verdict_pass_when_no_findings`` — empty findings
   list resolves to ``verdict == "pass"``.
3. ``test_subgraph_verdict_fail_on_security_critical`` — one
   :class:`SecurityFinding` with ``severity="critical"`` flips the
   verdict to ``"fail"`` and ``is_blocking`` to ``True``.
4. ``test_subgraph_no_llm_call`` — patches
   ``litellm_client.completion`` with a ``MagicMock`` and asserts the
   mock was never called. Proves the no-LLM invariant from the
   locked Phase 1 decision.
5. ``test_subgraph_audit_rows_written`` — patches
   ``audit_service.record`` with an ``AsyncMock`` and asserts the
   call count is >= 3 (one per node).
6. ``test_subgraph_independent_of_sdlc_supervisor`` — guards the
   independence contract: ``agents.code_validator`` does NOT import
   from the SDLC supervisor package (no shared prompt template).

All tool calls are stubbed via the injectable ``_runner`` /
``_audit_record`` params so the tests run hermetically without
``ruff`` / ``mypy`` / ``bandit`` / a real DB.
"""

from __future__ import annotations

import json
import re
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# Sub-graph imports.
from agents.code_validator import (
    CodeValidatorState,
    SecurityFinding,
    ValidationReport,
    build_code_validator_graph,
)
from agents.code_validator.nodes import (
    lint_node,
    security_scan_node,
    typecheck_node,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _state(**overrides) -> CodeValidatorState:
    base = {
        "tenant_id": uuid.uuid4(),
        "project_id": uuid.uuid4(),
        "run_id": uuid.uuid4(),
        "files": ["backend/app/main.py"],
    }
    base.update(overrides)
    return CodeValidatorState(**base)


def _stub_runner(stdout: str, returncode: int = 0):
    """Return a synchronous tool runner that yields the given stdout."""

    def _runner(files, timeout):  # noqa: ARG001
        return subprocess.CompletedProcess(
            args=[],
            returncode=returncode,
            stdout=stdout,
            stderr="",
        )

    return _runner


def _thread_config() -> dict:
    """Build a LangGraph config dict with a thread_id (required by checkpointer)."""
    return {"configurable": {"thread_id": str(uuid.uuid4())}}


def _build_test_graph(audit_mock: AsyncMock):
    """Build a sub-graph with stubbed tool runners and the audit mock.

    Each node is wrapped in an async closure that calls the production
    node with the injected ``_runner`` / ``_audit_record`` so the test
    is hermetic.
    """

    async def _lint(state: CodeValidatorState) -> dict[str, Any]:
        new_state = await lint_node(
            state,
            _runner=_stub_runner(json.dumps([])),
            _audit_record=audit_mock,
        )
        return new_state.model_dump(mode="json")

    async def _typecheck(state: CodeValidatorState) -> dict[str, Any]:
        new_state = await typecheck_node(
            state,
            _runner=_stub_runner(json.dumps([])),
            _audit_record=audit_mock,
        )
        return new_state.model_dump(mode="json")

    async def _security(state: CodeValidatorState) -> dict[str, Any]:
        new_state = await security_scan_node(
            state,
            _runner=_stub_runner(json.dumps({"results": []})),
            _audit_record=audit_mock,
        )
        return new_state.model_dump(mode="json")

    return build_code_validator_graph(
        lint=_lint,
        typecheck=_typecheck,
        security_scan=_security,
    )


# ---------------------------------------------------------------------------
# 1. End-to-end pipeline produces a ValidationReport
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subgraph_produces_validation_report() -> None:
    """Full pipeline → ValidationReport with all required fields."""
    audit_mock = AsyncMock()
    graph = _build_test_graph(audit_mock)

    result = await graph.ainvoke(_state().model_dump(mode="json"), config=_thread_config())
    assert result is not None
    # The result is a dict (LangGraph state dict) — verify the report
    # is present after emit_report ran.
    assert result.get("verdict") == "pass"
    assert result.get("produced_at") is not None
    report = result.get("report")
    assert report is not None
    # report may be a ValidationReport instance OR a dict depending
    # on LangGraph's serialization. Coerce to dict.
    if hasattr(report, "model_dump"):
        report = report.model_dump(mode="json")
    # Verify all required F-501 fields.
    assert report["tenant_id"]
    assert report["project_id"]
    assert report["run_id"]
    assert report["verdict"] == "pass"
    assert "produced_at" in report
    assert report["lint_findings"] == []
    assert report["typecheck_findings"] == []
    assert report["security_findings"] == []


# ---------------------------------------------------------------------------
# 2. Verdict == "pass" when no findings
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subgraph_verdict_pass_when_no_findings() -> None:
    """No findings → verdict is "pass"."""
    from agents.code_validator.graph import _compute_verdict

    state = _state()
    assert _compute_verdict(state) == "pass"


# ---------------------------------------------------------------------------
# 3. Verdict == "fail" + is_blocking on a critical security finding
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subgraph_verdict_fail_on_security_critical() -> None:
    """One critical security finding → verdict "fail" + is_blocking True."""
    from agents.code_validator.graph import _compute_verdict

    finding = SecurityFinding(
        file="a.py",
        line=1,
        rule_id="B105",
        severity="critical",
        message="hardcoded password",
    )
    state = _state(security_findings=[finding])
    assert _compute_verdict(state) == "fail"

    report = ValidationReport(
        tenant_id=state.tenant_id,
        project_id=state.project_id,
        run_id=state.run_id,
        lint_findings=[],
        typecheck_findings=[],
        security_findings=[finding],
        verdict="fail",
        produced_at=datetime.now(UTC),
    )
    assert report.is_blocking is True


# ---------------------------------------------------------------------------
# 4. No LLM call in the sub-graph
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subgraph_no_llm_call() -> None:
    """No ``litellm_client.completion`` call during graph execution.

    The mock will fail the test if any LLM call leaks into the
    sub-graph, proving the no-LLM invariant per the locked Phase 1
    decision.
    """
    # Patch the canonical litellm_client.completion entry point.
    import app.services.litellm_client as litellm_client_module

    mock_completion = MagicMock(return_value=None)
    original = getattr(litellm_client_module, "completion", None)
    litellm_client_module.completion = mock_completion
    try:
        audit_mock = AsyncMock()
        graph = _build_test_graph(audit_mock)
        result = await graph.ainvoke(_state().model_dump(mode="json"), config=_thread_config())
        assert result is not None
        assert mock_completion.call_count == 0, (
            "sub-graph must NOT call litellm_client.completion; "
            f"called {mock_completion.call_count} time(s)"
        )
    finally:
        if original is not None:
            litellm_client_module.completion = original


# ---------------------------------------------------------------------------
# 5. Audit rows are written by every node
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subgraph_audit_rows_written() -> None:
    """Each node writes at least one audit row via _audit_record."""
    audit_mock = AsyncMock()
    graph = _build_test_graph(audit_mock)
    await graph.ainvoke(_state().model_dump(mode="json"), config=_thread_config())
    # Three nodes each write one audit row via _audit_record.
    assert audit_mock.call_count >= 3, (
        f"expected >= 3 audit rows (one per node), got {audit_mock.call_count}"
    )
    # Verify the actions are distinct per node.
    actions = [call.kwargs.get("action") for call in audit_mock.call_args_list]
    assert "code_validator.lint" in actions
    assert "code_validator.typecheck" in actions
    assert "code_validator.security_scan" in actions


# ---------------------------------------------------------------------------
# 6. Independence: agents.code_validator does NOT import the SDLC supervisor
# ---------------------------------------------------------------------------


def test_subgraph_independent_of_sdlc_supervisor() -> None:
    """No ``import`` of the SDLC supervisor exists in the sub-graph package.

    This proves the independence contract: the Code Validator sub-graph
    has no shared prompt template with the SDLC supervisor, per the
    locked Phase 1 decision in STATE.md.
    """
    package_root = Path(__file__).resolve().parents[2] / "agents" / "code_validator"
    assert package_root.is_dir(), f"expected {package_root} to exist"

    # Match any import / reference to the SDLC supervisor module
    # (sdlc_agent OR sdlc_state) — we explicitly want to forbid both
    # because the plan locks independence from BOTH.
    bad_pattern = re.compile(r"\b(sdlc_agent|sdlc_state)\b")
    bad: list[str] = []
    for path in package_root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if bad_pattern.search(text):
            bad.append(str(path))
    assert not bad, (
        f"agents.code_validator must NOT reference the SDLC supervisor; offending files: {bad}"
    )
