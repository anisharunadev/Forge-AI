"""
Admin override path (FORA-36 acceptance: "Deleting/editing an audit
record requires explicit admin override and itself emits an audit
record.").

`AuditAdmin` is the only sanctioned way to mutate the audit store.
Every method emits a synthetic `admin_override` event chained to
the same (tenant, run) pair so the head always advances and the
override is itself a permanent, hash-chained record.

The admin path is rate-limited and alerted on in production; the
1Password-held `audit_admin` credentials rotate every 90 days
(per `memory/security.md §7` and ADR-0001 §D3).  In dev there is
no rate limit; the path is the same so the chain contract is
exercised in tests.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Optional

from .schema import AuditEvent, AuditEventType
from .store import AuditStore


_log = logging.getLogger("fora.audit.admin")


@dataclass
class AdminOverride:
    """The record of an admin action.  The action is performed
    inside the store; this object is what gets returned for
    audit-of-audit purposes."""
    event: AuditEvent                # the admin_override event we emitted
    target_event_id: str             # the event we acted on
    action: str                      # "redact" | "delete" | "metadata_set"
    reason: str                      # human-supplied; persisted on the event
    actor: str                       # "admin:<user-id>" -- who pulled the credential


class AuditAdmin:
    """The admin-override surface.  Constructed with a store and a
    tenant scope; refuses to act on events outside that scope."""

    def __init__(self, store: AuditStore, *, default_tenant_id: Optional[str] = None) -> None:
        self._store = store
        self._default_tenant_id = default_tenant_id

    def redact(self, *, tenant_id: str, run_id: str, target_event_id: str,
               actor: str, reason: str) -> AdminOverride:
        """Redact `target_event_id`.  The original event is not
        removed; a synthetic `event_redacted` is appended to the
        (tenant, run) chain so the head advances and the action
        is auditable.  The reader surfaces the redaction as a
        chain break with reason 'event_redacted' rather than a
        verification failure (see `HashChain.verify`)."""
        if not reason or len(reason) < 8:
            raise ValueError("admin.reason must be a non-trivial string (>= 8 chars)")
        if not actor.startswith("admin:"):
            raise ValueError("admin.actor must be of the form 'admin:<user-id>'")
        target = self._store.get(target_event_id)
        if target is None or target.tenant_id != tenant_id or target.run_id != run_id:
            raise PermissionError(
                f"refusing to redact {target_event_id!r}: not in ({tenant_id!r}, {run_id!r})"
            )
        synth = AuditEvent(
            event_id=f"evt-redact-{uuid.uuid4().hex[:12]}",
            event_type=AuditEventType.EVENT_REDACTED,
            run_id=run_id,
            agent_id=target.agent_id,
            tenant_id=tenant_id,
            stage=target.stage,
            tool=target.tool,
            input_digest=target.input_digest,
            output_digest=target.output_digest,
            cost_cents=target.cost_cents,
            prompt_tokens=target.prompt_tokens,
            completion_tokens=target.completion_tokens,
            wall_ms=target.wall_ms,
            call_id=target.call_id,
            step_id=target.step_id,
            idempotency_key=target.idempotency_key,
            actor=actor,
            metadata={
                "redactedEventId": target_event_id,
                "redactionReason": reason,
            },
        )
        # Chain the synthetic event onto the same (tenant, run) pair.
        self._store.append(synth)
        # Now the admin override event itself.  This is a separate
        # event chained to the same pair; both are permanent.
        override = AuditEvent(
            event_id=f"evt-admin-{uuid.uuid4().hex[:12]}",
            event_type=AuditEventType.ADMIN_OVERRIDE,
            run_id=run_id,
            agent_id=target.agent_id,
            tenant_id=tenant_id,
            stage=target.stage,
            tool=target.tool,
            actor=actor,
            metadata={
                "action": "redact",
                "targetEventId": target_event_id,
                "reason": reason,
            },
        )
        self._store.append(override)
        _log.warning(
            "admin_override action=redact tenant=%s run=%s target=%s actor=%s",
            tenant_id, run_id, target_event_id, actor,
        )
        return AdminOverride(
            event=override,
            target_event_id=target_event_id,
            action="redact",
            reason=reason,
            actor=actor,
        )
