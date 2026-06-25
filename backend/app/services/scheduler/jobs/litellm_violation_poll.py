"""F-829i — LiteLLM guardrail violation polling job (Phase C).

APScheduler entry point invoked every 30 seconds. Each tick delegates
to :meth:`app.integrations.litellm.compliance_feed.ComplianceFeed.poll_violations`,
which fetches the recent window from the LiteLLM Proxy
``/guardrail/violations`` endpoint and ingests any new rows into
``litellm_guardrail_violations``.

Survives a backend restart because ``scheduler/service.py`` registers
the job during ``start()`` which runs from ``app.main.lifespan`` —
so every process boot re-arms the 30s interval. APScheduler also
``replace_existing=True`` so a duplicate registration is safe.
"""

from __future__ import annotations

from app.core.logging import get_logger

logger = get_logger(__name__)


async def poll_litellm_violations() -> None:
    """Scheduler entry point — runs every 30s, fans out to ComplianceFeed.

    Failure isolation: any exception raised inside the polling service
    is caught here so APScheduler does not enter its retry/backoff
    state and silently skip subsequent ticks.
    """
    try:
        # Lazy import — sibling Phase A agents own the integration
        # module. The job must not fail boot if the file is mid-write.
        from app.integrations.litellm.compliance_feed import compliance_feed

        result = await compliance_feed.poll_violations()
        if result.ingested > 0 or result.skipped_duplicates > 0:
            logger.info(
                "litellm.violation_poll.tick",
                ingested=result.ingested,
                skipped_duplicates=result.skipped_duplicates,
            )
    except Exception as exc:  # noqa: BLE001 — loop must never die
        logger.warning(
            "litellm.violation_poll.failed",
            error=f"{type(exc).__name__}: {exc}",
        )


__all__ = ["poll_litellm_violations"]
