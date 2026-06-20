"""
GitHub HTTP transport seam (FORA-201 / 11.2b).

The transport is the only place that knows the GitHub REST
endpoints live under `https://api.github.com`. The adapter
above it speaks GitHub semantics (issue / comment / state);
the transport below it speaks HTTP. The seam is the
`GitHubTransport` Protocol so the day-one `urllib` impl can
be swapped for `httpx` (async) or a recorded-test fake
without touching `apply_mirror`.

The shape intentionally mirrors `agents.github_mcp.server`
which is the read-side MCP — same header conventions, same
auth header, same rate-limit response handling. The two
modules are **not** merged: the MCP is the agent's tool
surface (7 read-mostly tools); the transport is the
Sync Plane's outbound writer (one issue / one comment at
a time, idempotent). Sharing the transport would be a
mistake — the MCP's read path tolerates pagination, the
writer's write path tolerates idempotency on
`remote_refs["github"]`.

The transport surface is small on purpose:

    request(method, path, *, json=None, headers=None) -> Response

The transport is **stateless**; the adapter is the
component that holds the per-tenant token. The transport
never reads env vars itself; the auth provider is the
only place env vars are read.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Protocol, runtime_checkable


GITHUB_API = "https://api.github.com"
DEFAULT_API_VERSION = "2022-11-28"
USER_AGENT = "fora-sync-plane/0.1 (+github-issues-adapter)"


@dataclass
class GitHubResponse:
    """A normalized GitHub response. The transport is the
    only place that knows the GitHub response shape; the
    adapter works in `body: Dict[str, Any]` + `headers`.

    `rate_limit_remaining` and `rate_limit_reset` are
    extracted from `X-RateLimit-*` headers and surfaced
    as typed fields so the adapter can populate
    `AdapterHealth.rate_limit_remaining` without
    re-parsing headers."""
    status: int
    body: Dict[str, Any] = field(default_factory=dict)
    headers: Dict[str, str] = field(default_factory=dict)
    rate_limit_remaining: Optional[int] = None
    rate_limit_reset: Optional[int] = None
    error: str = ""

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def is_rate_limited(self) -> bool:
        return self.status == 429 or (
            self.rate_limit_remaining is not None
            and self.rate_limit_remaining <= 0
        )


@runtime_checkable
class GitHubTransport(Protocol):
    """The HTTP seam. Implementations must extract the
    rate-limit headers and populate the typed fields on
    `GitHubResponse`; the adapter depends on those fields
    for `health()`."""

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str,
        json_body: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> GitHubResponse:
        """One HTTP request. `path` is the path component
        only (e.g. `/repos/owner/repo/issues`); the
        transport prepends the API origin. The caller
        supplies the bearer token — the transport is
        stateless across tenants."""


class UrllibGitHubTransport:
    """The day-one `urllib`-backed transport. Pure stdlib,
    synchronous, no connection pooling beyond the default
    `http.client` behaviour. Phase 2 may replace this
    with an `httpx`-backed async variant without
    touching the adapter or the Protocol.

    The transport honors the GitHub `Accept` and
    `X-GitHub-Api-Version` headers (ADR-0006 §"API
    versioning") and surfaces 4xx / 5xx as non-2xx
    `GitHubResponse` (never raises). 429 is **not**
    retried at the transport layer; the adapter
    routes through `BurstControl` and the
    `OutboxQueue` for retry.
    """

    __slots__ = ("_api_origin", "_api_version", "_user_agent")

    def __init__(
        self,
        *,
        api_origin: str = GITHUB_API,
        api_version: str = DEFAULT_API_VERSION,
        user_agent: str = USER_AGENT,
    ) -> None:
        self._api_origin = api_origin.rstrip("/")
        self._api_version = api_version
        self._user_agent = user_agent

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str,
        json_body: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> GitHubResponse:
        url = f"{self._api_origin}{path}"
        headers: Dict[str, str] = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": self._api_version,
            "User-Agent": self._user_agent,
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            data = None
        if extra_headers:
            headers.update(extra_headers)

        req = urllib.request.Request(
            url, data=data, method=method.upper(), headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw_body = resp.read().decode("utf-8") if resp.length != 0 else "{}"
                body = _safe_json_loads(raw_body)
                return _response_from(resp.status, dict(resp.headers), body)
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8") if exc.fp else ""
            body = _safe_json_loads(raw) if raw else {}
            return _response_from(exc.code, dict(exc.headers or {}), body, error=str(exc))
        except urllib.error.URLError as exc:
            return GitHubResponse(
                status=0,
                body={},
                headers={},
                error=f"network: {exc.reason}",
            )
        except (TimeoutError, OSError) as exc:
            return GitHubResponse(
                status=0,
                body={},
                headers={},
                error=f"transport: {type(exc).__name__}: {exc}",
            )


def _safe_json_loads(raw: str) -> Dict[str, Any]:
    """Decode a JSON body, returning `{}` on empty / malformed
    input. The transport never raises on bad JSON; the
    adapter inspects `body` fields individually."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _response_from(
    status: int,
    headers: Dict[str, str],
    body: Dict[str, Any],
    *,
    error: str = "",
) -> GitHubResponse:
    """Build a `GitHubResponse` and pull the rate-limit
    headers into typed fields. Header lookup is
    case-insensitive (`urllib` lower-cases keys for the
    common path; we still normalise for safety)."""
    lower = {k.lower(): v for k, v in headers.items()}
    remaining = _int_or_none(lower.get("x-ratelimit-remaining"))
    reset = _int_or_none(lower.get("x-ratelimit-reset"))
    return GitHubResponse(
        status=status,
        body=body,
        headers=lower,
        rate_limit_remaining=remaining,
        rate_limit_reset=reset,
        error=error,
    )


def _int_or_none(value: Optional[str]) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
