"""Connector Lifecycle (Pillar 1 — Phase 4 — hardening).

Three operations back the Connector Center UI:

- :meth:`ConnectorLifecycle.install` — create a new ``Connector`` row and
  immediately probe it. The probe's outcome is stamped on the row
  (``last_healthcheck_at`` / ``last_healthcheck_status``) so the UI
  never shows a freshly-installed connector as "unknown health".

- :meth:`ConnectorLifecycle.rotate` — replace the ``config`` blob with
  new credentials, invalidate the MCP-server registration (the Python
  :class:`MCPClient` doesn't expose ``unregister`` today — we emit a
  bus event instead so downstream consumers can flush their caches),
  then probe again.

- :meth:`ConnectorLifecycle.test` — run a single probe and persist a
  :class:`ConnectorHealthHistory` row. Distinct from the sync
  ``ConnectorSyncHistory`` — a healthcheck is non-destructive and is
  the unit of work the alertmanager windowing reads.

All three emit an :class:`AuditEvent` (Rule 6) with
``action = "connector.install" | "connector.rotate" | "connector.test"``.

Design notes
------------
The lifecycle service intentionally delegates to the existing
:class:`ConnectorManager` rather than re-implementing probe + CRUD.
``ConnectorManager.test_connection`` returns a :class:`TestResult` which
carries the latency / detail we want to persist; the new methods wrap
that with audit + history writes so the call sites (the new
``connector_lifecycle`` router and any future scheduled probe job) stay
terse.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db.models.connector import (
    Connector,
    ConnectorHealthHistory,
    ConnectorType,
)
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.connector_manager import (
    ConnectorManager,
    TestResult,
    connector_manager,
)
from app.services.event_bus import EventType, bus as default_bus

logger = get_logger(__name__)


# Short status strings persisted to ``Connector.last_healthcheck_status``.
_STATUS_OK = "ok"
_STATUS_UNREACHABLE = "unreachable"


class ConnectorLifecycle:
    """Install / rotate / test operations for ``Connector`` rows.

    Wraps ``ConnectorManager`` with audit + health-history persistence
    so the Connector Center UI can render a "last probe" badge and a
    rolling history chart without extra wiring.
    """

    def __init__(
        self,
        *,
        manager: ConnectorManager | None = None,
        bus: Any | None = None,
    ) -> None:
        self._manager = manager or connector_manager
        self._bus = bus or default_bus

    # ------------------------------------------------------------------
    # install
    # ------------------------------------------------------------------

    async def install(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        connector_type: ConnectorType,
        name: str,
        config: dict[str, Any],
        actor_id: UUID | str,
    ) -> Connector:
        """Create a ``Connector`` row and probe it.

        Returns the (now-updated) ``Connector``. The probe result is
        stamped on the row regardless of success — a freshly-installed
        connector that fails its first probe should appear "unreachable"
        in the UI immediately, not "unknown".
        """
        connector = await self._manager.create_connector(
            tenant_id=tenant_id,
            project_id=project_id,
            name=name,
            type=connector_type,
            config=config,
            actor_id=actor_id,
        )
        # Probe + persist history regardless. The test does not raise;
        # a failed probe returns ``TestResult(ok=False, ...)`` which the
        # history row records faithfully.
        result = await self._manager.test_connection(
            connector.id, tenant_id=tenant_id
        )
        await self._persist_probe(connector=connector, result=result)
        await self._stamp_last_healthcheck(connector=connector, result=result)

        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action="connector.install",
            target_type="connector",
            target_id=str(connector.id),
            payload={
                "type": connector_type.value,
                "name": name,
                "ok": result.ok,
                "latency_ms": result.latency_ms,
                "detail": result.detail,
            },
        )
        logger.info(
            "connector.lifecycle.installed",
            connector_id=str(connector.id),
            type=connector_type.value,
            ok=result.ok,
        )
        return connector

    # ------------------------------------------------------------------
    # rotate
    # ------------------------------------------------------------------

    async def rotate(
        self,
        *,
        connector_id: UUID | str,
        new_credentials: dict[str, Any],
        tenant_id: UUID | str,
        actor_id: UUID | str,
    ) -> Connector:
        """Replace ``Connector.config`` with ``new_credentials``, invalidate
        any cached MCP registration, and re-probe.

        Why emit a bus event instead of calling
        ``mcp-router.unregister(...)`` directly?

        The Python :class:`MCPClient` shim today has no ``unregister``
        method; the TS ``packages/mcp-router`` ``McpRouter`` does.
        Emitting ``EventType.CONNECTOR_SYNCING`` with ``"event": "credentials_rotated"``
        lets whatever owns the TS-side cache (a future cross-process
        subscriber) flush; the in-process Python ``MCPClient`` will pick
        up the new config the next time it resolves the connector.
        """
        # Verify tenant ownership before mutating.
        connector = await self._manager.get_connector(
            connector_id, tenant_id=tenant_id
        )

        merged_config: dict[str, Any] = dict(connector.config or {})
        merged_config.update(dict(new_credentials or {}))
        updated = await self._manager.update_connector(
            connector.id,
            config=merged_config,
            actor_id=actor_id,
        )

        # Notify downstream consumers that credentials changed.
        await self._bus.publish(
            EventType.CONNECTOR_SYNCING,
            {
                "connector_id": str(updated.id),
                "event": "credentials_rotated",
                "type": updated.type.value,
            },
            tenant_id=updated.tenant_id,
            project_id=updated.project_id,
            actor_id=actor_id,
        )

        # Re-probe with the new credentials so a bad rotation surfaces
        # immediately rather than waiting for the next sync.
        result = await self._manager.test_connection(
            updated.id, tenant_id=updated.tenant_id
        )
        await self._persist_probe(connector=updated, result=result)
        await self._stamp_last_healthcheck(connector=updated, result=result)

        await audit_service.record(
            tenant_id=tenant_id,
            project_id=updated.project_id,
            actor_id=actor_id,
            action="connector.rotate",
            target_type="connector",
            target_id=str(updated.id),
            payload={
                "ok": result.ok,
                "latency_ms": result.latency_ms,
                "detail": result.detail,
                "credential_keys": sorted(list((new_credentials or {}).keys())),
            },
        )
        logger.info(
            "connector.lifecycle.rotated",
            connector_id=str(updated.id),
            ok=result.ok,
        )
        return updated

    # ------------------------------------------------------------------
    # test
    # ------------------------------------------------------------------

    async def test(
        self,
        *,
        connector_id: UUID | str,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> TestResult:
        """Run a single reachability probe and persist a history row.

        ``actor_id`` is optional here because probes are also driven by
        the scheduled jobs (no human actor). The audit event records
        ``actor_id="system"`` in that case so the audit chain stays
        gap-free.
        """
        # tenant-scoped get — raises PermissionError if cross-tenant.
        connector = await self._manager.get_connector(
            connector_id, tenant_id=tenant_id
        )
        result = await self._manager.test_connection(
            connector.id, tenant_id=tenant_id
        )
        await self._persist_probe(connector=connector, result=result)
        await self._stamp_last_healthcheck(connector=connector, result=result)

        await audit_service.record(
            tenant_id=tenant_id,
            project_id=connector.project_id,
            actor_id=actor_id or "system",
            action="connector.test",
            target_type="connector",
            target_id=str(connector.id),
            payload={
                "ok": result.ok,
                "latency_ms": result.latency_ms,
                "detail": result.detail,
            },
        )
        return result

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _persist_probe(*, connector: Connector, result: TestResult) -> None:
        """Append a ``ConnectorHealthHistory`` row for one probe."""
        factory = get_session_factory()
        async with factory() as session:
            session.add(
                ConnectorHealthHistory(
                    tenant_id=str(connector.tenant_id),
                    project_id=str(connector.project_id),
                    connector_id=connector.id,
                    checked_at=result.checked_at or datetime.now(timezone.utc),
                    ok=result.ok,
                    latency_ms=result.latency_ms,
                    detail=result.detail,
                )
            )
            await session.commit()

    @staticmethod
    async def _stamp_last_healthcheck(
        *, connector: Connector, result: TestResult
    ) -> None:
        """Write ``Connector.last_healthcheck_at`` + ``last_healthcheck_status``.

        Done in a separate session so the history insert (above) and
        the connector update commit independently — a failure to update
        the connector's last-check fields must not roll back the
        history row.
        """
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Connector, str(connector.id))
            if row is None:
                return
            row.last_healthcheck_at = result.checked_at or datetime.now(timezone.utc)
            row.last_healthcheck_status = (
                _STATUS_OK if result.ok else _STATUS_UNREACHABLE
            )
            await session.commit()


# ---------------------------------------------------------------------------
# Public singleton
# ---------------------------------------------------------------------------

connector_lifecycle = ConnectorLifecycle()


__all__ = [
    "ConnectorLifecycle",
    "connector_lifecycle",
]
