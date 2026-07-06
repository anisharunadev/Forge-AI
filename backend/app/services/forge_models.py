"""step-75 P2 — Models Registry service.

Exposes the catalog of models the calling principal can route to, sourced
from three LiteLLM endpoints and merged with their allow-list:

* ``GET /v1/models``        — caller's Virtual Key (what *they* may use)
* ``GET /model/info``       — master key  (full registry + metadata)
* ``GET /public/litellm_model_cost_map`` — no auth (pricing)

The ``allowed_for_caller`` flag is the intersection of the caller-key
allow-list with the master registry. Cost fields come from the public
cost map when available.

Ponytail: single-process caches keyed by TTL bucket. Upgrade to Redis
when a second replica lands.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections import defaultdict
from functools import lru_cache
from typing import Any, TypedDict
from uuid import UUID

import httpx

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.schemas.forge_models import ModelCost, ModelDescriptor, ModelGroup
from app.services.audit_service import audit_service
from app.services.forge_config import get_forge_config

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Principal type — small TypedDict; full AuthenticatedPrincipal is overkill here
# ---------------------------------------------------------------------------


class Principal(TypedDict, total=False):
    """Caller identity as far as ModelsService needs it.

    Fields are optional because this service is read-only and doesn't
    write rows; only ``tenant_id`` and ``virtual_key`` are required.
    """

    tenant_id: str
    project_id: str | None
    user_id: str | None
    virtual_key: str


# ---------------------------------------------------------------------------
# Cache TTLs (seconds)
# ---------------------------------------------------------------------------

_TTL_V1_MODELS: int = 5 * 60  # 5 minutes — caller-key listing
_TTL_MODEL_INFO: int = 60 * 60  # 1 hour  — master registry
_TTL_COST_MAP: int = 24 * 60 * 60  # 24 hours — public pricing

_V1_MODELS_PATH: str = "/v1/models"
_MODEL_INFO_PATH: str = "/model/info"
_COST_MAP_PATH: str = "/public/litellm_model_cost_map"


# ---------------------------------------------------------------------------
# Ponytail: per-process TTL-bucket caches. Same pattern as
# app/api/v1/forge_health.py. lru_cache gives us TTL eviction by keying on
# `int(time.time() // ttl)`; the bucket dict carries the actual payload
# so we can refresh without changing the lru key.
#
# The v1-models cache is keyed by (key_hash, ttl_bucket) so two callers
# with different virtual keys never see each other's allow-list.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=64)
def _v1_models_bucket(key_hash: str, version: int) -> dict[str, Any]:
    return {"_ts": 0.0}


@lru_cache(maxsize=4)
def _model_info_bucket(version: int) -> dict[str, Any]:
    return {"_ts": 0.0}


@lru_cache(maxsize=4)
def _cost_map_bucket(version: int) -> dict[str, Any]:
    return {"_ts": 0.0}


_BUCKETS: dict[str, Any] = {
    "v1": _v1_models_bucket,
    "info": _model_info_bucket,
    "cost": _cost_map_bucket,
}


def _hash_key(api_key: str) -> str:
    """Short, non-reversible caller identity for cache keying."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]


