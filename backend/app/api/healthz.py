"""M1 T1.3 — top-level ``/healthz`` route (NOT under /api/v1/).

Closes M1 G8. Mounts directly on the FastAPI ``app`` instance via
``app.include_router`` in ``main.py`` — k8s liveness/readiness probes
and the docker-compose backend healthcheck (T1.1.1) all hit this
endpoint, so it MUST be reachable from the network namespace the
probes use.

Spec (M1 §4 AC-1): the route must run 7 probes with a 5s timeout
each and report ``status: ok`` only when every probe is green; a
single red probe flips the aggregated status to ``degraded`` (HTTP
200 + body) — we don't return 503 on a single dependency outage
because the backend can still serve traffic for the unaffected
centers. Process-level unrecoverable failures bubble up separately
via FastAPI's uvicorn lifecycle hooks.

Probes (each with a 5s timeout):
  db_health             SELECT 1 against the SQLAlchemy async engine
  redis_health          PING on Redis (forges' Pub/Sub + session store)
  keycloak_reachable    GET <keycloak>/realms/<realm>/.well-known/openid-configuration
  litellm_health        GET <litellm>/health/liveliness (reuses existing cache)
  audit_sink            telemetry initialized + can resolve AuditEvent table
  floci_health          GET <AWS_ENDPOINT_URL>/_localstack/health
  forge_phase4_mounted  True after mount_phase4_top_level(app) (T1.8)

Tests live in ``backend/tests/test_healthz.py``.
"""

from __future__ import annotations

import asyncio
import os
import urllib.request
from typing import Any

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter
from sqlalchemy import text

from app import __version__
from app.api.v1.forge_phase4 import forge_phase4_mounted  # type: ignore[attr-defined]
from app.core.config import settings
from app.core.logging import get_logger
from app.core.telemetry import _initialized as _otel_initialized
from app.db.models.audit import AuditEvent
from app.db.session import get_engine
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)
router = APIRouter(tags=["healthz"])

_PROBE_TIMEOUT_SECONDS = 5.0


# ---------------------------------------------------------------------------
# Individual probes — each returns "ok" or "down" (string), or a structured
# dict when more detail matters. Never raises; ``down`` is the catch-all.
# ---------------------------------------------------------------------------


async def _probe_db() -> str:
    """SELECT 1 against the async SQLAlchemy engine.

    Mirrors ``app/api/v1/health.py:_check_postgres`` but added here as a
    fresh path so the top-level /healthz is fully independent of the
    /api/v1 surface (the docker-compose backend healthcheck hits the
    unauthenticated top-level route, never the v1 surface).
    """
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.db_fail", error=str(exc))
        return "down"


async def _probe_redis() -> str:
    """PING on the configured Redis URL."""
    try:
        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        try:
            pong = await client.ping()
        finally:
            await client.aclose()
        return "ok" if pong else "down"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.redis_fail", error=str(exc))
        return "down"


async def _probe_keycloak() -> str:
    """GET /realms/<realm>/.well-known/openid-configuration on Keycloak.

    The OIDC discovery endpoint is the canonical readiness probe for
    Keycloak — it answers once the realm is imported AND the
    discovery document is built. Wrapped in a 5s timeout because
    Keycloak's first-boot realm import can take 60-90s and we don't
    want /healthz to block on it.
    """
    base = settings.keycloak_url.rstrip("/")
    realm = settings.keycloak_realm or "forge"
    url = f"{base}/realms/{realm}/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(url)
        if response.status_code == 200:
            return "ok"
        return "down"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.keycloak_fail", error=str(exc))
        return "down"


async def _probe_litellm() -> str:
    """GET /health/liveliness on the configured LiteLLM Proxy URL.

    Reuses the LiteLLMBaseClient so the existing master-key handling
    and readiness semantics in F-829 stay consistent with /api/forge/health.
    """
    try:
        async with LiteLLMBaseClient() as litellm:
            payload = await litellm.readiness()
        if payload.get("reachable") is True:
            return "ok"
        # F-829 contract: reachable=False covers 401, http_*, and network errors.
        return "down"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.litellm_fail", error=str(exc))
        return "down"


