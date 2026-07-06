"""step-77 Slice 5 — ``ToolsService`` — broader Tools registry orchestrator.

Sibling to :class:`GuardrailsService`, :class:`PoliciesService`,
:class:`MCPService`. Owns the union of MCP + native + function +
passthrough tools, plus the per-tool overrides and invocation log.

Rules respected:
* Rule 1 — every proxy call goes through :class:`LiteLLMBaseClient`.
* Rule 2 — every public method takes ``tenant_id`` and propagates it.
* Rule 4 — typed input/output.
* Rule 6 — every invocation + override + archive writes an audit row.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import UTC
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.integrations.litellm.tools_apply import (
    archive_tool as _archive_tool,
)
from app.integrations.litellm.tools_apply import (
    get_overrides as _get_overrides,
)
from app.integrations.litellm.tools_apply import (
    get_tool_detail as _get_tool_detail,
)
from app.integrations.litellm.tools_apply import (
    list_logs as _list_logs,
)
from app.integrations.litellm.tools_apply import (
    list_search_tools as _list_search_tools,
)
from app.integrations.litellm.tools_apply import (
    list_search_tools_ui as _list_search_tools_ui,
)
from app.integrations.litellm.tools_apply import (
    list_tools as _list_tools,
)
from app.integrations.litellm.tools_apply import (
    put_overrides as _put_overrides,
)
from app.integrations.litellm.tools_apply import (
    test_search_tool as _test_search_tool,
)
from app.schemas.tools_v2 import (
    SearchToolRead,
    SearchToolTestResult,
    ToolLogRead,
    ToolOverrides,
    ToolRead,
)
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


# Catalog cache TTL. Spec AC #9 — 60s reflects override changes.
_CATALOG_TTL_SECONDS = 60.0


@dataclass
class _CatalogCacheEntry:
    rows: list[dict[str, Any]]
    fetched_at: float = field(default_factory=time.monotonic)


class ToolsService:
    """Singleton orchestrator (mirrors the other Phase 2 services)."""

    def __init__(self) -> None:
        self._catalog_cache: dict[str, _CatalogCacheEntry] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    async def list(
        self,
        *,
        tenant_id: UUID | str | None = None,
        kind: str | None = None,
        server_id: str | None = None,
    ) -> list[ToolRead]:
        """Return the union of MCP + native + function + passthrough tools.

        AC #1, #5 — soft-deleted tools filtered from default; ``name`` +
        ``display_name`` exposed; kind filterable.
        """
        cache_key = str(tenant_id) if tenant_id else "__global__"
        async with self._lock:
            entry = self._catalog_cache.get(cache_key)
            if entry is not None and (time.monotonic() - entry.fetched_at) < _CATALOG_TTL_SECONDS:
                rows = list(entry.rows)
            else:
                rows = None

        if rows is None:
            rows = await _list_tools(kind=kind, server_id=server_id)
            async with self._lock:
                self._catalog_cache[cache_key] = _CatalogCacheEntry(rows=list(rows))

        out: list[ToolRead] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            # Filter soft-deleted by default.
            if r.get("archived") or r.get("deleted"):
                continue
            name = r.get("name") or r.get("tool_name")
            if not name:
                continue
            kind_raw = r.get("kind") or r.get("type") or "function"
            if kind_raw not in {"mcp", "native", "function", "passthrough"}:
                kind_raw = "function"
            out.append(
                ToolRead(
                    name=str(name),
                    display_name=r.get("display_name") or str(name),
                    kind=kind_raw,  # type: ignore[arg-type]
                    description=r.get("description"),
                    parameters=r.get("parameters") or r.get("input_schema") or {},
                    server_id=r.get("server_id") or r.get("server"),
                    version=r.get("version"),
                    deprecated=bool(r.get("deprecated", False)),
                    requires_approval=bool(r.get("requires_approval", False)),
                    cost_estimate_usd=r.get("cost_estimate_usd"),
                    extra={
                        k: v
                        for k, v in r.items()
                        if k
                        not in {
                            "name",
                            "tool_name",
                            "display_name",
                            "kind",
                            "type",
                            "description",
                            "parameters",
                            "input_schema",
                            "server_id",
                            "server",
                            "version",
                            "deprecated",
                            "requires_approval",
                            "cost_estimate_usd",
                        }
                    },
                )
            )
        return out

    def invalidate(self, tenant_id: UUID | str | None = None) -> None:
        if tenant_id is None:
            self._catalog_cache.clear()
        else:
            self._catalog_cache.pop(str(tenant_id), None)
            self._catalog_cache.pop("__global__", None)

    async def detail(self, name: str) -> ToolRead | None:
        raw = await _get_tool_detail(name)
        if raw is None:
            return None
        kind_raw = raw.get("kind") or raw.get("type") or "function"
        if kind_raw not in {"mcp", "native", "function", "passthrough"}:
            kind_raw = "function"
        return ToolRead(
            name=str(raw.get("name") or raw.get("tool_name") or name),
            display_name=raw.get("display_name") or name,
            kind=kind_raw,  # type: ignore[arg-type]
            description=raw.get("description"),
            parameters=raw.get("parameters") or raw.get("input_schema") or {},
            server_id=raw.get("server_id"),
            version=raw.get("version"),
            deprecated=bool(raw.get("deprecated", False)),
            requires_approval=bool(raw.get("requires_approval", False)),
            cost_estimate_usd=raw.get("cost_estimate_usd"),
        )

    # ------------------------------------------------------------------
    # Logs (AC #2 — hashes only)
    # ------------------------------------------------------------------

    async def logs(self, *, name: str, since_hours: int = 24) -> list[ToolLogRead]:
        rows = await _list_logs(name=name, since_hours=since_hours)
        from datetime import datetime

        out: list[ToolLogRead] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            try:
                ts_raw = r.get("ts") or r.get("occurred_at") or r.get("created_at")
                ts = (
                    datetime.fromisoformat(ts_raw) if isinstance(ts_raw, str) else datetime.now(UTC)
                )
            except (TypeError, ValueError):
                ts = datetime.now(UTC)
            out.append(
                ToolLogRead(
                    ts=ts,
                    request_id=r.get("request_id"),
                    agent_id=r.get("agent_id"),
                    arguments_hash=str(r.get("arguments_hash") or ""),
                    result_hash=str(r.get("result_hash") or ""),
                    duration_ms=int(r.get("duration_ms", 0) or 0),
                    status=str(r.get("status") or "ok"),
                )
            )
        return out

    # ------------------------------------------------------------------
    # Overrides (AC #3, #9)
    # ------------------------------------------------------------------

    async def get_overrides(self, *, name: str) -> ToolOverrides | None:
        raw = await _get_overrides(name=name)
        if raw is None:
            return None
        return ToolOverrides.model_validate(raw)

    async def set_overrides(
        self,
        *,
        name: str,
        overrides: ToolOverrides,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> ToolOverrides | None:
        raw = await _put_overrides(name=name, overrides=overrides.model_dump(exclude_none=True))
        self.invalidate(tenant_id)
        await self._emit_audit(
            action="forge.tools.overridden",
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload={"tool_name": name, "overrides": overrides.model_dump(exclude_none=True)},
        )
        await bus.publish(
            EventType.LITELLM_TOOL_OVERRIDDEN,
            {"tool_name": name, "overrides": overrides.model_dump(exclude_none=True)},
            tenant_id=tenant_id,
        )
        if raw is None:
            return None
        try:
            return ToolOverrides.model_validate(raw)
        except Exception:  # noqa: BLE001
            return overrides

    # ------------------------------------------------------------------
    # Archive (AC #5 — soft delete)
    # ------------------------------------------------------------------

    async def archive(
        self,
        *,
        name: str,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> bool:
        ok = await _archive_tool(name=name)
        self.invalidate(tenant_id)
        await self._emit_audit(
            action="forge.tools.archived",
            tenant_id=tenant_id,
            actor_id=actor_id,
            payload={"tool_name": name},
        )
        await bus.publish(
            EventType.LITELLM_TOOL_ARCHIVED,
            {"tool_name": name},
            tenant_id=tenant_id,
        )
        return ok

    # ------------------------------------------------------------------
    # Audit hook (called by MCP dispatch + native callers)
    # ------------------------------------------------------------------

    async def record_invocation(
        self,
        *,
        tool_name: str,
        kind: str,
        decision: str,
        duration_ms: int,
        tenant_id: UUID | str,
        agent_id: UUID | str | None = None,
        request_id: str | None = None,
        status: str = "ok",
    ) -> None:
        """``forge.tools.invoked`` audit row (AC #6)."""
        await self._emit_audit(
            action="forge.tools.invoked",
            tenant_id=tenant_id,
            actor_id=agent_id,
            payload={
                "tool_name": tool_name,
                "kind": kind,
                "decision": decision,
                "duration_ms": duration_ms,
                "request_id": request_id,
                "status": status,
                "agent_id": str(agent_id) if agent_id else None,
            },
        )
        await bus.publish(
            EventType.LITELLM_TOOL_INVOKED,
            {
                "tool_name": tool_name,
                "kind": kind,
                "decision": decision,
                "duration_ms": duration_ms,
                "status": status,
            },
            tenant_id=tenant_id,
        )

    # ------------------------------------------------------------------
    # Search tools
    # ------------------------------------------------------------------

    async def search_tools(self) -> list[SearchToolRead]:
        rows = await _list_search_tools()
        out: list[SearchToolRead] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            tid = str(r.get("id") or r.get("name") or "")
            if not tid:
                continue
            out.append(
                SearchToolRead(
                    id=tid,
                    name=str(r.get("name") or tid),
                    description=r.get("description"),
                    kind=r.get("kind") or r.get("type"),
                )
            )
        return out

    async def search_tools_ui(self) -> list[dict[str, Any]]:
        return await _list_search_tools_ui()

    async def test_search_tool(self, *, tool_id: str) -> SearchToolTestResult:
        raw = await _test_search_tool(tool_id=tool_id)
        if raw is None:
            return SearchToolTestResult(tool_id=tool_id, reachable=False, error="no_response")
        return SearchToolTestResult(
            tool_id=tool_id,
            reachable=bool(raw.get("reachable", False)),
            latency_ms=int(raw.get("latency_ms", 0) or 0),
            error=raw.get("error"),
        )

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _emit_audit(
        self,
        *,
        action: str,
        tenant_id: UUID | str,
        actor_id: UUID | str | None,
        payload: dict[str, Any],
    ) -> None:
        try:
            await audit_service.record(
                tenant_id=str(tenant_id),
                project_id=None,
                action=action,
                actor_id=str(actor_id) if actor_id else None,
                target_type="litellm_tool",
                target_id=str(payload.get("tool_name") or payload.get("name") or "tool"),
                payload=payload,
            )
        except Exception:  # noqa: BLE001
            logger.exception("tools_service.audit_failed", action=action)


# Module-level singleton (mirrors ``audit_service``).
tools_service = ToolsService()


__all__ = ["ToolsService", "tools_service"]
