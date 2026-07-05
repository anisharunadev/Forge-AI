"""FastAPI application entry point.

Wires CORS, OpenTelemetry, structured logging, the v1 router, and the
Terminal WebSocket route. Lifespan handles bus + telemetry startup.
"""

from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
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
from app.api.healthz import router as healthz_router
from app.api.v1.forge_phase4 import mount_phase4_top_level
from app.api.v1.router import api_router
from app.api.ws.ideation import router as ideation_ws_router
from app.api.ws.runs import router as runs_ws_router
from app.api.ws.terminal import router as terminal_ws_router
from app.api.ws.terminal_broadcast import router as terminal_broadcast_ws_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.core.phase4_errors import register_phase4_exception_handlers
from app.core.telemetry import init_telemetry
from app.integrations.litellm.health_monitor import health_monitor
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.services import lesson_service
from app.services.audit_service import audit_service
from app.services.event_bus import bus

logger = get_logger(__name__)

# M1 T1.9 — auto-migrate + auto-seed on first boot. The spec calls for
# ``alembic upgrade head`` then ``seed_runner.apply(...)`` for each demo
# package; both are gated by env vars so CI can opt out cleanly. The
# helpers below are intentionally tiny and additive so Track A's wiring
# stays untouched. See:
#   - https://internal/spec/M1#T1.9 — auto-seed order
#   - docs/operations/dev-bootstrap.md — operator-facing recipe
#   - docs/operations/seed-data.md      — seed catalog (Track C)
#
# Env overrides (read directly so we don't take a dependency on the
# pydantic settings module — these are boot-only escape hatches, not
# user-facing config):
#   SKIP_AUTO_MIGRATE=true    → skip ``alembic upgrade head``.
#   SKIP_AUTO_SEED=true       → skip the seed-if-empty pass.
#   AUTO_SEED_PACKAGES        → comma-separated override of the seed
#                               packages to apply. Default is the
#                               three-package smoke set the M1 spec
#                               requested: ``acme-corp``, ``kn-base``,
#                               ``acme-secondary`` (which may not yet
#                               ship — see ``_AUTO_SEED_DEFAULT``).
_SKIP_AUTO_MIGRATE = os.environ.get("SKIP_AUTO_MIGRATE", "").strip().lower() in {
    "1",
    "true",
    "yes",
}
_SKIP_AUTO_SEED = os.environ.get("SKIP_AUTO_SEED", "").strip().lower() in {
    "1",
    "true",
    "yes",
}
_AUTO_SEED_DEFAULT = "acme-corp,kn-base,acme-secondary"
_AUTO_SEED_PACKAGES = [
    item.strip()
    for item in os.environ.get("AUTO_SEED_PACKAGES", _AUTO_SEED_DEFAULT).split(",")
    if item.strip()
]
_AUTO_SEED_SYSTEM_ACTOR_ID = __import__("uuid").UUID(int=0)


# ---------------------------------------------------------------------------
# M1 T1.9 — boot helpers (auto-migrate + auto-seed).
#
# Both helpers are intentionally tolerant — a failing migration aborts
# the boot (we don't want to serve traffic against an out-of-date schema),
# but a missing seed package is logged-and-skipped rather than crashing
# the deploy. ``python -m seeds apply <name>`` is the explicit escape
# hatch when an operator needs to backfill a single package.
# ---------------------------------------------------------------------------


async def _run_alembic_upgrade_head() -> None:
    """Invoke ``alembic upgrade head`` from inside the event loop.

    The alembic ``env.py`` ships an async engine; we still run the
    upgrade on a worker thread because alembic's command surface
    blocks on the IO loop and would deadlock FastAPI's lifespan.
    The subprocess import is local so the module stays importable
    in environments where alembic isn't on PYTHONPATH.

    Set ``SKIP_AUTO_MIGRATE=true`` to bypass.
    """
    if _SKIP_AUTO_MIGRATE:
        logger.info("forge.startup.auto_migrate_skipped")
        return
    backend_root = Path(__file__).resolve().parents[1]
    ini_path = backend_root / "alembic.ini"
    if not ini_path.exists():
        logger.warning(
            "forge.startup.auto_migrate_no_alembic_ini",
            path=str(ini_path),
        )
        return
    cmd = [
        sys.executable,
        "-m",
        "alembic",
        "-c",
        str(ini_path),
        "upgrade",
        "head",
    ]
    logger.info("forge.startup.auto_migrate_start", cmd=" ".join(cmd))

    def _run() -> None:
        import subprocess

        subprocess.run(cmd, cwd=str(backend_root), check=True)

    try:
        await asyncio.to_thread(_run)
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "forge.startup.auto_migrate_failed",
            error=str(exc),
        )
        raise
    logger.info("forge.startup.auto_migrate_complete")


