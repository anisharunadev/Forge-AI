"""
Workspace override/extend resolver (FORA-411, sub-goal 0.8.4).

The resolver is the single read path the orchestrator + memory MCP
use after a tenant has been materialized (FORA-409 / 0.8.3). It
answers the question "given (slug, rel), what file should the next
read return?" with a cached, deterministic lookup that honors the
tenant contract from ``workspace/README.md §6``:

    tenants/<slug>/workspace/<rel>      -> tenant override (if present)
    workspace/<rel>                     -> seed (fallthrough)

Constraints (from the FORA-411 issue body):

- Pure-Python. No subprocess shell-outs.
- Cache-friendly. The hot path is a dict lookup keyed on
  ``(slug, rel, mtime)``; the cache survives across sub-agent runs.
- No per-request filesystem walk. A single ``os.stat`` per cache
  miss per (slug, rel) pair is the entire cost.
- The seed is NEVER read directly once a tenant is materialized;
  all reads go through this resolver.

The resolver also owns the write side of the contract:

- ``write_to_tenant(slug, rel, body, ...)`` writes a file under the
  tenant tree, but REFUSES any ``memory/`` write with an audit row
  carrying the actor + reason. The platform's ``memory/`` namespace
  is read-only for tenants by contract.
- The audit log is a single JSONL stream under
  ``var/workspace-resolve-audit.jsonl`` so the Audit agent (FORA-210)
  can sample it the same way it samples the materializer log.

Slug grammar mirrors FORA-409: lowercase letters, digits, dash,
underscore; 1-63 chars. Reject anything that could be a path
traversal before any I/O.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional, Tuple

# Project-root bootstrap so the package is importable as
# ``agents.workspace_resolve`` from any cwd.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if ROOT not in os.sys.path:
    os.sys.path.insert(0, ROOT)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Same slug grammar as the materializer (FORA-409 §slug validation) and
# the platform's tenant_id grammar (ADR-0003 §3.2). The slug becomes
# part of every on-disk path and audit row, so we reject anything that
# could be a path-traversal or shell-injection vector at the door.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")

# Subtrees a tenant is NEVER allowed to write into. ``memory/`` is
# platform read-only by contract (workspace/README.md §6); the
# override contract exists for ``customer/`` and ``project/`` only.
PROTECTED_RELPATH_PREFIXES: Tuple[str, ...] = ("memory/",)

# Where the seed lives, relative to the project root. The resolver
# reads this once and caches it for the life of the process.
DEFAULT_SEED_ROOT = os.path.join(ROOT, "workspace")
DEFAULT_TENANTS_ROOT = os.path.join(ROOT, "tenants")

# Default audit log. Same convention as the materializer.
DEFAULT_AUDIT_LOG = os.path.join(ROOT, "var", "workspace-resolve-audit.jsonl")

# Resolver version, embedded in every audit row so a future change
# to the cache key or the fallthrough order can be detected by the
# audit reader.
RESOLVER_VERSION = "workspace-resolver/0.1.0"


# ---------------------------------------------------------------------------
# Errors + data model
# ---------------------------------------------------------------------------


class ResolverError(ValueError):
    """Raised on bad slug, path traversal, or a denied write."""


@dataclass(frozen=True)
class Source:
    """Which side of the resolver produced the path."""

    TENANT = "tenant"
    SEED = "seed"


@dataclass(frozen=True)
class ResolvedPath:
    """The result of a successful ``resolve`` call.

    ``path`` is the absolute on-disk path; ``source`` is whether the
    tenant override or the seed produced it; ``tenant_relpath`` is the
    tenant-relative POSIX path the caller requested (post-validation).
    """

    slug: str
    tenant_relpath: str
    path: str
    source: str
    size: int
    mtime_ns: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Slug + relpath validation
# ---------------------------------------------------------------------------


def _validate_slug(slug: str) -> str:
    if not isinstance(slug, str):
        raise ResolverError("slug must be a string")
    if not slug or not _SLUG_RE.match(slug):
        raise ResolverError(
            f"invalid slug {slug!r}: must match {_SLUG_RE.pattern} "
            "(lowercase letters/digits, dash/underscore, 1-63 chars)"
        )
    return slug


def _validate_relpath(rel: str) -> str:
    """Normalize and validate a relpath; reject anything that could escape.

    We refuse absolute paths, any parent-traversal (``..`` segments),
    and backslashes. The returned string is POSIX-style and starts
    without a leading slash so it composes cleanly with
    ``os.path.join``.
    """
    if not isinstance(rel, str):
        raise ResolverError("relpath must be a string")
    if not rel:
        raise ResolverError("relpath must be non-empty")
    norm = rel.replace("\\", "/")
    if norm.startswith("/"):
        raise ResolverError(f"relpath must be relative: {rel!r}")
    # Reject parent traversal anywhere in the path. ``os.path.normpath``
    # would collapse a leading ``../`` for us, but we want the rejection
    # to be explicit so the audit row carries the bad input verbatim.
    parts = norm.split("/")
    if ".." in parts:
        raise ResolverError(f"relpath contains '..': {rel!r}")
    if norm.startswith("./") or norm == ".":
        raise ResolverError(f"relpath must not start with './': {rel!r}")
    return norm


# ---------------------------------------------------------------------------
# Cache (process-local, thread-safe)
# ---------------------------------------------------------------------------


@dataclass
class _CacheEntry:
    path: str
    source: str
    size: int
    mtime_ns: int
    cached_at_monotonic: float


class _ResolverCache:
    """A bounded LRU keyed on ``(slug, relpath)``; invalidates on mtime drift.

    The hot path is the dict lookup; the cold path is one ``os.stat``
    on the tenant path and (if absent) one on the seed path. A
    ``clear()`` is exposed for tests + an operator-driven invalidation
    hook so a CLI ``workspace:resolve --clear-cache`` can drop the
    in-process state without a restart.
    """

    def __init__(self, maxsize: int = 4096) -> None:
        self._maxsize = maxsize
        self._lock = threading.Lock()
        self._data: Dict[Tuple[str, str], _CacheEntry] = {}

    def get(self, key: Tuple[str, str]) -> Optional[_CacheEntry]:
        with self._lock:
            return self._data.get(key)

    def put(self, key: Tuple[str, str], entry: _CacheEntry) -> None:
        with self._lock:
            if len(self._data) >= self._maxsize:
                # Drop the oldest by insertion order. ``dict`` preserves
                # insertion order in CPython 3.7+, so ``next(iter(...))``
                # is the LRU eviction point.
                oldest = next(iter(self._data))
                self._data.pop(oldest, None)
            self._data[key] = entry

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


_CACHE = _ResolverCache()


def clear_cache() -> None:
    """Drop the in-process resolver cache (for tests + operator use)."""
    _CACHE.clear()


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------


def _audit_path(audit_log: Optional[str]) -> str:
    return audit_log or os.environ.get(
        "FORA_WORKSPACE_RESOLVE_AUDIT", DEFAULT_AUDIT_LOG
    )


def write_audit_row(row: Dict[str, Any], audit_path: Optional[str] = None) -> str:
    """Append one JSONL row to the resolver audit log; return the path.

    Every public write and every denied write goes through here so
    the Audit agent (FORA-210) can sample one stream and see both
    happy-path and contract-violation events.
    """
    path = _audit_path(audit_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    row = dict(row)
    row.setdefault("ts", time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z")
    row.setdefault("resolver_version", RESOLVER_VERSION)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")
    return path


# ---------------------------------------------------------------------------
# Core resolve
# ---------------------------------------------------------------------------


def resolve(
    slug: str,
    relpath: str,
    *,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
    use_cache: bool = True,
) -> Optional[ResolvedPath]:
    """Return the on-disk path for ``(slug, relpath)`` or ``None``.

    Resolution order:

      1. ``tenants/<slug>/workspace/<relpath>`` -- if the file exists,
         the tenant override wins (this is the "extend" path; a
         tenant can shadow any seed file under ``customer/`` or
         ``project/``, and add new ones).
      2. ``<seed_root>/<relpath>`` -- the seed is the fallthrough
         for files the tenant has not overridden, and for tenants
         that have never been materialized (FORA-409 is the
         bootstrap, not a precondition for reads).
      3. ``None`` -- neither side has the file.

    The cache is invalidated by mtime drift: if the cached entry's
    mtime_ns does not match the live ``os.stat``, the entry is
    refreshed. A tenant write or seed write that changes the file
    therefore invalidates naturally on the next read.
    """
    slug = _validate_slug(slug)
    rel = _validate_relpath(relpath)
    seed_root = seed_root or os.environ.get("FORA_SEED_ROOT", DEFAULT_SEED_ROOT)
    tenants_root = tenants_root or os.environ.get(
        "FORA_TENANTS_ROOT", DEFAULT_TENANTS_ROOT
    )

    cache_key = (slug, rel)
    if use_cache:
        cached = _CACHE.get(cache_key)
        if cached is not None and cached.source != Source.SEED + "_missing":
            # Live-mtime check: if the file changed under us, drop the
            # entry and fall through to the cold path.
            try:
                live_mtime = os.stat(cached.path).st_mtime_ns
            except OSError:
                # File disappeared. Cold-path it.
                _CACHE.put(cache_key, _CacheEntry(
                    path="", source="missing", size=0, mtime_ns=0,
                    cached_at_monotonic=time.monotonic(),
                ))
            else:
                if live_mtime == cached.mtime_ns and cached.size > 0:
                    return ResolvedPath(
                        slug=slug,
                        tenant_relpath=rel,
                        path=cached.path,
                        source=cached.source,
                        size=cached.size,
                        mtime_ns=cached.mtime_ns,
                    )

    # Cold path.
    tenant_path = os.path.join(tenants_root, slug, "workspace", rel)
    if os.path.isfile(tenant_path):
        st = os.stat(tenant_path)
        entry = _CacheEntry(
            path=tenant_path,
            source=Source.TENANT,
            size=st.st_size,
            mtime_ns=st.st_mtime_ns,
            cached_at_monotonic=time.monotonic(),
        )
        _CACHE.put(cache_key, entry)
        return ResolvedPath(
            slug=slug,
            tenant_relpath=rel,
            path=tenant_path,
            source=Source.TENANT,
            size=st.st_size,
            mtime_ns=st.st_mtime_ns,
        )

    seed_path = os.path.join(seed_root, rel)
    if os.path.isfile(seed_path):
        st = os.stat(seed_path)
        entry = _CacheEntry(
            path=seed_path,
            source=Source.SEED,
            size=st.st_size,
            mtime_ns=st.st_mtime_ns,
            cached_at_monotonic=time.monotonic(),
        )
        _CACHE.put(cache_key, entry)
        return ResolvedPath(
            slug=slug,
            tenant_relpath=rel,
            path=seed_path,
            source=Source.SEED,
            size=st.st_size,
            mtime_ns=st.st_mtime_ns,
        )

    # Negative-cache the miss for a short window so a hot sub-agent
    # loop that asks for the same missing file doesn't redo the stat.
    _CACHE.put(
        cache_key,
        _CacheEntry(
            path="",
            source="missing",
            size=0,
            mtime_ns=0,
            cached_at_monotonic=time.monotonic(),
        ),
    )
    return None


# ---------------------------------------------------------------------------
# Convenience: cached text read
# ---------------------------------------------------------------------------


def read_text(
    slug: str,
    relpath: str,
    *,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
    encoding: str = "utf-8",
    use_cache: bool = True,
) -> Optional[str]:
    """Return the text contents of ``resolve(slug, relpath)`` or ``None``.

    The byte cache (above) covers path resolution; the text decode
    is on the read path. A future optimization can add a per-file
    decoded-text cache if profiling shows decode cost is non-trivial
    — for the FORA-411 acceptance bar the decode is milliseconds
    even on the 50-file seed.
    """
    rp = resolve(
        slug,
        relpath,
        seed_root=seed_root,
        tenants_root=tenants_root,
        use_cache=use_cache,
    )
    if rp is None:
        return None
    with open(rp.path, "r", encoding=encoding) as fh:
        return fh.read()


def exists(
    slug: str,
    relpath: str,
    *,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
) -> bool:
    """True iff ``resolve(slug, relpath)`` returns a path."""
    return resolve(
        slug, relpath, seed_root=seed_root, tenants_root=tenants_root
    ) is not None


# ---------------------------------------------------------------------------
# Writes (gated)
# ---------------------------------------------------------------------------


def write_to_tenant(
    slug: str,
    relpath: str,
    body: str,
    *,
    actor: str = "unknown",
    tenants_root: Optional[str] = None,
    audit_log: Optional[str] = None,
    encoding: str = "utf-8",
) -> ResolvedPath:
    """Write ``body`` under ``tenants/<slug>/workspace/<relpath>``.

    Refuses any relpath starting with ``memory/`` -- the platform's
    ``memory/`` namespace is read-only for tenants by contract. The
    refusal is recorded as an audit event so a tenant (or a buggy
    caller) cannot bypass the rule silently.

    Other namespaces (``customer/``, ``project/``, ``README.md``) are
    permitted: those are the override + extend surface the FORA-411
    issue ships.

    Returns the ``ResolvedPath`` for the written file. The resolver
    cache for that key is invalidated so the next read returns the
    new bytes.
    """
    slug = _validate_slug(slug)
    rel = _validate_relpath(relpath)
    tenants_root = tenants_root or os.environ.get(
        "FORA_TENANTS_ROOT", DEFAULT_TENANTS_ROOT
    )

    if any(rel.startswith(p) for p in PROTECTED_RELPATH_PREFIXES):
        write_audit_row(
            {
                "actor": actor,
                "operation": "write_to_tenant",
                "outcome": "denied",
                "slug": slug,
                "relpath": rel,
                "reason": "memory_tenant_write_blocked",
                "bytes": len(body.encode(encoding)),
            },
            audit_path=audit_log,
        )
        raise ResolverError(
            f"tenant write to '{rel}' denied: 'memory/' is read-only by contract "
            "(workspace/README.md §6); file a seed PR instead"
        )

    abs_path = os.path.join(tenants_root, slug, "workspace", rel)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding=encoding) as fh:
        bytes_written = fh.write(body)
    st = os.stat(abs_path)

    # Refresh the cache so the next read returns the new bytes
    # without doing an extra ``os.stat``.
    _CACHE.put(
        (slug, rel),
        _CacheEntry(
            path=abs_path,
            source=Source.TENANT,
            size=st.st_size,
            mtime_ns=st.st_mtime_ns,
            cached_at_monotonic=time.monotonic(),
        ),
    )

    write_audit_row(
        {
            "actor": actor,
            "operation": "write_to_tenant",
            "outcome": "ok",
            "slug": slug,
            "relpath": rel,
            "bytes": bytes_written,
            "sha256": hashlib.sha256(body.encode(encoding)).hexdigest(),
        },
        audit_path=audit_log,
    )

    return ResolvedPath(
        slug=slug,
        tenant_relpath=rel,
        path=abs_path,
        source=Source.TENANT,
        size=st.st_size,
        mtime_ns=st.st_mtime_ns,
    )