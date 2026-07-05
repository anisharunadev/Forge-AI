"""Phase 5 -- fetch current metric snapshot for SLO evaluation.

Ponytail: returns an empty dict. The SLO evaluator compares its
``install_default_alerts()`` list to the snapshot; absent keys are
silently skipped. Wire a Prometheus client (or read OTel metric
export) here when the operator dashboard is built. The shape is
``{(surface, metric): float}`` and any provider can be plugged in.
"""
from __future__ import annotations


async def fetch_current_metrics() -> dict[tuple[str, str], float]:
    """Return ``{(surface, metric): value}`` for the most recent tick.

    Empty by design for now -- the alert evaluator treats missing
    keys as \"no data, no breach\". This keeps the pipeline runnable
    in environments without a metrics backend while we ship the
    alert wiring itself.
    """
    return {}


__all__ = ["fetch_current_metrics"]
