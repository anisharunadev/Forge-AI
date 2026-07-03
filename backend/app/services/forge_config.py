"""Typed config wrapper for the Phase 1 / step-75 LiteLLM substrate.

Single accessor every other Phase 1 module imports instead of reading
``settings`` directly. Renames ``litellm_admin_key`` → ``litellm_master_key``
(the spec word) while keeping the legacy alias as a fallback so existing
call sites keep working in this PR.

ponytail: this is one accessor, not a service. It exists because every
Phase 1 module needs the master key on the hot path and we want one
place to enforce the rename later in Phase 2.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from app.core.config import settings


@dataclass(frozen=True)
class ForgeConfig:
    """Read-only view of the LiteLLM substrate config.

    Constructed once via :func:`get_forge_config` (lru_cache). All
    downstream services read from this — no other module should touch
    ``settings.litellm_admin_key`` directly after Phase 1.
    """

    master_key: str
    proxy_url: str
    chat_api_key: str
    health_cache_ttl_seconds: int
    tenant_header: str
    run_header: str
    route_discovery_enabled: bool
    integration_enabled: bool


@lru_cache(maxsize=1)
def get_forge_config() -> ForgeConfig:
    """Return the cached ForgeConfig for this process.

    Raises ``ValueError`` at import time if ``environment != "test"``
    and no master key is set. Tests can clear the cache via
    ``get_forge_config.cache_clear()`` after monkeypatching ``settings``.
    """
    master = settings.litellm_master_key or settings.litellm_admin_key
    if not master and settings.environment not in ("test", "development"):
        # Spec line 91 — fail-fast on missing master key in non-dev.
        raise RuntimeError(
            "LITELLM_MASTER_KEY (or LITELLM_ADMIN_KEY legacy alias) is required "
            f"when ENVIRONMENT={settings.environment!r}. Refusing to boot."
        )
    return ForgeConfig(
        master_key=master or "",
        proxy_url=settings.litellm_proxy_url.rstrip("/"),
        chat_api_key=settings.litellm_api_key,
        health_cache_ttl_seconds=int(settings.forge_health_cache_ttl_seconds),
        tenant_header=settings.forge_tenant_header,
        run_header=settings.forge_run_header,
        route_discovery_enabled=bool(settings.forge_route_discovery_enabled),
        integration_enabled=bool(settings.litellm_integration_enabled),
    )


__all__ = ["ForgeConfig", "get_forge_config"]
