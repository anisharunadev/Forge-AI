"""F-501 Code Validator sub-graph — LangGraph wiring.

Topology
--------

::

    START
      └─▶ lint
            └─▶ typecheck
                  └─▶ security_scan
                        └─▶ emit_report
                              └─▶ END

Linear pipeline; each node appends to its typed findings slot.
The terminal :func:`emit_report` node computes the deterministic
``verdict`` (``pass`` | ``warn`` | ``fail``) and constructs the
typed :class:`ValidationReport` artifact.

No LLM call exists in the sub-graph (per the locked Phase 1
decision). All nodes write one audit row per invocation.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable

from langgraph.graph import END, START, StateGraph

from agents.code_validator.nodes.lint_node import lint_node
from agents.code_validator.nodes.security_scan_node import security_scan_node
from agents.code_validator.nodes.typecheck_node import typecheck_node
from agents.code_validator.state import CodeValidatorState, ValidationReport

logger = logging.getLogger(__name__)


# Verdict computation (per threat-model T-01-05-4 Repudiation):
# - "fail" if any SecurityFinding.severity in ("critical", "high")
#   OR any LintFinding.severity == "error"
#   OR any TypeCheckFinding.severity == "error"
# - "warn" if any warning-severity finding
# - "pass" otherwise
def _compute_verdict(state: CodeValidatorState) -> str:
    for f in state.security_findings:
        if f.severity in ("critical", "high"):
            return "fail"
    for f in state.lint_findings:
        if f.severity == "error":
            return "fail"
    for f in state.typecheck_findings:
        if f.severity == "error":
            return "fail"
    if any(f.severity == "warning" for f in state.security_findings):
        return "warn"
    if any(f.severity == "warning" for f in state.lint_findings):
        return "warn"
    if any(f.severity == "warning" for f in state.typecheck_findings):
        return "warn"
    if any(f.severity == "info" for f in state.lint_findings):
        return "warn"
    return "pass"


def _summary_text(state: CodeValidatorState) -> str:
    """One-line human-readable summary for the artifact."""
    return (
        f"lint={len(state.lint_findings)} "
        f"typecheck={len(state.typecheck_findings)} "
        f"security={len(state.security_findings)} "
        f"verdict={state.verdict}"
    )


async def emit_report(
    state: CodeValidatorState,
    *,
    _audit_record: Callable[..., Awaitable[Any]] | None = None,
) -> dict[str, Any]:
    """Final node: compute verdict, build ValidationReport, audit it.

    The LangGraph return shape is a partial-state dict so reducers
    can merge it back into :class:`CodeValidatorState`.
    """
    verdict = _compute_verdict(state)
    produced_at = datetime.now(UTC)
    report = ValidationReport(
        tenant_id=state.tenant_id,
        project_id=state.project_id,
        run_id=state.run_id,
        lint_findings=list(state.lint_findings),
        typecheck_findings=list(state.typecheck_findings),
        security_findings=list(state.security_findings),
        verdict=verdict,  # type: ignore[arg-type]
        produced_at=produced_at,
        summary=_summary_text(
            state.model_copy(update={"verdict": verdict})  # type: ignore[arg-type]
        ),
    )
    if _audit_record is not None:
        await _audit_record(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=None,
            action="code_validator.emit_report",
            target_type="artifact",
            target_id=str(state.run_id),
            payload={
                "verdict": verdict,
                "lint_count": len(state.lint_findings),
                "typecheck_count": len(state.typecheck_findings),
                "security_count": len(state.security_findings),
            },
        )
    return {
        "verdict": verdict,
        "produced_at": produced_at,
        "report": report,
    }


def build_code_validator_graph(
    *,
    checkpointer: Any | None = None,
    lint: Callable[..., Awaitable[Any]] | None = None,
    typecheck: Callable[..., Awaitable[Any]] | None = None,
    security_scan: Callable[..., Awaitable[Any]] | None = None,
    report: Callable[..., Awaitable[Any]] | None = None,
) -> Any:
    """Build and compile the Code Validator sub-graph.

    All node callables are injectable so tests can swap the production
    nodes for deterministic stubs.
    """
    builder: StateGraph = StateGraph(CodeValidatorState)

    builder.add_node("lint", lint or lint_node)
    builder.add_node("typecheck", typecheck or typecheck_node)
    builder.add_node("security_scan", security_scan or security_scan_node)
    builder.add_node("emit_report", report or emit_report)

    builder.add_edge(START, "lint")
    builder.add_edge("lint", "typecheck")
    builder.add_edge("typecheck", "security_scan")
    builder.add_edge("security_scan", "emit_report")
    builder.add_edge("emit_report", END)

    if checkpointer is None:
        from langgraph.checkpoint.memory import MemorySaver

        checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


# ponytail: cached default compiled graph for the common case. Tests
# always use build_code_validator_graph() so they can inject stubs.
code_validator_graph = build_code_validator_graph()

__all__ = [
    "build_code_validator_graph",
    "code_validator_graph",
    "emit_report",
    "_compute_verdict",
]
