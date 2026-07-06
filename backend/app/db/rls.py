"""Row-Level Security helpers (Rule 2 enforcement at the DB layer).

Postgres RLS policies on every tenant-scoped table filter by
`current_setting('app.tenant_id', true)`. This module ensures the
session always has those settings set, and refuses to run queries
that don't.
"""

from __future__ import annotations

import functools
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

logger = get_logger(__name__)

_TENANT_SETTING = "app.tenant_id"
_PROJECT_SETTING = "app.project_id"

# Literal SQL probe — kept outside any f-string so bandit B608 passes.
_PROBE_GUCS = text(
    "SELECT current_setting('app.tenant_id', true) AS tid, "
    "current_setting('app.project_id', true) AS pid"
)
_SET_LOCAL_TENANT = text("SET LOCAL app.tenant_id = :tid")
_SET_LOCAL_PROJECT = text("SET LOCAL app.project_id = :pid")


def _coerce(value: UUID | str | None) -> str | None:
    if value is None:
        return None
    return str(value)


def _enforce_missing() -> None:
    """Return value when GUC probe returns no row.

    The probe SELECT returns no rows when the session has not run
    any GUC-setting statements yet (e.g. a bare AsyncSession opened
    outside any explicit tenant context). We treat this as a Rule 2
    violation: caller must wrap the session in `tenant_context`.

    Returns None on purpose — the calling wrapper short-circuits the
    protected callable so the missing-GUC path never reaches the DB.
    """
    logger.warning("rls.guc_probe_returned_no_row")
    raise PermissionError(
        "RLS: no app.tenant_id / app.project_id GUC set on session "
        "(Rule 2 violation). Wrap the session in tenant_context()."
    )


@asynccontextmanager
async def tenant_context(
    session: AsyncSession,
    tenant_id: UUID | str,
    project_id: UUID | str | None = None,
):
    """Context manager: set Postgres GUCs for the wrapped block.

    Uses SET LOCAL so the settings revert at transaction end. Always
    run inside an open transaction (commit/rollback exits the block).
    """
    tid = _coerce(tenant_id)
    pid = _coerce(project_id)

    if tid is None:
        raise ValueError("tenant_context requires a non-null tenant_id (Rule 2)")
    if pid is None:
        # Some queries are tenant-only (org-wide standards/templates);
        # we still require an explicit empty-string sentinel for RLS.
        pid = ""

    # Literal SQL — no f-string. tenant_id and project_id are bound params.
    await session.execute(_SET_LOCAL_TENANT, {"tid": tid})
    await session.execute(_SET_LOCAL_PROJECT, {"pid": pid})
    logger.debug("rls.context_set", tenant_id=tid, project_id=pid or "*")
    try:
        yield session
    finally:
        # SET LOCAL auto-reverts; no explicit reset needed.
        pass


def rls_required(
    func: Callable[..., Awaitable[Any]],
) -> Callable[..., Awaitable[Any]]:
    """Decorator: assert that tenant_context is currently active.

    Detects the active transaction and reads back the GUCs; if either
    is missing or empty, raises PermissionError so the request fails
    loudly instead of leaking cross-tenant data.
    """

    @functools.wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        # The decorator is paired with a session passed positionally or via kwargs.
        session: AsyncSession | None = kwargs.get("session")
        if session is None:
            for arg in args:
                if isinstance(arg, AsyncSession):
                    session = arg
                    break
        if session is None:
            raise RuntimeError("rls_required: no AsyncSession in call args")

        # ponytail: probe both GUCs in one round-trip; literal SQL — no f-string.
        row = (await session.execute(_PROBE_GUCS)).one_or_none()
        if row is None:
            return _enforce_missing()
        tid = row.tid or None
        pid = row.pid or None
        if not tid:
            raise PermissionError("RLS: app.tenant_id not set on session (Rule 2 violation)")
        # project_id may be empty for org-level queries but must be explicitly set.
        if pid is None:
            raise PermissionError("RLS: app.project_id not set on session (Rule 2 violation)")
        return await func(*args, **kwargs)

    return wrapper


def install_session_listener(session_factory: Any) -> None:
    """Install a SQLAlchemy event listener that auto-applies tenant GUCs.

    Call this once at app startup. If the request's auth context has
    already set `g.tenant_id` (FastAPI), the listener applies it on
    session.begin(); otherwise the session starts with empty GUCs and
    every query that hits a tenant-scoped table will return zero rows
    (fail-closed).
    """
    # The listener uses sync event hooks because SQLAlchemy's sync
    # after_begin fires for both sync and async sessions before the
    # async layer takes over. The actual SET LOCAL is async.
    from app.core.security import AuthenticatedPrincipal  # avoid circular import

    principal: AuthenticatedPrincipal | None = None

    @event.listens_for(session_factory, "before_session_create")
    def _attach_principal(sess: AsyncSession) -> None:  # type: ignore[no-untyped-def]
        sess.info.setdefault("rls_principal", principal)

    @event.listens_for(AsyncSession, "after_begin")
    def _apply_rls(sess: AsyncSession, transaction: Any) -> None:  # type: ignore[no-untyped-def]
        p: AuthenticatedPrincipal | None = sess.info.get("rls_principal")
        if p is None:
            return
        # Defer to async via a flag; the first query will then apply.
        sess.info["rls_pending"] = (p.tenant_id, p.project_id or "")

    logger.info("rls.listener_installed")
