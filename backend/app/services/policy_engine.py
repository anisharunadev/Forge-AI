"""Policy engine — JSONLogic/CEL expression evaluator with caching.

Policies live in the DB and are compiled into a Python callable
on first use, then cached until the row is updated. The engine is
shared by Approval Engine, RBAC, and the Connector State Machine.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)


@dataclass
class PolicyResult:
    """Outcome of a policy evaluation."""

    allowed: bool
    reason: str
    obligations: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "obligations": list(self.obligations),
        }


CompiledPolicy = Callable[[dict[str, Any]], bool]


class PolicyEngine:
    """In-memory compiled-policy cache + dispatcher.

    For Phase 2 we implement a conservative JSONLogic-compatible
    interpreter inline so we don't take on a hard dependency yet.
    When CEL is needed, swap `_compile` for a celpy-based backend.
    """

    def __init__(self, bus: Any | None = None) -> None:
        self._cache: dict[str, CompiledPolicy] = {}
        self._bus = bus or default_bus

    @staticmethod
    def _key(tenant_id: UUID | str, policy_id: UUID | str) -> str:
        return f"{tenant_id}::{policy_id}"

    def invalidate(self, tenant_id: UUID | str, policy_id: UUID | str) -> None:
        self._cache.pop(self._key(tenant_id, policy_id), None)

    def invalidate_tenant(self, tenant_id: UUID | str) -> None:
        prefix = f"{tenant_id}::"
        for k in list(self._cache.keys()):
            if k.startswith(prefix):
                self._cache.pop(k, None)

    def register(
        self,
        policy_id: UUID | str,
        expression: dict[str, Any],
        *,
        tenant_id: UUID | str,
    ) -> CompiledPolicy:
        """Compile and cache a policy expression.

        The expression format is JSONLogic:

            {"==": [{"var": "user.role"}, "admin"]}
            {"and": [{...}, {...}]}
            {">": [{"var": "cost.cumulative_usd"}, 1000]}
        """
        key = self._key(tenant_id, policy_id)
        compiled = self._compile(expression)
        self._cache[key] = compiled
        return compiled

    def _compile(self, expression: dict[str, Any]) -> CompiledPolicy:
        """Compile a JSONLogic expression to a Python callable.

        Supports: var, ==, !=, <, >, <=, >=, and, or, not, !, in.
        """
        op = next(iter(expression)) if expression else None
        args = expression.get(op) if op else None

        if op in (None, "true"):
            return lambda _ctx: True
        if op == "false":
            return lambda _ctx: False

        if op == "var":
            path = args if isinstance(args, str) else (args[0] if args else "")
            default = args[1] if isinstance(args, list) and len(args) > 1 else None

            def _var(ctx: dict[str, Any], _path: str = path, _default: Any = default) -> Any:
                cur: Any = ctx
                for part in _path.split("."):
                    if isinstance(cur, dict) and part in cur:
                        cur = cur[part]
                    else:
                        return _default
                return cur

            return lambda ctx: bool(_var(ctx))

        if op in {"==", "!=", "<", ">", "<=", ">="}:
            compiled_args = [
                self._compile(a) if isinstance(a, dict) else (lambda _x, v=a: v) for a in args
            ]
            ops: dict[str, Callable[[Any, Any], bool]] = {
                "==": lambda a, b: a == b,
                "!=": lambda a, b: a != b,
                "<": lambda a, b: a < b,
                ">": lambda a, b: a > b,
                "<=": lambda a, b: a <= b,
                ">=": lambda a, b: a >= b,
            }

            def _cmp(ctx: dict[str, Any], _ops_args=ops[op], _compiled=compiled_args) -> bool:
                vals = [c(ctx) for c in _compiled]
                return _ops_args(*vals)

            return _cmp

        if op == "and":
            compiled_args = [self._compile(a) for a in args or []]
            return lambda ctx, _compiled=compiled_args: all(c(ctx) for c in _compiled)
        if op == "or":
            compiled_args = [self._compile(a) for a in args or []]
            return lambda ctx, _compiled=compiled_args: any(c(ctx) for c in _compiled)
        if op in {"!", "not"}:
            inner = self._compile(args if isinstance(args, dict) else {"true": True})
            return lambda ctx, _inner=inner: not _inner(ctx)
        if op == "in":
            compiled_a = (
                self._compile(args[0]) if isinstance(args[0], dict) else (lambda _x, v=args[0]: v)
            )
            compiled_b = (
                self._compile(args[1]) if isinstance(args[1], dict) else (lambda _x, v=args[1]: v)
            )
            return lambda ctx, _a=compiled_a, _b=compiled_b: _a(ctx) in _b(ctx)

        raise ValueError(f"unsupported policy operator: {op!r}")

    async def evaluate(
        self,
        policy_id: UUID | str,
        context: dict[str, Any],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        obligations: list[str] | None = None,
    ) -> PolicyResult:
        """Evaluate a cached or freshly-provided policy.

        If the policy isn't in cache, we treat it as a default-allow
        placeholder and log a warning; the registry will populate the
        cache when policies are loaded from the DB.
        """
        compiled = self._cache.get(self._key(tenant_id, policy_id))
        if compiled is None:
            logger.warning("policy.cache_miss", policy_id=str(policy_id))
            result = PolicyResult(allowed=True, reason="policy_not_loaded_default_allow")
        else:
            try:
                allowed = bool(compiled(context))
            except Exception as exc:  # noqa: BLE001
                logger.error("policy.eval_error", policy_id=str(policy_id), error=str(exc))
                result = PolicyResult(allowed=False, reason=f"policy_eval_error: {exc}")
            else:
                result = PolicyResult(
                    allowed=allowed,
                    reason="matched" if allowed else "denied_by_policy",
                    obligations=list(obligations or []),
                )

        await self._bus.publish(
            EventType.POLICY_EVALUATED,
            {
                "policy_id": str(policy_id),
                "allowed": result.allowed,
                "reason": result.reason,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return result


policy_engine = PolicyEngine()


__all__ = ["PolicyEngine", "PolicyResult", "policy_engine"]
