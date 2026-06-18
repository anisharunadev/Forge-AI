"""
Compatibility shim for the audit event-type enum.

The audit module exports `AuditEventType` from
`agents.audit.schema`; the enum values are:

    TOOL_CALL = "tool_call"
    RUN_STARTED = "run_started"
    RUN_FINISHED = "run_finished"
    ADMIN_OVERRIDE = "admin_override"
    EVENT_REDACTED = "event_redacted"

The cost ledger treats `tool_call` as the only cost-bearing
event type (per the audit design v0.1, §4).  This shim isolates
the import so a future rename in the audit module is a one-line
change here.
"""

from __future__ import annotations

from typing import Any


def is_tool_call_event(event_type: Any) -> bool:
    """True iff `event_type` is the `tool_call` AuditEventType.
    Tolerates strings (for tests that pass raw values) and the
    enum itself (production code path)."""
    if event_type is None:
        return False
    val = getattr(event_type, "value", event_type)
    return val == "tool_call"
