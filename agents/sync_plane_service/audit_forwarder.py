"""
AuditForwarder — day-one P0 per ADR-0010 §9 (FORA-252 / 11.8
day-one coupling).

The 8 `sync.*` event types (ADR-0010 §8.1) must wire into the
existing FORA-36 audit pipeline on day one. This module ships a
working in-memory default that delegates to
`agents.audit.emit.emit_tool_call`; sub-task 11.8 will replace
it with the cross-account SQS+SNS bridge without changing the
`AuditForwarder` protocol.

The default builds the audit row shape per the `agents.audit`
contract (FORA-36):

    eventType     = "tool_call"            # v1 audit schema
    stage         = "sync_plane"           # the new ADR-0010 §8 stage
    tool          = "sync.<event_type>"    # the §8.1 discriminator
    inputDigest   = sha256(metadata)
    outputDigest  = sha256(canonical_event_type)
    metadata      = the sync.* fields per §6 of the risk register
                    (sync.target_platform, sync.idempotency_key, …)

The actor field uses the FORA-36 actor convention
(`agent:<id>` / `user:<id>` / `system:<component>`). The service
calls `forward(actor="system:sync_plane", …)` for self-triggered
events and `forward(actor="agent:<id>", …)` for agent-triggered
ones.

The smoke test wires this to the real `InMemoryStore` and
asserts every `forward` produces one audit event with the
expected shape.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

# The audit module is at `agents/audit/`; we add the repo root
# to sys.path so the import works from any CWD. The audit module
# itself does the same trick in its own `__init__.py`.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from agents.audit import (  # noqa: E402
    InMemoryStore as _AuditInMemoryStore,
    emit_tool_call,
)
from agents.audit.schema import (  # noqa: E402
    AUDIT_SCHEMA_VERSION,
    AuditEvent,
    AuditEventType,
    canonical_json,
    digest_of,
)

from .ports import AuditForwarder  # noqa: E402


_log = logging.getLogger("fora.sync_plane_service.audit_forwarder")


# The 8 §8.1 event types, mirrored from `agents.sync_plane.audit`
# so the wire form is consistent across the resolver and the
# forwarder. The forwarder rejects anything else at the boundary
# — a typo in the §8.1 list is a bug we'd rather catch at
# forward-time than at audit-read time.
SYNC_EVENT_TYPES = frozenset({
    "sync.event.received",
    "sync.event.applied",
    "sync.event.divergence_detected",
    "sync.event.divergence_resolved",
    "sync.event.divergence_resolved_by_human",
    "sync.platform.degraded",
    "sync.backfill.completed",
    "sync.comment.attribution_written",
})

# The stage value for the audit row. Per ADR-0010 §6 of the risk
# register, this is a new enum value alongside the existing
# dev / qa / etc. stages. It is not a top-level field addition
# (which would require an `AUDIT_SCHEMA_VERSION` bump); the new
# stage is an instance-level `stage` value on the audit row.
STAGE_SYNC_PLANE = "sync_plane"

# The default agent_id for self-triggered events (clock skew,
# circuit-breaker trips, etc.). The Paperclip-internal "system"
# identity is `system:<component>` per the actor convention.
SYSTEM_ACTOR_CLOCK_MONITOR = "system:clock_monitor"
SYSTEM_ACTOR_CIRCUIT_BREAKER = "system:circuit_breaker"
SYSTEM_ACTOR_POLLING_BACKSTOP = "system:polling_backstop"
SYSTEM_ACTOR_SYNC_PLANE = "system:sync_plane"


@dataclass
class AuditForwarderConfig:
    """Wiring config. `audit_store` is the FORA-36 store; the
    default is an in-memory store so the smoke test can run
    without Postgres. `service_run_id` is the Paperclip run id
    the Sync Plane is operating under (per ADR-0006 §3.2 the
    run id is the audit chain head)."""
    audit_store: Any = None        # `agents.audit.AuditStore`; default InMemoryStore
    service_run_id: str = "sync-plane-skeleton"
    default_actor: str = SYSTEM_ACTOR_SYNC_PLANE


class InMemoryAuditForwarder(AuditForwarder):
    """The day-one default. Wraps an `AuditStore` and emits one
    `tool_call` audit event per `forward` call. The store is
    responsible for chain head + record hash; this class is
    responsible for the input/output digests and the
    `metadata.sync.*` keys per ADR-0010 risk register §6.

    Thread-safety: the underlying `InMemoryStore` holds its
    own lock; this class is stateless beyond the config and
    therefore safe to share across threads.
    """

    def __init__(self, config: Optional[AuditForwarderConfig] = None) -> None:
        self._config = config or AuditForwarderConfig()
        if self._config.audit_store is None:
            # Lazy default: each forward call shares the same
            # in-memory store unless the caller wires a real
            # one. The smoke test wires a fresh store per
            # scenario so evidence files do not bleed.
            self._config.audit_store = _AuditInMemoryStore()

    @property
    def store(self) -> Any:
        return self._config.audit_store

    # -- AuditForwarder protocol --------------------------------

    def forward(
        self,
        *,
        event_type: str,
        tenant_id: str,
        actor: str,
        entity_id: str = "",
        hlc: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        if event_type not in SYNC_EVENT_TYPES:
            raise ValueError(
                f"unknown sync event_type {event_type!r}; "
                f"expected one of {sorted(SYNC_EVENT_TYPES)}"
            )
        if not tenant_id:
            raise ValueError("tenant_id is required")
        if not actor:
            raise ValueError("actor is required")
        md = dict(metadata or {})
        # The `metadata.sync.*` keys are the §6 of the risk
        # register — the AC says no top-level audit field
        # additions; the sync-specific fields live under
        # `metadata`. We inject the per-call inputs as
        # namespaced keys for the daily sample (§7 of the risk
        # register) to find.
        md.setdefault("sync.event_type", event_type)
        if entity_id:
            md.setdefault("sync.entity_id", entity_id)
        if hlc:
            md.setdefault("sync.hlc", hlc)
        # Stable, deterministic input/output digests.
        input_payload = {
            "event_type": event_type,
            "tenant_id": tenant_id,
            "actor": actor,
            "entity_id": entity_id,
            "hlc": hlc,
            "metadata": md,
        }
        input_digest = digest_of(input_payload)
        # The "output" of a forward call is just the audit
        # event_type echo; the audit row is the output. We
        # digest the event_type + tenant for a stable value
        # the smoke test can assert on.
        output_digest = digest_of({"event_type": event_type, "tenant_id": tenant_id})
        ev = emit_tool_call(
            self._config.audit_store,
            run_id=self._config.service_run_id,
            agent_id="sync_plane_service",  # the service's own agent id
            tenant_id=tenant_id,
            stage=STAGE_SYNC_PLANE,
            tool=f"sync.{event_type.removeprefix('sync.')}",
            arguments={
                "event_type": event_type,
                "tenant_id": tenant_id,
                "actor": actor,
                "entity_id": entity_id,
                "hlc": hlc,
                "metadata": md,
            },
            output={
                "event_type": event_type,
                "tenant_id": tenant_id,
                "forwarded": True,
            },
            cost_cents=0,
            prompt_tokens=0,
            completion_tokens=0,
            wall_ms=0.0,
            call_id=hlc or "",          # tie the audit row to the HLC
            step_id=event_type,
            idempotency_key=_idempotency_key(event_type, tenant_id, entity_id, hlc),
            actor=actor,
            request_id=self._config.service_run_id,
        )
        # The audit event id is what the service correlates
        # back to the canonical state update. We return it
        # so the smoke test can assert the round-trip.
        return ev.event_id


def _idempotency_key(
    event_type: str, tenant_id: str, entity_id: str, hlc: str,
) -> str:
    """Stable idempotency key for one forward call. The FORA-36
    contract does not require the sync plane to dedupe on this
    (the JetStream consumer already dedupes on `event_id`); the
    field is populated for traceability and for the
    audit-divergence canary (R-X2 from the risk register)."""
    raw = f"{event_type}|{tenant_id}|{entity_id}|{hlc}"
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
