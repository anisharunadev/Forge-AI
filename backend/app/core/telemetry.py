"""OpenTelemetry tracer + meter providers (Rule 7).

Wires OTLP exporter when an endpoint is configured; otherwise falls back
to a no-op provider so tests don't need a collector running.
"""

from __future__ import annotations

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
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


def init_telemetry() -> None:
    """Initialize OpenTelemetry providers once per process.

    Idempotent: safe to call from FastAPI startup and from tests.
    """
    global _initialized
    if _initialized:
        return

    resource = Resource.create(
        {
            ResourceAttributes.SERVICE_NAME: settings.otel_service_name,
            ResourceAttributes.SERVICE_VERSION: settings.app_version,
            ResourceAttributes.DEPLOYMENT_ENVIRONMENT: settings.environment,
        }
    )

    if settings.otlp_endpoint:
        span_exporter = OTLPSpanExporter(
            endpoint=settings.otlp_endpoint,
            insecure=settings.otel_exporter_otlp_insecure,
        )
        metric_exporter = OTLPMetricExporter(
            endpoint=settings.otlp_endpoint,
            insecure=settings.otel_exporter_otlp_insecure,
        )

        tracer_provider = TracerProvider(resource=resource)
        tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))
        trace.set_tracer_provider(tracer_provider)

        meter_provider = MeterProvider(
            resource=resource,
            metric_readers=[PeriodicExportingMetricReader(metric_exporter)],
        )
        metrics.set_meter_provider(meter_provider)
        logger.info("telemetry.otlp_initialized", endpoint=settings.otlp_endpoint)
    else:
        # No exporter — keep SDK defaults but still tag resources.
        trace.set_tracer_provider(TracerProvider(resource=resource))
        metrics.set_meter_provider(MeterProvider(resource=resource))
        logger.info("telemetry.noop_initialized")

    _initialized = True


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
