"""
In-memory `GitHubTransport` for the day-one smoke test.

The transport is the **only** seam between the adapter
and the network. The smoke test uses this in-memory
fake so the assertions are deterministic and the test
runs in <50 ms without `pytest` / `httpx` / a real
GitHub App.

The fake records every request so the smoke test can
assert "we POSTed exactly one Issue and exactly one
Comment in the right order with the right body". The
record is the source of truth for "what would the
adapter have sent to api.github.com".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from ._transport import GitHubResponse, GitHubTransport


@dataclass
class RecordedRequest:
    """One captured outbound call. Fields are
    intentionally flat so the smoke test can assert on
    them with `==`."""
    method: str
    path: str
    token: str
    json_body: Optional[Dict[str, Any]] = None


class InMemoryGitHubTransport(GitHubTransport):
    """A scripted GitHub transport. The smoke test
    installs a `script` (a list of `(method, path,
    response_body, response_status)` tuples) and the
    fake walks the list on each request, raising
    `IndexError` on the first request that isn't
    covered (i.e. the smoke test author forgot to
    script it).

    Two on-by-default behaviours:

      * `rate_limit_remaining` starts at 5000 and
        decrements by 1 on every 2xx request.
      * `rate_limit_reset` is fixed at `now + 3600`
        so the test is time-zone-agnostic.

    The smoke test can override either by passing
    `initial_rate_limit_remaining` / `initial_rate_limit_reset`
    to the constructor."""

    __slots__ = (
        "_script",
        "_script_idx",
        "_recorded",
        "_rate_limit_remaining",
        "_rate_limit_reset",
        "_default_status",
    )

    def __init__(
        self,
        script: Optional[List[Tuple[str, str, Dict[str, Any], int]]] = None,
        *,
        initial_rate_limit_remaining: int = 5000,
        initial_rate_limit_reset: int = 9_999_999_999,
        default_status: int = 200,
    ) -> None:
        self._script: List[Tuple[str, str, Dict[str, Any], int]] = list(
            script or []
        )
        self._script_idx = 0
        self._recorded: List[RecordedRequest] = []
        self._rate_limit_remaining = initial_rate_limit_remaining
        self._rate_limit_reset = initial_rate_limit_reset
        self._default_status = default_status

    @property
    def recorded(self) -> List[RecordedRequest]:
        """A read-only view of the recorded requests."""
        return list(self._recorded)

    @property
    def remaining_script(self) -> int:
        return len(self._script) - self._script_idx

    def request(
        self,
        method: str,
        path: str,
        *,
        token: str,
        json_body: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> GitHubResponse:
        self._recorded.append(
            RecordedRequest(
                method=method.upper(),
                path=path,
                token=token,
                json_body=dict(json_body) if json_body else None,
            )
        )
        if self._script_idx < len(self._script):
            script_method, script_path, body, status = self._script[
                self._script_idx
            ]
            self._script_idx += 1
            if script_method != method.upper() or script_path != path:
                raise AssertionError(
                    f"script mismatch: expected "
                    f"({script_method}, {script_path}) got "
                    f"({method.upper()}, {path})"
                )
        else:
            body = {}
            status = self._default_status

        # Decrement the rate-limit counter on success.
        if 200 <= status < 300:
            self._rate_limit_remaining = max(0, self._rate_limit_remaining - 1)

        return GitHubResponse(
            status=status,
            body=body,
            headers={
                "X-RateLimit-Remaining": str(self._rate_limit_remaining),
                "X-RateLimit-Reset": str(self._rate_limit_reset),
            },
            rate_limit_remaining=self._rate_limit_remaining,
            rate_limit_reset=self._rate_limit_reset,
        )
