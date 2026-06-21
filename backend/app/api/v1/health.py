"""F-007 Health endpoint — pings dependencies for /health."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter
from sqlalchemy import text

from app import __version__
from app.core.config import settings
from app.core.logging import get_logger
from app.db.session import get_engine

logger = get_logger(__name__)
router = APIRouter(tags=["health"])


async def _check_postgres() -> str:
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok"
    except Exception as exc:  # noqa: BLE001
        logger.warning("health.postgres_fail", error=str(exc))
        return "down"


async def _check_redis() -> str:
    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        pong = await client.ping()
        await client.aclose()
        return "ok" if pong else "down"
    except Exception as exc:  # noqa: BLE001
        logger.warning("health.redis_fail", error=str(exc))
        return "down"


async def _check_litellm() -> str:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(
                f"{settings.litellm_proxy_url.rstrip('/')}/health/liveliness",
                headers={"Authorization": f"Bearer {settings.litellm_api_key}"},
            )
            return "ok" if response.status_code < 500 else "down"
    except Exception as exc:  # noqa: BLE001
        logger.warning("health.litellm_fail", error=str(exc))
        return "down"


@router.get("/health")
async def health() -> dict[str, Any]:
    """Liveness + dependency check.

    Returns 200 unless the process itself is dead; per-dependency
    status is in the body so dashboards can graph trends.
    """
    return {
        "status": "ok",
        "version": __version__,
        "environment": settings.environment,
        "deps": {
            "postgres": await _check_postgres(),
            "redis": await _check_redis(),
            "litellm": await _check_litellm(),
        },
    }


__all__ = ["router"]
