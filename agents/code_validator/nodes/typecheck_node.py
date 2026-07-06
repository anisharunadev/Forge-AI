"""F-501 TypeCheckNode — runs ``mypy`` on the state's files.

Each call is deterministic: same input files → same JSON output from
mypy → same list of :class:`TypeCheckFinding` records. No LLM call.
"""
from __future__ import annotations

import json
import logging
import subprocess
from typing import Any, Awaitable, Callable

from agents.code_validator.state import CodeValidatorState, TypeCheckFinding

logger = logging.getLogger(__name__)


ToolRunner = Callable[[list[str], int], subprocess.CompletedProcess[str]]


def _default_mypy_runner(files: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    """Default ``mypy`` runner. Tests inject a stub for determinism."""
    return subprocess.run(
        ["mypy", "--output", "json", "--no-error-summary", *files],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _parse_mypy_output(stdout: str) -> list[TypeCheckFinding]:
    """Parse mypy JSON output into :class:`TypeCheckFinding` records."""
    if not stdout or not stdout.strip():
        return []
    raw: Any
    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError:
        logger.debug("typecheck_node: mypy output is not valid JSON; dropping")
        return []
    if not isinstance(raw, list):
        return []
    findings: list[TypeCheckFinding] = []
    for entry in raw:
        try:
            findings.append(
                TypeCheckFinding(
                    file=entry["file"],
                    line=int(entry["line"]),
                    column=int(entry["column"]),
                    code=str(entry.get("code", "")),
                    severity=entry.get("severity", "error"),  # type: ignore[arg-type]
                    message=entry.get("message", ""),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return findings


async def typecheck_node(
    state: CodeValidatorState,
    *,
    _runner: ToolRunner | None = None,
    _audit_record: Callable[..., Awaitable[Any]] | None = None,
) -> CodeValidatorState:
    """LangGraph node: run ``mypy`` and append findings to state."""
    runner = _runner or _default_mypy_runner
    state_files = list(state.files)

    tool_failed = False
    tool_payload: dict[str, Any] = {"tool": "mypy", "files": state_files}
    findings: list[TypeCheckFinding] = []

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
                findings = _parse_mypy_output(proc.stdout)
                tool_payload["result"] = {"count": len(findings)}
        except subprocess.TimeoutExpired:
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": "timeout"}
        except FileNotFoundError:
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": "mypy_not_installed"}
        except Exception as exc:  # noqa: BLE001
            tool_failed = True
            tool_payload["result"] = {"tool_failed": True, "reason": repr(exc)[:256]}

    if _audit_record is not None:
        await _audit_record(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=None,
            action="code_validator.typecheck",
            target_type="tool",
            target_id="mypy",
            payload=tool_payload,
        )

    return state.model_copy(
        update={
            "typecheck_findings": findings,
            "metadata": {**state.metadata, "typecheck_failed": str(tool_failed)},
        }
    )


TypeCheckNode = typecheck_node

__all__ = ["typecheck_node", "TypeCheckNode", "_default_mypy_runner", "_parse_mypy_output"]
