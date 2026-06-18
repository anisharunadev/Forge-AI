"""Seed corpus loader for the v1 dev Memory service.

Scans ``workspace/memory/*.md``, ``workspace/customer/*.md``, and
``workspace/project/*.md`` and produces one fact per H2 (##) heading.
The source path is preserved on the fact so citations point back to
the human-edited constitution (ADR-0002 §9).

The file-level mapping to namespaces is:

    workspace/memory/*.md      -> namespace='memory', scope='global'
    workspace/customer/*.md    -> namespace='customer', scope='global'
    workspace/project/*.md     -> namespace='project', scope='global'

For a single-tenant v1 dev run we use the literal scope 'global'; a
multi-tenant cold-start uses the caller-supplied tenant_id and the
scopes 'customer:<id>' and 'project:<id>' respectively. The Memory
service still has to dedupe across the global org rules when a fresh
tenant asks for 'codebase' (which is its own namespace; not seeded).
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple


# Default kind heuristic: every heading chunk is a "rule" by default;
# the seeder lets the caller override per-file. (ADR-0002 §3.2 says
# `kind` is one of rule/pattern/gotcha/reference/decision/fact.)
DEFAULT_KIND = "rule"


@dataclass
class SeedChunk:
    """One chunked fact ready to be written through MemoryStore.write."""

    file_path: str
    heading: str
    anchor: str
    content: str
    namespace: str
    scope: str
    kind: str
    tags: List[str]
    source: Dict[str, Any]
    redaction_class: str
    ttl_policy: str
    half_life_days: Optional[int]
    fact_id: str  # deterministic so re-seeding is idempotent.


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$", re.MULTILINE)


def _slugify(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", text.strip().lower()).strip("-")
    return s or "section"


def _stable_fact_id(namespace: str, scope: str, file_path: str, anchor: str) -> str:
    h = hashlib.sha256(f"{namespace}|{scope}|{file_path}|{anchor}".encode("utf-8")).hexdigest()
    # Format as a UUID-shaped string for downstream Postgres parity.
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def _file_namespace(rel: str) -> str:
    parts = rel.split(os.sep)
    if not parts:
        return "memory"
    if parts[0] == "memory":
        return "memory"
    if parts[0] == "customer":
        return "customer"
    if parts[0] == "project":
        return "project"
    return "memory"


def _file_scope(rel: str, tenant_id: Optional[str]) -> str:
    ns = _file_namespace(rel)
    if ns == "memory":
        return "global"
    if tenant_id:
        return tenant_id
    return "global"


def _file_kind(rel: str) -> str:
    """Map a file to a default kind. Most constitution files are
    'rule'; the glossary is 'reference'; the PRD is 'reference';
    the roadmap is 'decision'; the tech-stack is 'reference'."""
    name = os.path.basename(rel).lower()
    if name == "glossary.md":
        return "reference"
    if name == "prd.md":
        return "reference"
    if name == "roadmap.md":
        return "decision"
    if name == "tech-stack.md":
        return "reference"
    return DEFAULT_KIND


def _file_tags(rel: str) -> List[str]:
    return [os.path.basename(rel).replace(".md", ""), _file_namespace(rel)]


def _file_redaction(rel: str) -> str:
    # Customer / project files are public-internal; they are not redacted.
    # Real customer-private secrets would land in the Audit agent's redact
    # pass; this is a no-op in v1 dev.
    return "none"


def _file_ttl(rel: str) -> Tuple[str, Optional[int]]:
    # Constitution files are 'epoch' in spirit. ADR-0002 §6.1 says epoch
    # requires manual forget; we mirror that by giving the seeder epoch.
    if _file_namespace(rel) == "memory":
        return "epoch", None
    if _file_namespace(rel) == "project":
        return "sliding", 90
    return "sliding", 60


def chunk_markdown_file(
    file_path: str,
    workspace_root: str,
    *,
    tenant_id: Optional[str] = None,
    written_by: str = "seed",
) -> List[SeedChunk]:
    """Read a markdown file and split on H2 (##) headings.

    The first heading is the file's H1; we use it as the namespace
    label but the per-section content starts from the first H2.
    """
    with open(file_path, "r", encoding="utf-8") as fh:
        text = fh.read()
    rel = os.path.relpath(file_path, workspace_root)
    namespace = _file_namespace(rel)
    scope = _file_scope(rel, tenant_id)
    kind = _file_kind(rel)
    tags = _file_tags(rel)
    redaction = _file_redaction(rel)
    ttl_policy, half_life = _file_ttl(rel)

    # Find all headings. The first H1 becomes the document title; we
    # use it as a section anchor for the body before the first H2.
    matches = list(_HEADING_RE.finditer(text))
    chunks: List[SeedChunk] = []

    if not matches:
        # Whole file as one chunk.
        anchor = _slugify(os.path.basename(file_path))
        chunks.append(SeedChunk(
            file_path=rel,
            heading=os.path.basename(file_path),
            anchor=anchor,
            content=text.strip(),
            namespace=namespace,
            scope=scope,
            kind=kind,
            tags=tags,
            source={"type": "workspace", "ref": rel, "anchor": anchor},
            redaction_class=redaction,
            ttl_policy=ttl_policy,
            half_life_days=half_life,
            fact_id=_stable_fact_id(namespace, scope, rel, anchor),
        ))
        return chunks

    # Pre-heading intro (between H1 and first H2) becomes its own chunk.
    first = matches[0]
    if first.start(1) - first.start(0) > 0:
        intro = text[: first.start(0)].strip()
        if intro:
            anchor = _slugify(first.group(2))
            chunks.append(SeedChunk(
                file_path=rel,
                heading=first.group(2).strip(),
                anchor=anchor,
                content=intro,
                namespace=namespace,
                scope=scope,
                kind=kind,
                tags=tags,
                source={"type": "workspace", "ref": rel, "anchor": anchor},
                redaction_class=redaction,
                ttl_policy=ttl_policy,
                half_life_days=half_life,
                fact_id=_stable_fact_id(namespace, scope, rel, anchor),
            ))

    # Per-H2 (or lower) section.
    for i, m in enumerate(matches):
        if m.group(1).count("#") < 2:
            continue
        start = m.end(2) + 1  # skip the heading line
        end = matches[i + 1].start(0) if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if not body:
            continue
        anchor = _slugify(m.group(2))
        chunks.append(SeedChunk(
            file_path=rel,
            heading=m.group(2).strip(),
            anchor=anchor,
            content=body,
            namespace=namespace,
            scope=scope,
            kind=kind,
            tags=tags,
            source={"type": "workspace", "ref": rel, "anchor": anchor},
            redaction_class=redaction,
            ttl_policy=ttl_policy,
            half_life_days=half_life,
            fact_id=_stable_fact_id(namespace, scope, rel, anchor),
        ))
    return chunks


def scan_workspace(workspace_root: str) -> List[str]:
    """Return the list of markdown files in the seed directories."""
    out: List[str] = []
    for sub in ("memory", "customer", "project"):
        d = os.path.join(workspace_root, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if name.endswith(".md"):
                out.append(os.path.join(d, name))
    return out


def seed_workspace(
    workspace_root: str,
    *,
    tenant_id: Optional[str] = None,
    written_by: str = "seed",
) -> List[SeedChunk]:
    """Return all seed chunks across the workspace's three directories."""
    out: List[SeedChunk] = []
    for f in scan_workspace(workspace_root):
        out.extend(chunk_markdown_file(f, workspace_root, tenant_id=tenant_id, written_by=written_by))
    return out


def stage_files_for(stage: str) -> List[str]:
    """Convenience: list the workspace-relative files the given stage should load.

    Mirrors [workspace/README.md §2] but is the runtime lookup so a
    caller does not have to re-implement the table.
    """
    from .injection import get_stage
    return list(get_stage(stage).get("files", []))
