"""Error reporting shim (M15-5, Rec #9 — production engineering).

Real Sentry SDK is **not** a hard dependency — it's only imported when
``ERROR_REPORT_DSN`` (or ``SENTRY_DSN`` alias) is set AND ``sentry-sdk``
is installed. This keeps dev/test installs free of the SDK while
giving production a single env-var to flip.

When neither is true, the shim is a no-op aside from writing a
single ``forge.error_reporting.skipped`` structlog line at startup so
operators have visibility into the decision. When sentry-sdk is
installed but the DSN is unset, init() raises so the misconfig is
loud rather than silent.

Usage::

    from app.core.error_reporting import error_reporter
    error_reporter.capture_exception(exc)   # no-op or sentry.capture
    error_reporter.set_tag("tenant_id", tenant_id)
"""

from __future__ import annotations

import os
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)

_DSN_ENV_KEYS: tuple[str, ...] = ("ERROR_REPORT_DSN", "SENTRY_DSN")
_GIT_SHA_ENV_KEYS: tuple[str, ...] = ("GIT_SHA", "COMMIT_SHA")


class _ErrorReporter:
    """Sentry-or-nothing error reporter.

    The ``_client`` attribute holds the underlying Sentry SDK client
    when configured; ``None`` when running in no-op mode. Tests and
    dev should not need this dependency.
    """

    def __init__(self) -> None:
        self._client: Any | None = None
        self._configured = False

    def init(self, *, release: str | None = None) -> bool:
        """Lazy-init the Sentry client when a DSN is configured.

        Returns ``True`` when the client is live, ``False`` when the
        DSN is unset (no-op mode). Raises when the DSN is set but the
        SDK isn't installed — this is a misconfig, not silent.
        """
        if self._configured:
            return self._client is not None

        dsn = next(
            (os.environ[k] for k in _DSN_ENV_KEYS if os.environ.get(k)),
            None,
        )
        if not dsn:
            logger.info("forge.error_reporting.skipped", reason="no_dsn")
            self._configured = True
            return False

        try:
            import sentry_sdk  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError(
                "ERROR_REPORT_DSN is set but sentry-sdk is not installed. "
                "Add 'sentry-sdk[fastapi]>=1.40' to backend/requirements.txt "
                "or unset the env var to run in no-op mode."
            ) from exc

        resolved_release = release or next(
            (os.environ[k] for k in _GIT_SHA_ENV_KEYS if os.environ.get(k)),
            "dev",
        )
        sentry_sdk.init(dsn=dsn, release=resolved_release)
        self._client = sentry_sdk
        self._configured = True
        logger.info(
            "forge.error_reporting.configured",
            release=resolved_release,
        )
        return True

    def capture_exception(self, exc: BaseException) -> None:
        if self._client is None:
            return
        self._client.capture_exception(exc)

    def set_tag(self, key: str, value: str) -> None:
        if self._client is None:
            return
        self._client.set_tag(key, value)


error_reporter = _ErrorReporter()
