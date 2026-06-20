"""
Platform adapters for the Sync Plane (FORA-252 / 11.2).

The 6 architectural-seam ports in `agents.sync_plane_service.ports`
declare the *protocols*; this package ships the concrete
implementations. Day-one (FORA-201) carries the GitHub Issues
adapter; the Jira adapter (FORA-200) and ClickUp adapter (FORA-202)
follow the same shape.

Each adapter is **dependency-free** (pure stdlib) so the smoke
test runs without `httpx` / `requests` / `psycopg2`. Phase 2 may
swap the urllib transport for httpx, the env-backed auth for the
customer-cloud-broker (FORA-126) OIDC path, and the in-memory
debounce for a Redis sorted-set — the seams below are the
replacement surface, not the runtime cost.

Public surface:

    from agents.sync_plane_service.adapters import (
        GitHubIssuesAdapter,                  # the 11.2b adapter
        GitHubAuthProvider,                   # auth Protocol
        EnvBackedGitHubAuthProvider,          # day-one auth impl
        GitHubTransport,                      # HTTP Protocol
        UrllibGitHubTransport,                # day-one transport impl
        StatusMapping,                        # Paperclip <-> GitHub state map
        StatusMappingError,                   # verdict-invariant error type
    )

Wiring (FORA-252 service.py):

    from agents.sync_plane_service.adapters import (
        EnvBackedGitHubAuthProvider,
        GitHubIssuesAdapter,
        UrllibGitHubTransport,
    )
    from agents.sync_plane_service.ports import (
        PORT_PLATFORM_GITHUB, PortRegistry,
    )

    auth = EnvBackedGitHubAuthProvider()
    transport = UrllibGitHubTransport()
    registry.register(
        PORT_PLATFORM_GITHUB,
        GitHubIssuesAdapter(auth=auth, transport=transport),
    )
"""

from __future__ import annotations

from .github import (  # noqa: F401
    EnvBackedGitHubAuthProvider,
    GitHubAuthProvider,
    GitHubIssuesAdapter,
    StatusMapping,
    StatusMappingError,
    map_status_paperclip_to_github,
    map_status_github_to_paperclip,
)
from ._transport import (  # noqa: F401
    GitHubResponse,
    GitHubTransport,
    UrllibGitHubTransport,
)

__all__ = [
    "EnvBackedGitHubAuthProvider",
    "GitHubAuthProvider",
    "GitHubIssuesAdapter",
    "GitHubTransport",
    "StatusMapping",
    "StatusMappingError",
    "UrllibGitHubTransport",
    "map_status_paperclip_to_github",
    "map_status_github_to_paperclip",
]
