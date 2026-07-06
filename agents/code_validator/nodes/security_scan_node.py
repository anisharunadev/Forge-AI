"""F-501 SecurityScanNode — runs ``bandit`` on the state's files.

Each call is deterministic: same input files → same JSON output from
bandit → same list of :class:`SecurityFinding` records. No LLM call.
"""
from __future__ import annotations

import json
import logging
import subprocess
from typing import Any, Awaitable, Callable

from agents.code_validator.state import CodeValidatorState, SecurityFinding

logger = logging.getLogger(__name__)


ToolRunner = Callable[[list[str], int], subprocess.CompletedProcess[str]]


def _default_bandit_runner(files: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    """Default ``bandit`` runner. Tests inject a stub for determinism."""
    return subprocess.run(
        ["bandit", "-f", "json", "-q", *files],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


_SEVERITY_MAP: dict[str, str] = {
    "HIGH": "high",
    "MEDIUM": "medium",
    "LOW": "low",
}


def _parse_bandit_output(stdout: str) -> list[SecurityFinding]:
    """Parse bandit JSON output into :class:`SecurityFinding` records.

    The top-level bandit JSON wraps results in ``{"results": [...], ...}``.
    We extract the per-finding records and drop the rest.
    """
    if not stdout or not stdout.strip():
        return []
    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError:
        logger.debug("security_scan_node: bandit output is not valid JSON; dropping")
        return []
    results = raw.get("results", []) if isinstance(raw, dict) else []
    findings: list[SecurityFinding] = []
    for entry in results:
        try:
            issue_severity = entry["issue_severity"]
            severity = _SEVERITY_MAP.get(issue_severity, "low")
            findings.append(
                SecurityFinding(
                    file=entry["filename"],
                    line=int(entry["line_number"]),
                    rule_id=entry["test_id"],
                    severity=severity,  # type: ignore[arg-type]
                    message=entry.get("issue_text", ""),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return findings


async def security_scan_node(
    state: CodeValidatorState,
    *,
    _runner: ToolRunner | None = None,
    _audit_record: Callable[..., Awaitable[Any]] | None = None,
) -> CodeValidatorState:
    """LangGraph node: run ``bandit`` and append findings to state."""
    runner = _runner or _default_bandit_runner
    state_files = list(state.files)

    tool_failed = False
    tool_payload: dict[str, Any] = {"tool": "bandit", "files": state_files}
    findings: list[SecurityFinding] = []

    if not state_files:
        tool_payload["result"] = {"empty_files": True}
    else:
        try:
            proc = runner(state_files, 120)
            if proc.returncode not in (0, 1):
                tool_failed = True
                tool_payload["result"] = {
                    "tool_failed": True,
                    "returncode": proc.returncode,
                    "stderr": (proc.stderr or "")[:512],
                }
            else:
                findings = _parse_bandit_output(proc.stdout)
                tool_payload["result"] = {"count": len(findings)}
        except subprocess.TimeoutExpired:
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": "timeout"}
        except FileNotFoundError:
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": "bandit_not_installed"}
        except Exception as exc:  # noqa: BLE001
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": repr(exc)[:256]}

    if _audit_record is not None:
        await _audit_record(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=None,
            action="code_validator.security_scan",
            target_type="tool",
            target_id="bandit",
            payload=tool_payload,
        )

    return state.model_copy(
        update={
            "security_findings": findings,
            "metadata": {**state.metadata, "security_scan_failed": str(tool_failed)},
        }
    )


SecurityScanNode = security_scan_node

__all__ = [
    "security_scan_node",
    "SecurityScanNode",
    "_default_bandit_runner",
    "_parse_bandit_output",
]
