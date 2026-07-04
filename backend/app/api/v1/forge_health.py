"""F1 / Phase 1 — `GET /api/forge/health` (spec lines 81-95).

Mounted under `/api/v1/forge/health` via the `/forge` prefix on the
router. Returns the typed payload the spec mandates (line 88); no
secrets are ever included.

Backend dependencies: `LiteLLMBaseClient.readiness()` (added in P1) and
`services/forge_config.py`.
"""

from __future__ import annotations

import json
import time
from functools import lru_cache
from typing import Any

import httpx
from fastapi import APIRouter

from app.core.config import settings
from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.schemas.forge import ForgeHealth, LiteLLMHealthDetail
from app.services.forge_config import get_forge_config
from app.services.observability_service import observability_service

router = APIRouter(prefix="/forge", tags=["forge.health"])
logger = get_logger(__name__)


_READINESS_PATH = "/health/readiness"


@lru_cache(maxsize=4)
def _cache_bucket(version: int) -> dict[str, Any]:
    """Per-process bucket for readiness state with TTL eviction.

    ponytail: in-process LRU keyed by ``int(time.time() //
    ttl_seconds)`` — single-replica cache. Upgrade to Redis when a
    second replica lands. The bucket holds at most 4 entries (last 4
    TTL windows) so bursty refreshes don't evict too aggressively.
    """
    return {"_ts": time.time()}


async def _readiness_live(timeout: float) -> dict[str, Any]:
    """Hit /health/readiness and parse the typed payload.

    Returns a dict with stable keys even when the proxy is down —
    ``reachable=False`` + ``version=None`` + structured ``error``.
    """
    cfg = get_forge_config()
    headers = {
        "Authorization": f"Bearer {cfg.master_key}",
        "User-Agent": "forge-litellm-integration/1.0",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(f"{cfg.proxy_url}{_READINESS_PATH}", headers=headers)
            if response.status_code == 401:
                return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "error": "master_key_rejected"}
            if response.status_code != 200:
                return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "error": f"http_{response.status_code}"}
            try:
                body = response.json()
            except json.JSONDecodeError:
                return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "error": "non_json_body"}
            status = body.get("status") or body.get("health_status")
            return {
                "reachable": status in ("healthy", "ok", "live"),
                "version": body.get("version") or body.get("litellm_version"),
                "db": body.get("db"),
                "cache": body.get("cache") if isinstance(body.get("cache"), str) else None,
                "callbacks": body.get("callbacks") if isinstance(body.get("callbacks"), list) else None,
                "error": None,
            }
    except (httpx.HTTPError, RuntimeError) as exc:
        return {"reachable": False, "version": None, "db": None, "cache": None, "callbacks": None, "error": f"{type(exc).__name__}: {exc}"}


async def _readiness_cached() -> dict[str, Any]:
    """Return the cached readiness payload if fresh, else refresh."""
    ttl = max(1, get_forge_config().health_cache_ttl_seconds)
    bucket_key = int(time.time() // ttl)
    bucket = _cache_bucket(bucket_key)
    fresh = bucket.get("payload") and (time.time() - bucket.get("_ts", 0)) < ttl
    if fresh:
        return bucket["payload"]
    payload = await _readiness_live(timeout=5.0)
    bucket["payload"] = payload
    bucket["_ts"] = time.time()
    return payload


@router.get(
    "/health",
    response_model=ForgeHealth,
    summary="Forge + LiteLLM reachability for /api/forge/health",
)
async def forge_health() -> ForgeHealth:
    """Phase 1 trust-root probe — no secrets returned.

    Spec line 88: ``{ status, litellm: { version, reachable, db, cache, callbacks } }``
    """
    cfg = get_forge_config()
    state = await _readiness_cached()

    litellm = LiteLLMHealthDetail(
        version=state.get("version") or None,
        reachable=bool(state.get("reachable")),
        db=state.get("db") or None,
        cache=state.get("cache") or None,
        callbacks=state.get("callbacks") or None,
    )

    # Spec line 64-66: 200 + healthy → ok; 200 + db Not connected → degraded;
    # 401 or unreachable → down.
    if not litellm.reachable:
        status = "down"
    elif litellm.db == "Not connected":
        status = "degraded"
    else:
        status = "ok"

    logger.info(
        "forge.health.served",
        status=status,
        litellm_reachable=litellm.reachable,
        litellm_version=litellm.version,
        integration_enabled=cfg.integration_enabled,
    )
    # step-78 F15 — extend the response with the per-process Forge
    # detail so the enterprise dashboard can render uptime / error
    # rates / latency p50/p95/p99 alongside the LiteLLM reachability
    # block (spec line 610).
    forge_detail = observability_service.forge_health_detail()
    return ForgeHealth(
        status=status,
        litellm=litellm,
        forge=forge_detail.model_dump(),
    )


__all__ = ["router"]
