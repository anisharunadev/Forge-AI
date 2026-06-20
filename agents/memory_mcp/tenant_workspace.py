"""Tenant workspace adapter (FORA-413, sub-goal 0.8.6).

A thin adapter over the existing 0.4 retrieval contract
(``agents.workspace_resolve``) that gives the Memory MCP a file-tree
view of a tenant's workspace. It exposes two operations:

    list_tenant_files(slug)              -> the resolved tree
    retrieve_tenant_file(slug, relpath)  -> one resolved file

The contract is "seed + tenant override, with the override shadowing":
for every relpath the tenant tree has, the tenant file wins; for every
relpath only the seed has, the seed file is the fallthrough. A file
that lives only on the tenant side (a true extension — the tenant added
it) is also surfaced with ``source="tenant"`` so the consumer can tell
"added" from "shadowed".

This module is intentionally a thin pass-through over
``agents.workspace_resolve``. It does NOT re-implement memory storage
(that's the 0.4 SQLite store) and does NOT touch the write path
(``write_to_tenant`` is owned by the resolver). The only added value is
two convenience entry points that produce the structured payload the
Memory MCP and the orchestrator consume.

Design notes (FORA-413 acceptance #4 in FORA-103):

- The tree walk consults the tenant tree first, then the seed. A
  relpath present on both sides is reported once with ``source="tenant"``
  and a ``seed_path`` so the caller can introspect the shadow.
- The walk is depth-bounded (default 8) and file-count-bounded
  (default 5000) so a runaway tree cannot hang the orchestrator.
- No file content is loaded by ``list_tenant_files`` — only metadata
  (relpath, source, size, mtime). ``retrieve_tenant_file`` is the
  content path; that keeps the list call cheap.
- All slug + relpath validation is delegated to ``resolve`` and
  ``read_text`` so the resolver's invariants (no path traversal,
  memory/ read-only) carry over without re-implementation.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if ROOT not in os.sys.path:
    os.sys.path.insert(0, ROOT)


# Same slug grammar as ``agents.workspace_resolve.resolver._SLUG_RE``.
# Inlined here (instead of importing the private symbol) so this
# module depends only on the resolver's PUBLIC surface (``resolve``,
# ``read_text``). The grammar is the platform's tenant_id shape
# (ADR-0003 §3.2); the resolver enforces it again on every call.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


def _validate_slug_public(slug: str) -> str:
    if not isinstance(slug, str) or not slug or not _SLUG_RE.match(slug):
        raise ValueError(
            f"invalid slug {slug!r}: must match {_SLUG_RE.pattern} "
            "(lowercase letters/digits, dash/underscore, 1-63 chars)"
        )
    return slug


# The three tenant-overridable namespaces plus the read-only memory
# namespace. Pulled from the FORA-103 / FORA-411 contract (workspace/
# README §6) and the injection table in agents/memory_mcp/injection.py.
# The tree walker stops at these so it never leaks the runtime workspace
# (runs/, artifacts/, sessions/, audit/, plan/) into the listing.
_TREE_NAMESPACES = ("memory", "customer", "project")

# Safety bounds. The walker is the only place these live so the
# orchestrator's worst-case latency is documented in one spot.
_DEFAULT_MAX_DEPTH = 8
_DEFAULT_MAX_FILES = 5000


def list_tenant_files(
    slug: str,
    *,
    namespaces: Optional[List[str]] = None,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
    max_depth: int = _DEFAULT_MAX_DEPTH,
    max_files: int = _DEFAULT_MAX_FILES,
    use_cache: bool = True,
) -> Dict[str, Any]:
    """Walk the merged seed + tenant tree and return one entry per file.

    The return shape mirrors the FORA-413 acceptance #4 contract:

        {
          "tenant":   <slug>,
          "namespaces": [...],
          "files": [
            {
              "relpath":  "customer/standards.md",
              "source":   "tenant" | "seed",
              "path":     "<absolute on-disk path>",
              "size":     <int>,
              "mtime_ns": <int>,
              "seed_path": "<absolute seed path>" | null,
            },
            ...
          ],
          "count":     <int>,
          "truncated":  bool,
        }

    The walker honors the override contract: a relpath present on both
    sides is reported once with ``source="tenant"`` and a non-null
    ``seed_path``. A relpath only on the tenant side (an extension) is
    reported with ``source="tenant"`` and ``seed_path=None``. A
    relpath only on the seed side (no override, no extension) is
    reported with ``source="seed"`` and ``seed_path=None`` (it is the
    seed itself).

    The walker is bounded: ``max_depth`` caps directory recursion,
    ``max_files`` caps the total entries returned. ``truncated`` is
    set when either bound is hit so the caller can detect partial
    results without parsing the entries.
    """
    from agents.workspace_resolve import _validate_slug, resolve  # late import

    slug = _validate_slug(slug)
    ns_filter = tuple(namespaces) if namespaces else _TREE_NAMESPACES
    for ns in ns_filter:
        if ns not in _TREE_NAMESPACES:
            raise ValueError(
                f"unknown namespace {ns!r}: must be one of {_TREE_NAMESPACES}"
            )

    seed_root = seed_root or os.environ.get(
        "FORA_SEED_ROOT",
        os.path.join(ROOT, "workspace"),
    )
    tenants_root = tenants_root or os.environ.get(
        "FORA_TENANTS_ROOT",
        os.path.join(ROOT, "tenants"),
    )

    files: List[Dict[str, Any]] = []
    truncated = False

    def _walk(ns_root: str, source_label: str, *, is_tenant_side: bool) -> None:
        """Walk one tree (tenant or seed) under ``ns_root``.

        For every regular file, record ``(relpath, source, path)`` into
        the local ``seen`` map keyed by relpath. The tenant walker
        stamps ``source="tenant"``; the seed walker only stamps
        ``source="seed"`` for relpaths not already present (so the
        tenant override wins).
        """
        nonlocal truncated
        if not os.path.isdir(ns_root):
            return
        base_depth = ns_root.rstrip(os.sep).count(os.sep)
        for dirpath, dirnames, filenames in os.walk(ns_root, followlinks=False):
            depth = dirpath.count(os.sep) - base_depth
            if depth >= max_depth:
                # Stop descending this branch. ``os.walk`` honors
                # in-place mutation of ``dirnames``.
                dirnames[:] = []
                continue
            # Stable order so the listing is reproducible.
            dirnames.sort()
            filenames.sort()
            for name in filenames:
                if len(files) >= max_files:
                    truncated = True
                    return
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, ns_root).replace(os.sep, "/")
                if is_tenant_side:
                    # Tenant side: always wins. We still record the
                    # seed_path (if the seed has the same relpath) so
                    # the caller can introspect the shadow.
                    seed_path = os.path.join(seed_root, ns, rel) if seed_root else None
                    try:
                        st = os.stat(full)
                    except OSError:
                        continue
                    entry: Dict[str, Any] = {
                        "relpath": f"{ns}/{rel}",
                        "source": "tenant",
                        "path": full,
                        "size": st.st_size,
                        "mtime_ns": st.st_mtime_ns,
                        "seed_path": (
                            seed_path if os.path.isfile(seed_path) else None
                        ),
                    }
                    _seen[f"{ns}/{rel}"] = entry
                else:
                    # Seed side: only record if the tenant side did NOT
                    # already claim this relpath (the walker for the
                    # tenant side runs first in ``_walk``).
                    key = f"{ns}/{rel}"
                    if key in _seen:
                        continue
                    try:
                        st = os.stat(full)
                    except OSError:
                        continue
                    _seen[key] = {
                        "relpath": key,
                        "source": "seed",
                        "path": full,
                        "size": st.st_size,
                        "mtime_ns": st.st_mtime_ns,
                        "seed_path": None,
                    }

    _seen: Dict[str, Dict[str, Any]] = {}

    for ns in ns_filter:
        # Walk the tenant side first so the seed walker skips shadows.
        if tenants_root:
            _walk(
                os.path.join(tenants_root, slug, "workspace", ns),
                "tenant",
                is_tenant_side=True,
            )
        if truncated:
            break
        # Then the seed side.
        if seed_root:
            _walk(
                os.path.join(seed_root, ns),
                "seed",
                is_tenant_side=False,
            )
        if truncated:
            break

    files = sorted(_seen.values(), key=lambda e: e["relpath"])
    return {
        "tenant": slug,
        "namespaces": list(ns_filter),
        "files": files,
        "count": len(files),
        "truncated": truncated,
    }


def retrieve_tenant_file(
    slug: str,
    relpath: str,
    *,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
    encoding: str = "utf-8",
    use_cache: bool = True,
    include_content: bool = True,
) -> Dict[str, Any]:
    """Resolve ``(slug, relpath)`` and return the file content + metadata.

    The return shape mirrors the FORA-413 acceptance #4 contract for
    the retrieve side:

        {
          "tenant":   <slug>,
          "relpath":  <rel>,
          "source":   "tenant" | "seed",
          "path":     "<absolute on-disk path>",
          "size":     <int>,
          "mtime_ns": <int>,
          "content":  "<text>" | null,
        }

    ``content`` is the UTF-8-decoded text when ``include_content`` is
    True; otherwise it is ``None`` so the caller can do a metadata-only
    probe (used by the orchestrator's existence checks before a
    content read).

    ``None`` is returned ONLY when neither side has the file. Callers
    should branch on the ``source`` key (``"tenant"`` vs ``"seed"``) to
    detect shadowed files; an empty result here is a real "not found"
    and should be surfaced, not swallowed.
    """
    from agents.workspace_resolve import read_text, resolve  # late import

    rp = resolve(
        slug,
        relpath,
        seed_root=seed_root,
        tenants_root=tenants_root,
        use_cache=use_cache,
    )
    if rp is None:
        return {
            "tenant": slug,
            "relpath": relpath,
            "source": None,
            "path": None,
            "size": 0,
            "mtime_ns": 0,
            "content": None,
            "found": False,
        }
    payload: Dict[str, Any] = {
        "tenant": slug,
        "relpath": relpath,
        "source": rp.source,
        "path": rp.path,
        "size": rp.size,
        "mtime_ns": rp.mtime_ns,
        "content": None,
        "found": True,
    }
    if include_content:
        payload["content"] = read_text(
            slug,
            relpath,
            seed_root=seed_root,
            tenants_root=tenants_root,
            encoding=encoding,
            use_cache=use_cache,
        )
    return payload


__all__ = [
    "list_tenant_files",
    "retrieve_tenant_file",
    "_TREE_NAMESPACES",
]