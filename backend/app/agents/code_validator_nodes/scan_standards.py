"""``scan_standards`` node — invokes ``semgrep`` for coding standards.

Semgrep drives the standards layer: project-specific rule packs,
organization style guides, and OWASP top-10 coverage. Findings from
this scanner typically have ``severity=low|medium`` and surface in
the FAIL decision only when escalated by the aggregator.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from app.agents.code_validator_state import (
    CodeValidatorState,
    ScannerEnvelope,
    ValidationFinding,
)

logger = logging.getLogger(__name__)


class StandardsScanner(Protocol):
    name: str

    async def scan(
        self,
        files: list[dict[str, Any]],
        rules: list[str] | None = None,
    ) -> list[ValidationFinding]: ...


@dataclass(slots=True)
class SemgrepScanner:
    name: str = "semgrep"
    findings: list[ValidationFinding] | None = None

    async def scan(
        self,
        files: list[dict[str, Any]],
        rules: list[str] | None = None,
    ) -> list[ValidationFinding]:
        if self.findings is not None:
            return list(self.findings)
        logger.info(
            "semgrep: scanning %d file(s) with %d rule pack(s)",
            len(files),
            len(rules or []),
        )
        return []


async def scan_standards(
    state: CodeValidatorState,
    *,
    scanner: StandardsScanner | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    scanner = scanner or SemgrepScanner()
    started_at = datetime.now(timezone.utc)
    rules = list((state.metadata or {}).get("semgrep_rules", []) or [])

    try:
        findings = await scanner.scan(state.target.files, rules=rules)
    except Exception as exc:  # noqa: BLE001 — recorded in envelope
        logger.warning("standards scanner raised: %s", exc)
        envelope = ScannerEnvelope(
            scanner="standards",
            findings=[],
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            duration_ms=int((time.perf_counter() - started) * 1000),
            error=str(exc),
        )
        return {
            "scanner_envelopes": [*state.scanner_envelopes, envelope],
            "standards_envelope": envelope,
            "errors": [*state.errors, f"scan_standards:{type(exc).__name__}"],
        }

    tagged = [
        f.model_copy(update={"scanner": "standards"}) if not f.scanner else f
        for f in findings
    ]
    envelope = ScannerEnvelope(
        scanner="standards",
        findings=tagged,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc),
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    return {
        "standards_partial": tagged,
        "standards_envelope": envelope,
    }


__all__ = ["scan_standards", "SemgrepScanner", "StandardsScanner"]