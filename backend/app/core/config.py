"""Application configuration via pydantic-settings.

Reads from environment variables (12-factor). All settings required by the
8 constitutional rules must be present, otherwise the application refuses to
start. Defaults are only provided for non-security-critical, dev-only values.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
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


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor.

    Using lru_cache means pydantic-settings parses env exactly once
    per process; tests can clear the cache via `get_settings.cache_clear()`.
    """
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
