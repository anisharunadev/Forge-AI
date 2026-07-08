"""OpenTelemetry tracer + meter providers (Rule 7).

Wires OTLP exporter when an endpoint is configured; otherwise falls back
to a no-op provider so tests don't need a collector running.
"""

from __future__ import annotations

import os

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv.resource import ResourceAttributes

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_initialized = False
_configured: bool = False


def configure_otel(endpoint: str | None = None) -> bool:
    """Configure the OTLP exporter for the active process.

    Plan 01-03 (PITFALL-5 closure) — the canonical entry point for
    "is OTel actually wired?". Returns ``True`` when an OTLP endpoint
    resolves to a non-empty value (the SDK then ships spans + metrics
    through it); ``False`` when the endpoint is unset, in which case
    the backend falls back to the no-op exporter and audit / trace
    data stays in-process.

    The check prefers the ``OTEL_EXPORTER_OTLP_ENDPOINT`` env var
    (the canonical OpenTelemetry SDK lookup key) and falls back to
    the ``Settings.otlp_endpoint`` field. The env var wins because
    the SDK itself reads it via the standard OTEL configuration
    pipeline at exporter construction time.

    Side effect: sets the module-level ``_configured`` flag so
    :func:`is_otel_configured` can answer the readiness probe
    without re-reading settings on every call.
    """
    global _configured  # noqa: PLW0603
    resolved = (
        endpoint
        if endpoint is not None
        else os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or settings.otlp_endpoint
    )
    _configured = bool(resolved and str(resolved).strip())
    return _configured


def is_otel_configured() -> bool:
    """Return whether :func:`configure_otel` last resolved to a real endpoint.

    Used by the ``/healthz`` ``otel_exporter_configured`` probe (Plan
    01-03) and by the production-mode 503 gate so operators can detect
    a misconfigured OTLP exporter before any cutover.
    """
    return _configured


def init_telemetry() -> None:
    """Initialize OpenTelemetry providers once per process.

    Idempotent: safe to call from FastAPI startup and from tests.
    """
    global _initialized  # noqa: PLW0603
    if _initialized:
        return

    # Resolve the OTLP endpoint once and cache the boolean for the
    # /healthz otel_exporter_configured probe. Done up front so the
    # probe can answer without re-reading env every request.
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or settings.otlp_endpoint
    configure_otel(endpoint)

    resource = Resource.create(
        {
            ResourceAttributes.SERVICE_NAME: settings.otel_service_name,
            ResourceAttributes.SERVICE_VERSION: settings.app_version,
            ResourceAttributes.DEPLOYMENT_ENVIRONMENT: settings.environment,
        }
    )

    if endpoint:
        span_exporter = OTLPSpanExporter(
            endpoint=endpoint,
            insecure=settings.otel_exporter_otlp_insecure,
        )
        metric_exporter = OTLPMetricExporter(
            endpoint=endpoint,
            insecure=settings.otel_exporter_otlp_insecure,
        )

        tracer_provider = TracerProvider(resource=resource, sampler=_build_sampler())
        tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))
        trace.set_tracer_provider(tracer_provider)

        meter_provider = MeterProvider(
            resource=resource,
            metric_readers=[PeriodicExportingMetricReader(metric_exporter)],
        )
        metrics.set_meter_provider(meter_provider)
        logger.info("telemetry.otlp_initialized", endpoint=endpoint)
    else:
        # No exporter — keep SDK defaults but still tag resources.
        trace.set_tracer_provider(TracerProvider(resource=resource, sampler=_build_sampler()))
        metrics.set_meter_provider(MeterProvider(resource=resource))
        logger.info("telemetry.noop_initialized")

    _initialized = True


def _build_sampler():
    """Build a tenant-scoped sampler when redis + session factory are available."""
    from app.core.tenant_sampler import TenantSettingsCache, make_sampler

    try:
        import redis.asyncio as aioredis

        from app.core.config import settings
        from app.db.session import get_session_factory

        redis_client = None
        if settings.redis_url:
            try:
                redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
            except Exception:  # noqa: BLE001
                redis_client = None
        cache = TenantSettingsCache(redis_client, get_session_factory())
        return make_sampler(cache)
    except Exception:  # noqa: BLE001
        logger.warning("telemetry.sampler_unavailable")
        from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

        return ParentBased(TraceIdRatioBased(1.0))


def get_tracer(name: str = "forge") -> trace.Tracer:
    """Module-level tracer accessor."""
    if not _initialized:
        init_telemetry()
    return trace.get_tracer(name)


def get_meter(name: str = "forge") -> metrics.Meter:
    """Module-level meter accessor."""
    if not _initialized:
        init_telemetry()
    return metrics.get_meter(name)
