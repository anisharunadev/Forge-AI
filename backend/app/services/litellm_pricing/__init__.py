"""LiteLLM pricing loader (ADR-009 Appendix B).

Exposes :func:`project_cost_usd` which reads
``litellm_model_pricing.yaml`` (co-located with this module) to
project the USD cost of an upcoming LLM call given its model and
token counts.

Pricing drift policy: when a model price changes upstream, refresh
the YAML (Track C owns the runbook). The ``default`` fallback
under-estimates by design so unknown models never silently blow
past the cap — the cumulative-cap rule (ADR-009 Appendix B) filters
on ``projected = false`` so the budget is enforced on confirmed
spend regardless.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(slots=True, frozen=True)
class ModelPricing:
    """USD price per 1,000 tokens for a single model.

    `prompt_per_1k` is the cost of 1,000 prompt tokens; same shape
    for `completion_per_1k`. Multiplied by token count / 1_000 to
    get the projected USD cost of an upcoming call.
    """

    prompt_per_1k: float
    completion_per_1k: float


# The YAML lives next to this __init__. Using ``Path(__file__).parent``
# makes the path resolution robust to import order — pytest fixtures,
# workers, and CLI invocation all resolve to the same file.
_PRICING_YAML = Path(__file__).parent / "litellm_model_pricing.yaml"


@lru_cache(maxsize=1)
def _load_pricing_table() -> tuple[dict[str, ModelPricing], ModelPricing]:
    """Parse the YAML once per process; cache the result.

    Returns a tuple of ``(per_model_pricing, default_pricing)``. A
    parse error raises ``RuntimeError`` — the hot path is never
    allowed to silently fall back to all-zeros pricing.
    """
    if not _PRICING_YAML.exists():
        raise RuntimeError(
            f"litellm_pricing YAML missing: {_PRICING_YAML}. "
            f"Track B T-B5 ships the file co-located with this module."
        )
    with _PRICING_YAML.open("r", encoding="utf-8") as fh:
        raw: dict[str, Any] = yaml.safe_load(fh) or {}
    models_raw = raw.get("models") or {}
    if not isinstance(models_raw, dict):
        raise RuntimeError(
            f"litellm_pricing YAML schema invalid: 'models' must be a mapping. "
            f"Got {type(models_raw).__name__}."
        )
    default_raw = raw.get("default")
    if not isinstance(default_raw, dict):
        raise RuntimeError(
            f"litellm_pricing YAML schema invalid: 'default' must be a mapping. "
            f"Got {type(default_raw).__name__}."
        )

    per_model: dict[str, ModelPricing] = {}
    for name, entry in models_raw.items():
        if not isinstance(entry, dict):
            logger.warning(
                "litellm_pricing.invalid_model_entry",
                model=name,
                reason="entry_not_mapping",
            )
            continue
        per_model[name] = ModelPricing(
            prompt_per_1k=float(entry.get("prompt_per_1k", 0.0)),
            completion_per_1k=float(entry.get("completion_per_1k", 0.0)),
        )

    default = ModelPricing(
        prompt_per_1k=float(default_raw.get("prompt_per_1k", 0.0)),
        completion_per_1k=float(default_raw.get("completion_per_1k", 0.0)),
    )
    return per_model, default


def get_pricing(model: str | None) -> ModelPricing:
    """Return pricing for ``model`` or the default fallback.

    Unknown model → ``default`` block. Missing model arg → ``default``
    block. The ``default`` block is intentionally conservative
    (matches gpt-4o-mini) so unknown / future models never silently
    inflate the budget.
    """
    per_model, default = _load_pricing_table()
    if model is None:
        return default
    return per_model.get(model, default)


def project_cost_usd(
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
) -> float:
    """Project USD cost of an LLM call given model + token counts.

    Used by :func:`app.services.litellm_client.pre_call_admission` to
    reserve headroom on the per-RUN cumulative cap (ADR-009
    Appendix B). Returns a non-negative float; the cumulative-cap
    rule filters on ``projected = false`` so a projection that
    over-estimates never silently consumes the budget.

    Negative token counts are clamped to zero — the projection
    surface is for *admission*, not for billing, and admitting a
    negative-cost call is a bug.
    """
    pricing = get_pricing(model)
    pt = max(0, int(prompt_tokens))
    ct = max(0, int(completion_tokens))
    cost = (pt / 1000.0) * pricing.prompt_per_1k + (ct / 1000.0) * pricing.completion_per_1k
    return max(0.0, float(cost))


__all__ = [
    "ModelPricing",
    "get_pricing",
    "project_cost_usd",
]
