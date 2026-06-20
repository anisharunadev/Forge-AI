"""
Per-tenant workspace materialization (FORA-409 / 0.8.3).

Cold-start a tenant by materializing the seed workspace into
``tenants/<slug>/workspace/`` and priming the 0.4 memory index for
that tenant. Pure-Python, no subprocess shell-outs (shutil + the
in-process MemoryStore API). The post-condition is the same shape the
Auth/Cold-start path of 0.7 expects: every sub-agent's next read for
tenant ``slug`` resolves from ``tenants/<slug>/workspace/`` instead of
from the seed, and the memory store has the seed facts loaded with
``tenant_id=slug``.

The "0.4 memory index" lives in
``agents/memory_mcp/store.MemoryStore`` (SQLite + sqlite-vec). We call
its ``write`` path directly — same as the MCP server's ``seed_workspace``
tool does — so the audit row, the embedding, and the dedupe contract
are identical. The CLI can also target a different ``FORA_MEMORY_DB``
path if the tenant is being provisioned in a different mount.

Design constraints (from the FORA-409 issue body):

- Pure-Python, no subprocess shell-outs. ``shutil.copytree`` and
  ``MemoryStore.write`` satisfy this. No ``subprocess.run``, no
  ``os.system``, no shell ``cp -r``.
- <60s for a 50-file seed on a developer laptop. The naive copy is
  a few hundred ms; the memory seeding is the dominant cost. We
  pre-tokenize once, embed once, and write in one connection.
- Idempotent. Re-running with the same slug does not duplicate
  files (we copy into a fresh tree each call, but the per-fact
  ``fact_id`` is deterministic so the memory index is a no-op).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

# Allow `python -m agents.workspace_materialize.materialize` from the
# project root; mirrors the memory_mcp package's bootstrap.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if ROOT not in os.sys.path:
    os.sys.path.insert(0, ROOT)

# The slug grammar is intentionally restrictive: lowercase letters,
# digits, dash, underscore; the same shape the platform uses for
# tenant_id claims (FORA-125 / 0.7.3) and that the customer-cloud-broker
# uses for the object prefix (ADR-0003 §4.3).
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")

# What we copy from the seed. The seed is the FORA Knowledge Layer
# (workspace/README.md §1): three folders, twelve files. We copy
# those plus README.md so the tenant inherits the same layout.
SEED_SUBDIRS: Tuple[str, ...] = ("memory", "customer", "project")
SEED_TOP_LEVEL_FILES: Tuple[str, ...] = ("README.md",)

# Files we never copy. ``.audit/`` and ``.omc/`` are per-tenant scratch
# state; ``runs/`` and ``sessions/`` accumulate per-tenant runtime data
# that the broker should not seed.
EXCLUDE_NAMES: frozenset = frozenset(
    {
        ".audit",
        ".omc",
        "runs",
        "sessions",
        "artifacts",
        "__pycache__",
        ".DS_Store",
    }
)

# Memory namespaces seeded by the materializer. Mirrors
# ``agents/memory_mcp/seed._file_namespace``; we hard-code the list
# here so the materializer has no hard import on memory_mcp.seed
# (so the smoke test runs even if sqlite-vec is missing).
MEMORY_NAMESPACES: Tuple[str, ...] = ("memory", "customer", "project")


class MaterializeError(ValueError):
    """Raised on a bad slug, missing seed, or a partial write."""


@dataclass
class FileCopy:
    """Audit-trail row for one file copied from the seed."""

    src: str
    dst: str
    bytes: int


@dataclass
class MemorySeed:
    """Counts from the memory-index prime step."""

    written: int
    updated: int
    chunks: int
    db_path: str
    duration_ms: float


@dataclass
class MaterializeResult:
    """End-to-end result of a single ``materialize`` call."""

    slug: str
    workspace_root: str
    tenant_workspace: str
    files: List[FileCopy] = field(default_factory=list)
    total_bytes: int = 0
    copy_ms: float = 0.0
    memory: Optional[MemorySeed] = None
    duration_ms: float = 0.0
    materializer_version: str = "workspace-materializer/0.1.0"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # The full file list can be hundreds of entries; keep the
        # JSON report compact. The smoke test reads the per-file
        # rows off the in-memory result; a future review will scan
        # the .audit log.
        files = d.pop("files")
        d["file_count"] = len(files)
        d["sample_files"] = [f["src"] for f in files[:5]]
        return d


# ---------------------------------------------------------------------------
# Slug validation
# ---------------------------------------------------------------------------


def validate_slug(slug: str) -> str:
    """Validate the tenant slug; raise MaterializeError on bad input.

    The slug becomes part of every object-prefix key, audit row, and
    file path the tenant owns, so we reject anything that could later
    be a path-traversal or shell-injection vector. The shape mirrors
    the platform's tenant_id grammar in ADR-0003 §3.2.
    """
    if not isinstance(slug, str):
        raise MaterializeError("slug must be a string")
    if not slug or not _SLUG_RE.match(slug):
        raise MaterializeError(
            f"invalid slug {slug!r}: must match {_SLUG_RE.pattern} "
            "(lowercase letters/digits, dash/underscore, 1-63 chars)"
        )
    return slug


# ---------------------------------------------------------------------------
# File copy
# ---------------------------------------------------------------------------


def _walk_seed(seed_root: str) -> List[str]:
    """List the seed files we will copy. Deterministic order."""
    out: List[str] = []
    for name in sorted(os.listdir(seed_root)):
        if name in EXCLUDE_NAMES:
            continue
        full = os.path.join(seed_root, name)
        if os.path.isfile(full):
            if name in SEED_TOP_LEVEL_FILES:
                out.append(full)
            continue
        if os.path.isdir(full) and name in SEED_SUBDIRS:
            for dirpath, dirnames, filenames in os.walk(full):
                # Prune excluded subdirs in-place; os.walk honors it.
                dirnames[:] = [d for d in dirnames if d not in EXCLUDE_NAMES]
                for fn in sorted(filenames):
                    out.append(os.path.join(dirpath, fn))
    return out


def _copy_seed_to_tenant(
    seed_root: str, tenant_workspace: str, slug: str
) -> Tuple[List[FileCopy], int, float]:
    """Copy the seed into ``tenants/<slug>/workspace/`` (pure-Python).

    Uses ``shutil.copy2`` to preserve mtimes, so the seeded tenant
    tree is byte-identical (modulo any future drift in the seed) to
    a ``cp -r`` but without the shell-out. We delete and re-create
    the destination so a re-run is always a fresh materialization
    rather than a merge that could leak old files.
    """
    t0 = time.monotonic()
    files = _walk_seed(seed_root)
    if os.path.lexists(tenant_workspace):
        if not os.path.isdir(tenant_workspace):
            raise MaterializeError(
                f"{tenant_workspace} exists and is not a directory; refusing to overwrite"
            )
        # Wipe the prior tree but keep the tenant's policy.yaml /
        # cloud_trust.yaml siblings — those live at tenants/<slug>/
        # not at tenants/<slug>/workspace/, so they're untouched.
        shutil.rmtree(tenant_workspace)
    os.makedirs(tenant_workspace, exist_ok=True)

    copies: List[FileCopy] = []
    total_bytes = 0
    for src in files:
        rel = os.path.relpath(src, seed_root)
        dst = os.path.join(tenant_workspace, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        size = os.path.getsize(dst)
        total_bytes += size
        copies.append(FileCopy(src=rel, dst=os.path.relpath(dst, ROOT), bytes=size))
    return copies, total_bytes, (time.monotonic() - t0) * 1000.0


# ---------------------------------------------------------------------------
# Memory index prime
# ---------------------------------------------------------------------------


def _chunk_markdown_file(
    file_path: str, workspace_root: str, slug: str
) -> List[Dict[str, Any]]:
    """Split a markdown file into H2 chunks; same shape as memory_mcp.seed.

    We re-implement the chunker here (instead of importing
    ``memory_mcp.seed.chunk_markdown_file``) so the materializer has no
    hard dependency on sqlite-vec. The MCP server's seed_workspace
    tool produces identical chunk dicts given the same file and
    tenant_id, so re-running through the MCP is a true no-op
    (deterministic ``fact_id``).
    """
    import hashlib

    def slugify(t: str) -> str:
        s = re.sub(r"[^A-Za-z0-9]+", "-", t.strip().lower()).strip("-")
        return s or "section"

    def stable_id(ns: str, scope: str, ref: str, anchor: str) -> str:
        h = hashlib.sha256(f"{ns}|{scope}|{ref}|{anchor}".encode("utf-8")).hexdigest()
        return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"

    def file_namespace(rel: str) -> str:
        parts = rel.split(os.sep)
        if not parts:
            return "memory"
        if parts[0] in ("memory", "customer", "project"):
            return parts[0]
        return "memory"

    def file_scope(rel: str) -> str:
        ns = file_namespace(rel)
        if ns == "memory":
            return "global"
        return slug

    def file_kind(rel: str) -> str:
        n = os.path.basename(rel).lower()
        if n == "glossary.md":
            return "reference"
        if n == "prd.md":
            return "reference"
        if n == "roadmap.md":
            return "decision"
        if n == "tech-stack.md":
            return "reference"
        return "rule"

    def file_ttl(rel: str) -> Tuple[str, Optional[int]]:
        ns = file_namespace(rel)
        if ns == "memory":
            return "epoch", None
        if ns == "project":
            return "sliding", 90
        return "sliding", 60

    with open(file_path, "r", encoding="utf-8") as fh:
        text = fh.read()
    rel = os.path.relpath(file_path, workspace_root)
    ns = file_namespace(rel)
    scope = file_scope(rel)
    kind = file_kind(rel)
    ttl, half_life = file_ttl(rel)

    def _envelope(anchor: str, content: str) -> Dict[str, Any]:
        """Build the chunk envelope consumed by :mod:`memory_seed`.

        The provenance + source envelopes match the shape
        ``MemoryStore.write`` produces (see ``agents/memory_mcp/store.py``
        §write) so the seeded facts are indistinguishable from a runtime
        write — the audit row, the dedupe contract, and the recall path
        all behave identically.
        """
        return {
            "file_path": rel,
            "anchor": anchor,
            "content": content,
            "namespace": ns,
            "scope": scope,
            "kind": kind,
            "ttl_policy": ttl,
            "half_life_days": half_life,
            "fact_id": stable_id(ns, scope, rel, anchor),
            "tags": [os.path.basename(rel).replace(".md", ""), ns],
            "source": {
                "type": "tenant-workspace",
                "ref": rel,
                "anchor": anchor,
            },
            "provenance": {
                "actor": {
                    "agentId": "workspace-materializer",
                    "runId": None,
                    "contractId": f"materialize:{slug}",
                },
                "stage": "materialize",
            },
            "redaction_class": "none",
        }

    heading_re = re.compile(r"^(#{1,6})\s+(.*?)\s*$", re.MULTILINE)
    matches = list(heading_re.finditer(text))
    chunks: List[Dict[str, Any]] = []
    if not matches:
        anchor = slugify(os.path.basename(file_path))
        chunks.append(_envelope(anchor, text.strip()))
        return chunks

    # Pre-H2 intro.
    first = matches[0]
    if first.start(1) - first.start(0) > 0:
        intro = text[: first.start(0)].strip()
        if intro:
            anchor = slugify(first.group(2))
            chunks.append(_envelope(anchor, intro))
    # Per-H2.
    for i, m in enumerate(matches):
        if m.group(1).count("#") < 2:
            continue
        start = m.end(2) + 1
        end = matches[i + 1].start(0) if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if not body:
            continue
        anchor = slugify(m.group(2))
        chunks.append(_envelope(anchor, body))
    return chunks


def _prime_memory_index(
    seed_root: str,
    tenant_workspace: str,
    slug: str,
    memory_db_path: str,
    refit_idf: bool = True,
) -> MemorySeed:
    """Prime the 0.4 memory index for ``slug``.

    Delegates to :func:`agents.workspace_materialize.memory_seed.bulk_seed`
    which INSERTs every fact + embedding + audit row inside a single
    transaction. This collapses the per-fact ``BEGIN ... COMMIT`` cost
    of ``MemoryStore.write`` (≈ 65 fsyncs for a 50-file seed) into
    one fsync, which is what makes the FORA-409 acceptance bar
    of <60s achievable on a developer laptop.

    Walks the *tenant* workspace (the freshly materialized copy, not
    the seed) so a future per-tenant override file is honored.
    """
    # Lazy import: only fail if the user actually asks to prime the
    # memory index. Keeps the file-copy CLI usable in environments
    # that haven't built sqlite-vec yet.
    from agents.memory_mcp.store import MemoryStore  # type: ignore
    from .memory_seed import bulk_seed

    store = MemoryStore(db_path=memory_db_path)
    return bulk_seed(
        tenant_workspace=tenant_workspace,
        slug=slug,
        memory_db_path=memory_db_path,
        store=store,
        refit_idf=refit_idf,
    )


# ---------------------------------------------------------------------------
# Top-level entry point
# ---------------------------------------------------------------------------


def materialize(
    slug: str,
    *,
    seed_root: Optional[str] = None,
    tenants_root: Optional[str] = None,
    memory_db_path: Optional[str] = None,
    prime_memory: bool = True,
    refit_idf: bool = True,
) -> MaterializeResult:
    """Materialize a tenant workspace.

    Args:
        slug: The tenant slug (validated).
        seed_root: The seed workspace root. Default: ``./workspace``.
        tenants_root: The tenants root. Default: ``./tenants``.
        memory_db_path: SQLite file for the 0.4 memory index. Default:
            ``./var/memory.db``. Ignored if ``prime_memory=False``.
        prime_memory: If True (default), prime the 0.4 memory index
            for the new tenant.
        refit_idf: Refit the IDF table after seeding (default True).

    Returns:
        A ``MaterializeResult`` with per-file copies, byte totals,
        and the memory prime summary.

    Raises:
        MaterializeError: bad slug, missing seed, partial write, etc.
    """
    slug = validate_slug(slug)
    seed_root = seed_root or os.path.join(ROOT, "workspace")
    tenants_root = tenants_root or os.path.join(ROOT, "tenants")
    tenant_dir = os.path.join(tenants_root, slug)
    tenant_workspace = os.path.join(tenant_dir, "workspace")

    if not os.path.isdir(seed_root):
        raise MaterializeError(f"seed workspace not found: {seed_root}")
    os.makedirs(tenants_root, exist_ok=True)
    os.makedirs(tenant_dir, exist_ok=True)

    t0 = time.monotonic()
    copies, total_bytes, copy_ms = _copy_seed_to_tenant(seed_root, tenant_workspace, slug)
    memory: Optional[MemorySeed] = None
    if prime_memory:
        db = memory_db_path or os.environ.get(
            "FORA_MEMORY_DB", os.path.join(ROOT, "var", "memory.db")
        )
        os.makedirs(os.path.dirname(db), exist_ok=True)
        memory = _prime_memory_index(seed_root, tenant_workspace, slug, db, refit_idf=refit_idf)
    return MaterializeResult(
        slug=slug,
        workspace_root=seed_root,
        tenant_workspace=tenant_workspace,
        files=copies,
        total_bytes=total_bytes,
        copy_ms=copy_ms,
        memory=memory,
        duration_ms=(time.monotonic() - t0) * 1000.0,
    )


def write_audit_row(result: MaterializeResult, audit_path: str) -> None:
    """Append one JSONL row to the materializer audit log.

    The row carries the slug, the file count, the byte total, the
    copy + memory timing, the materializer version, and the actor
    (the calling agent — e.g. ``identity-broker`` on cold-start).
    """
    os.makedirs(os.path.dirname(audit_path), exist_ok=True)
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        "actor": "workspace-materializer",
        "operation": "materialize",
        "slug": result.slug,
        "tenant_workspace": os.path.relpath(result.tenant_workspace, ROOT),
        "file_count": len(result.files),
        "total_bytes": result.total_bytes,
        "copy_ms": round(result.copy_ms, 3),
        "memory": None
        if result.memory is None
        else {
            "chunks": result.memory.chunks,
            "written": result.memory.written,
            "updated": result.memory.updated,
            "duration_ms": round(result.memory.duration_ms, 3),
            "db_path": os.path.relpath(result.memory.db_path, ROOT),
        },
        "duration_ms": round(result.duration_ms, 3),
        "materializer_version": result.materializer_version,
    }
    with open(audit_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")
