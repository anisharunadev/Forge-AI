"""AWS Secrets Manager wrapper for per-tenant Virtual Key storage.

Per-tenant Virtual Keys (the credentials Forge uses to call the
LiteLLM Proxy on behalf of a tenant) MUST live somewhere durable,
encrypted, and audited. AWS Secrets Manager is the chosen substrate.

The wrapper mirrors :class:`app.services.aws_transform_client.AWSTransformClient`:
* Lazy init with graceful degradation — if boto3 is missing or AWS
  credentials are not configured, ``available`` returns ``False`` and
  every method logs a structured warning instead of raising.
* The :class:`Boto3ClientFactory` Protocol (same shape as
  ``app/services/aws_transform_client.py:46-54``) is injectable so
  tests can swap in a mock without monkey-patching ``boto3.client``.

Secret naming
-------------
Every secret is stored under
``settings.aws_secrets_manager_prefix + name``
(default prefix: ``forge/tenants/``). Callers therefore pass only the
logical name (e.g. ``<tenant_id>/virtual_key``) and let this client
own the prefix.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol

from app.core.config import settings
from app.core.logging import get_logger

try:  # pragma: no cover — telemetry is optional at import time
    from app.core.telemetry import get_tracer

    _tracer = get_tracer(__name__)
except Exception:  # noqa: BLE001
    _tracer = None

# Fall back to stdlib logging in case structlog isn't ready at import.
logger = get_logger(__name__) if hasattr(logging, "getLogger") else logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


class Boto3ClientFactory(Protocol):
    """Protocol for the boto3 client factory.

    Same shape as
    ``app/services/aws_transform_client.py:46-54``. Tests inject a
    callable that returns a stand-in for
    ``boto3.client("secretsmanager", ...)`` without needing boto3
    installed.
    """

    def __call__(self, service_name: str, **kwargs: Any) -> Any:  # pragma: no cover
        ...


@dataclass(slots=True)
class SecretRef:
    """Logical reference to a stored secret.

    ``name`` is the *logical* name (the prefix is owned by the client);
    ``version_id`` is optional and only populated on rotation.
    """

    name: str
    version_id: str | None = None

    def full_name(self) -> str:
        """Return the prefixed ARN-style path on AWS Secrets Manager."""
        return f"{settings.aws_secrets_manager_prefix}{self.name}"


class SecretsManagerUnavailable(RuntimeError):
    """Raised when an operation requires AWS but the client is degraded."""


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class SecretsManagerClient:
    """Thin async wrapper around ``boto3.client("secretsmanager")``.

    Falls back gracefully when boto3 or AWS credentials are missing.
    All public methods are ``async def`` to match the rest of the
    integration layer (the underlying boto3 call is synchronous and
    runs in the default thread pool when awaited via
    ``asyncio.to_thread``).
    """

    def __init__(
        self,
        *,
        region: str = "us-east-1",
        kms_key_id: str | None = None,
        boto3_client_factory: Boto3ClientFactory | None = None,
    ) -> None:
        self._region = region
        self._kms_key_id = (
            kms_key_id if kms_key_id is not None else settings.aws_secrets_manager_kms_key_id
        )
        self._factory = boto3_client_factory
        self._client: Any | None = None
        self._init_failed: bool = False
        self._disabled: bool = False

    # ------------------------------------------------------------------
    # Lifecycle — mirrors aws_transform_client._try_init (line 111)
    # ------------------------------------------------------------------

    def _try_init(self) -> Any | None:
        """Lazily initialize the boto3 client.

        Returns the client on success, ``None`` on any failure (logged
        at warning level). Subsequent calls reuse the cached client
        (or the cached failure flag).
        """
        if self._client is not None:
            return self._client
        if self._init_failed or self._disabled:
            return None

        try:
            import boto3  # type: ignore[import-not-found]
        except ImportError:
            logger.warning(
                "secrets_manager.boto3_missing",
                detail="boto3 not installed; using degraded mode",
            )
            self._init_failed = True
            return None

        try:
            factory: Boto3ClientFactory = self._factory or boto3.client  # type: ignore[assignment]
            self._client = factory("secretsmanager", region_name=self._region)
            return self._client
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "secrets_manager.init_failed",
                error=f"{type(exc).__name__}: {exc}",
            )
            self._init_failed = True
            return None

    @property
    def available(self) -> bool:
        """``True`` when boto3 + AWS credentials are usable."""
        return self._try_init() is not None

    # ------------------------------------------------------------------
    # Operations
    # ------------------------------------------------------------------

    async def get_secret(self, name: str) -> str:
        """Fetch the secret value for ``name``.

        Returns the raw string. Raises :class:`SecretsManagerUnavailable`
        if the client cannot be initialized (caller should map to a
        ``503 unavailable`` at the API boundary) or
        :class:`LookupError` if the secret does not exist.
        """
        import asyncio

        ref = SecretRef(name=name)
        span_cm = _tracer.start_as_current_span("secrets_manager.get") if _tracer else _null_cm()
        async with span_cm as span:
            if span is not None:
                span.set_attribute("secrets_manager.name", ref.full_name())
            client = self._try_init()
            if client is None:
                logger.warning(
                    "secrets_manager.get.degraded",
                    name=ref.full_name(),
                )
                raise SecretsManagerUnavailable(
                    f"AWS Secrets Manager unavailable; cannot fetch {ref.full_name()}"
                )

            try:
                response = await asyncio.to_thread(
                    client.get_secret_value, SecretId=ref.full_name()
                )
            except Exception as exc:  # noqa: BLE001
                # Boto3 raises ClientError with a specific error code
                # for missing secrets; we don't import the type to
                # avoid a hard boto3 dependency.
                code = (
                    getattr(getattr(exc, "response", None), "get", lambda *_: None)(
                        "Error", {}
                    ).get("Code")
                    if hasattr(exc, "response")
                    else None
                )
                if code == "ResourceNotFoundException":
                    raise LookupError(f"secret not found: {ref.full_name()}") from exc
                logger.warning(
                    "secrets_manager.get.failed",
                    name=ref.full_name(),
                    error=f"{type(exc).__name__}: {exc}",
                )
                raise SecretsManagerUnavailable(
                    f"failed to fetch secret {ref.full_name()}: {exc}"
                ) from exc

            value = response.get("SecretString")
            if value is None:
                # Binary secrets are not used by Forge today (Virtual
                # Keys are always strings). Surface a clear error.
                raise SecretsManagerUnavailable(
                    f"secret {ref.full_name()} is binary; expected string"
                )
            return str(value)

    async def put_secret(
        self,
        name: str,
        value: str,
        kms_key_id: str | None = None,
    ) -> None:
        """Create or update the secret at ``name``.

        ``kms_key_id`` overrides ``settings.aws_secrets_manager_kms_key_id``
        for this single call. If neither is set, AWS uses the default
        key for the account/region.
        """
        import asyncio

        ref = SecretRef(name=name)
        effective_kms = kms_key_id if kms_key_id is not None else self._kms_key_id
        span_cm = _tracer.start_as_current_span("secrets_manager.put") if _tracer else _null_cm()
        async with span_cm as span:
            if span is not None:
                span.set_attribute("secrets_manager.name", ref.full_name())
                if effective_kms:
                    span.set_attribute("secrets_manager.kms_key_id", effective_kms)
            client = self._try_init()
            if client is None:
                logger.warning(
                    "secrets_manager.put.degraded",
                    name=ref.full_name(),
                )
                raise SecretsManagerUnavailable(
                    f"AWS Secrets Manager unavailable; cannot write {ref.full_name()}"
                )

            kwargs: dict[str, Any] = {"SecretId": ref.full_name(), "SecretString": value}
            if effective_kms:
                kwargs["KmsKeyId"] = effective_kms

            try:
                await asyncio.to_thread(client.put_secret_value, **kwargs)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "secrets_manager.put.failed",
                    name=ref.full_name(),
                    error=f"{type(exc).__name__}: {exc}",
                )
                raise SecretsManagerUnavailable(
                    f"failed to write secret {ref.full_name()}: {exc}"
                ) from exc

    async def delete_secret(self, name: str) -> None:
        """Mark the secret at ``name`` for deletion (with 30-day recovery).

        Idempotent: if the secret does not exist the call logs at
        debug and returns without raising.
        """
        import asyncio

        ref = SecretRef(name=name)
        span_cm = _tracer.start_as_current_span("secrets_manager.delete") if _tracer else _null_cm()
        async with span_cm as span:
            if span is not None:
                span.set_attribute("secrets_manager.name", ref.full_name())
            client = self._try_init()
            if client is None:
                logger.warning(
                    "secrets_manager.delete.degraded",
                    name=ref.full_name(),
                )
                raise SecretsManagerUnavailable(
                    f"AWS Secrets Manager unavailable; cannot delete {ref.full_name()}"
                )

            try:
                await asyncio.to_thread(
                    client.delete_secret,
                    SecretId=ref.full_name(),
                    RecoveryWindowInDays=30,
                )
            except Exception as exc:  # noqa: BLE001
                code = (
                    getattr(getattr(exc, "response", None), "get", lambda *_: None)(
                        "Error", {}
                    ).get("Code")
                    if hasattr(exc, "response")
                    else None
                )
                if code == "ResourceNotFoundException":
                    logger.debug(
                        "secrets_manager.delete.missing",
                        name=ref.full_name(),
                    )
                    return
                logger.warning(
                    "secrets_manager.delete.failed",
                    name=ref.full_name(),
                    error=f"{type(exc).__name__}: {exc}",
                )
                raise SecretsManagerUnavailable(
                    f"failed to delete secret {ref.full_name()}: {exc}"
                ) from exc


# ---------------------------------------------------------------------------
# Module-level singleton (lazy)
# ---------------------------------------------------------------------------

_default_client: SecretsManagerClient | None = None


def get_default_client() -> SecretsManagerClient:
    """Return the process-wide :class:`SecretsManagerClient`."""
    global _default_client
    if _default_client is None:
        _default_client = SecretsManagerClient()
    return _default_client


def _null_cm() -> _NullCM:
    return _NullCM()


class _NullCM:
    """Async context manager used when no tracer is configured."""

    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *_exc: Any) -> None:
        return None


__all__ = [
    "SecretsManagerClient",
    "SecretsManagerUnavailable",
    "SecretRef",
    "Boto3ClientFactory",
    "get_default_client",
]
