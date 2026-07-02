"""FastAPI application entry point.

Wires CORS, OpenTelemetry, structured logging, the v1 router, and the
Terminal WebSocket route. Lifespan handles bus + telemetry startup.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ponytail: FastAPI's get_typed_signature uses call.__globals__ to eval string
# annotations (PEP 563). When an endpoint is wrapped by @audit, the wrapper's
# __globals__ is audit.py's module dict — which doesn't have get_current_principal
# or Depends. Unwrap first so resolution uses the wrapped function's own globals.
import inspect as _inspect
from fastapi.dependencies import utils as _fdep_utils

_orig_get_typed_signature = _fdep_utils.get_typed_signature


def _patched_get_typed_signature(call):
    return _orig_get_typed_signature(_inspect.unwrap(call))


_fdep_utils.get_typed_signature = _patched_get_typed_signature

from app import __version__
from app.api.v1.router import api_router
from app.api.ws.ideation import router as ideation_ws_router
from app.api.ws.runs import router as runs_ws_router
from app.api.ws.terminal import router as terminal_ws_router
from app.api.ws.terminal_broadcast import router as terminal_broadcast_ws_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.phase4_errors import register_phase4_exception_handlers
from app.core.telemetry import init_telemetry
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.services import lesson_service
from app.services.event_bus import bus

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Boot-time wiring: log + telemetry + LiteLLM readiness + event bus.

    step-75 Phase 1: probes ``/health/readiness`` with the master key;
    on 401 raises and aborts boot (spec line 64). On
    ``db == "Not connected"`` warns but allows boot (spec line 66). On
    success, fires a one-shot ``GET /routes`` for capability discovery
    (spec line 95) and emits a ``forge.auth.config_loaded`` log line
    that doubles as the audit event.
    """
    configure_logging(level=settings.log_level)
    init_telemetry()
    await bus.start()
    lesson_service.register(bus)
    # step-75 Phase 1 — readiness probe + routes discovery.
    route_count = 0
    if settings.forge_route_discovery_enabled:
        async with LiteLLMBaseClient() as litellm:
            readiness = await litellm.readiness()
            if readiness.get("status_code") == 401:
                # ponytail: bail loud so a misconfigured deploy doesn't
                # start serving traffic with a broken key.
                logger.critical(
                    "forge.startup.master_key_rejected",
                    proxy=settings.litellm_proxy_url,
                )
                raise SystemExit(2)
            if not readiness.get("reachable"):
                logger.warning(
                    "forge.startup.litellm_unreachable",
                    error=readiness.get("error"),
                    status_code=readiness.get("status_code"),
                )
            elif readiness.get("db") == "Not connected":
                logger.warning(
                    "forge.startup.litellm_db_disconnected",
                    version=readiness.get("version"),
                )
            else:
                logger.info("forge.startup.litellm_ready", version=readiness.get("version"))
            routes_result = await litellm.list_routes()
            route_count = int(routes_result.get("count") or 0)
    logger.info(
        "forge.auth.config_loaded",
        version=__version__,
        environment=settings.environment,
        otlp=settings.otlp_endpoint or "disabled",
        route_count=route_count,
        master_key_present=bool(settings.litellm_master_key or settings.litellm_admin_key),
    )
    logger.info(
        "forge.startup",
        version=__version__,
        environment=settings.environment,
        otlp=settings.otlp_endpoint or "disabled",
    )
    try:
        yield
    finally:
        await bus.stop()
        logger.info("forge.shutdown")


app = FastAPI(
    title="Forge AI Backend",
    version=__version__,
    lifespan=lifespan,
    # Don't set default_response_class=JSONResponse — it conflicts with
    # status_code=204 endpoints (FastAPI rejects a body for 204, but
    # JSONResponse always implies a body). The default Response class
    # is content-aware and handles 204 correctly. Endpoints that need
    # JSON can still set response_model explicitly.
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(terminal_ws_router)
app.include_router(terminal_broadcast_ws_router)
app.include_router(ideation_ws_router)
app.include_router(runs_ws_router)
# step-80 — Phase 4 error handler (PassThroughDisabled, SSOMisconfigured, …).
register_phase4_exception_handlers(app)


@app.get("/", tags=["root"])
async def root() -> dict[str, str]:
    """Trivial root route — useful for k8s probes that hit `/`."""
    return {"service": "forge-backend", "version": __version__}


__all__ = ["app"]
