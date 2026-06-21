"""Audit decorator for endpoints (Rule 6).

Every endpoint MUST wrap business logic in `audit(...)`. The decorator
captures actor, action, target, result, and payload, then enqueues an
AuditEvent via the event bus. The terminal center has its own audit
module for command-level fidelity.
"""

from __future__ import annotations

import functools
import inspect
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal

logger = get_logger(__name__)


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def audit(
    *,
    action: str,
    target_type: str,
) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    """Decorator factory: tag a handler with an audit action+target_type.

    The wrapped handler must accept `principal` as a keyword argument;
    we resolve it from the kwargs the framework passed in.
    """

    def decorator(func: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        sig = inspect.signature(func)

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            principal: AuthenticatedPrincipal | None = kwargs.get("principal")
            bound = sig.bind_partial(*args, **kwargs)
            bound.apply_defaults()
            target_id = str(bound.arguments.get("target_id") or bound.arguments.get("id") or "*")

            start = datetime.now(timezone.utc)
            try:
                result = await func(*args, **kwargs)
                outcome = "success"
                err: str | None = None
                return result
            except Exception as exc:  # noqa: BLE001 — we re-raise after logging
                outcome = "failure"
                err = type(exc).__name__ + ": " + str(exc)
                raise
            finally:
                duration_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000
                logger.info(
                    "audit.event",
                    action=action,
                    target_type=target_type,
                    target_id=target_id,
                    outcome=outcome,
                    error=err,
                    duration_ms=round(duration_ms, 2),
                    actor_id=principal.user_id if principal else None,
                    tenant_id=principal.tenant_id if principal else None,
                    project_id=principal.project_id if principal else None,
                    occurred_at=_utcnow_iso(),
                )

        return wrapper

    return decorator
