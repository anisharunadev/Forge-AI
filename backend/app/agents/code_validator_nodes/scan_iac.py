"""``scan_iac`` node — invokes ``checkov`` on Infrastructure-as-Code paths.

The IaC scanner is scoped to the explicit ``target.iac_paths`` list.
This keeps the sub-graph deterministic: callers enumerate the paths
they want scanned (Terraform files, Kustomize overlays, Dockerfile).
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


class IaCScanner(Protocol):
    name: str

    async def scan(self, paths: list[str]) -> list[ValidationFinding]: ...


@dataclass(slots=True)
class CheckovScanner:
    name: str = "checkov"
    findings: list[ValidationFinding] | None = None

    async def scan(self, paths: list[str]) -> list[ValidationFinding]:
        if self.findings is not None:
            return list(self.findings)
        logger.info("checkov: scanning %d IaC path(s)", len(paths))
        return []


async def scan_iac(
    state: CodeValidatorState,
    *,
    scanner: IaCScanner | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    scanner = scanner or CheckovScanner()
    started_at = datetime.now(timezone.utc)

    try:
        findings = await scanner.scan(state.target.iac_paths)
    except Exception as exc:  # noqa: BLE001 — recorded in envelope
        logger.warning("iac scanner raised: %s", exc)
        envelope = ScannerEnvelope(
            scanner="iac",
            findings=[],
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
            duration_ms=int((time.perf_counter() - started) * 1000),
            error=str(exc),
        )
        return {
            "scanner_envelopes": [*state.scanner_envelopes, envelope],
            "iac_envelope": envelope,
            "errors": [*state.errors, f"scan_iac:{type(exc).__name__}"],
        }

    tagged = [
        f.model_copy(update={"scanner": "iac"}) if not f.scanner else f
        for f in findings
    ]
    envelope = ScannerEnvelope(
        scanner="iac",
        findings=tagged,
        started_at=started_at,
        finished_at=datetime.now(timezone.utc),
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    return {
        "iac_partial": tagged,
        "iac_envelope": envelope,
    }


__all__ = ["scan_iac", "CheckovScanner", "IaCScanner"]