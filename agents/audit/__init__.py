"""
The Audit system (FORA-36, formerly FORA-21).

Append-only event store of every agent action.  See
`docs/adr/0001-audit-system-one-way-doors.md` for the one-way-door
decisions and `agents/audit/README.md` for the operational contract.

Public surface:

    AuditEvent          -- the event shape (issue body, verbatim)
    AuditStore          -- the protocol; InMemoryStore and PostgresStore
                           are the shipped implementations
    InMemoryStore       -- append-only, chain-hashed, file-backed (dev)
    HashChain           -- the per-(tenant, run) chain verifier
    RetentionPolicy     -- per-tenant retention hook
    AuditReader         -- the read API consumed by FORA-75 cost and
                           FORA-110 master orchestrator
    AuditAdmin          -- the admin-override path; every admin action
                           emits its own audit event
    emit_tool_call      -- the helper the runtime uses to emit one event
                           per tool call
    AUDIT_SCHEMA_VERSION

The store is the seam: production code paths use PostgresStore + SQS
shipping (per ADR-0001 §D3); the dev/test paths use InMemoryStore with
a JSON-lines file for persistence.  A bug in the seam is a P0; the
acceptance test in `agents/audit/tests/test_emit.py` exercises it.
"""

from .schema import (
    AUDIT_SCHEMA_VERSION,
    AuditEvent,
    AuditEventType,
    canonical_json,
    digest_of,
)
from .chain import HashChain, ChainBreak, GENESIS_HASH
from .store import AuditStore, InMemoryStore
from .retention import RetentionPolicy, DEFAULT_RETENTION, apply_retention
from .reader import AuditReader
from .admin import AuditAdmin, AdminOverride
from .emit import emit_tool_call, emit_run_started, emit_run_finished

__all__ = [
    "AUDIT_SCHEMA_VERSION",
    "AuditEvent",
    "AuditEventType",
    "canonical_json",
    "digest_of",
    "HashChain",
    "ChainBreak",
    "GENESIS_HASH",
    "AuditStore",
    "InMemoryStore",
    "RetentionPolicy",
    "DEFAULT_RETENTION",
    "apply_retention",
    "AuditReader",
    "AuditAdmin",
    "AdminOverride",
    "emit_tool_call",
    "emit_run_started",
    "emit_run_finished",
]
