"""F-501 Code Validator sub-graph — independent of the SDLC supervisor.

This package is the canonical home of the Code Validator sub-graph.
It is INTENTIONALLY independent of the SDLC supervisor package
(no shared prompt template, no shared state type).

* It carries its own :class:`CodeValidatorState` (see :mod:`state`).
* It has NO shared prompt template with the SDLC supervisor.
* It does NOT call any LLM (deterministic tools only).
* Its nodes write audit rows through ``audit_service.record`` per
  Rule 6 (Mandatorily auditable).

Public surface (re-exported for convenience)::

    from agents.code_validator import (
        code_validator_graph,
        build_code_validator_graph,
        CodeValidatorState,
        LintFinding,
        TypeCheckFinding,
        SecurityFinding,
        ValidationReport,
    )
"""
from __future__ import annotations

from agents.code_validator.graph import build_code_validator_graph, code_validator_graph
from agents.code_validator.state import (
    CodeValidatorState,
    LintFinding,
    SecurityFinding,
    TypeCheckFinding,
    ValidationReport,
)

__all__ = [
    "build_code_validator_graph",
    "code_validator_graph",
    "CodeValidatorState",
    "LintFinding",
    "TypeCheckFinding",
    "SecurityFinding",
    "ValidationReport",
]
