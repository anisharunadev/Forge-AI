"""Security headers middleware — Phase 8 SC-8.8.

Sets the standard hardened response headers on every FastAPI response:

- ``Content-Security-Policy`` — default-src 'self' (tighten per-route
  if the SPA needs external resources).
- ``Strict-Transport-Security`` — 1 year, includeSubDomains.
- ``X-Frame-Options: DENY`` — clickjacking protection.
- ``X-Content-Type-Options: nosniff`` — MIME sniffing protection.
- ``Referrer-Policy: strict-origin-when-cross-origin`` — referrer
  leakage.
- ``Permissions-Policy`` — disable unused powerful features.

Ponytail: install AFTER CORS so security headers win on conflicts.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_DEFAULT_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https:; "
    "font-src 'self' data:; "
    "connect-src 'self' ws: wss: https:; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

_PERMISSIONS_POLICY = (
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
    "magnetometer=(), microphone=(), payment=(), usb=()"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject hardened response headers on every response."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("Content-Security-Policy", _DEFAULT_CSP)
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", _PERMISSIONS_POLICY)
        return response
