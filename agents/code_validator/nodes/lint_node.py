"""F-501 LintNode — runs ``ruff check`` on the state's files.

Each call is deterministic: same input files → same JSON output from
ruff → same list of :class:`LintFinding` records. No LLM call.
"""
from __future__ import annotations

import json
import logging
import subprocess
from typing import Any, Awaitable, Callable

from agents.code_validator.state import CodeValidatorState, LintFinding

logger = logging.getLogger(__name__)


# ponytail: subprocess.run with check=False and a hard timeout — on
# timeout / non-zero exit / JSON parse error, the node writes an
# empty findings list and still records the audit row so the audit
# trail is never gapped (Rule 6). A future iteration can dispatch to
# a worker pool; the call site is async-safe.
ToolRunner = Callable[[list[str], int], subprocess.CompletedProcess[str]]


def _default_ruff_runner(files: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    """Default ``ruff`` runner. Tests inject a stub for determinism."""
    return subprocess.run(
        ["ruff", "check", "--output-format", "json", *files],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


_SEVERITY_MAP: dict[str, str] = {
    "E": "error",
    "F": "error",
    "W": "warning",
    "I": "info",
    "N": "info",
    "C": "info",
    "B": "info",
    "D": "info",
    "S": "warning",
    "T": "info",
    "R": "info",
    "U": "warning",
    "UP": "warning",
    "SIM": "info",
    "PIE": "info",
    "PT": "info",
    "RET": "info",
    "YTT": "info",
    "ARG": "info",
    "PTH": "info",
    "ERA": "info",
    "PL": "info",
    "TRY": "info",
    "NPY": "info",
    "PERF": "info",
    "FURB": "info",
    "LOG": "info",
    "G": "info",
    "COM": "info",
    "Q": "info",
    "RUF": "info",
    "ASYNC": "info",
    "S": "warning",
}


def _severity_for(code: str) -> str:
    """Map a ruff code prefix to a :class:`LintFinding` severity."""
    # codes are like "E501", "F401", "W391", "B008", "UP015", "SIM102"
    # extract the leading alpha prefix.
    prefix = "".join(c for c in code if c.isalpha()) or code
    return _SEVERITY_MAP.get(prefix, "info")


def _parse_ruff_output(stdout: str) -> list[LintFinding]:
    """Parse ruff JSON output into :class:`LintFinding` records.

    Malformed entries are dropped (with a ``logger.debug``); the
    audit row records the parse-failure count separately.
    """
    if not stdout or not stdout.strip():
        return []
    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError:
        logger.debug("lint_node: ruff output is not valid JSON; dropping")
        return []
    findings: list[LintFinding] = []
    for entry in raw:
        try:
            code = entry["code"]
            filename = entry["filename"]
            location = entry["location"]
            findings.append(
                LintFinding(
                    file=filename,
                    line=int(location["row"]),
                    column=int(location["column"]),
                    code=code,
                    severity=_severity_for(code),  # type: ignore[arg-type]
                    message=entry.get("message", ""),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return findings


async def lint_node(
    state: CodeValidatorState,
    *,
    _runner: ToolRunner | None = None,
    _audit_record: Callable[..., Awaitable[Any]] | None = None,
) -> CodeValidatorState:
    """LangGraph node: run ``ruff`` and append findings to state.

    The ``_runner`` and ``_audit_record`` parameters are injected
    by tests; production callers use the defaults.
    """
    runner = _runner or _default_ruff_runner
    state_files = list(state.files)

    tool_failed = False
    tool_payload: dict[str, Any] = {"tool": "ruff", "files": state_files}
    findings: list[LintFinding] = []

    if not state_files:
        tool_payload["result"] = {"empty_files": True}
    else:
        try:
            proc = runner(state_files, 60)
            if proc.returncode not in (0, 1):  # 0=clean, 1=findings
                tool_failed = True
                tool_payload["result"] = {
                    "tool_failed": True,
                    "returncode": proc.returncode,
                    "stderr": (proc.stderr or "")[:512],
                }
            else:
                findings = _parse_ruff_output(proc.stdout)
                tool_payload["result"] = {"count": len(findings)}
        except subprocess.TimeoutExpired:
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": "timeout"}
        except FileNotFoundError:
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": "ruff_not_installed"}
        except Exception as exc:  # noqa: BLE001 — Rule 6 audit-everything
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": repr(exc)[:256]}

    if _audit_record is not None:
        await _audit_record(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=None,
            action="code_validator.lint",
            target_type="tool",
            target_id="ruff",
            payload=tool_payload,
        )

    return state.model_copy(
        update={"lint_findings": findings, "metadata": {**state.metadata, "lint_failed": str(tool_failed)}}
    )


LintNode = lint_node

__all__ = ["lint_node", "LintNode", "_default_ruff_runner", "_parse_ruff_output"]
