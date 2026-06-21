"""RBAC service — checks permission strings against a user's role bundle."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from uuid import UUID

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.services.policy_engine import PolicyEngine, PolicyResult, policy_engine

logger = get_logger(__name__)


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


__all__ = ["RBACService", "Permission", "rbac"]
