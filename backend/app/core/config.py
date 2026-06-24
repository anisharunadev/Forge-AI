"""Application configuration via pydantic-settings.

Reads from environment variables (12-factor). All settings required by the
8 constitutional rules must be present, otherwise the application refuses to
start. Defaults are only provided for non-security-critical, dev-only values.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Forge AI configuration.

    All environment-bound settings live here. Anything that touches
    multi-tenancy, auth, or LLM routing MUST be in this class — not
    scattered through modules — so it is auditable in one place.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Core
    app_name: str = "forge-backend"
    app_version: str = "0.2.0"
    environment: Literal["development", "staging", "production", "test"] = "development"
    debug: bool = False
    log_level: str = "INFO"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # Database (PostgreSQL 17 + Apache AGE + pgvector)
    database_url: str = Field(..., description="postgresql+asyncpg:// connection string")
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # Redis (Pub/Sub + session store)
    redis_url: str = Field(..., description="redis:// connection string")
    redis_event_channel_prefix: str = "forge:events:"

    # LiteLLM Proxy (Rule 1 — no direct LLM SDKs)
    litellm_proxy_url: str = Field(..., description="e.g. http://litellm:4000")
    litellm_api_key: str = Field(..., description="Bearer token for the LiteLLM Proxy")
    litellm_default_model: str = "gpt-4o-mini"

    # Keycloak / OIDC
    keycloak_url: str = Field(..., description="Keycloak realm base URL")
    keycloak_realm: str = "forge"
    keycloak_client_id: str = "forge-backend"
    keycloak_audience: str = "forge-backend"

    # JWT — local verification key (HS256 dev / RS256 prod via JWKS)
    jwt_secret: str = Field(..., description="HMAC secret or PEM public key")
    jwt_algorithm: str = "HS256"
    jwt_audience: str | None = None
    jwt_issuer: str | None = None

    # OpenTelemetry
    otlp_endpoint: str | None = None
    otel_service_name: str = "forge-backend"
    otel_exporter_otlp_insecure: bool = True

    # WebSocket / Terminal Center
    ws_max_message_bytes: int = 65536
    ws_idle_timeout_seconds: int = 300
    terminal_workspace_root: str = "/var/forge/workspaces"

    # Freshness ledger defaults
    connector_default_ttl_seconds: int = 3600

    # Cost ledger
    cost_currency: str = "USD"

    # F-503 — Deterministic Security Gate
    # Per-commit cost cap for pre-call admission control (USD).
    merge_gate_per_commit_cost_cap_usd: float = 1.0
    # GitHub webhook shared secret (HMAC SHA-256). Empty disables
    # signature verification — only acceptable in local dev.
    github_webhook_secret: str = Field(default="", description="HMAC secret")

    # F-HYG-04 — DEV_AUTH_BYPASS guard
    # When True, the auth layer synthesizes a `dev@forge.local` principal
    # with `forge:admin` and every `ideation:*` permission. HYG-04 mandates
    # this is only legal in development; production must boot with this
    # disabled. The `model_validator` below enforces the rule at import
    # time so a misconfigured process exits non-zero before FastAPI starts.
    dev_auth_bypass: bool = Field(
        default=False,
        description="DEV_AUTH_BYPASS env var. Synthesizes dev@forge.local principal. Dev-only.",
    )

    @model_validator(mode="after")
    def _dev_bypass_only_in_dev(self) -> "Settings":
        """Refuse to boot if DEV_AUTH_BYPASS is enabled outside development.

        HYG-04 closes the PITFALL where ``DEV_AUTH_BYPASS=1`` silently
        granted a synthetic ``dev@forge.local`` principal (with
        ``forge:admin`` and every ``ideation:*`` permission) in production.
        Pydantic v2's ``mode="after"`` runs after field validation, so
        ``self.dev_auth_bypass`` and ``self.environment`` are already
        coerced to their declared types (``bool`` and ``Literal[...]``)
        by the time this fires.

        The validator runs at ``Settings()`` instantiation. Because
        ``settings = get_settings()`` is evaluated at module import
        (bottom of this file), a misconfigured deployment exits non-zero
        at import — before FastAPI boots, before any request is served.
        """
        if self.dev_auth_bypass and self.environment != "development":
            raise ValueError(
                f"DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development. "
                f"Got ENVIRONMENT={self.environment!r}. Refusing to boot."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor.

    Using lru_cache means pydantic-settings parses env exactly once
    per process; tests can clear the cache via `get_settings.cache_clear()`.
    """
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
