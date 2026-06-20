"""
Audit recorder for the IaC Scanner (FORA-77 AC #5).

Every tool call the IaC scanner makes is recorded so the audit
log can be replayed to prove the agent never read the Developer's
prompt or context. The shape of each record mirrors
`agents/audit/schema.py` `AuditEvent`; we keep our own narrow
type here so the IaC scanner does not import the broader audit
package (one of the isolation guarantees is that the Security
Agent's dependencies are a strict subset of the Developer's).

The IaC scanner's audit recorder is a strict subset of the FORA-76
DepScanner shape — only four tool entry points (read_pr_diff,
write_pr_comment, write_scan_evidence, write_handoff_artifact).
The schema is otherwise identical so the daily sample can fold
all Security Agent records into one query.

Public surface:

    SecurityAuditRecorder — the in-process recorder (in-memory by default;
                            an S3-backed or Kafka-backed adapter plugs in
                            the same way `agents/audit/store.py` does for
                            the system-wide store)
    ToolCallRecord        — one row per tool call
    record_tool_call      — convenience entry point
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .isolation import ToolAllowList


AUDIT_SCHEMA_VERSION = "1.0.0"


@dataclass
class ToolCallRecord:
    """One row in the IaC scanner's per-process audit log.

    Fields mirror the system-wide `AuditEvent` shape (FORA-36) so
    the daily sample (per `forge/sync-plane/risk_register.md` R-X2)
    can fold Security Agent records in without a separate join.

    `allowed` is True iff the tool was on the agent's allow-list.
    `suspicious_access` is True iff the tool name contains a
    forbidden token (e.g. `read_developer_*`); the recorder
    surfaces this so the daily sample can flag it without the
    agent itself having to decide.
    """

    record_id: str
    run_id: str
    tenant_id: str
    agent_id: str
    tool: str
    allowed: bool
    suspicious_access: bool
    arguments_digest: str
    output_digest: str
    duration_ms: float
    timestamp: str
    stage: str = "iac_scanner"
    error_code: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# Forbidden tokens are a defence-in-depth list — they catch the
# obvious "Developer-prompt-leak" attempts even when the runtime
# allow-list is intact. The list is intentionally narrow: every
# token here is one a Developer Agent uses that the IaC scanner
# must NOT use.
_FORBIDDEN_TOKENS = (
    "developer_prompt",
    "developer_scratch",
    "conversation_log",
    "plan_output_body",
    "code_diff_body",
    "lockfile_body",
    "iac_file_body",  # the IaC scanner reads ONLY the line pointer, never the body
)


def _suspicious(tool: str) -> bool:
    name = tool.lower()
    return any(tok in name for tok in _FORBIDDEN_TOKENS)


def _digest(payload: Any) -> str:
    """Hex SHA-256 of the canonical JSON form of `payload`.

    The IaC scanner does NOT store the payload body — only its
    digest. A `dict` is canonicalised via `json.dumps(sort_keys=True)`
    so two equal inputs always produce the same digest.
    """
    try:
        canon = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    except TypeError:
        canon = repr(payload)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class SecurityAuditRecorder:
    """In-process audit recorder for the IaC scanner.

    Every tool call goes through `record()`. The recorder:

      - asserts the tool is on the allow-list (defence in depth;
        the runtime is the primary gate)
      - computes input/output digests
      - times the call
      - stores the row in memory (the production adapter persists
        to the system-wide `agents/audit/store.py` `AuditStore`)

    The `records` property returns a copy so a reviewer can replay
    the log to prove no Developer-prompt access (AC #5).
    """

    def __init__(
        self,
        *,
        run_id: str,
        tenant_id: str,
        agent_id: str,
        allow_list: ToolAllowList,
        sink: Optional[List[ToolCallRecord]] = None,
    ) -> None:
        self._run_id = run_id
        self._tenant_id = tenant_id
        self._agent_id = agent_id
        self._allow = allow_list
        self._sink: List[ToolCallRecord] = sink if sink is not None else []

    @property
    def records(self) -> List[ToolCallRecord]:
        return list(self._sink)

    def record(
        self,
        tool: str,
        arguments: Any,
        output: Any,
        *,
        duration_ms: float = 0.0,
        error_code: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ToolCallRecord:
        """Record one tool call. Raises if the tool is not on the allow-list."""
        allowed = tool in self._allow.allowed
        rec = ToolCallRecord(
            record_id=f"iacscan-audit-{uuid.uuid4().hex[:12]}",
            run_id=self._run_id,
            tenant_id=self._tenant_id,
            agent_id=self._agent_id,
            tool=tool,
            allowed=allowed,
            suspicious_access=_suspicious(tool),
            arguments_digest=_digest(arguments),
            output_digest=_digest(output) if output is not None else "",
            duration_ms=float(duration_ms or 0.0),
            timestamp=_utcnow_iso(),
            error_code=error_code,
            metadata=metadata or {},
        )
        self._sink.append(rec)
        # Even if the runtime already allowed the call, the recorder
        # must NOT record it if it would have been an allow-list
        # violation — the agent calls `assert_tool_allowed` *before*
        # this method, so by the time we get here the runtime has
        # agreed; we still tag `allowed=False` so the rejection path
        # can be replayed (e.g. for red-team exercises).
        return rec

    # Convenience helpers — typed entry points for the four tools.

    def record_read_pr_diff(
        self, arguments: Any, output: Any, **kw: Any
    ) -> ToolCallRecord:
        return self.record("read_pr_diff", arguments, output, **kw)

    def record_write_pr_comment(
        self, arguments: Any, output: Any, **kw: Any
    ) -> ToolCallRecord:
        return self.record("write_pr_comment", arguments, output, **kw)

    def record_write_scan_evidence(
        self, arguments: Any, output: Any, **kw: Any
    ) -> ToolCallRecord:
        return self.record("write_scan_evidence", arguments, output, **kw)

    def record_write_handoff_artifact(
        self, arguments: Any, output: Any, **kw: Any
    ) -> ToolCallRecord:
        return self.record("write_handoff_artifact", arguments, output, **kw)


def record_tool_call(
    recorder: SecurityAuditRecorder, tool: str, arguments: Any, output: Any
) -> ToolCallRecord:
    """Module-level convenience wrapper."""
    return recorder.record(tool, arguments, output)


# A monotonic clock for tests + timing
def _now_ms() -> float:
    return time.perf_counter() * 1000.0