async def _run_autoseed_if_empty() -> None:
    """Apply each demo seed package, but only if the seed_runs table is empty.

    The idempotency check prevents re-seeding on every boot; it also
    surfaces a clean "already seeded" log line so an operator can
    tell at a glance whether this is a fresh boot or a re-boot. We
    deliberately bail loud on a failing apply so a broken seed
    manifest doesn't ship silently.

    Set ``SKIP_AUTO_SEED=true`` to bypass (test + CI use this when
    they manage seeds out of band).
    """
    if _SKIP_AUTO_SEED:
        logger.info("forge.startup.auto_seed_skipped")
        return
    # Local imports — defer the dependency on session machinery to
    # the moment we actually need it, so a SKIP_AUTO_SEED=true
    # boot doesn't pay the cost (or risk the side effects) of an
    # extra session factory.
    from sqlalchemy import func, select

    from app.db.models.seed import SeedRun as SeedRunRow
    from app.db.session import get_session_factory
    from seeds.framework.seed_runner import SeedRunner

    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(select(func.count(SeedRunRow.id)))
        existing_runs = int(result.scalar_one() or 0)
    if existing_runs > 0:
        logger.info(
            "forge.startup.auto_seed_skipped_existing",
            seed_runs=existing_runs,
        )
        return

    runner = SeedRunner(
        session_factory=session_factory,
        audit_service=audit_service,
        env=settings.environment,
    )
    available = {summary.name for summary in runner.list()}
    for package in _AUTO_SEED_PACKAGES:
        if package not in available:
            # Spec lists ``acme-secondary`` even though the package
            # is not yet on disk. Skip-with-warning keeps the spec
            # alignment while not breaking a fresh deploy.
            logger.warning(
                "forge.startup.auto_seed_missing_package",
                package=package,
                available=sorted(available),
            )
            continue
        try:
            run = await runner.apply(
                seed_name=package,
                actor_id=_AUTO_SEED_SYSTEM_ACTOR_ID,
                triggered_by="bootstrap",
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "forge.startup.auto_seed_failed",
                package=package,
                error=str(exc),
            )
            raise
        logger.info(
            "forge.startup.auto_seed_applied",
            package=package,
            manifest_version=run.manifest_version,
            row_counts=run.row_counts,
            duration_ms=run.duration_ms,
        )


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
    # step-77 P0 — start the LiteLLM availability monitor (it was
    # defined in F-829l but never wired in). Cheap idempotent noop if
    # already running. ``is_healthy`` flips on the first probe and the
    # audit event is emitted by the monitor itself.
    await health_monitor.start()
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
    # M1 T1.9 — order:
    #   1. (already done) env validator runs when ``settings`` is imported,
    #      so any placeholder-LLM-key failure has already aborted the
    #      process by this point.
    #   2. alembic upgrade head — bring the schema to head before any
    #      request hits the orchestrator. Idempotent; runs on every boot
    #      but is a no-op once we're at head.
    #   3. seed-if-empty — apply the demo seed packages on a fresh DB.
    #      Idempotent on re-boot: the seed_runs table acts as the gate.
    #   4. (already done) the /healthz probe is registered as part of the
    #      Track A app-building sequence (``app.include_router(healthz_router)``
    #      above). We don't repeat the registration here.
    await _run_alembic_upgrade_head()
    await _run_autoseed_if_empty()
    # M7 T-A2 — reload the in-process ``_HASH_CHAIN`` cache from the
    # DB so new writes that arrive immediately after a restart extend
    # the chain rather than restarting from ``""``. Best-effort: a
    # failure here logs and lets the process boot so startup never
    # blocks on observability concerns.
    try:
        from app.db.session import get_session_factory  # noqa: PLC0415  (lifespan import)
        from app.services.observability_service import (  # noqa: PLC0415  (lifespan import)
            observability_service,
        )

        async with get_session_factory()() as _boot_session:
            await observability_service.reload_chain_heads(_boot_session)
    except Exception as _chain_exc:  # noqa: BLE001 — boot must not block
        logger.warning(
            "forge.startup.chain_reload_failed", error=str(_chain_exc)
        )
    logger.info("forge.startup.boot_complete")
    try:
        yield
    finally:
        # Stop the health monitor BEFORE the event bus so any
        # in-flight audit row it tries to publish during shutdown has
        # a live bus to dispatch on. The monitor's ``stop()`` is
        # idempotent and a noop when never started.
        await health_monitor.stop()
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
# M1 T1.3 — top-level /healthz for k8s probes + docker-compose backend
# healthcheck (T1.1.1). The route is outside /api/v1/ on purpose so
# it's reachable from any network namespace and stays valid even if
# the v1 surface is renamed.
app.include_router(healthz_router)
app.include_router(terminal_ws_router)
app.include_router(terminal_broadcast_ws_router)
app.include_router(ideation_ws_router)
app.include_router(runs_ws_router)
# step-80 — Phase 4 error handler (PassThroughDisabled, SSOMisconfigured, …).
register_phase4_exception_handlers(app)
# M1 T1.8 — mount Phase 4 top-level routes (/openai/*, /.well-known/*,
# /a2a/*) directly on ``app``. Until this runs, those routes are
# unreachable, which is exactly what the G1 audit flagged. The flag
# ``forge_phase4_mounted`` is flipped inside the helper and read by
# the /healthz probe to confirm the wiring is live in CI.
mount_phase4_top_level(app)


@app.get("/", tags=["root"])
async def root() -> dict[str, str]:
    """Trivial root route — useful for k8s probes that hit `/`."""
    return {"service": "forge-backend", "version": __version__}


__all__ = ["app"]
