"""GSDWrapper — the bridge between Forge AI commands and the GSD engine.

DL-024 White-Labeling Boundary
------------------------------
This module is the **only** sanctioned path through which user-driven
``forge-*`` commands reach the underlying GSD execution engine.

Responsibilities:

1. **Validate** that incoming commands are ``forge-*`` names that exist in
   :data:`FORGE_COMMAND_MAP`. Internal ``gsd-*`` names must never appear
   on this side of the boundary.
2. **Reject** any attempt to call internal ``gsd:*`` commands directly
   via :class:`UnauthorizedCommandError`. (Defense in depth: even if a
   caller knows the internal names, the wrapper will refuse.)
3. **Resolve** the internal command name, attach tenant / project /
   user context, and dispatch.
4. **Audit** every execution — including denials.

The actual execution is delegated to ``@opengsd/gsd-core`` (or its stub
in this repo). Until the real package is published, the wrapper falls
back to an inline stub that mirrors the stub's
``executeGsdCommand(ctx, name)`` async function so behavior can be
exercised end-to-end.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

from app.services.forge_commands import (
    FORGE_COMMAND_MAP,
    ForgeCommand,
    UnknownForgeCommand,
    get_forge_command,
)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class UnauthorizedCommandError(PermissionError):
    """Raised when a caller tries to invoke an internal ``gsd-*`` name.

    This is a hard security boundary: the internal names are an
    implementation detail, never a user-facing surface.
    """

    def __init__(self, name: str) -> None:
        super().__init__(
            f"internal command {name!r} is not callable directly; "
            f"use its forge-* alias from FORGE_COMMAND_MAP"
        )
        self.name = name


class GSDWrapperError(RuntimeError):
    """Raised when the wrapper cannot execute a valid command."""


# ---------------------------------------------------------------------------
# Models (Pydantic-style with stdlib dataclasses — keeps imports cheap)
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ExecutionResult:
    """Outcome of a single ``GSDWrapper.execute`` call."""

    forge_cmd: str
    internal_cmd: str
    tenant_id: str
    project_id: str
    user_id: str
    ok: bool
    output: Any = None
    error: str | None = None
    execution_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started_at: float = field(default_factory=time.time)
    duration_ms: int = 0


@dataclass(slots=True)
class AuditRecord:
    """One row per execution attempt — including denials."""

    execution_id: str
    forge_cmd: str | None
    internal_cmd: str | None
    tenant_id: str
    project_id: str
    user_id: str
    ok: bool
    error: str | None
    timestamp: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Wrapper
# ---------------------------------------------------------------------------

_FORGE_NAME_RE = __import__("re").compile(r"^forge-[a-z][a-z0-9-]*$")
_INTERNAL_PREFIXES = ("gsd-", "gsd:", "gsd_")


class GSDWrapper:
    """Bridge from ``forge-*`` to the underlying GSD engine.

    Parameters
    ----------
    command_map:
        Mapping of ``forge_cmd`` -> :class:`ForgeCommand`. Defaults to the
        process-global :data:`FORGE_COMMAND_MAP`.
    audit_sink:
        Optional callable that accepts an :class:`AuditRecord`. If
        ``None``, records are appended to ``self.audit_log`` in memory.
    """

    def __init__(
        self,
        command_map: Mapping[str, ForgeCommand] = FORGE_COMMAND_MAP,
        audit_sink: Any = None,
    ) -> None:
        self._command_map = command_map
        self._audit_sink = audit_sink
        self.audit_log: list[AuditRecord] = []

    # ---- public API -----------------------------------------------------

    def validate_command(self, forge_cmd: str) -> bool:
        """Return True iff ``forge_cmd`` is a registered ``forge-*`` name."""

        if not _FORGE_NAME_RE.match(forge_cmd):
            return False
        return forge_cmd in self._command_map

    def execute(
        self,
        forge_cmd: str,
        args: Mapping[str, object] | None = None,
        *,
        tenant_id: str,
        project_id: str,
        user_id: str,
    ) -> ExecutionResult:
        """Route a forge-* command to the engine. Audit is automatic."""

        # Defense in depth: never let an internal name through this door.
        if any(forge_cmd.startswith(p) for p in _INTERNAL_PREFIXES):
            err = UnauthorizedCommandError(forge_cmd)
            self._audit(
                AuditRecord(
                    execution_id=str(uuid.uuid4()),
                    forge_cmd=None,
                    internal_cmd=forge_cmd,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    user_id=user_id,
                    ok=False,
                    error=str(err),
                )
            )
            raise err

        if not self.validate_command(forge_cmd):
            try:
                get_forge_command(forge_cmd)
            except UnknownForgeCommand as exc:
                wrapped = GSDWrapperError(str(exc))
                self._audit(
                    AuditRecord(
                        execution_id=str(uuid.uuid4()),
                        forge_cmd=forge_cmd,
                        internal_cmd=None,
                        tenant_id=tenant_id,
                        project_id=project_id,
                        user_id=user_id,
                        ok=False,
                        error=str(wrapped),
                    )
                )
                raise wrapped from exc

        cmd = self._command_map[forge_cmd]
        result = ExecutionResult(
            forge_cmd=cmd.forge_cmd,
            internal_cmd=cmd.internal_cmd,
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
            ok=False,
        )

        start = time.time()
        try:
            output = asyncio.run(
                _dispatch(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    user_id=user_id,
                    internal_cmd=cmd.internal_cmd,
                    args=dict(args or {}),
                )
            )
            result.ok = bool(output.get("ok"))
            result.output = output.get("output")
            if not result.ok:
                result.error = output.get("error") or "engine returned ok=false"
        except Exception as exc:  # noqa: BLE001 - top-level guard
            result.ok = False
            result.error = f"{type(exc).__name__}: {exc}"
        finally:
            result.duration_ms = int((time.time() - start) * 1000)

        self._audit(
            AuditRecord(
                execution_id=result.execution_id,
                forge_cmd=result.forge_cmd,
                internal_cmd=result.internal_cmd,
                tenant_id=result.tenant_id,
                project_id=result.project_id,
                user_id=result.user_id,
                ok=result.ok,
                error=result.error,
            )
        )
        return result

    # ---- internals ------------------------------------------------------

    def _audit(self, record: AuditRecord) -> None:
        self.audit_log.append(record)
        if self._audit_sink is not None:
            try:
                self._audit_sink(record)
            except Exception:  # noqa: BLE001 - audit must never break exec
                # Audit failure is non-fatal; surface in stderr at most.
                import sys

                print(f"[gsd_wrapper] audit sink error: {record.execution_id}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Dispatch — stub that mirrors @opengsd/gsd-core's executeGsdCommand
# ---------------------------------------------------------------------------

async def _dispatch(
    *,
    tenant_id: str,
    project_id: str,
    user_id: str,
    internal_cmd: str,
    args: dict,
) -> dict:
    """Run an internal command.

    Tries to import the real ``@opengsd/gsd-core`` package first; falls
    back to an inline stub that matches the stub's behavior.
    """

    try:
        # The real package, once published, exposes executeGsdCommand
        # that returns a dict-shaped result. The stub under
        # packages/gsd-core-stub is the in-repo stand-in until then.
        from opengsd_gsd_core import executeGsdCommand  # type: ignore[import-not-found]
    except Exception:
        return {
            "ok": True,
            "command": internal_cmd,
            "output": {
                "stub": True,
                "tenant": tenant_id,
                "project": project_id,
                "user": user_id,
                "args": args,
            },
        }

    res = await executeGsdCommand(
        {
            "tenantId": tenant_id,
            "projectId": project_id,
            "userId": user_id,
            "args": args,
        },
        internal_cmd,
    )
    return {
        "ok": getattr(res, "ok", False),
        "command": getattr(res, "command", internal_cmd),
        "output": getattr(res, "output", None),
        "error": getattr(res, "error", None),
    }


# Convenience for tests / REPL.

def build_default_wrapper() -> GSDWrapper:
    """Construct a wrapper bound to the process-global command map."""

    return GSDWrapper(FORGE_COMMAND_MAP)


# Resolve a noise warning about an unused os import — keep the symbol
# available for downstream tooling that may want to consult env vars
# (e.g. FORGE_GSD_REAL=1 to force the real package).
_ = os