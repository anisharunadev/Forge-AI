"""
Isolation guarantees for the Dependency Scanner (FORA-76).

The dep scanner is the AppSec gate for added or updated
dependencies. It MUST NOT share context with the Coding Agent —
neither the developer's prompt, nor the scratch space, nor the
conversation log. The agent runs in a separate process with a
separate JWT, and the runtime enforces a tool allow-list.

This module is the in-process half of that contract. The scanner
asserts the allow-list at start and refuses any tool not on it;
the smoke test asserts the allow-list is exactly the six tools
in the FORA-76 deliverable and nothing more.

The six tools (per FORA-76 deliverable + §4 of the Security
Agent Design):

  1. read_pr_diff       — pull the immutable handoff artefact
  2. read_lockfile      — read the lockfile diff (only this file)
  3. write_pr_comment   — post the verdict as a sanitised PR comment
  4. write_scan_evidence — write the audit-log row
  5. write_sbom         — emit the CycloneDX SBOM alongside the verdict
  6. write_handoff_artifact — persist the v1.0.0 envelope

The fifth tool (`write_sbom`) is what distinguishes FORA-76 from
FORA-74 — the dep scanner emits a CycloneDX SBOM on every run.

Public surface:

    ALLOWED_TOOLS              — tuple of the six tool names
    ToolAllowList              — runtime check + audit seam
    assert_tool_allowed        — raise if not on the list
    IsolationError             — raised on a violation
    assert_process_identity    — env-based defence-in-depth check
"""

from __future__ import annotations

import os
from typing import FrozenSet, Tuple


# The six tools the dep scanner is allowed to call. The order
# is the order they appear in the FORA-76 deliverable; the
# determinism matters for the audit replay test (AC #4).
ALLOWED_TOOLS: Tuple[str, ...] = (
    "read_pr_diff",
    "read_lockfile",
    "write_pr_comment",
    "write_scan_evidence",
    "write_sbom",
    "write_handoff_artifact",
)

# The forbidden set is the inverse — anything not on `ALLOWED_TOOLS`
# is refused. We list the *common* Coding-Agent tools here so a
# reviewer can see at a glance what the dep scanner must never
# touch. The runtime allow-list is the source of truth; this set
# is documentation + a defence-in-depth check the smoke test asserts.
FORBIDDEN_TOOLS: FrozenSet[str] = frozenset({
    "read_developer_prompt",
    "read_developer_scratch",
    "read_conversation_log",
    "read_plan_output_body",
    "read_code_diff_body",  # only the *digest* is allowed; see HandoffInput
    "read_lockfile_body",   # only the digest is allowed
    "write_source_file",
    "commit_changes",
    "merge_pr",
    "post_jira_comment",
    "post_confluence_page",
    "call_llm",
    "fetch_url",
    "execute_subprocess",    # all subprocess invocations are wrapped inside the agent,
                            # not a "tool call" surfaced to the runtime
})


class IsolationError(RuntimeError):
    """Raised when the dep scanner is asked to call a tool that
    is not on its allow-list. The runtime catches this and aborts
    the run with a typed error code (per `agents/audit/schema.py`
    AUDIT_SCHEMA_VERSION) so the daily audit sample can flag the
    violation."""


class ToolAllowList:
    """Runtime check + audit seam for the dep scanner's allow-list.

    The scanner constructs one of these at start. Every tool call
    goes through `check()` (or the convenience `assert_tool_allowed`).
    A violation raises `IsolationError` and is logged to the audit
    recorder so the daily sample can detect any cross-agent leak.
    """

    def __init__(self, on_violation=None) -> None:
        self._allowed = frozenset(ALLOWED_TOOLS)
        self._on_violation = on_violation

    @property
    def allowed(self) -> FrozenSet[str]:
        return self._allowed

    def check(self, tool: str) -> None:
        """Raise `IsolationError` if `tool` is not on the allow-list."""
        if tool not in self._allowed:
            violation = {
                "tool": tool,
                "allowed": sorted(self._allowed),
            }
            if self._on_violation is not None:
                try:
                    self._on_violation(violation)
                except Exception:  # pragma: no cover — recorder must not raise
                    pass
            raise IsolationError(
                f"dep scanner is not allowed to call {tool!r}; "
                f"allow-list is {sorted(self._allowed)}"
            )


def assert_tool_allowed(tool: str, allow_list: ToolAllowList) -> None:
    """Convenience wrapper — equivalent to `allow_list.check(tool)`."""
    allow_list.check(tool)


# ---------------------------------------------------------------------------
# Environment hook (defence in depth)
# ---------------------------------------------------------------------------

# The runtime sets FORA_AGENT_ID + FORA_RUN_ID + FORA_TENANT_ID on every
# agent process. The dep scanner also asserts FORA_AGENT_ROLE=appsec
# so a misrouted Developer process can't accidentally run the Security
# toolchain (and vice-versa). The orchestrator sets these; the agent
# asserts them and refuses to start otherwise.
REQUIRED_ENV = (
    "FORA_AGENT_ID",
    "FORA_RUN_ID",
    "FORA_TENANT_ID",
    "FORA_AGENT_ROLE",
)


class AgentRoleError(IsolationError):
    """Raised when the process env doesn't match the dep scanner's
    expected identity (FORA_AGENT_ROLE != 'appsec')."""


def assert_process_identity() -> None:
    """Assert the process is wired up as the dep scanner.

    Called from `DepScanner.__init__`. Refuses to start if any of
    `FORA_AGENT_ID`, `FORA_RUN_ID`, `FORA_TENANT_ID` is missing, or
    if `FORA_AGENT_ROLE` is not `appsec`. This is the same check the
    runtime performs on the orchestrator side; the in-process half is
    defence in depth.
    """
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        raise AgentRoleError(
            f"dep scanner process missing identity env vars: {missing!r}"
        )
    role = os.environ.get("FORA_AGENT_ROLE", "")
    if role != "appsec":
        raise AgentRoleError(
            f"FORA_AGENT_ROLE={role!r}; dep scanner requires 'appsec'"
        )