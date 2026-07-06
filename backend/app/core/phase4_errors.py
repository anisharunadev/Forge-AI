"""Phase 4 error envelope — exception classes + FastAPI handler.

Each Phase 4 error has a stable ``code`` (upper-snake) and ``status_code``
(HTTP). The handler in ``app/main.py`` renders them as
``{error, code, details, occurred_at}`` JSON.

New error? Add it here and re-run ``scripts/generate_phase4_docs.py``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class Phase4Error(Exception):
    """Base class — every Phase 4 error extends this."""

    code: str = "PHASE4_ERROR"
    status_code: int = 500

    def __init__(self, message: str = "", **details: Any) -> None:
        super().__init__(message or self.code)
        self.message = message or self.code
        self.details = details

    def to_envelope(self) -> dict[str, Any]:
        return {
            "error": self.code,
            "message": self.message,
            "details": self.details,
            "occurred_at": datetime.now(UTC).isoformat(),
        }


# ── F16 Pass-through + Media ──────────────────────────────────────────


class PassThroughDisabled(Phase4Error):
    code = "PASS_THROUGH_DISABLED"
    status_code = 403


class PassThroughUnsupportedProvider(Phase4Error):
    code = "PASS_THROUGH_UNSUPPORTED_PROVIDER"
    status_code = 400


# ── F17 Realtime / A2A ────────────────────────────────────────────────


class RealtimeAuthExpired(Phase4Error):
    code = "REALTIME_AUTH_EXPIRED"
    status_code = 401


class RealtimeSessionExpired(Phase4Error):
    code = "REALTIME_SESSION_EXPIRED"
    status_code = 410


class SessionResumeWindowExpired(Phase4Error):
    code = "SESSION_RESUME_WINDOW_EXPIRED"
    status_code = 410


# ── F18 Identity ──────────────────────────────────────────────────────


class SSOMisconfigured(Phase4Error):
    code = "SSO_MISCONFIGURED"
    status_code = 503


class SCIMTokenInvalid(Phase4Error):
    code = "SCIM_TOKEN_INVALID"
    status_code = 401


# ── F19 Cache ─────────────────────────────────────────────────────────


class CacheBackendUnreachable(Phase4Error):
    code = "CACHE_BACKEND_UNREACHABLE"
    status_code = 503


class CacheCrossTenantDenied(Phase4Error):
    code = "CACHE_CROSS_TENANT_DENIED"
    status_code = 403


# ── F20 Credentials / Vault / FinOps ──────────────────────────────────


class CredentialNotFound(Phase4Error):
    code = "CREDENTIAL_NOT_FOUND"
    status_code = 404


class CredentialValueWriteOnly(Phase4Error):
    code = "CREDENTIAL_VALUE_WRITE_ONLY"
    status_code = 400


class CloudZeroExportFailed(Phase4Error):
    code = "CLOUDZERO_EXPORT_FAILED"
    status_code = 502


class VantageExportFailed(Phase4Error):
    code = "VANTAGE_EXPORT_FAILED"
    status_code = 502


class VaultUnreachable(Phase4Error):
    code = "VAULT_UNREACHABLE"
    status_code = 503


class JWTKeyRotationInProgress(Phase4Error):
    code = "JWT_KEY_ROTATION_IN_PROGRESS"
    status_code = 409


# ── Handler registration ──────────────────────────────────────────────


def register_phase4_exception_handlers(app: FastAPI) -> None:
    """Mount a single handler for all Phase4Error subclasses."""

    async def _handler(_request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, Phase4Error)
        return JSONResponse(status_code=exc.status_code, content=exc.to_envelope())

    app.add_exception_handler(Phase4Error, _handler)

    async def _fallback(_request: Request, exc: Exception) -> JSONResponse:
        """M14: catch-all handler for unhandled exceptions.

        Without this, FastAPI returns a generic 500 with a raw stack
        trace in debug mode — a real user-facing crash. The handler
        renders a stable envelope so the UI gets a typed error code
        it can render instead of swallowing the response.
        """
        from app.core.logging import get_logger

        logger = get_logger(__name__)
        logger.exception(
            "phase4_errors.unhandled_exception",
            error_type=type(exc).__name__,
            error_message=str(exc),
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_error",
                "code": "INTERNAL_ERROR",
                "details": {"type": type(exc).__name__, "message": str(exc)[:500]},
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )

    app.add_exception_handler(Exception, _fallback)


__all__ = [
    "Phase4Error",
    "PassThroughDisabled",
    "PassThroughUnsupportedProvider",
    "RealtimeAuthExpired",
    "RealtimeSessionExpired",
    "SessionResumeWindowExpired",
    "SSOMisconfigured",
    "SCIMTokenInvalid",
    "CacheBackendUnreachable",
    "CacheCrossTenantDenied",
    "CredentialNotFound",
    "CredentialValueWriteOnly",
    "CloudZeroExportFailed",
    "VantageExportFailed",
    "VaultUnreachable",
    "JWTKeyRotationInProgress",
    "register_phase4_exception_handlers",
]
