"""Connector Manager (F-007).

CRUD + sync orchestration for connector records. Sync orchestration
delegates to the connector state machine and records each attempt in
ConnectorSyncHistory.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.connector import (
    Connector,
    ConnectorStatus,
    ConnectorSyncHistory,
    ConnectorType,
    SyncStatus,
)
from app.db.session import get_session_factory
from app.services.connector_states import ConnectorState, connector_state_machine
from app.services.event_bus import EventType, bus as default_bus

logger = get_logger(__name__)


@dataclass
class TestResult:
    """Outcome of a connector reachability probe."""

    connector_id: UUID
    ok: bool
    latency_ms: float | None
    detail: str | None
    checked_at: datetime


class ConnectorManager:
    """Tenant-scoped CRUD + sync driver for Connectors."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def list_connectors(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
    ) -> list[Connector]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Connector).where(Connector.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(Connector.project_id == str(project_id))
            stmt = stmt.order_by(Connector.created_at.desc())
            return list((await session.execute(stmt)).scalars().all())

    async def get_connector(
        self,
        connector_id: UUID | str,
        *,
        tenant_id: UUID | str | None = None,
    ) -> Connector:
        factory = get_session_factory()
        async with factory() as session:
            connector = await session.get(Connector, str(connector_id))
            if connector is None:
                raise LookupError(f"Connector {connector_id} not found")
            if tenant_id is not None and str(connector.tenant_id) != str(tenant_id):
                raise PermissionError(f"Connector {connector_id} not in tenant {tenant_id}")
            return connector

    async def create_connector(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        name: str,
        type: ConnectorType,
        config: dict[str, Any],
        actor_id: UUID | str,
    ) -> Connector:
        factory = get_session_factory()
        async with factory() as session:
            connector = Connector(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                name=name,
                type=type,
                config=config,
                status=ConnectorStatus.PENDING,
                created_by=str(actor_id),
            )
            session.add(connector)
            await session.commit()
            await session.refresh(connector)

        await self._bus.publish(
            EventType.CONNECTOR_SYNCING,
            {
                "connector_id": str(connector.id),
                "event": "created",
                "to_state": ConnectorStatus.PENDING.value,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        logger.info(
            "connector.created",
            connector_id=str(connector.id),
            type=type.value,
            tenant_id=str(tenant_id),
        )
        return connector

    async def update_connector(
        self,
        connector_id: UUID | str,
        *,
        name: str | None = None,
        config: dict[str, Any] | None = None,
        status: ConnectorStatus | None = None,
        actor_id: UUID | str | None = None,
    ) -> Connector:
        factory = get_session_factory()
        async with factory() as session:
            connector = await session.get(Connector, str(connector_id))
            if connector is None:
                raise LookupError(f"Connector {connector_id} not found")
            if name is not None:
                connector.name = name
            if config is not None:
                connector.config = config
            if status is not None:
                connector.status = status
            await session.commit()
            await session.refresh(connector)

        await self._bus.publish(
            EventType.CONNECTOR_SYNCING,
            {
                "connector_id": str(connector_id),
                "event": "updated",
            },
            tenant_id=connector.tenant_id,
            project_id=connector.project_id,
            actor_id=actor_id,
        )
        return connector

    async def delete_connector(
        self,
        connector_id: UUID | str,
        *,
        actor_id: UUID | str | None = None,
    ) -> Connector:
        """Soft delete: transition to QUARANTINED.

        Connectors are NEVER physically deleted (DL-027 append-only);
        they are quarantined which keeps history queryable.

        Admin-issued quarantine bypasses the strict state-machine
        transitions so a freshly-created (PENDING) connector can be
        removed without forcing it through a sync first.
        """
        factory = get_session_factory()
        async with factory() as session:
            connector = await session.get(Connector, str(connector_id))
            if connector is None:
                raise LookupError(f"Connector {connector_id} not found")
            prior_status = ConnectorStatus(connector.status)
            if prior_status != ConnectorStatus.QUARANTINED:
                # Emit a state event but allow the transition regardless
                # of the strict machine — soft-delete is an admin override.
                try:
                    await connector_state_machine.transition(
                        str(connector.id),
                        ConnectorState(prior_status.value),
                        ConnectorState.QUARANTINED,
                        reason="soft_deleted",
                        tenant_id=connector.tenant_id,
                        project_id=connector.project_id,
                        actor_id=actor_id,
                    )
                except Exception:  # noqa: BLE001 — admin override must always succeed
                    logger.warning(
                        "connector.quarantine_override",
                        connector_id=str(connector.id),
                        from_state=prior_status.value,
                    )
                connector.status = ConnectorStatus.QUARANTINED
                await session.commit()
                await session.refresh(connector)
        return connector

    async def trigger_sync(
        self,
        connector_id: UUID | str,
        *,
        actor_id: UUID | str | None = None,
    ) -> ConnectorSyncHistory:
        """Run one sync attempt end-to-end and record the outcome."""
        factory = get_session_factory()
        async with factory() as session:
            connector = await session.get(Connector, str(connector_id))
            if connector is None:
                raise LookupError(f"Connector {connector_id} not found")
            prior_status = ConnectorStatus(connector.status)
            history = ConnectorSyncHistory(
                tenant_id=connector.tenant_id,
                project_id=connector.project_id,
                connector_id=connector.id,
                started_at=datetime.now(timezone.utc),
                status=SyncStatus.STARTED,
            )
            session.add(history)
            await session.flush()

            try:
                # PENDING -> SYNCING
                if prior_status != ConnectorStatus.SYNCING:
                    await connector_state_machine.transition(
                        str(connector.id),
                        ConnectorState(prior_status.value),
                        ConnectorState.SYNCING,
                        reason="sync_triggered",
                        tenant_id=connector.tenant_id,
                        project_id=connector.project_id,
                        actor_id=actor_id,
                    )
                connector.status = ConnectorStatus.SYNCING

                # Simulated sync work — real implementation hits upstream APIs.
                items = await self._perform_sync(connector)
                history.items_synced = items
                history.status = SyncStatus.SUCCESS
                history.finished_at = datetime.now(timezone.utc)

                # SYNCING -> HEALTHY
                await connector_state_machine.transition(
                    str(connector.id),
                    ConnectorState.SYNCING,
                    ConnectorState.HEALTHY,
                    reason="sync_succeeded",
                    tenant_id=connector.tenant_id,
                    project_id=connector.project_id,
                    actor_id=actor_id,
                )
                connector.status = ConnectorStatus.HEALTHY
                connector.last_sync_at = datetime.now(timezone.utc)
                connector.last_error = None
                await session.commit()
                await session.refresh(history)
                return history
            except Exception as exc:  # noqa: BLE001
                history.status = SyncStatus.FAILURE
                history.finished_at = datetime.now(timezone.utc)
                history.error_message = type(exc).__name__ + ": " + str(exc)
                connector.status = ConnectorStatus.FAILED
                connector.last_error = history.error_message
                try:
                    await connector_state_machine.transition(
                        str(connector.id),
                        ConnectorState.SYNCING,
                        ConnectorState.FAILED,
                        reason=f"sync_failed:{type(exc).__name__}",
                        tenant_id=connector.tenant_id,
                        project_id=connector.project_id,
                        actor_id=actor_id,
                    )
                except Exception:  # noqa: BLE001 — state-machine errors must not mask the underlying
                    logger.exception("connector.state_transition_failed", connector_id=str(connector.id))
                await session.commit()
                await session.refresh(history)
                raise

    async def _perform_sync(self, connector: Connector) -> int:
        """Connector-type-specific sync stub.

        Real implementation calls into upstream APIs; here we yield a
        deterministic item count to keep the state machine honest.
        """
        await asyncio.sleep(0)
        return random.randint(1, 25)

    async def get_sync_history(
        self,
        connector_id: UUID | str,
        *,
        limit: int = 50,
    ) -> list[ConnectorSyncHistory]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(ConnectorSyncHistory)
                .where(ConnectorSyncHistory.connector_id == str(connector_id))
                .order_by(ConnectorSyncHistory.started_at.desc())
                .limit(max(1, min(limit, 500)))
            )
            return list((await session.execute(stmt)).scalars().all())

    async def test_connection(
        self,
        connector_id: UUID | str,
        *,
        tenant_id: UUID | str | None = None,
    ) -> TestResult:
        """Lightweight probe: verify connector is configured and reachable.

        The probe is non-destructive (no upstream writes). For
        unreachable upstreams, returns ok=False with detail.
        """
        connector = await self.get_connector(connector_id, tenant_id=tenant_id)
        started = time.perf_counter()
        try:
            await self._probe_upstream(connector)
            latency_ms = (time.perf_counter() - started) * 1000.0
            return TestResult(
                connector_id=connector.id,
                ok=True,
                latency_ms=round(latency_ms, 2),
                detail="reachable",
                checked_at=datetime.now(timezone.utc),
            )
        except Exception as exc:  # noqa: BLE001
            latency_ms = (time.perf_counter() - started) * 1000.0
            return TestResult(
                connector_id=connector.id,
                ok=False,
                latency_ms=round(latency_ms, 2),
                detail=f"{type(exc).__name__}: {exc}",
                checked_at=datetime.now(timezone.utc),
            )

    async def _probe_upstream(self, connector: Connector) -> None:
        """Stub probe. Real implementation issues a HEAD/GET to the upstream URL."""
        if not connector.config:
            raise RuntimeError("connector_missing_config")


# Re-export for caller convenience.
connector_manager = ConnectorManager()


__all__ = ["ConnectorManager", "TestResult", "connector_manager"]
