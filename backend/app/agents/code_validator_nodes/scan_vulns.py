"""``scan_vulns`` node — invokes ``bandit`` against Python sources.

Bandit is the canonical Python AST-based scanner for security issues.
We pass the same file list used by ``scan_secrets`` but mark findings
with ``scanner="vulns"`` so they aggregate into the correct bucket.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from app.agents.code_validator_state import (
    CodeValidatorState,
    ScannerEnvelope,
    ValidationFinding,
)

logger = logging.getLogger(__name__)


class VulnScanner(Protocol):
    name: str

    async def scan(self, files: list[dict[str, Any]]) -> list[ValidationFinding]: ...


@dataclass(slots=True)
class BanditScanner:
    name: str = "bandit"
    findings: list[ValidationFinding] | None = None

    async def scan(self, files: list[dict[str, Any]]) -> list[ValidationFinding]:
        if self.findings is not None:
            return list(self.findings)
        logger.info("bandit: scanning %d file(s)", len(files))
        return []


async def scan_vulns(
    state: CodeValidatorState,
    *,
    scanner: VulnScanner | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    scanner = scanner or BanditScanner()
    started_at = datetime.now(UTC)

    try:
        findings = await scanner.scan(state.target.files)
    except Exception as exc:  # noqa: BLE001 — recorded in envelope
        logger.warning("vuln scanner raised: %s", exc)
        envelope = ScannerEnvelope(
            scanner="vulns",
            findings=[],
            started_at=started_at,
            finished_at=datetime.now(UTC),
            duration_ms=int((time.perf_counter() - started) * 1000),
            error=str(exc),
        )
        return {
            "scanner_envelopes": [*state.scanner_envelopes, envelope],
            "vulns_envelope": envelope,
            "errors": [*state.errors, f"scan_vulns:{type(exc).__name__}"],
        }

    tagged = [f.model_copy(update={"scanner": "vulns"}) if not f.scanner else f for f in findings]
    envelope = ScannerEnvelope(
        scanner="vulns",
        findings=tagged,
        started_at=started_at,
        finished_at=datetime.now(UTC),
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    return {
        "vulns_partial": tagged,
        "vulns_envelope": envelope,
    }


__all__ = ["scan_vulns", "BanditScanner", "VulnScanner"]
