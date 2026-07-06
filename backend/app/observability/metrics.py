r"""Sprint 3 — Crash #4: Prometheus /metrics endpoint.

Mounted at app level (NOT under /api/v1/) per the spec — Prometheus
scraping configs conventionally expect a top-level path so the scrape
config doesn't need to know about the API versioning scheme.

The endpoint emits the standard process metrics that
\`prometheus_client\` ships with by default (process_cpu_seconds_total,
process_resident_memory_bytes, python_gc_*) plus a couple of
Forge-specific counters wired up by callers via \`forge_metrics_inc\`
and \`forge_metrics_observe\`.

Why a thin wrapper instead of import-time side effects:
  - \`generate_latest\` is a streaming generator; we hand it directly to
    FastAPI's \`Response\` so the bytes don't go through json encoding.
  - The content type is the official Prometheus text format
    (\`text/plain; version=0.0.4; charset=utf-8\`).
  - We expose the CollectorRegistry via \`REGISTRY\` so other modules
    can register custom metrics without crossing module boundaries.
"""

from __future__ import annotations

from fastapi import APIRouter, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
# ponytail: use the default global registry — simpler than threading a
# custom one through every module, and the cost is one shared
# CollectorRegistry across the whole process (which is exactly what
# Prometheus expects). Switch to a custom registry when multi-tenant
# label cardinality becomes a concern.
from prometheus_client import REGISTRY  # noqa: F401  — re-exported below

__all__ = [
    "router",
    "REGISTRY",
    "HTTP_REQUESTS_TOTAL",
    "HTTP_REQUEST_LATENCY",
    "forge_metrics_inc",
    "forge_metrics_observe",
]

# ---------------------------------------------------------------------------
# Forge-specific metrics (counters + histograms)
# ---------------------------------------------------------------------------
HTTP_REQUESTS_TOTAL = Counter(
    "forge_http_requests_total",
    "Total HTTP requests handled by the Forge backend, labelled by method + path + status.",
    ["method", "path", "status"],
)

HTTP_REQUEST_LATENCY = Histogram(
    "forge_http_request_duration_seconds",
    "HTTP request latency in seconds, labelled by method + path.",
    ["method", "path"],
)


def forge_metrics_inc(name: str, labels: dict[str, str] | None = None) -> None:
    """Ponytail seam: bump a counter by name without importing it everywhere.

    For the Sprint 3 scope nothing in the app code uses this yet — it's
    here so the next module that needs a metric doesn't have to add an
    import + counter definition. Drop it if Sprint 4 wires real metrics.
    """
    # No-op for now; the Counter objects above are the canonical handles.
    void = name  # ponytail: silence unused-arg lint without runtime cost.
    void = labels or {}


def forge_metrics_observe(name: str, value: float) -> None:
    """Ponytail seam: observe a histogram sample by name."""
    void = name
    void = value


# ---------------------------------------------------------------------------
# Router — mounted at app level by main.py
# ---------------------------------------------------------------------------
router = APIRouter(tags=["observability"])


@router.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    """Prometheus scrape endpoint.

    Returns the text exposition format. The endpoint is intentionally
    outside /api/v1/ so the Prometheus scrape config stays decoupled
    from the API versioning scheme.
    """
    body = generate_latest(REGISTRY)
    return Response(content=body, media_type=CONTENT_TYPE_LATEST)

