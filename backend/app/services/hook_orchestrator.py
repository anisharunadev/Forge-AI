"""Hook Orchestration (F-017).

Hooks are tenant- or project-scoped scripts that fire on domain
events. Three phases:
- PRE: runs before the originating action; may mutate context.
- POST: runs after success; used for audit/notify.
- ERROR: runs after failure; used for alerting.

Execution is async with a per-hook timeout to keep the orchestrator
responsive even when a script hangs.
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.hook import Hook, HookPhase
from app.db.session import get_session_factory
from app.schemas.hooks import HookResult

logger = get_logger(__name__)


class HookOrchestrator:
    """In-process script runner for Hook rows."""

    async def register_hook(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        name: str,
        event_type: str,
        phase: HookPhase,
        action: str = "shell",
        script: str = "",
        enabled: bool = True,
        run_order: int = 100,
        timeout_seconds: int = 30,
    ) -> Hook:
        factory = get_session_factory()
        async with factory() as session:
            hook = Hook(
                tenant_id=str(tenant_id),
                project_id=str(project_id) if project_id else None,
                name=name,
                event_type=event_type,
                phase=phase,
                action=action,
                script=script,
                enabled=enabled,
                run_order=run_order,
                timeout_seconds=timeout_seconds,
            )
            session.add(hook)
            await session.commit()
            await session.refresh(hook)
        logger.info(
            "hook.registered",
            hook_id=str(hook.id),
            event_type=event_type,
            phase=phase.value,
        )
        return hook

    async def update_hook(
        self,
        hook_id: UUID | str,
        *,
        name: str | None = None,
        event_type: str | None = None,
        phase: HookPhase | None = None,
        script: str | None = None,
        enabled: bool | None = None,
        run_order: int | None = None,
        timeout_seconds: int | None = None,
    ) -> Hook:
        factory = get_session_factory()
        async with factory() as session:
            hook = await session.get(Hook, str(hook_id))
            if hook is None:
                raise LookupError(f"Hook {hook_id} not found")
            if name is not None:
                hook.name = name
            if event_type is not None:
                hook.event_type = event_type
            if phase is not None:
                hook.phase = phase
            if script is not None:
                hook.script = script
            if enabled is not None:
                hook.enabled = enabled
            if run_order is not None:
                hook.run_order = run_order
            if timeout_seconds is not None:
                hook.timeout_seconds = timeout_seconds
            await session.commit()
            await session.refresh(hook)
        return hook

    async def delete_hook(self, hook_id: UUID | str) -> None:
        factory = get_session_factory()
        async with factory() as session:
            hook = await session.get(Hook, str(hook_id))
            if hook is None:
                raise LookupError(f"Hook {hook_id} not found")
            await session.delete(hook)
            await session.commit()

    async def get_hook(self, hook_id: UUID | str) -> Hook:
        factory = get_session_factory()
        async with factory() as session:
            hook = await session.get(Hook, str(hook_id))
            if hook is None:
                raise LookupError(f"Hook {hook_id} not found")
            return hook

    async def list_hooks(
        self,
        tenant_id: UUID | str,
        *,
        event_type: str | None = None,
    ) -> list[Hook]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Hook).where(Hook.tenant_id == str(tenant_id))
            if event_type is not None:
                stmt = stmt.where(Hook.event_type == event_type)
            stmt = stmt.order_by(Hook.run_order, Hook.created_at)
            return list((await session.execute(stmt)).scalars().all())

    async def fire(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        event_type: str,
        phase: HookPhase,
        context: dict[str, Any] | None = None,
    ) -> list[HookResult]:
        """Execute all matching hooks in run_order.

        PRE hooks may mutate the context via a return-value convention:
        if a PRE hook's script writes a JSON line like
        `__forge_mutate__:{...}` to stdout, that JSON is merged into
        the next hook's context. The full context trail is returned
        alongside the HookResult list for observability.
        """
        ctx = dict(context or {})
        hooks = await self.list_hooks(tenant_id, event_type=event_type)
        candidates = [h for h in hooks if h.enabled and h.phase == phase]
        results: list[HookResult] = []
        for hook in candidates:
            results.append(await self._run_one(hook, ctx))
            if phase == HookPhase.PRE and results[-1].output:
                merged = _parse_mutate_marker(results[-1].output)
                if merged:
                    ctx.update(merged)
        return results

    async def _run_one(self, hook: Hook, context: dict[str, Any]) -> HookResult:
        started_at = datetime.now(UTC)
        started_perf = time.perf_counter()
        if hook.action != "shell":
            return HookResult(
                hook_id=hook.id,
                name=hook.name,
                phase=hook.phase,
                ok=False,
                started_at=started_at,
                finished_at=started_at,
                duration_ms=0.0,
                error=f"unsupported_hook_action:{hook.action}",
            )
        try:
            proc = await asyncio.create_subprocess_shell(
                hook.script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "FORGE_HOOK_CONTEXT": _safe_json(context)},
            )
            try:
                stdout_b, stderr_b = await asyncio.wait_for(
                    proc.communicate(), timeout=max(1, hook.timeout_seconds)
                )
            except TimeoutError:
                proc.kill()
                await proc.wait()
                finished_at = datetime.now(UTC)
                return HookResult(
                    hook_id=hook.id,
                    name=hook.name,
                    phase=hook.phase,
                    ok=False,
                    started_at=started_at,
                    finished_at=finished_at,
                    duration_ms=round((time.perf_counter() - started_perf) * 1000.0, 2),
                    error="hook_timeout",
                )
            finished_at = datetime.now(UTC)
            duration_ms = round((time.perf_counter() - started_perf) * 1000.0, 2)
            ok = proc.returncode == 0
            return HookResult(
                hook_id=hook.id,
                name=hook.name,
                phase=hook.phase,
                ok=ok,
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=duration_ms,
                output=(stdout_b or b"").decode("utf-8", errors="replace") or None,
                error=None if ok else (stderr_b or b"").decode("utf-8", errors="replace") or None,
            )
        except Exception as exc:  # noqa: BLE001
            finished_at = datetime.now(UTC)
            return HookResult(
                hook_id=hook.id,
                name=hook.name,
                phase=hook.phase,
                ok=False,
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=round((time.perf_counter() - started_perf) * 1000.0, 2),
                error=f"{type(exc).__name__}: {exc}",
            )


def _safe_json(context: dict[str, Any]) -> str:
    import json

    def default(_obj: Any) -> str:
        return str(_obj)

    return json.dumps(context, default=default)


def _parse_mutate_marker(output: str) -> dict[str, Any] | None:
    """Pull `__forge_mutate__:{...}` out of a hook's stdout, if present."""
    import json

    for line in output.splitlines():
        line = line.strip()  # noqa: PLW2901
        if line.startswith("__forge_mutate__:"):
            payload = line[len("__forge_mutate__:") :]
            try:
                data = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict):
                return data
    return None


hook_orchestrator = HookOrchestrator()


__all__ = ["HookOrchestrator", "hook_orchestrator"]
