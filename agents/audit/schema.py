"""
Audit event schema (FORA-36).

The shape is fixed by the issue body; the contract is what every
downstream (FORA-75 cost, FORA-110 orchestrator, the board read view)
consumes.  A change to any field name or type is a breaking change:
bump `AUDIT_SCHEMA_VERSION` and update the worked example in the ADR
together.

Versioning
----------
* 0.1.0  — initial (FORA-36 acceptance criteria).
* 0.2.0  — Phase 3 §D (FORA-495). Adds two merge-block event types,
           ``artifact.rejected.merge`` and ``artifact.cleared.merge``,
           plus the merge-block metadata contract documented below.
           The event envelope is unchanged; the new event kinds carry
           merge-specific fields in the ``metadata`` dict and reuse
           the existing ``run_id`` for the Audit join key.

Merge-block event metadata contract (FORA-495 / Phase 3 §D)
---------------------------------------------------------
Both ``REJECTED_MERGE`` and ``CLEARED_MERGE`` carry the following
fields in the event's ``metadata`` dict (so the envelope shape stays
single-purpose and the chain hash stays stable across kinds):

    ruleId           (str)   — the MergeBlockRule.ruleId from the rule set.
    clearUrl         (str)   — human-clear URL: the Paperclip approval
                               surface for the originating rule, or the
                               record URL once cleared.
    clearRole        (str)   — role-of-record for the clear path
                               (qa_lead, security_lead, devops_lead,
                               cto, board, …).  For CLEARED events this
                               is the role that actually cleared.
    clearSlaHours    (number)— SLA from the rule. Sticky rules use 0.

The reader helper ``AuditReader.merge_block_log`` joins every merge
event for a run into a chronological block/clear log per FORA-495
acceptance criteria.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


AUDIT_SCHEMA_VERSION = "0.2.0"


# ---------------------------------------------------------------------------
# Merge-block metadata contract (Phase 3 §D / FORA-495)
# ---------------------------------------------------------------------------
# Both REJECTED_MERGE and CLEARED_MERGE carry these metadata fields.
# Defined as module-level constants so other modules can reference the
# canonical key names without re-typing them.

MERGE_BLOCK_METADATA_KEYS = ("ruleId", "clearUrl", "clearRole", "clearSlaHours")

MERGE_BLOCK_EVENT_TYPES = ("artifact.rejected.merge", "artifact.cleared.merge")


def merge_block_metadata(
    *,
    rule_id: str,
    clear_url: str,
    clear_role: str,
    clear_sla_hours: float,
) -> Dict[str, Any]:
    """Build the merge-block metadata dict for a REJECTED_MERGE or
    CLEARED_MERGE event.  Field names are camelCase to match the
    envelope's canonical form (``metadata`` survives ``to_dict``)."""
    return {
        "ruleId": rule_id,
        "clearUrl": clear_url,
        "clearRole": clear_role,
        "clearSlaHours": float(clear_sla_hours),
    }


class AuditEventType(str, Enum):
    """The discriminated event kinds.  The schema is uniform; this is
    the field that tells the reader which fields to expect."""
    TOOL_CALL = "tool_call"             # the per-tool-call record
    RUN_STARTED = "run_started"         # boundary; emitted before the first step
    RUN_FINISHED = "run_finished"       # boundary; emitted after the last step
    ADMIN_OVERRIDE = "admin_override"   # the admin-override path was used
    EVENT_REDACTED = "event_redacted"   # an event was redacted/deleted (synthetic)
    SAMPLE_RUN_COMPLETE = "sample_run_complete"  # FORA-210: daily audit sample finished
    # Phase 3 §D (FORA-495).  Emitted by the merge-block evaluator.  The
    # `metadata` field carries ruleId, clearUrl, clearRole, clearSlaHours.
    REJECTED_MERGE = "artifact.rejected.merge"   # rule fired; merge blocked
    CLEARED_MERGE = "artifact.cleared.merge"     # human cleared the block


