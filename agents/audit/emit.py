"""
Emit helpers (FORA-36 deliverable, runtime integration seam).

The runtime calls one of these once per tool call.  The function
builds the `AuditEvent` from the runtime's `StepRecord` (or from
raw fields for the boundary events), digests the input/output,
and appends to the store.  The store is responsible for the
chain head and the record hash; the emit helper does not touch
either field.

The helpers are the single audit boundary; a tool call that
does not pass through here is an audit gap.  The smoke test in
`agents/runtime/smoke_test.py` is the property test for "every
tool call emits exactly one audit event."
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Mapping, Optional

from .schema import AuditEvent, AuditEventType, digest_of
from .store import AuditStore


_log = logging.getLogger("fora.audit.emit")


def emit_tool_call(
    store: AuditStore,
    *,
    run_id: str,
    agent_id: str,
    tenant_id: str,
    stage: str,
    tool: str,
    arguments: Mapping[str, Any],
    output: Any,
    cost_cents: int,
    prompt_tokens: int,
    completion_tokens: int,
    wall_ms: float,
    call_id: str = "",
    step_id: str = "",
    idempotency_key: str = "",
    error_code: str = "",
    actor: str = "",
    request_id: str = "",
) -> AuditEvent:
    """Build and append one `tool_call` event.  The digests are
    computed from canonicalised JSON of the arguments and output;
    the bodies themselves are not stored on the event (the
    `input_ref` / `output_ref` fields are for the production
    S3-backed path; the dev path is digest-only)."""
    event = AuditEvent(
        event_id="",
        event_type=AuditEventType.TOOL_CALL,
        run_id=run_id,
        agent_id=agent_id,
        tenant_id=tenant_id,
        stage=stage,
        tool=tool,
        input_digest=digest_of(_safe_dict(arguments)),
        output_digest=digest_of(output) if output is not None else "",
        cost_cents=int(cost_cents or 0),
        prompt_tokens=int(prompt_tokens or 0),
        completion_tokens=int(completion_tokens or 0),
        wall_ms=float(wall_ms or 0.0),
        call_id=call_id,
        step_id=step_id,
        idempotency_key=idempotency_key,
        error_code=error_code,
        actor=actor,
        request_id=request_id,
    )
    return store.append(event)


def emit_run_started(
    store: AuditStore,
    *,
    run_id: str,
    agent_id: str,
    tenant_id: str,
    actor: str = "",
    request_id: str = "",
    metadata: Optional[Dict[str, Any]] = None,
) -> AuditEvent:
    """Boundary event: a run has started.  Chained to the (tenant,
    run) pair so the head is well-defined before any tool call
    happens."""
    event = AuditEvent(
        event_id="",
        event_type=AuditEventType.RUN_STARTED,
        run_id=run_id,
        agent_id=agent_id,
        tenant_id=tenant_id,
        stage="",
        tool="",
        input_digest="",
        output_digest="",
        actor=actor,
        request_id=request_id,
        metadata=metadata or {},
    )
    return store.append(event)


def emit_run_finished(
    store: AuditStore,
    *,
    run_id: str,
    agent_id: str,
    tenant_id: str,
    status: str,
    cost_cents: int = 0,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    wall_ms: float = 0.0,
    actor: str = "",
    request_id: str = "",
) -> AuditEvent:
    """Boundary event: a run has finished.  Carries the aggregate
    cost so the cost summary can be reconstructed even if the
    per-step events were lost in a queue outage (defence in
    depth: per-step events are the source of truth)."""
    event = AuditEvent(
        event_id="",
        event_type=AuditEventType.RUN_FINISHED,
        run_id=run_id,
        agent_id=agent_id,
        tenant_id=tenant_id,
        stage="",
        tool="",
        input_digest="",
        output_digest=digest_of({"status": status}),
        cost_cents=int(cost_cents or 0),
        prompt_tokens=int(prompt_tokens or 0),
        completion_tokens=int(completion_tokens or 0),
        wall_ms=float(wall_ms or 0.0),
        actor=actor,
        request_id=request_id,
        metadata={"status": status},
    )
    return store.append(event)


def _safe_dict(d: Mapping[str, Any]) -> Dict[str, Any]:
    """Defensive: a `Mapping` may carry non-JSON values.  We coerce
    to plain dict and let `canonical_json` raise on the rest -- a
    malformed argument is a programming error and should fail
    loudly at emit time, not silently at read time."""
    out: Dict[str, Any] = {}
    for k, v in dict(d).items():
        try:
            json.dumps(v, default=str)
            out[k] = v
        except TypeError:
            out[k] = repr(v)
    return out
