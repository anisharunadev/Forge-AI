"""Workspace override/extend resolver (FORA-411, sub-goal 0.8.4).

A tenant can override or extend the seed ``customer/`` and ``project/``
files without forking the platform. The resolver is the single read
path the orchestrator and the memory MCP use after a tenant has been
materialized (FORA-409 / 0.8.3):

    tenants/<slug>/workspace/<rel>      -> tenant override (if present)
    workspace/<rel>                     -> seed (fallthrough)

Tenant contract (per ``workspace/README.md §6``):

- A tenant MAY add new files under ``customer/`` and ``project/``.
- A tenant MAY shadow a seed ``customer/`` or ``project/`` file with an
  override at the same relpath.
- A tenant MAY NOT write to ``memory/`` — that namespace is platform
  read-only by contract. A write attempt is refused and emitted as an
  audit event.
- A tenant MAY NOT override the glossary directly — the glossary is in
  ``customer/glossary.md`` but is part of the seed by contract; overrides
  go through a PR to the seed (per §6).

Public surface:

    ResolvedPath               -- the dataclass returned by ``resolve``
    ResolverError              -- raised on bad slug / path-traversal
    resolve(slug, rel, ...)    -- core lookup (returns ResolvedPath | None)
    read_text(slug, rel, ...)  -- cached file-content read
    exists(slug, rel, ...)     -- True iff resolve() returns a path
    write_to_tenant(slug, rel, body, ...)  -- gated write; raises on memory/
    clear_cache()              -- for tests + operator-driven invalidation
    DEFAULT_AUDIT_LOG          -- ./var/workspace-resolve-audit.jsonl

CLI:

    python -m agents.workspace_resolve --tenant <slug> --path <rel>
    python -m agents.workspace_resolve --tenant <slug> --path <rel> --read
    python -m agents.workspace_resolve --tenant <slug> --path <rel> --write --body-file <f>
"""

from .resolver import (
    DEFAULT_AUDIT_LOG,
    PROTECTED_RELPATH_PREFIXES,
    ResolvedPath,
    ResolverError,
    Source,
    clear_cache,
    exists,
    read_text,
    resolve,
    write_audit_row,
    write_to_tenant,
)

__all__ = [
    "DEFAULT_AUDIT_LOG",
    "PROTECTED_RELPATH_PREFIXES",
    "ResolvedPath",
    "ResolverError",
    "Source",
    "clear_cache",
    "exists",
    "read_text",
    "resolve",
    "write_audit_row",
    "write_to_tenant",
]