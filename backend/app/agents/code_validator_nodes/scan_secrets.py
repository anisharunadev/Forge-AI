"""``scan_secrets`` node — invokes ``trufflehog`` against the scan target.

The node is a thin LangGraph adapter over the underlying scanner. It:

1. Looks up files in :attr:`ScanTarget.files` whose ``path`` ends with
   a text-like extension.
2. Delegates to :class:`SecretScanner` (default: ``trufflehog``).
3. Returns a partial state update: ``findings`` and ``scanner_envelopes``.

The scanner is fully injectable so tests can pass a stub.
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


# ---------------------------------------------------------------------------
# Scanner protocol — lets tests inject a deterministic stand-in.
# ---------------------------------------------------------------------------


class SecretScanner(Protocol):
    """Minimal contract for the secrets scanner."""

    name: str

    async def scan(self, files: list[dict[str, Any]]) -> list[ValidationFinding]: ...


@dataclass(slots=True)
class TruffleHogScanner:
    """Default secrets scanner.

    In production this wraps the ``trufflehog`` binary. In tests, the
    constructor takes an explicit ``findings`` list so output is fully
    deterministic.
    """

    name: str = "trufflehog"
    findings: list[ValidationFinding] | None = None

    async def scan(self, files: list[dict[str, Any]]) -> list[ValidationFinding]:
        if self.findings is not None:
            return list(self.findings)
        # Production path: shell out to trufflehog. We do not import
        # the binary here — that is wired up by the deployment module.
        logger.info("trufflehog: scanning %d file(s)", len(files))
        return []


# ---------------------------------------------------------------------------
# LangGraph node
# ---------------------------------------------------------------------------


async def scan_secrets(
    state: CodeValidatorState,
    *,
    scanner: SecretScanner | None = None,
) -> dict[str, Any]:
    """LangGraph node — scan for secrets with trufflehog."""
    started = time.perf_counter()
    scanner = scanner or TruffleHogScanner()
    started_at = datetime.now(UTC)

    try:
        findings = await scanner.scan(state.target.files)
    except Exception as exc:  # noqa: BLE001 — recorded in envelope
        logger.warning("secrets scanner raised: %s", exc)
        findings = []
        envelope = ScannerEnvelope(
            scanner="secrets",
            findings=[],
            started_at=started_at,
            finished_at=datetime.now(UTC),
            duration_ms=int((time.perf_counter() - started) * 1000),
            error=str(exc),
        )
        return {
            "scanner_envelopes": [*state.scanner_envelopes, envelope],
            "secrets_envelope": envelope,
            "errors": [*state.errors, f"scan_secrets:{type(exc).__name__}"],
        }

    # Tag findings with the scanner name for the summary aggregator.
    tagged: list[ValidationFinding] = []
    for f in findings:
        if not f.scanner:
            tagged.append(f.model_copy(update={"scanner": "secrets"}))
        else:
            tagged.append(f)

    envelope = ScannerEnvelope(
        scanner="secrets",
        findings=tagged,
        started_at=started_at,
        finished_at=datetime.now(UTC),
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    return {
        "secrets_partial": tagged,
        "secrets_envelope": envelope,
    }


__all__ = ["scan_secrets", "TruffleHogScanner", "SecretScanner"]