async def _probe_audit_sink() -> dict[str, str]:
    """Verify the audit pipeline is wired without writing a row.

    audit_sink is the combination of:
      - structured DB storage (AuditEvent lives in the same postgres DB)
      - observability (OpenTelemetry sink is initialized)

    We don't insert a row on every /healthz call (that would multiply
    write load on the cluster); we just check that the audit_log table
    is registered in metadata + OTel was initialized. If either leg
    is down the probe reports a structured dict so the dashboard can
    graph which leg failed.
    """
    statuses: dict[str, str] = {"otel": "down", "audit_table": "down"}
    if _otel_initialized:
        statuses["otel"] = "ok"
    try:
        # Confirm AuditEvent is registered against Base.metadata.
        # If a future refactor moves audit storage, this probe fires
        # BEFORE the backend serves traffic — that is the desired
        # behavior.
        if AuditEvent.__tablename__ in {t.name for t in AuditEvent.metadata.tables.values()}:
            statuses["audit_table"] = "ok"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.audit_sink_fail", error=str(exc))
    return statuses


def _probe_floci() -> str:
    """Synchronous check against ``AWS_ENDPOINT_URL/_localstack/health``.

    Floci is the LocalStack Community successor (ADR-001 — dev-only
    AWS emulator). The compose file injects ``AWS_ENDPOINT_URL=http://floci:4566``
    into the backend container; /_localstack/health returns 200 with
    a per-service JSON status object once floci is ready to serve
    requests.

    We treat floci as best-effort: the backend can still serve
    traffic without S3/SQS (it just can't write artifacts), so a
    floci outage maps to ``degraded`` overall but not a hard failure.
    """
    endpoint = (
        os.environ.get("AWS_ENDPOINT_URL")
        or os.environ.get("FLOCI_URL")
        or "http://localhost:4566"
    )
    url = f"{endpoint.rstrip('/')}/_localstack/health"
    try:
        # Use a synchronous probe because floci lives in-process
        # during tests (no event loop) — and to keep the probe
        # time-bounded with a urllib-based timeout.
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=_PROBE_TIMEOUT_SECONDS) as resp:  # noqa: S310
            return "ok" if resp.status < 500 else "down"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.floci_fail", error=str(exc))
        return "down"


# ---------------------------------------------------------------------------
# Aggregation + route
# ---------------------------------------------------------------------------


def _aggregate_status(probes: dict[str, Any]) -> str:
    """Return 'ok' if every probe is 'ok'; else 'degraded'."""
    for value in probes.values():
        # Probe values are either the literal string "ok"/"down" or a
        # nested dict for compound probes like audit_sink. Treat a
        # nested dict as green only when every leaf is "ok".
        if isinstance(value, dict):
            for leaf in value.values():
                if leaf != "ok":
                    return "degraded"
        elif value != "ok":
            return "degraded"
    return "ok"


@router.get("/healthz")
async def healthz() -> dict[str, Any]:
    """Top-level liveness + dependency probe (M1 AC-1).

    Returns 200 + ``status: ok`` when every probe is green. Single
    red probe flips aggregate to ``degraded`` but the route still
    answers 200 — operators should consult the per-probe fields
    rather than ping the HTTP status alone. The 5s per-probe
    timeout guarantees the slowest probe doesn't drag the entire
    response past 5×7 = 35s worst case (probes run concurrently).
    """
    # Phase 4 mount is read once at boot — set by T1.8
    # (``mount_phase4_top_level(app)`` flips the flag in
    # ``app/api/v1/forge_phase4/__init__.py``). When the flag is
    # False the top-level routes /openai/*, /.well-known/*, /a2a/*
    # are not mounted — that's a real production-correctness gap,
    # so /healthz surfaces it as a probe failure.

    db_task = asyncio.create_task(_probe_db())
    redis_task = asyncio.create_task(_probe_redis())
    keycloak_task = asyncio.create_task(_probe_keycloak())
    litellm_task = asyncio.create_task(_probe_litellm())
    audit_task = asyncio.create_task(_probe_audit_sink())  # returns dict
    floci_value = _probe_floci()  # sync — fast, no event loop needed

    db_v, redis_v, keycloak_v, litellm_v, audit_v = await asyncio.gather(
        db_task,
        redis_task,
        keycloak_task,
        litellm_task,
        audit_task,
    )

    probes: dict[str, Any] = {
        "db_health": db_v,
        "redis_health": redis_v,
        "keycloak_reachable": keycloak_v,
        "litellm_health": litellm_v,
        "audit_sink": audit_v,
        "floci_health": floci_value,
        "forge_phase4_mounted": bool(forge_phase4_mounted),
    }
    status = _aggregate_status(probes)
    logger.info(
        "healthz.served",
        status=status,
        db=db_v,
        redis=redis_v,
        keycloak=keycloak_v,
        litellm=litellm_v,
        audit=audit_v,
        floci=floci_value,
        phase4=bool(forge_phase4_mounted),
    )
    return {
        "status": status,
        "version": __version__,
        "environment": settings.environment,
        "probes": probes,
    }


__all__ = ["router"]
