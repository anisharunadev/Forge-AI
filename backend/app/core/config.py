"""Application configuration via pydantic-settings.

Reads from environment variables (12-factor). All settings required by the
8 constitutional rules must be present, otherwise the application refuses to
start. Defaults are only provided for non-security-critical, dev-only values.
"""

from decimal import Decimal
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

    # F-829 — LiteLLM Integration Layer (Phase A foundation)
    # Bearer token for LiteLLM management endpoints. Distinct from the
    # chat key above; admin key is long-lived, chat key is the
    # per-tenant Virtual Key minted at runtime.
    # Defaults to empty so the service can boot in local dev when no
    # proxy is reachable; production deployments MUST set
    # ``LITELLM_ADMIN_KEY`` (or ``docker-compose.yml`` will inject a
    # default from ``LITELLM_MASTER_KEY``). When empty, admin calls to
    # the proxy will fail with 401 — the service still serves traffic
    # but the LiteLLM integration layer is effectively disabled.
    litellm_admin_key: str = Field(
        default="",
        description="Bearer token for LiteLLM management endpoints (distinct from chat key)",
    )
    # step-75 Phase 1 — preferred name for the LiteLLM master key
    # (spec word). When set, takes precedence over `litellm_admin_key`.
    # Phase 2 will retire the legacy alias; this PR keeps both so
    # existing call sites stay green.
    litellm_master_key: str = Field(
        default="",
        description=(
            "Bearer token for the LiteLLM master key (spec name, takes "
            "precedence over LITELLM_ADMIN_KEY)."
        ),
    )
    # TTL for the in-process cache of per-tenant Virtual Keys (seconds).
    # 5 minutes by default — short enough to keep the auth surface
    # responsive to revocations, long enough to avoid hammering
    # Secrets Manager on the hot path.
    litellm_key_cache_ttl_seconds: int = 300
    # AWS Secrets Manager path prefix for per-tenant Virtual Keys.
    aws_secrets_manager_prefix: str = "forge/tenants/"
    # Optional KMS CMK used to encrypt per-tenant secrets in AWS.
    # When None, AWS uses the default key for the account/region.
    aws_secrets_manager_kms_key_id: str | None = None

    # F-829 — LiteLLM Integration Layer (Phase A — budgets, health, feature flags)
    # Default tenant-level budget applied at tenant creation (OQ-32).
    litellm_budget_default_usd: Decimal = Decimal("500.00")
    # Budget period — LiteLLM Budgets API expects "monthly" | "daily" | "weekly".
    litellm_budget_default_period: str = "monthly"
    # How often the LiteLLMHealthMonitor pings /health/liveliness (seconds).
    litellm_health_check_interval_seconds: int = 30
    # How long the usage analytics cache stays fresh (seconds).
    litellm_usage_cache_ttl_seconds: int = 60

    # F-829 — Feature flags (per-tenant controls live in LiteLLM Team metadata;
    # these are global defaults applied at integration startup).
    # Master toggle — when False the integration layer is disabled and the
    # legacy LiteLLMClient path remains active for graceful rollout.
    litellm_integration_enabled: bool = True
    # Auto-provision per-tenant Virtual Keys on tenant creation.
    litellm_auto_provision_keys: bool = True
    # Hard-enforce LiteLLM Budgets (block at 100%) vs soft-warn.
    litellm_budget_hard_limit: bool = True
    # Default guardrails applied to new tenants unless overridden per-tenant.
    litellm_guardrail_pii_default: bool = True
    litellm_guardrail_content_default: bool = True
    litellm_guardrail_injection_default: bool = True

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

    # step-75 Phase 1 — Config & Auth foundation (F1)
    # Cache TTL (seconds) for the /api/forge/health readiness probe.
    forge_health_cache_ttl_seconds: int = 60
    # Tenant header injected on outgoing admin/chat calls (Phase 2+).
    forge_tenant_header: str = "X-Forge-Tenant"
    # Run header injected on outgoing chat calls (Phase 5).
    forge_run_header: str = "X-Forge-Run-Id"
    # One-shot GET /routes capability discovery at boot.
    forge_route_discovery_enabled: bool = True
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

    # F-800 — Forge Co-pilot (Plan 0.1 foundation)
    # Master toggle for the Co-pilot surface. When False, every
    # /api/v1/copilot/* endpoint returns 404 and the frontend
    # hides the Cmd+J hotkey + nav entry. Per-tenant overrides land
    # in the next iteration via the existing ``tenants`` config table.
    copilot_enabled: bool = Field(
        default=False,
        description="COPILOT_ENABLED env var. Master toggle for the Co-pilot surface.",
    )
    # Per-conversation USD ceiling enforced by workflow_budget admission
    # control. ``copilot_service`` declares a synthetic WorkflowBudget
    # row on conversation creation with this ceiling; ``LiteLLMClient``
    # blocks calls that would breach it. Overridable per tenant later.
    copilot_default_budget_usd: float = Field(
        default=1.00,
        description="COPILOT_DEFAULT_BUDGET_USD. Per-conversation budget ceiling.",
    )
    # Hard cap on tool-call turns per agent_loop invocation. Prevents
    # runaway loops where the model keeps calling tools without
    # converging on a final answer. ``ToolLoopExhausted`` is raised
    # at the cap (copilot_service maps to 503).
    copilot_tool_call_max: int = Field(
        default=5,
        description="COPILOT_TOOL_CALL_MAX. Tool-call turns per agent_loop.",
    )
    # Per-user message rate limit (POST /copilot/conversations).
    # Enforced by copilot_rate_limit (Plan 5). 10 msg/min keeps an
    # individual user from monopolizing shared capacity.
    copilot_rate_limit_per_min: int = Field(
        default=10,
        description="COPILOT_RATE_LIMIT_PER_MIN. Per-user request cap.",
    )
    # When True, the /welcome page stub shows the Co-pilot intro
    # card on first visit. F-805 will own this surface; the stub
    # shipped in Plan 4 only renders when this is True.
    copilot_welcome_enabled: bool = Field(
        default=True,
        description="COPILOT_WELCOME_ENABLED. Render the welcome shim on /welcome.",
    )

    # M1 G2 — placeholder LLM key guard. The .env.example ships with
    # ``ANTHROPIC_API_KEY=sk-ant-replace-me``,
    # ``OPENAI_API_KEY=sk-openai-replace-me`` and
    # ``LITELLM_MASTER_KEY=sk-litellm-dev-replace-me`` so a fresh
    # ``cp .env.example .env`` boots without manual edits. That's a
    # nice ergonomic, but it is also a PITFALL: a misconfigured
    # deployment that ships the placeholder to production would make
    # every LLM call silently 401 from LiteLLM's perspective while
    # the backend still appears healthy. This opt-in escape hatch lets
    # tests + a controlled dev smoke (``ALLOW_PLACEHOLDER_LLM_KEYS=true``)
    # run without real keys; production MUST leave the flag at its
    # default of ``False``.
    allow_placeholder_llm_keys: bool = Field(
        default=False,
        description=(
            "ALLOW_PLACEHOLDER_LLM_KEYS. Escape hatch for tests + dev "
            "smoke. Defaults to False — production refuses to boot when "
            "ANTHROPIC_API_KEY / OPENAI_API_KEY / LITELLM_MASTER_KEY "
            "match the .env.example placeholder strings."
        ),
    )

    # M1 G2 — Surface ANTHROPIC_API_KEY + OPENAI_API_KEY as
    # ``Settings`` fields so the placeholder validator below can read
    # them. These values are forwarded to the LiteLLM container via the
    # compose env (``os.environ/ANTHROPIC_API_KEY`` in
    # ``infra/litellm/config.yaml``); the backend itself doesn't call
    # provider SDKs (Rule 1) so the in-process fields are only used by
    # the validator. Defaults to "" when the env var is missing so the
    # validator can fire on empty-string as well as the placeholder.
    anthropic_api_key: str = Field(
        default="",
        description=(
            "ANTHROPIC_APIKEY. Forwarded to the LiteLLM container; "
            "validated against the .env.example placeholder."
        ),
    )
    openai_api_key: str = Field(
        default="",
        description=(
            "OPENAI_API_KEY. Forwarded to the LiteLLM container; "
            "validated against the .env.example placeholder."
        ),
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

    @model_validator(mode="after")
    def _reject_placeholder_llm_keys(self) -> "Settings":
        """Refuse to boot on the .env.example placeholder LLM keys.

        M1 G2 closure. Tracks the three values .env.example ships:
            ANTHROPIC_API_KEY=sk-ant-replace-me
            OPENAI_API_KEY=sk-openai-replace-me
            LITELLM_MASTER_KEY=sk-litellm-dev-replace-me
        plus the obvious empty-string failure mode. The guard is
        configured by ``ALLOW_PLACEHOLDER_LLM_KEYS`` — when set to the
        string ``"true"`` (case-insensitive) the placeholder check is
        skipped so tests + a controlled dev smoke can boot with the
        placeholder strings without a real provider key. The
        ``.env.example`` documents this override inline.

        Validators run on ``Settings()`` instantiation. Because
        ``settings = get_settings()`` is evaluated at module import
        (bottom of this file), a misconfigured deployment exits non-zero
        at import — before FastAPI boots — same lifecycle as the
        sibling ``_dev_bypass_only_in_dev`` validator.
        """
        # Mirror the sibling ``_dev_bypass_only_in_dev`` exemption:
        # skip the check in ``test`` so the default test env that
        # conftest.py sets (no real keys, no bypass flag) still imports
        # cleanly. development is NOT exempted here on purpose — a
        # developer who copied ``.env.example`` and forgot to set real
        # keys still gets stopped at boot instead of silently shipping
        # 401s on the first LLM call. ALLOW_PLACEHOLDER_LLM_KEYS=true
        # is the documented opt-in escape hatch for non-test dev smokes.
        if self.environment == "test" or self.allow_placeholder_llm_keys:
            return self
        offenders: list[str] = []
        # Match either the exact placeholder, an empty string, or
        # whitespace-only. These three together cover every way the
        # .env.example bootstraps to a non-functional state.
        placeholders = {
            "anthropic_api_key": "sk-ant-replace-me",
            "openai_api_key": "sk-openai-replace-me",
            "litellm_master_key": "sk-litellm-dev-replace-me",
        }
        for field_name, expected_placeholder in placeholders.items():
            value = getattr(self, field_name, "")
            if not isinstance(value, str):
                # pydantic coerces; defensive. Skip non-strings.
                continue
            stripped = value.strip()
            if stripped in {"", expected_placeholder}:
                offenders.append(field_name)
        if offenders:
            raise ValueError(
                "Refusing to boot with placeholder LLM keys: "
                + ", ".join(sorted(offenders))
                + ". Set real values in your environment "
                "(ANTHROPIC_API_KEY, OPENAI_API_KEY, LITELLM_MASTER_KEY), "
                "or set ALLOW_PLACEHOLDER_LLM_KEYS=true to bypass "
                "(dev/test only)."
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
