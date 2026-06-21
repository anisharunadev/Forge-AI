"""``aggregate_findings`` node — fan-in for the four scanners.

This node is the terminal node of the Code Validator sub-graph. It:

1. Collects every :class:`ValidationFinding` from the per-scanner
   partial slots (``secrets_partial``, ``iac_partial``, ``vulns_partial``,
   ``standards_partial``).
2. Emits a deterministic :class:`ValidationReport` with PASS/FAIL.
3. Stores the report on the state for downstream consumers.

Determinism (NFR-042):

    * PASS requires zero findings with severity >= HIGH.
    * FAIL surfaces every finding (no filtering).

The aggregator does NOT import any scanner implementation; it works
purely off the typed state contract.
"""
from __future__ import annotations

import logging
from typing import Any

from app.agents.code_validator_state import (
    CodeValidatorState,
    FindingsBuckets,
    ValidationReport,
)

logger = logging.getLogger(__name__)


async def aggregate_findings(state: CodeValidatorState) -> dict[str, Any]:
    """LangGraph node — fan-in for the four scanner buckets."""
    merged = FindingsBuckets(
        secrets=list(state.secrets_partial),
        iac=list(state.iac_partial),
        vulns=list(state.vulns_partial),
        standards=list(state.standards_partial),
    )
    findings = merged.all()
    envelopes = [
        e for e in (
            state.secrets_envelope,
            state.iac_envelope,
            state.vulns_envelope,
            state.standards_envelope,
        ) if e is not None
    ]
    report = ValidationReport.finalize(findings=findings, run_id=state.run_id)
    logger.info(
        "code_validator: aggregated %d finding(s) -> %s",
        len(findings),
        report.decision,
    )
    return {
        "findings": merged,
        "scanner_envelopes": envelopes,
        "report": report,
    }


__all__ = ["aggregate_findings"]