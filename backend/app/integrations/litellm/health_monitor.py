"""F-829l — LiteLLM availability monitor.

A long-running background task that pings the LiteLLM proxy every
``settings.litellm_health_check_interval_seconds`` (default 30s) and
flips a cached health flag. The UI ``LLMUnavailableBanner`` (Phase B)
and the 14 existing LLM call sites both read this state.

This module intentionally does not import :class:`LiteLLMBaseClient`
at module load — sibling agents own that file and it may not be on
disk yet. The health check is performed by issuing a GET to the
proxy ``/health`` endpoint via a one-shot httpx client; when the
:class:`LiteLLMBaseClient` is available, the type is referenced by
string in the type hint for the same reason.

Pattern reference: ``app.services.ideation.jira_status_subscribers``
(line 273-287) — the ``_background_tasks: set[asyncio.Task]`` set
keeps the loop alive across GC and survives shutdown via
:meth:`stop`.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from app.core.config import settings
from app.core.logging import get_logger
from app.core.telemetry import get_tracer
from app.services.audit_service import audit_service

if TYPE_CHECKING:
    # Sibling-agent file — keep the type hint working without forcing
    # the import at module load (parallel agents may be writing it).
    from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)
_tracer = get_tracer(__name__)


# Default flip thresholds — at 3 consecutive failures we mark the
# proxy unhealthy and emit the audit event. The first success after
# an unhealthy state flips us back to healthy.
_FAILURE_THRESHOLD = 3
_REQUEST_TIMEOUT_SECONDS = 5.0


class LiteLLMHealthMonitor:
    """Background poller that maintains a cached health snapshot.

    Lifecycle
    ---------
    * :meth:`start` is called from ``app.main.lifespan`` once per process.
    * :meth:`stop` is called at shutdown to cancel the loop.
    * The cached :attr:`is_healthy` is read by the global banner and
      by every Forge LLM call site that wants to short-circuit before
      issuing a request.

    State semantics
    ---------------
    * ``_is_healthy`` — last known health flag (``True`` until first check fails).
    * ``_consecutive_failures`` — counts up on failures, resets on success.
    * ``_last_check_at`` — when the most recent ping completed.
    * ``_last_state_change_at`` — when ``_is_healthy`` last flipped.
    """

    def __init__(self, *, base_client: LiteLLMBaseClient | None = None) -> None:
        self._base_client = base_client
        self._task: asyncio.Task[None] | None = None
        self._stop_event: asyncio.Event | None = None
        self._is_healthy: bool = True
        self._consecutive_failures: int = 0
        self._last_check_at: datetime | None = None
        self._last_state_change_at: datetime | None = None

    # ------------------------------------------------------------------
    # Public properties
    # ------------------------------------------------------------------

    @property
    def is_healthy(self) -> bool:
        """Cached health flag — last value from the poller.

        Defaults to ``True`` before the first check completes so the
        UI doesn't flash a "down" banner during process boot.
        """
        return self._is_healthy

    @property
    def last_updated_at(self) -> datetime | None:
        """Wall-clock time of the most recent health check (UTC)."""
        return self._last_check_at

    @property
    def consecutive_failures(self) -> int:
        """Count of consecutive failed checks since the last success."""
        return self._consecutive_failures

    def snapshot(self) -> dict[str, Any]:
        """Return a JSON-serializable view of the current state.

        Used by ``GET /api/v1/health/litellm`` (Phase A) and by the
        Phase-B admin dashboard.
        """
        return {
            "is_healthy": self._is_healthy,
            "consecutive_failures": self._consecutive_failures,
            "last_check_at": (self._last_check_at.isoformat() if self._last_check_at else None),
            "last_state_change_at": (
                self._last_state_change_at.isoformat() if self._last_state_change_at else None
            ),
        }

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self, interval_seconds: int | None = None) -> None:
        """Begin the background poll loop. Idempotent.

        Resolves ``interval_seconds`` from settings
        (``litellm_health_check_interval_seconds``, default 30s) when
        not provided. The task is held by ``self._task``; a strong
        reference is required because asyncio only weakly references
        tasks returned from ``create_task``.
        """
        if self._task is not None and not self._task.done():
            logger.info("health_monitor.already_running")
            return

        interval = int(
            interval_seconds
            if interval_seconds is not None
            else settings.litellm_health_check_interval_seconds
        )
        # Don't spam a proxy that's already marked down — clamp the
        # interval to a minimum of 5s so a tight loop can't DoS a
        # broken backend on its way back up.
        interval = max(interval, 5)
        self._stop_event = asyncio.Event()

        async def _loop() -> None:
            assert self._stop_event is not None
            logger.info("health_monitor.started", interval_seconds=interval)
            while not self._stop_event.is_set():
                try:
                    await self._check_once()
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 — loop must never die
                    logger.exception("health_monitor.loop_error")
                # Sleep with cancellation honored mid-sleep.
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                except TimeoutError:
                    continue
            logger.info("health_monitor.stopped")

        self._task = asyncio.create_task(_loop(), name="litellm-health-monitor")

    async def stop(self) -> None:
        """Cancel the background loop and wait for it to exit."""
        if self._stop_event is not None:
            self._stop_event.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None
        self._stop_event = None
        logger.info("health_monitor.shutdown_complete")

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _check_once(self) -> None:
        """Single probe; updates state + emits audit on transition."""
        healthy = await self._probe()
        now = datetime.now(UTC)
        self._last_check_at = now

        if healthy:
            self._consecutive_failures = 0
            if not self._is_healthy:
                self._is_healthy = True
                self._last_state_change_at = now
                await self._emit_health_changed(
                    is_healthy=True,
                    occurred_at=now,
                )
        else:
            self._consecutive_failures += 1
            if self._is_healthy and self._consecutive_failures >= _FAILURE_THRESHOLD:
                self._is_healthy = False
                self._last_state_change_at = now
                await self._emit_health_changed(
                    is_healthy=False,
                    occurred_at=now,
                    consecutive_failures=self._consecutive_failures,
                )

    async def _probe(self) -> bool:
        """Issue a single health request; return True on a clean 200.

        Uses the injected ``LiteLLMBaseClient`` when available. Falls
        back to a raw httpx GET against ``/health/liveliness`` on the
        configured proxy URL when the base client isn't wired yet —
        this keeps the monitor usable in tests before the sibling
        agents land.
        """
        # Prefer the typed base client when present.
        if self._base_client is not None:
            try:
                return bool(await self._base_client.health())
            except Exception:  # noqa: BLE001
                return False

        # Fallback: ad-hoc httpx probe against the proxy URL.
        try:
            import httpx  # local import — keep module load fast

            url = settings.litellm_proxy_url.rstrip("/") + "/health/liveliness"
            async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
                resp = await client.get(url)
            return resp.status_code == 200
        except Exception:  # noqa: BLE001 — any failure = unhealthy
            return False

    async def _emit_health_changed(
        self,
        *,
        is_healthy: bool,
        occurred_at: datetime,
        consecutive_failures: int | None = None,
    ) -> None:
        """Emit the ``litellm.health.changed`` audit event.

        Tenant_id uses the nil-UUID sentinel because the LiteLLM
        gateway itself is a platform-level concern, not a tenant one.
        ``project_id`` is left None — the audit_event table requires
        an explicit project_id, so the audit_service inserts the
        nil-UUID on our behalf.
        """
        payload: dict[str, Any] = {
            "is_healthy": is_healthy,
            "consecutive_failures": (
                consecutive_failures
                if consecutive_failures is not None
                else self._consecutive_failures
            ),
            "last_check_at": (self._last_check_at.isoformat() if self._last_check_at else None),
            "occurred_at": occurred_at.isoformat(),
        }
        try:
            await audit_service.record(
                tenant_id="00000000-0000-0000-0000-000000000000",
                project_id=None,
                actor_id=None,
                action="litellm.health.changed",
                target_type="litellm_gateway",
                target_id="litellm",
                payload=payload,
                occurred_at=occurred_at,
            )
        except Exception:  # noqa: BLE001 — never let audit failure mask the flip
            logger.exception("health_monitor.audit_failed", payload=payload)


# Module-level singleton for convenience (DI-friendly).
health_monitor = LiteLLMHealthMonitor()


__all__ = ["LiteLLMHealthMonitor", "health_monitor"]
