"""F16 — Provider pass-through proxy handler.

Two URL surfaces, one backing logic:

  * Top-level ``/openai/{path}``, ``/anthropic/{path}``, etc. — for
    native SDK clients (Cursor, Anthropic SDK) that don't speak Forge
    auth. Forge injects its admin key + metadata envelope so LiteLLM
    can attribute spend / apply policies.
  * Forge-style ``/forge/pass-through/{provider}/{path}`` — for
    explicit testing and admin access; uses the caller's Virtual Key
    via the existing :class:`PassThroughClient`.

Auth model
----------
- Tenant enablement is gated by ``forge.pass_through.enabled`` +
  ``forge.provider.<name>.enabled`` feature flags.
- Top-level mounts: anonymous to Forge (no JWT). Tenant is read from
  ``X-Forge-Tenant`` header (SDK clients) or from a Forge JWT if
  present (dashboard calls).
- Admin-style mounts: require a Forge JWT and use the caller's
  Virtual Key.

ponytail: one HTTP handler for both surfaces. New provider → add to
``app.services.phase4_providers.PROVIDERS``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.core.config import settings
from app.core.logging import get_logger
from app.core.phase4_errors import PassThroughDisabled, PassThroughUnsupportedProvider
from app.core.security import AuthenticatedPrincipal, get_current_principal
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.phase4_cache import phase4_cache_service
from app.services.phase4_providers import (
    PROVIDERS,
    is_provider_enabled,
    record_accessed,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/pass-through", tags=["phase4-passthrough"])


# ── Auth resolution ──────────────────────────────────────────────────


async def _resolve_principal_or_header(request: Request) -> tuple[str, str, str | None]:
    """Return (tenant_id, project_id, user_id).

    Tries JWT first; falls back to ``X-Forge-Tenant`` header for
    provider SDK clients that don't speak Forge auth.
    """
    principal: AuthenticatedPrincipal | None = None
    try:
        principal = await get_current_principal(request=request)  # type: ignore[arg-type]
    except HTTPException:
        principal = None

    if principal is not None:
        return principal.tenant_id, principal.project_id, principal.user_id

    tenant_header = request.headers.get("X-Forge-Tenant")
    if tenant_header:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(Tenant, tenant_header)  # type: ignore[arg-type]
        if row is None:
            raise HTTPException(status_code=403, detail="unknown_tenant_header")
        return str(row.id), str(row.project_id), None

    raise HTTPException(status_code=401, detail="auth_required")


# ── Cache lookup (chat-completions only, exact-match) ────────────────


def _resolve_cache_key(body: bytes) -> tuple[str, str, str] | None:
    if not body:
        return None
    try:
        parsed = json.loads(body)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(parsed, dict):
        return None
    model = parsed.get("model")
    if not isinstance(model, str):
        return None
    canonical = json.dumps(
        {k: parsed[k] for k in sorted(parsed) if k != "stream"}, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest(), model, "exact"


# ── Top-level proxy (admin-key, anonymous client) ────────────────────


def _filter_forwarded_headers(client_headers: Any) -> dict[str, str]:
    """Mirror ``app.integrations.litellm.pass_through._filter_forwarded_headers``
    inline to keep this module self-contained.
    """
    allow = {
        "authorization-credential",
        "x-amz-date",
        "x-amz-security-token",
        "x-amz-content-sha256",
        "x-amz-target",
        "x-amz-user-agent",
        "x-goog-api-version",
        "anthropic-version",
        "anthropic-beta",
    }
    out: dict[str, str] = {}
    for k, v in client_headers.items():
        lk = k.lower()
        if lk in {"authorization", "host", "content-length", "x-forge-tenant"}:
            continue
        if lk in allow or lk.startswith(("x-amz-", "x-goog-")):
            out[k] = v
    return out


async def _top_level_proxy(request: Request, provider: str, path: str) -> Any:
    """Top-level /openai/, /anthropic/, etc. — uses admin key."""
    if provider not in PROVIDERS:
        raise PassThroughUnsupportedProvider(provider)

    tenant_id, project_id, user_id = await _resolve_principal_or_header(request)
    if not await is_provider_enabled(tenant_id, provider):
        raise PassThroughDisabled(provider)

    meta = PROVIDERS[provider]
    upstream_path = f"{meta['upstream']}/{path}".rstrip("/")

    body = await request.body()

    # Cache miss recording (chat-completions only).
    hit = _resolve_cache_key(body)
    if hit is not None:
        key_hash, model, cache_type = hit
        await phase4_cache_service.record_miss(
            tenant_id=tenant_id,
            project_id=project_id,
            key_hash=key_hash,
            model=model,
            cache_type=cache_type,
        )

    is_stream = meta["streaming"] and request.headers.get("accept", "").startswith(
        "text/event-stream"
    )

    headers = _filter_forwarded_headers(request.headers)
    headers["Authorization"] = f"Bearer {settings.litellm_admin_key}"
    headers["Content-Type"] = request.headers.get("content-type", "application/json")

    if is_stream:

        async def gen() -> AsyncIterator[bytes]:
            async with (
                httpx.AsyncClient(timeout=None) as client,
                client.stream(
                    request.method,
                    f"{settings.litellm_base_url}{upstream_path}",
                    params=request.query_params,
                    headers=headers,
                    content=body,
                ) as response,
            ):
                async for chunk in response.aiter_bytes():
                    yield chunk

        await record_accessed(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=user_id,
            provider=provider,
            path=upstream_path,
            method=request.method,
        )
        return StreamingResponse(gen(), media_type="text/event-stream")


    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        response = await client.request(
            request.method,
            f"{settings.litellm_base_url}{upstream_path}",
            params=request.query_params,
            headers=headers,
            content=body,
        )

    await record_accessed(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=user_id,
        provider=provider,
        path=upstream_path,
        method=request.method,
    )

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers={
            k: v
            for k, v in response.headers.items()
            if k.lower() not in {"content-length", "transfer-encoding", "connection"}
        },
    )


# ── Forge-style admin proxy (uses caller's virtual key) ──────────────


@router.api_route(
    "/{provider}/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def admin_pass_through(
    request: Request,
    provider: str,
    path: str,
    principal: AuthenticatedPrincipal = Depends(),
) -> Any:
    """Forge-style admin pass-through under /forge/pass-through/.

    Requires a JWT. Uses the caller's virtual key from the JWT (when
    present). Falls through to the top-level handler semantics if the
    caller only has admin credentials.
    """
    return await _top_level_proxy(request, provider, path)


# ── Top-level mount helper ────────────────────────────────────────────


def mount_passthrough(app: Any) -> None:
    """Mount the same handler at /openai/, /anthropic/, /bedrock/, etc.

    Called from ``app/main.py`` after the v1 routers are included.
    """
    for name, meta in PROVIDERS.items():
        mount_prefix = (
            meta["upstream"] if meta["upstream"].startswith("/") else f"/{meta['upstream']}"
        )

        async def handler(request: Request, provider: str = name, **_: Any) -> Any:
            # provider name is closed over; the path comes from the route.
            path = request.path_params.get("path", "")  # type: ignore[union-attr]
            return await _top_level_proxy(request, provider, path)

        app.add_api_route(
            path=f"{mount_prefix}/{{path:path}}",
            endpoint=handler,
            methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            include_in_schema=False,
            name=f"pt-{name}",
        )

    # Canonical Anthropic Messages path alias.
    async def _anthropic_messages_root(request: Request) -> Any:
        return await _top_level_proxy(request, "anthropic", "v1/messages")

    async def _anthropic_messages_sub(request: Request, path: str) -> Any:
        return await _top_level_proxy(request, "anthropic", f"v1/messages/{path}")

    app.add_api_route(
        path="/v1/messages",
        endpoint=_anthropic_messages_root,
        methods=["POST"],
        include_in_schema=False,
        name="pt-anthropic-v1-root",
    )
    app.add_api_route(
        path="/v1/messages/{path:path}",
        endpoint=_anthropic_messages_sub,
        methods=["POST"],
        include_in_schema=False,
        name="pt-anthropic-v1",
    )


__all__ = ["router", "mount_passthrough"]
