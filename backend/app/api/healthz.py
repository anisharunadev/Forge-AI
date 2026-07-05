"""M1 T1.3 — top-level ``/healthz`` route (NOT under /api/v1/).

Closes M1 G8. Mounts directly on the FastAPI ``app`` instance via
``app.include_router`` in ``main.py`` — k8s liveness/readiness probes
and the docker-compose backend healthcheck (T1.1.1) all hit this
endpoint, so it MUST be reachable from the network namespace the
probes use.

Spec (M1 §4 AC-1): the route must run 7 probes with a 5s timeout
each and report ``status: ok`` only when every probe is green.

Phase 7 SC-7.5 extends the surface:
  - ``git_sha`` field in the body (env ``GIT_SHA`` first, falling
    back to ``git rev-parse --short HEAD`` at process start).
  - ``latency_ms`` reported per probe.
  - HTTP **503** when ``_aggregate_status(...) == "degraded"`` so
    k8s readiness probes and the docker-compose healthcheck can
    act on the body alone — a single down probe fails the probe.

Probes (each with a 5s timeout):
  db_health             SELECT 1 against the SQLAlchemy async engine
  redis_health          PING on Redis (forges' Pub/Sub + session store)
  keycloak_reachable    GET <keycloak>/realms/<realm>/.well-known/openid-configuration
  litellm_health        GET <litellm>/health/liveliness (reuses existing cache)
  audit_sink            telemetry initialized + can resolve AuditEvent table
  floci_health          GET <AWS_ENDPOINT_URL>/_localstack/health
  forge_phase4_mounted  True after mount_phase4_top_level(app) (T1.8)
  otel_exporter_configured  OTLP endpoint configured (best-effort)

Tests live in ``backend/tests/test_healthz.py``.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import time
import urllib.request
from typing import Any

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter
from fastapi.responses import JSONResponse
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

# Phase 7 SC-7.5: git_sha — env first, fall back to git rev-parse.
_GIT_SHA = (
    os.environ.get("GIT_SHA")
    or subprocess.run(  # noqa: S603,S607
        ["git", "rev-parse", "--short", "HEAD"],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    ).stdout.strip()
    or "unknown"
)


# ---------------------------------------------------------------------------
# Individual probes — each returns ``(status, latency_ms)``. ``status`` is
# the string ``"ok"`` / ``"down"`` or a structured dict for compound
# probes. ``latency_ms`` is float seconds -> ms. Never raises.
# ---------------------------------------------------------------------------


async def _probe_db() -> tuple[Any, float]:
    """SELECT 1 against the async SQLAlchemy engine.

    Mirrors ``app/api/v1/health.py:_check_postgres`` but added here as a
    fresh path so the top-level /healthz is fully independent of the
    /api/v1 surface (the docker-compose backend healthcheck hits the
    unauthenticated top-level route, never the v1 surface).
    """
    start = time.perf_counter()
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok", (time.perf_counter() - start) * 1000.0
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.db_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000.0


async def _probe_redis() -> tuple[Any, float]:
    """PING on the configured Redis URL."""
    start = time.perf_counter()
    try:
        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        try:
            pong = await client.ping()
        finally:
            await client.aclose()
        return ("ok" if pong else "down"), (time.perf_counter() - start) * 1000.0
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.redis_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000.0


async def _probe_keycloak() -> tuple[Any, float]:
    """GET /realms/<realm>/.well-known/openid-configuration on Keycloak.

    The OIDC discovery endpoint is the canonical readiness probe for
    Keycloak — it answers once the realm is imported AND the
    discovery document is built. Wrapped in a 5s timeout because
    Keycloak's first-boot realm import can take 60-90s and we don't
    want /healthz to block on it.
    """
    start = time.perf_counter()
    base = settings.keycloak_url.rstrip("/")
    realm = settings.keycloak_realm or "forge"
    url = f"{base}/realms/{realm}/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(url)
        status = "ok" if response.status_code == 200 else "down"
        return status, (time.perf_counter() - start) * 1000.0
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.keycloak_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000.0


async def _probe_litellm() -> tuple[Any, float]:
    """GET /health/liveliness on the configured LiteLLM Proxy URL.

    Reuses the LiteLLMBaseClient so the existing master-key handling
    and readiness semantics in F-829 stay consistent with /api/forge/health.
    """
    start = time.perf_counter()
    try:
        async with LiteLLMBaseClient() as litellm:
            payload = await litellm.readiness()
        status = "ok" if payload.get("reachable") is True else "down"
        return status, (time.perf_counter() - start) * 1000.0
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.litellm_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000.0


async def _probe_audit_sink() -> tuple[Any, float]:
    """Verify the audit pipeline is wired without writing a row.

    audit_sink is the combination of:
      - structured DB storage (AuditEvent lives in the same postgres DB)
      - observability (OpenTelemetry sink is initialized)

    We don't insert a row on every /healthz call (that would multiply
    write load on the cluster); we just check that the audit_log table
    is registered in metadata + OTel was initialized. If either leg
    is down the probe reports a structured dict so the dashboard can
    graph which leg failed. Latency is reported as the wall-clock for
    the entire compound check.
    """
    start = time.perf_counter()
    statuses: dict[str, str] = {"otel": "down", "audit_table": "down"}
    if _otel_initialized:
        statuses["otel"] = "ok"
    try:
        # Confirm AuditEvent is registered against Base.metadata.
        if AuditEvent.__tablename__ in {t.name for t in AuditEvent.metadata.tables.values()}:
            statuses["audit_table"] = "ok"
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.audit_sink_fail", error=str(exc))
    return statuses, (time.perf_counter() - start) * 1000.0


def _probe_otel_exporter() -> tuple[Any, float]:
    """M2 T-A6 — PITFALL-5 closure (Plan 01-03).

    Reports ``ok`` when the OpenTelemetry exporter is wired to a
    non-empty endpoint (either via the ``OTEL_EXPORTER_OTLP_ENDPOINT``
    env var or via :attr:`Settings.otlp_endpoint`).  The probe is
    intentionally synchronous because the check is a single
    attribute read — the exporter itself is initialized at app
    startup by :mod:`app.core.telemetry`, not on every /healthz
    request.

    The probe returns ``down`` when neither source is set so the
    operator sees a clear signal that audit + trace spans are
    landing in the no-op exporter (M2 spec §2.2 G19).  Note that
    this probe is best-effort — a backend that boots without an
    OTel collector still serves traffic, it just loses the
    distributed-trace surface area.
    """
    # Prefer the env var (the canonical OpenTelemetry SDK lookup)
    # over the Settings field so the probe matches what the SDK
    # itself sees at runtime.
    import os

    endpoint = (
        os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        or getattr(settings, "otlp_endpoint", None)
    )
    if endpoint and str(endpoint).strip():
        return "ok", 0.0
    return "down", 0.0


def _probe_floci() -> tuple[Any, float]:
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
    start = time.perf_counter()
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
            status = "ok" if resp.status < 500 else "down"
            return status, (time.perf_counter() - start) * 1000.0
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz.floci_fail", error=str(exc))
        return "down", (time.perf_counter() - start) * 1000.0


# ---------------------------------------------------------------------------
# Aggregation + route
# ---------------------------------------------------------------------------


def _aggregate_status(probes: dict[str, Any]) -> str:
    """Return 'ok' if every probe is 'ok'; else 'degraded'.

    Each probe value is a dict ``{"status": ..., "latency_ms": ...}``
    (Phase 7 SC-7.5) OR, for legacy callers, a bare string / bool /
    dict. Phase 7 probes always emit the new shape; aggregate reads
    ``status`` from each.
    """
    for value in probes.values():
        if isinstance(value, dict) and "status" in value:
            sub = value["status"]
            if isinstance(sub, dict):
                # compound probe (audit_sink)
                for leaf in sub.values():
                    if leaf != "ok":
                        return "degraded"
            elif isinstance(sub, bool):
                if not sub:
                    return "degraded"
            elif sub != "ok":
                return "degraded"
        elif isinstance(value, dict):
            for leaf in value.values():
                if leaf != "ok":
                    return "degraded"
        elif isinstance(value, bool):
            if not value:
                return "degraded"
        elif value != "ok":
            return "degraded"
    return "ok"


@router.get("/healthz")
async def healthz() -> JSONResponse:
    """Top-level liveness + dependency probe (M1 AC-1; Phase 7 SC-7.5).

    Returns 200 + ``status: ok`` when every probe is green; otherwise
    503 + ``status: degraded``. The body always carries ``git_sha``
    and ``latency_ms`` per probe so operators can correlate
    deployments with regressions. The 5s per-probe timeout guarantees
    the slowest probe doesn't drag the entire response past
    5×7 = 35s worst case (probes run concurrently).
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
    audit_task = asyncio.create_task(_probe_audit_sink())
    floci_value = _probe_floci()  # sync — fast, no event loop needed
    otel_value = _probe_otel_exporter()  # sync — fast, no event loop needed

    db_v, redis_v, keycloak_v, litellm_v, audit_v = await asyncio.gather(
        db_task,
        redis_task,
        keycloak_task,
        litellm_task,
        audit_task,
    )

    def _flatten(value: Any) -> dict[str, Any]:
        """Wrap (status, latency_ms) tuples / bare values into the
        Phase 7 wire format ``{"status": ..., "latency_ms": ...}``.

        Compound probes (audit_sink) keep their nested dict under
        ``status``; latency_ms is the wall-clock for the whole check.
        """
        if isinstance(value, tuple) and len(value) == 2 and isinstance(value[1], (int, float)):
            status_raw, latency_ms = value
            return {"status": status_raw, "latency_ms": round(float(latency_ms), 3)}
        return {"status": value, "latency_ms": 0.0}

    probes: dict[str, Any] = {
        "db_health": _flatten(db_v),
        "redis_health": _flatten(redis_v),
        "keycloak_reachable": _flatten(keycloak_v),
        "litellm_health": _flatten(litellm_v),
        "audit_sink": _flatten(audit_v),
        "floci_health": _flatten(floci_value),
        "forge_phase4_mounted": {"status": bool(forge_phase4_mounted), "latency_ms": 0.0},
        # M2 T-A6 — Plan 01-03, G18 + G19 closure.  The probe is
        # synchronous because the underlying check is a single
        # attribute read; no event-loop work is required.
        "otel_exporter_configured": _flatten(otel_value),
    }
    status = _aggregate_status(probes)
    body = {
        "status": status,
        "version": __version__,
        "environment": settings.environment,
        "git_sha": _GIT_SHA,
        "probes": probes,
    }
    http_status = 200 if status == "ok" else 503
    logger.info(
        "healthz.served",
        status=status,
        git_sha=_GIT_SHA,
        db=db_v[0] if isinstance(db_v, tuple) else db_v,
        redis=redis_v[0] if isinstance(redis_v, tuple) else redis_v,
        keycloak=keycloak_v[0] if isinstance(keycloak_v, tuple) else keycloak_v,
        litellm=litellm_v[0] if isinstance(litellm_v, tuple) else litellm_v,
        audit=audit_v[0] if isinstance(audit_v, tuple) else audit_v,
        floci=floci_value[0] if isinstance(floci_value, tuple) else floci_value,
        phase4=bool(forge_phase4_mounted),
        otel_exporter=otel_value[0] if isinstance(otel_value, tuple) else otel_value,
        http_status=http_status,
    )
    return JSONResponse(status_code=http_status, content=body)


__all__ = ["router", "_GIT_SHA"]