@dataclass
class AuditEvent:
    """One audit event.  See issue body and ADR-0001 for the contract.

    The required fields come from the issue body verbatim:

        runId, agentId, tenantId, stage, tool, inputDigest, outputDigest,
        costCents, promptTokens, completionTokens, wallMs

    The internal fields carry the chain head, the version, the
    timestamp, the error code, and the body references.  They are
    stable; do not rename without bumping AUDIT_SCHEMA_VERSION.
    """
    # Identity
    event_id: str
    schema_version: str = AUDIT_SCHEMA_VERSION
    event_type: AuditEventType = AuditEventType.TOOL_CALL
    timestamp: str = ""

    # Required by the issue body (verbatim names)
    run_id: str = ""
    agent_id: str = ""
    tenant_id: str = ""
    stage: str = ""
    tool: str = ""
    input_digest: str = ""       # hex SHA-256 of the tool arguments
    output_digest: str = ""      # hex SHA-256 of the tool output (or "" if no output)
    cost_cents: int = 0          # tool cost, in cents
    prompt_tokens: int = 0
    completion_tokens: int = 0
    wall_ms: float = 0.0

    # Optional, stable.  Either all empty or all populated.
    call_id: str = ""            # the runtime's ToolCall.call_id
    step_id: str = ""            # the PlanStep.step_id
    idempotency_key: str = ""
    error_code: str = ""         # typed error code if the step failed
    actor: str = ""              # who initiated the run; e.g. "user:<user-id>", "agent:<agent-id>"
    request_id: str = ""         # paperclip run id, when the run is paperclip-managed
    input_ref: str = ""          # s3://audit-account/.../input.json (or "")
    output_ref: str = ""         # s3://audit-account/.../output.json (or "")
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Chain head + own hash.  These are populated by the store at
    # append time, not by the caller.  `prev_hash` is the hash of the
    # previous event in the (tenant, run) chain, or GENESIS_HASH for
    # the first.
    prev_hash: str = ""
    record_hash: str = ""

    def __post_init__(self) -> None:
        if not self.event_id:
            self.event_id = f"evt-{uuid.uuid4().hex[:16]}"
        if not self.timestamp:
            self.timestamp = _now()

    # -- canonical form -----------------------------------------------------

    def canonical_bytes(self) -> bytes:
        """A stable JSON representation used for hashing.  Excludes
        `record_hash` (the field being computed) and any empty
        optional fields.  Stable across processes and Python
        versions is the property the chain depends on."""
        return canonical_json(self.to_dict(include_hash=False)).encode("utf-8")

    def to_dict(self, include_hash: bool = True) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "eventId": self.event_id,
            "schemaVersion": self.schema_version,
            "eventType": self.event_type.value if isinstance(self.event_type, AuditEventType) else self.event_type,
            "timestamp": self.timestamp,
            "runId": self.run_id,
            "agentId": self.agent_id,
            "tenantId": self.tenant_id,
            "stage": self.stage,
            "tool": self.tool,
            "inputDigest": self.input_digest,
            "outputDigest": self.output_digest,
            "costCents": self.cost_cents,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "wallMs": self.wall_ms,
        }
        # Optional fields: keep only when populated.  Stable omission
        # is part of the canonical form; a populated "" is a different
        # canonical form than a missing key.
        for k, v in (
            ("callId", self.call_id),
            ("stepId", self.step_id),
            ("idempotencyKey", self.idempotency_key),
            ("errorCode", self.error_code),
            ("actor", self.actor),
            ("requestId", self.request_id),
            ("inputRef", self.input_ref),
            ("outputRef", self.output_ref),
            ("metadata", self.metadata),
            ("prevHash", self.prev_hash),
        ):
            if v != "" and v != {} and v is not None:
                out[k] = v
        if include_hash and self.record_hash:
            out["recordHash"] = self.record_hash
        return out


def canonical_json(obj: Any) -> str:
    """Stable JSON for hashing.  Sort keys, no whitespace, native
    string for enums, no NaN/Inf."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      default=_json_default, ensure_ascii=False,
                      allow_nan=False)


def _json_default(obj: Any) -> Any:
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, dt.datetime):
        return obj.isoformat()
    raise TypeError(f"not JSON serialisable: {type(obj).__name__}")


def digest_of(payload: Any) -> str:
    """Hex SHA-256 of `payload`.  The payload is canonicalised first
    so two equal inputs always produce the same digest."""
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
