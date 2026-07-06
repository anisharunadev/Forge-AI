"""Co-pilot tool: ``audit_event``.

Emits an :class:`AuditEvent` row from the Co-pilot context. The Co-pilot
needs to leave an audit trail for actions the *user* took via its
suggestions (e.g. "user clicked the deep-link"). The model can call this
tool to record such events without going through the API layer.

The tool is intentionally simple: a thin wrapper over
:func:`audit_service.record` with the principal's user_id stamped on
the actor field. Rule 6 (Mandatory Auditability) is satisfied as long
as every Co-pilot action that mutates state also calls this tool (or
goes through the typed tool layer, which audits itself).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.services.audit_service import audit_service
from app.services.rbac import COPILOT_PERMISSION_TOOL_AUDIT_EVENT

logger = get_logger(__name__)


class AuditEventTool:
    """Record a Co-pilot-originated audit event."""

    name = "audit_event"
    description = (
        "Emit an audit event from the Co-pilot context. Use when the "
        "model wants to record that the user acted on a suggestion "
        "(e.g. clicked a navigation link, exported an artifact). The "
        "audit event is tenant-scoped and attributed to the principal."
    )
    permission = COPILOT_PERMISSION_TOOL_AUDIT_EVENT
    rate_limit_per_min = 60
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "minLength": 1},
            "target_type": {"type": "string", "minLength": 1},
            "target_id": {"type": "string", "minLength": 1},
            "payload": {"type": "object", "additionalProperties": True, "default": {}},
        },
        "required": ["action", "target_type", "target_id"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        args: dict[str, Any],
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> dict[str, Any]:
        action = args.get("action")
        target_type = args.get("target_type")
        target_id = args.get("target_id")
        if not all(isinstance(v, str) and v.strip() for v in (action, target_type, target_id)):
            raise ToolArgumentInvalid(
                self.name,
                "action, target_type, and target_id must be non-empty strings",
            )
        payload = args.get("payload") or {}
        if not isinstance(payload, dict):
            raise ToolArgumentInvalid(self.name, "payload must be an object", field="payload")

        emitted_at = datetime.now(UTC)
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=principal.user_id,
            action=action.strip(),
            target_type=target_type.strip(),
            target_id=target_id.strip(),
            payload=dict(payload),
            occurred_at=emitted_at,
        )
        event_id = uuid4()
        logger.info(
            "copilot.tool.audit_event",
            tenant_id=str(tenant_id),
            project_id=str(project_id) if project_id else None,
            principal=principal.user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
        )
        return {
            "audit_event_id": str(event_id),
            "emitted_at": emitted_at.isoformat(),
        }


tool_registry.register(AuditEventTool())


__all__ = ["AuditEventTool"]
