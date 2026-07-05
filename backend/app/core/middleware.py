"""ASGI middleware: request_id + tenant context (Phase 5).

* :class:`RequestIdMiddleware` reads ``x-request-id`` (or mints a new
  UUID4) and binds it to ``request_id_ctx`` so structlog
  ``_inject_context`` propagates it to every log line of the request.
* :class:`TenantContextMiddleware` reads ``x-tenant-id`` and binds it
  to ``tenant_id_ctx`` so the OTel sampler can decide per tenant.

The ``x-tenant-id`` header is the only place the *unverified* tenant
is read; the actual auth check happens later in the FastAPI
dependency graph (see ``app.api.deps.get_current_principal``). The
middleware is best-effort: if the header is missing the contextvar is
left at its default ``None`` and the sampler falls back to 100%
sampling.
"""
from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import request_id_ctx, tenant_id_ctx


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Bind ``x-request-id`` (or a fresh UUID4) to ``request_id_ctx``."""

    HEADER = "x-request-id"

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        rid = request.headers.get(self.HEADER) or str(uuid.uuid4())
        token = request_id_ctx.set(rid)
        try:
            response: Response = await call_next(request)
            response.headers[self.HEADER] = rid
            return response
        finally:
            request_id_ctx.reset(token)


class TenantContextMiddleware(BaseHTTPMiddleware):
    """Bind ``x-tenant-id`` to ``tenant_id_ctx`` for the sampler."""

    HEADER = "x-tenant-id"

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        tenant_id = request.headers.get(self.HEADER)
        token = tenant_id_ctx.set(tenant_id) if tenant_id else tenant_id_ctx.set(None)
        try:
            return await call_next(request)
        finally:
            tenant_id_ctx.reset(token)


__all__ = ["RequestIdMiddleware", "TenantContextMiddleware"]