def _bucket_get(name: str, ttl: int, key_hash: str = "") -> Any:
    """Return the cached payload if fresh, else None."""
    key = int(time.time() // ttl)
    bucket_fn = _BUCKETS[name]
    bucket = bucket_fn(key_hash, key) if name == "v1" else bucket_fn(key)
    payload = bucket.get("payload")
    if payload is None:
        return None
    if (time.time() - bucket.get("_ts", 0)) >= ttl:
        return None
    return payload


def _bucket_put(name: str, ttl: int, payload: Any, key_hash: str = "") -> None:
    key = int(time.time() // ttl)
    bucket_fn = _BUCKETS[name]
    bucket = bucket_fn(key_hash, key) if name == "v1" else bucket_fn(key)
    bucket["payload"] = payload
    bucket["_ts"] = time.time()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ModelsService:
    """Read-only model catalog with TTL caching.

    Ponytail: stateless service object; caches live on module-level
    lru_cache functions so ``refresh_cache()`` can clear them.
    """

    # -- helpers ----------------------------------------------------------

    @staticmethod
    def _provider(model_id: str) -> str:
        # ponytail: unprefixed ids land under '' (UI groups as 'Other'); only
        # prefix-bearing ids return their segment. Upgrade when LiteLLM adds a
        # canonical provider field to /model/info.
        return model_id.split("/", 1)[0] if "/" in model_id else ""

    @staticmethod
    def _descriptor(
        model_id: str,
        *,
        allowed: bool,
        owned_by: str | None = None,
        cost_in: float | None = None,
        cost_out: float | None = None,
    ) -> ModelDescriptor:
        cost_block: ModelCost | None = (
            ModelCost(
                input_per_1k=cost_in * 1000.0,
                output_per_1k=cost_out * 1000.0,
                currency="USD",
            )
            if cost_in is not None and cost_out is not None
            else None
        )
        return ModelDescriptor(
            id=model_id,
            provider=ModelsService._provider(model_id),
            allowed_for_caller=allowed,
            owned_by=owned_by,
            cost=cost_block,
            input_cost_per_token=cost_in,
            output_cost_per_token=cost_out,
        )

    # -- fetches ----------------------------------------------------------

    async def _fetch_v1_models(self, api_key: str) -> list[str]:
        key_hash = _hash_key(api_key)
        cached = _bucket_get("v1", _TTL_V1_MODELS, key_hash)
        if cached is not None:
            return cached
        cfg = get_forge_config()
        url = f"{cfg.proxy_url.rstrip('/')}{_V1_MODELS_PATH}"
        async with LiteLLMBaseClient() as base:
            chat = base.chat_client(api_key)
            try:
                try:
                    resp = await chat.get(url)
                except httpx.HTTPError as exc:
                    logger.warning(
                        "forge_models.v1_models.http_error",
                        error=str(exc),
                    )
                    return []
                if resp.status_code != 200:
                    logger.warning(
                        "forge_models.v1_models.non_2xx",
                        status_code=resp.status_code,
                    )
                    return []
                body = resp.json()
                ids = [m.get("id") for m in (body.get("data") or []) if m.get("id")]
                _bucket_put("v1", _TTL_V1_MODELS, ids, key_hash)
                return ids
            finally:
                await chat.aclose()

    async def _fetch_model_info(self) -> dict[str, dict[str, Any]]:
        cached = _bucket_get("info", _TTL_MODEL_INFO)
        if cached is not None:
            return cached
        cfg = get_forge_config()
        url = f"{cfg.proxy_url.rstrip('/')}{_MODEL_INFO_PATH}"
        async with LiteLLMBaseClient() as base:
            try:
                resp = await base.admin_client.get(url)
            except httpx.HTTPError as exc:
                logger.warning(
                    "forge_models.model_info.http_error",
                    error=str(exc),
                )
                return {}
            if resp.status_code != 200:
                logger.warning(
                    "forge_models.model_info.non_2xx",
                    status_code=resp.status_code,
                )
                return {}
            body = resp.json()
            data = body.get("data") if isinstance(body, dict) else body
            if not isinstance(data, list):
                data = []
            registry: dict[str, dict[str, Any]] = {}
            for entry in data:
                if not isinstance(entry, dict):
                    continue
                mid = entry.get("model_name") or entry.get("id")
                if not mid:
                    continue
                info = entry.get("model_info") if isinstance(entry.get("model_info"), dict) else {}
                registry[str(mid)] = {
                    "owned_by": info.get("owned_by")
                    or entry.get("litellm_params", {}).get("custom_llm_provider")
                }
            _bucket_put("info", _TTL_MODEL_INFO, registry)
            return registry

    async def _fetch_cost_map(self) -> dict[str, tuple[float | None, float | None]]:
        cached = _bucket_get("cost", _TTL_COST_MAP)
        if cached is not None:
            return cached
        cfg = get_forge_config()
        url = f"{cfg.proxy_url.rstrip('/')}{_COST_MAP_PATH}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(url)
            except httpx.HTTPError as exc:
                logger.warning(
                    "forge_models.cost_map.http_error",
                    error=str(exc),
                )
                return {}
            if resp.status_code != 200:
                logger.warning(
                    "forge_models.cost_map.non_2xx",
                    status_code=resp.status_code,
                )
                return {}
            body = resp.json()
            costs: dict[str, tuple[float | None, float | None]] = {}
            for k, v in body.items() if isinstance(body, dict) else []:
                if not isinstance(v, dict):
                    continue
                costs[str(k)] = (v.get("input_cost_per_token"), v.get("output_cost_per_token"))
            _bucket_put("cost", _TTL_COST_MAP, costs)
            return costs

    # -- public API -------------------------------------------------------

    async def list_for_caller(self, principal: Principal) -> list[ModelDescriptor]:
        """Merge the three sources and return the catalog for ``principal``.

        The result list is the master registry intersected with the
        caller's virtual-key allow-list: caller sees only models that
        exist in ``/model/info`` AND in ``/v1/models``. Models from
        ``/v1/models`` that aren't in the registry are dropped (not just
        flagged), and registry models not in the caller's allow-list
        surface with ``allowed_for_caller=False``.
        """
        api_key = principal.get("virtual_key") or ""
        if not api_key:
            logger.warning("forge_models.list_for_caller.missing_virtual_key")
            return []
        caller_ids, registry, costs = await _gather(
            self._fetch_v1_models(api_key),
            self._fetch_model_info(),
            self._fetch_cost_map(),
        )
        caller_set = set(caller_ids)
        # C2: keep registry models only; set allowed based on caller intersection.
        visible_ids = set(registry.keys()) & caller_set
        out: list[ModelDescriptor] = []
        for mid in sorted(visible_ids):
            entry = registry.get(mid, {})
            cost_in, cost_out = costs.get(mid, (None, None))
            out.append(
                self._descriptor(
                    mid,
                    allowed=True,
                    owned_by=entry.get("owned_by"),
                    cost_in=cost_in,
                    cost_out=cost_out,
                )
            )
        return out

    def get(self, model_id: str) -> ModelDescriptor | None:
        """Return a single descriptor from the master-key registry (no caller scope)."""
        registry = _bucket_get("info", _TTL_MODEL_INFO)
        if not registry or model_id not in registry:
            return None
        costs = _bucket_get("cost", _TTL_COST_MAP) or {}
        cost_in, cost_out = costs.get(model_id, (None, None))
        return self._descriptor(
            model_id,
            allowed=False,
            owned_by=registry[model_id].get("owned_by"),
            cost_in=cost_in,
            cost_out=cost_out,
        )

    async def groups(self) -> list[ModelGroup]:
        """Group the master-key registry by provider segment."""
        registry = await self._fetch_model_info()
        costs = await self._fetch_cost_map()
        buckets: dict[str, list[ModelDescriptor]] = defaultdict(list)
        for mid in sorted(registry.keys()):
            cost_in, cost_out = costs.get(mid, (None, None))
            desc = self._descriptor(
                mid,
                allowed=False,
                owned_by=registry[mid].get("owned_by"),
                cost_in=cost_in,
                cost_out=cost_out,
            )
            buckets[desc.provider].append(desc)
        return [ModelGroup(provider=p, models=ms) for p, ms in sorted(buckets.items())]

    async def refresh_cache(self, principal: Principal | None = None) -> None:
        """Clear all three caches and emit an audit event.

        ``principal`` is required for a real audit row. Without it we
        log a warning and skip the audit instead of writing a fake
        zero-UUID row (Rule 6: audit must reflect the real actor).
        """
        # Snapshot counts before clearing so the audit payload is useful.
        # ponytail: best-effort sizes, upgrade when metrics land.
        models_count = len(_bucket_get("info", _TTL_MODEL_INFO) or {})
        costs_count = len(_bucket_get("cost", _TTL_COST_MAP) or {})

        _v1_models_bucket.cache_clear()
        _model_info_bucket.cache_clear()
        _cost_map_bucket.cache_clear()
        logger.info("forge_models.cache_refreshed")

        if principal is None:
            logger.warning(
                "forge_models.refresh_cache.no_principal",
                reason="audit row skipped; refresh was anonymous",
            )
            return

        tenant_id = principal.get("tenant_id")
        if not tenant_id:
            logger.warning(
                "forge_models.refresh_cache.no_tenant",
                reason="audit row skipped; principal missing tenant_id",
            )
            return

        try:
            tenant_uuid = UUID(str(tenant_id))
        except (ValueError, TypeError) as exc:
            logger.warning(
                "forge_models.refresh_cache.bad_tenant_id",
                tenant_id=tenant_id,
                error=str(exc),
            )
            return

        project_id = principal.get("project_id")
        actor_id = principal.get("user_id")
        try:
            project_uuid = UUID(str(project_id)) if project_id else None
        except (ValueError, TypeError):
            project_uuid = None
        try:
            actor_uuid = UUID(str(actor_id)) if actor_id else None
        except (ValueError, TypeError):
            actor_uuid = None

        await audit_service.record(
            tenant_id=tenant_uuid,
            project_id=project_uuid,
            actor_id=actor_uuid,
            action="forge.models.refreshed",
            target_type="model_cache",
            target_id="all",
            payload={
                "caches": ["v1_models", "model_info", "cost_map"],
                "models_count": models_count,
                "costs_count": costs_count,
            },
        )


# ---------------------------------------------------------------------------
# Internal: run the three fetches concurrently without pulling in asyncio.gather
# at import time (keeps the module cheap to import).
# ---------------------------------------------------------------------------


async def _gather(*coros: Any) -> list[Any]:
    return await asyncio.gather(*coros)


__all__ = ["ModelsService", "Principal"]
