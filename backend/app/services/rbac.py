"""RBAC service — checks permission strings against a user's role bundle."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from uuid import UUID

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.services.policy_engine import PolicyEngine, PolicyResult, policy_engine

logger = get_logger(__name__)


# F-800 — Co-pilot permission catalog.
#
# Permissions are strings; the JWT carries the granted subset under the
# ``forge.permissions`` claim. The catalog below is the source of truth
# for what strings exist; the API deps (``require_permission``) and the
# tool dispatcher reference these constants so a typo shows up at
# import time, not at request time.
COPILOT_PERMISSION_USE = "copilot:use"
COPILOT_PERMISSION_TOOLS_PREFIX = "copilot:tool:"

# Per-tool permission constants — one per V1 tool from spec §3.3.
# Use :func:`copilot_tool_permission` if you only have a tool name.
COPILOT_PERMISSION_TOOL_SEARCH_KNOWLEDGE = "copilot:tool:search_knowledge"
COPILOT_PERMISSION_TOOL_GET_SERVICE = "copilot:tool:get_service"
COPILOT_PERMISSION_TOOL_GET_ADR = "copilot:tool:get_adr"
COPILOT_PERMISSION_TOOL_LIST_RECENT_ADRS = "copilot:tool:list_recent_adrs"
COPILOT_PERMISSION_TOOL_GET_STANDARDS = "copilot:tool:get_standards"
COPILOT_PERMISSION_TOOL_GET_TEMPLATE = "copilot:tool:get_template"
COPILOT_PERMISSION_TOOL_NAVIGATE_TO = "copilot:tool:navigate_to"
COPILOT_PERMISSION_TOOL_DRAFT_ARTIFACT = "copilot:tool:draft_artifact"
COPILOT_PERMISSION_TOOL_RUN_COMMAND = "copilot:tool:run_command"
COPILOT_PERMISSION_TOOL_CHECK_BUDGET = "copilot:tool:check_budget"
COPILOT_PERMISSION_TOOL_AUDIT_EVENT = "copilot:tool:audit_event"


def copilot_tool_permission(tool_name: str) -> str:
    """Return the canonical ``copilot:tool:<name>`` permission string.

    Args:
        tool_name: The tool's canonical name (matches ``Tool.name``).

    Returns:
        The permission string the RBAC layer checks.

    Raises:
        ValueError: If ``tool_name`` is empty.
    """
    if not tool_name or not isinstance(tool_name, str):
        raise ValueError("tool_name must be a non-empty string")
    return f"{COPILOT_PERMISSION_TOOLS_PREFIX}{tool_name}"


@dataclass(frozen=True)
class Permission:
    """A `<resource>:<action>` permission."""

    resource: str
    action: str

    @classmethod
    def parse(cls, raw: str) -> "Permission":
        if ":" not in raw:
            raise ValueError(f"invalid permission string: {raw!r}")
        r, a = raw.split(":", 1)
        return cls(resource=r, action=a)

    def matches(self, other: "Permission") -> bool:
        return self.resource == other.resource and (
            self.action == other.action or self.action == "*" or other.action == "*"
        )


class RBACService:
    """Permission check helper used by FastAPI deps.

    For Phase 2 the role permission lists are passed in directly; the
    DB-backed role lookup lands in the next phase.
    """

    def __init__(self, policy_engine: PolicyEngine | None = None) -> None:
        self._policy_engine = policy_engine or policy_engine

    def expand_permissions(self, role_permissions: Iterable[Iterable[str]]) -> set[Permission]:
        out: set[Permission] = set()
        for perms in role_permissions:
            for raw in perms or []:
                try:
                    out.add(Permission.parse(raw))
                except ValueError:
                    logger.warning("rbac.invalid_permission", raw=raw)
        return out

    def has_permission(self, principal: AuthenticatedPrincipal, required: str) -> bool:
        # The principal's roles are strings like 'forge:admin'. Until
        # the role lookup lands, we grant 'forge:admin' and tenant
        # super-users all permissions; everyone else needs the role.
        if "forge:admin" in principal.roles or "tenant:admin" in principal.roles:
            return True
        # Roles carry inline permissions in the JWT (resource:action list).
        inline = principal.raw_claims.get("forge.permissions") or []
        if not isinstance(inline, list):
            return False
        needed = Permission.parse(required)
        try:
            owned = {Permission.parse(p) for p in inline}
        except ValueError:
            return False
        return any(p.matches(needed) for p in owned)

    async def check(
        self,
        principal: AuthenticatedPrincipal,
        required: str,
        *,
        policy_id: UUID | str | None = None,
        context: dict | None = None,
    ) -> PolicyResult:
        """Combine RBAC and policy engine for a single decision.

        policy_id is optional — when present, the policy engine gets
        the final say (e.g. cost gates regardless of role).
        """
        if not self.has_permission(principal, required):
            return PolicyResult(
                allowed=False,
                reason=f"rbac_denied:{required}",
                obligations=["request_access"],
            )
        if policy_id is None:
            return PolicyResult(allowed=True, reason="rbac_ok")
        return await self._policy_engine.evaluate(
            policy_id,
            context or {"user": {"id": principal.user_id, "roles": principal.roles}},
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
        )


rbac = RBACService()


__all__ = [
    "RBACService",
    "Permission",
    "rbac",
    "COPILOT_PERMISSION_USE",
    "COPILOT_PERMISSION_TOOLS_PREFIX",
    "COPILOT_PERMISSION_TOOL_SEARCH_KNOWLEDGE",
    "COPILOT_PERMISSION_TOOL_GET_SERVICE",
    "COPILOT_PERMISSION_TOOL_GET_ADR",
    "COPILOT_PERMISSION_TOOL_LIST_RECENT_ADRS",
    "COPILOT_PERMISSION_TOOL_GET_STANDARDS",
    "COPILOT_PERMISSION_TOOL_GET_TEMPLATE",
    "COPILOT_PERMISSION_TOOL_NAVIGATE_TO",
    "COPILOT_PERMISSION_TOOL_DRAFT_ARTIFACT",
    "COPILOT_PERMISSION_TOOL_RUN_COMMAND",
    "COPILOT_PERMISSION_TOOL_CHECK_BUDGET",
    "COPILOT_PERMISSION_TOOL_AUDIT_EVENT",
    "copilot_tool_permission",
]  # noqa: E501
