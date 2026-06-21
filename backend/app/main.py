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

from app import __version__
from app.api.v1.router import api_router
from app.api.ws.ideation import router as ideation_ws_router
from app.api.ws.runs import router as runs_ws_router
from app.api.ws.terminal import router as terminal_ws_router
from app.api.ws.terminal_broadcast import router as terminal_broadcast_ws_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.telemetry import init_telemetry
from app.services.event_bus import bus

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Boot-time wiring: log + telemetry + event bus."""
    configure_logging(level=settings.log_level)
    init_telemetry()
    await bus.start()
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


@app.get("/", tags=["root"])
async def root() -> dict[str, str]:
    """Trivial root route — useful for k8s probes that hit `/`."""
    return {"service": "forge-backend", "version": __version__}


__all__ = ["app"]
