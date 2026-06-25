"""Observability — AlertManager (Pillar 1 — Phase 4).

Watches the in-process :data:`app.services.event_bus.bus` for events
that carry a non-``ok`` ``outcome`` field and POSTs them to a
Prometheus Alertmanager-compatible webhook.

The webhook URL is read from the env var
``ALERTMANAGER_WEBHOOK_URL``. If the env var is unset, the manager
logs at ``warning`` level instead — keeps the system observable even
when alertmanager isn't wired up yet.

Why a webhook (not direct Alertmanager SDK)?
--------------------------------------------
- ``alertmanager_client`` would couple the service to a vendor SDK
  and complicate unit tests. The webhook contract is public + JSON
  + already shipped with Alertmanager itself.
- A small payload means even a degraded network path won't back up
  the bus dispatch loop — handlers run inside ``asyncio.create_task``
  so a slow webhook cannot stall the originating workflow.

Subscribed events
-----------------
- ``EventType.APPROVAL_GRANTED`` — outcome="granted" is healthy (skipped).
- ``EventType.APPROVAL_DENIED``  — outcome="denied" fires.
- ``EventType.AGENT_RUN_FAILED`` — outcome="failed" fires.
- ``EventType.CONNECTOR_FAILED`` — outcome="failed" fires.

The subscriber closes over a single :class:`AlertManager` instance so
tests can introspect ``alertmanager.fired`` without monkeypatching
httpx.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.services.event_bus import Event, EventBus, EventType, bus as default_bus

logger = get_logger(__name__)


@dataclass
class McpAuditEvent:
    """The audit-event shape we care about.

    Defined locally (not imported from ``packages/mcp-router``) because
    the TS-side type isn't reachable from Python. The contract is the
    minimal payload we need for alerting:

    - ``event_type``: the bus ``EventType`` value (e.g. ``"approval.denied"``).
    - ``tenant_id`` / ``project_id``: for routing + dedup labels.
    - ``outcome``: ``"ok"`` (skip) or anything else (fire).
    """

    event_type: str
    outcome: str
    tenant_id: UUID | str | None = None
    project_id: UUID | str | None = None
    actor_id: UUID | str | None = None
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class AlertPayload:
    """The JSON body POSTed to the alertmanager webhook."""

    alertname: str
    severity: str
    summary: str
    labels: dict[str, str]
    annotations: dict[str, str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "alertname": self.alertname,
            "severity": self.severity,
            "summary": self.summary,
            "labels": dict(self.labels),
            "annotations": dict(self.annotations),
        }


class AlertManager:
    """Translate non-OK bus events into alertmanager webhook calls."""

    def __init__(self, *, webhook_url: str | None = None) -> None:
        # ``None`` means "read env on each call" so tests can monkeypatch
        # ``os.environ`` between cases.
        self._explicit_url = webhook_url

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def check_and_alert(self, event: Event) -> None:
        """Inspect ``event.payload['outcome']`` and fire if non-OK.

        Subscribers call this from a bus handler. The function is
        intentionally exception-safe: handler errors are caught and
        logged so the bus dispatch loop never sees a failure.
        """
        payload = event.payload or {}
        outcome = str(payload.get("outcome") or "")
        if not outcome or outcome == "ok":
            return
        try:
            mcp_event = McpAuditEvent(
                event_type=event.event_type.value,
                outcome=outcome,
                tenant_id=event.tenant_id,
                project_id=event.project_id,
                actor_id=event.actor_id,
                payload=dict(payload),
            )
            await self._dispatch(mcp_event)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "observability.alert_failed",
                event_type=event.event_type.value,
                outcome=outcome,
                error=str(exc),
            )

    def fired(self) -> list[AlertPayload]:
        """Testing seam: list of payloads sent so far."""
        return list(self._fired)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    _fired: list[AlertPayload] = []

    def _build_payload(self, event: McpAuditEvent) -> AlertPayload:
        severity = "warning"
        # MCP / approval denials escalate to "error".
        if event.outcome in {"failed", "denied", "error", "unreachable"}:
            severity = "error"
        return AlertPayload(
            alertname=f"forge_{event.event_type.replace('.', '_')}_{event.outcome}",
            severity=severity,
            summary=(
                f"{event.event_type} on tenant={event.tenant_id} "
                f"project={event.project_id} outcome={event.outcome}"
            ),
            labels={
                "event_type": event.event_type,
                "outcome": event.outcome,
                "tenant_id": str(event.tenant_id) if event.tenant_id else "unknown",
                "project_id": str(event.project_id) if event.project_id else "unknown",
            },
            annotations={
                "actor_id": str(event.actor_id) if event.actor_id else "system",
                "payload_json": str(event.payload)[:1024],
            },
        )

    async def _dispatch(self, event: McpAuditEvent) -> None:
        payload = self._build_payload(event)
        url = self._webhook_url()
        self._fired.append(payload)
        if not url:
            logger.warning(
                "observability.alert.log_only",
                alertname=payload.alertname,
                severity=payload.severity,
                outcome=event.outcome,
                tenant_id=str(event.tenant_id) if event.tenant_id else None,
            )
            return
        # Fire-and-forget HTTP POST. We never block the bus dispatch
        # loop on webhook latency — the originating workflow continues
        # regardless.
        asyncio.create_task(self._post(url=url, payload=payload))

    async def _post(self, *, url: str, payload: AlertPayload) -> None:
        try:
            import httpx
        except ImportError:
            logger.warning("observability.alert.httpx_missing")
            return
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload.to_dict())
            if resp.status_code >= 400:
                logger.warning(
                    "observability.alert.http_error",
                    url=url,
                    status=resp.status_code,
                    body=resp.text[:200],
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "observability.alert.post_failed",
                url=url,
                error=str(exc),
            )

    def _webhook_url(self) -> str | None:
        if self._explicit_url is not None:
            return self._explicit_url
        return os.environ.get("ALERTMANAGER_WEBHOOK_URL") or None


# ---------------------------------------------------------------------------
# Bus subscriber registration
# ---------------------------------------------------------------------------


# Module-level singleton (mirrors the pattern of JiraCommenter /
# AlertManager — single shared instance because the manager is
# stateless apart from ``_fired`` which tests reset explicitly).
alert_manager = AlertManager()


async def _approval_denied_handler(event: Event) -> None:
    await alert_manager.check_and_alert(event)


async def _agent_run_failed_handler(event: Event) -> None:
    await alert_manager.check_and_alert(event)


async def _connector_failed_handler(event: Event) -> None:
    await alert_manager.check_and_alert(event)


def register(bus: EventBus | None = None) -> None:
    """Attach the alert subscribers to the bus.

    Idempotency: the bus's ``subscribe`` does NOT dedupe; calling this
    twice will double-fire. ``app.main.lifespan`` calls it exactly once
    per process.
    """
    target = bus or default_bus
    target.subscribe(EventType.APPROVAL_DENIED, _approval_denied_handler)
    target.subscribe(EventType.AGENT_RUN_FAILED, _agent_run_failed_handler)
    target.subscribe(EventType.CONNECTOR_FAILED, _connector_failed_handler)
    logger.info("observability.alerts.registered")


__all__ = [
    "AlertManager",
    "AlertPayload",
    "McpAuditEvent",
    "alert_manager",
    "register",
]
