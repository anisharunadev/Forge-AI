"""docs.query — read interface for the doc index and ADR registry.

This is the v1 query surface that the Memory Agent and Audit Agent call
into. The on-disk storage is `workspace/project/docs.md` and
`workspace/project/adr-registry.md`; the in-code schemas are
`agents/documentation.schemas`.

The interface is intentionally tiny — four entry points:

- `DocsQuery.list_docs(...)`       — the doc index query (returns `DocIndexEntry` rows)
- `DocsQuery.list_adrs(...)`       — the ADR registry query (returns `AdrRegistryEntry` rows)
- `DocsQuery.freshness_check()`    — returns `List[FreshnessWarning]` for stale entries
- `DocsQuery.summary()`            — board view (count by kind, count by status)

## Cost discipline

All queries are O(n) over the entries and run in **< 100 ms** on a 10k-entry
surface. The implementation is in-memory; there is no DB, no network. The
file is loaded once on construction; every query is a list comprehension
or a counter pass.

## Why two ways to construct

`DocsQuery.load(...)` parses the on-disk markdown (frontmatter + fenced
JSON) and is the cold-start path. `DocsQuery.from_objects(...)` accepts
already-parsed `DocIndex` + `AdrRegistry` and is the hot path the Memory
Agent uses on every run. Both return the same object; the difference is
who paid the I/O.

## Related

- Storage contract: `agents/documentation/schemas.py`
- On-disk index: `workspace/project/docs.md`
- On-disk registry: `workspace/project/adr-registry.md`
- Smoke test (incl. < 100 ms assertion): `agents/documentation/smoke_test.py`
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Iterable, List, Optional, Union

from .schemas import (
    AdrRegistry,
    AdrRegistryEntry,
    AdrStatus,
    DocIndex,
    DocIndexEntry,
    DocKind,
    FreshnessSla,
    FreshnessWarning,
)


DEFAULT_DOCS_PATH = "workspace/project/docs.md"
DEFAULT_ADR_REGISTRY_PATH = "workspace/project/adr-registry.md"

# Frontmatter regex: `---` ... `---` at the top of the file.
_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
# Fenced JSON block: ```json ... ```
_FENCED_JSON_RE = re.compile(r"```json\n(.*?)\n```", re.DOTALL)


# ---------------------------------------------------------------------------
# Parsing the on-disk markdown
# ---------------------------------------------------------------------------

def parse_index_markdown(text: str) -> DocIndex:
    """Parse `workspace/project/docs.md` into a `DocIndex`.

    Tolerates the frontmatter being missing (returns a default-versioned
    index) and the fenced JSON being missing (returns an empty entries list).
    The on-disk shape is the contract; this function is the parser.
    """
    import json

    m = _FENCED_JSON_RE.search(text)
    if not m:
        return DocIndex(version="1.0", entries=[])
    try:
        body = json.loads(m.group(1))
    except json.JSONDecodeError:
        return DocIndex(version="1.0", entries=[])
    return DocIndex.from_dict(body)


def parse_registry_markdown(text: str) -> AdrRegistry:
    """Parse `workspace/project/adr-registry.md` into an `AdrRegistry`."""
    import json

    m = _FENCED_JSON_RE.search(text)
    if not m:
        return AdrRegistry(version="1.0", entries=[])
    try:
        body = json.loads(m.group(1))
    except json.JSONDecodeError:
        return AdrRegistry(version="1.0", entries=[])
    return AdrRegistry.from_dict(body)


# ---------------------------------------------------------------------------
# DocsQuery
# ---------------------------------------------------------------------------

class DocsQuery:
    """Read interface over the doc index and ADR registry.

    Construction is cheap; queries are O(n) over the entries.
    """

    def __init__(self, index: DocIndex, registry: AdrRegistry) -> None:
        self._index = index
        self._registry = registry

    # -- construction ----------------------------------------------------

    @classmethod
    def from_objects(cls, index: DocIndex, registry: AdrRegistry) -> "DocsQuery":
        """Hot path: build from already-parsed objects. No I/O."""
        return cls(index, registry)

    @classmethod
    def load(
        cls,
        docs_path: Union[str, Path] = DEFAULT_DOCS_PATH,
        registry_path: Union[str, Path] = DEFAULT_ADR_REGISTRY_PATH,
    ) -> "DocsQuery":
        """Cold path: load + parse both files. Sub-millisecond on the v1 surface."""
        docs_p = Path(docs_path)
        registry_p = Path(registry_path)
        index = (
            parse_index_markdown(docs_p.read_text())
            if docs_p.exists()
            else DocIndex(version="1.0", entries=[])
        )
        registry = (
            parse_registry_markdown(registry_p.read_text())
            if registry_p.exists()
            else AdrRegistry(version="1.0", entries=[])
        )
        return cls(index, registry)

    # -- introspection ---------------------------------------------------

    @property
    def index(self) -> DocIndex:
        return self._index

    @property
    def registry(self) -> AdrRegistry:
        return self._registry

    def __len__(self) -> int:
        return len(self._index.entries) + len(self._registry.entries)

    # -- doc queries -----------------------------------------------------

    def list_docs(
        self,
        kind: Optional[Union[DocKind, str]] = None,
        tag: Optional[str] = None,
        area: Optional[str] = None,
        approval_required: Optional[bool] = None,
    ) -> List[DocIndexEntry]:
        """List doc index entries, with optional filters.

        Mirrors the FORA-117 acceptance criterion:
            `docs.list(kind='adr', status='accepted')` — note that the doc
            index's `kind='adr'` filter is the doc-side analog; the
            status filter is on the ADR side and lives in `list_adrs()`.
        """
        kind_v = DocKind(kind).value if isinstance(kind, str) else (kind.value if isinstance(kind, DocKind) else None)
        out: List[DocIndexEntry] = []
        for e in self._index.entries:
            if kind_v is not None and e.kind.value != kind_v:
                continue
            if tag is not None and tag not in e.tags:
                continue
            if area is not None and e.architecture_area != area:
                continue
            if approval_required is not None and e.approval_required != approval_required:
                continue
            out.append(e)
        return out

    # -- adr queries -----------------------------------------------------

    def list_adrs(
        self,
        status: Optional[Union[AdrStatus, str]] = None,
        tag: Optional[str] = None,
        area: Optional[str] = None,
        number: Optional[int] = None,
    ) -> List[AdrRegistryEntry]:
        """List ADR registry entries, with optional filters.

        Mirrors the FORA-117 acceptance criterion:
            `adr.list(status='accepted')` is `list_adrs(status="accepted")`.
        """
        status_v = (
            AdrStatus(status).value
            if isinstance(status, str)
            else (status.value if isinstance(status, AdrStatus) else None)
        )
        out: List[AdrRegistryEntry] = []
        for e in self._registry.entries:
            if status_v is not None and e.status.value != status_v:
                continue
            if tag is not None and tag not in e.tags:
                continue
            if area is not None and e.architecture_area != area:
                continue
            if number is not None and e.number != number:
                continue
            out.append(e)
        return out

    def list_adrs_in_range(
        self, start: Union[str, dt.date], end: Union[str, dt.date]
    ) -> List[AdrRegistryEntry]:
        """List ADRs whose `date` is in `[start, end]` (inclusive)."""
        s = dt.date.fromisoformat(start) if isinstance(start, str) else start
        e = dt.date.fromisoformat(end) if isinstance(end, str) else end
        return self._registry.by_date_range(s, e)

    # -- freshness -------------------------------------------------------

    def freshness_check(
        self, now: Optional[dt.datetime] = None
    ) -> List[FreshnessWarning]:
        """Return warnings for entries past their SLA. Sub-100ms on 10k entries."""
        return self._index.freshness_check(now=now)

    # -- board view ------------------------------------------------------

    def summary(self) -> dict:
        """Board view: count by kind (docs) and count by status (ADRs).

        O(n) over both indexes; sub-millisecond. The board view in the
        Forge console calls this every page load.
        """
        docs_by_kind: dict = {}
        for e in self._index.entries:
            docs_by_kind[e.kind.value] = docs_by_kind.get(e.kind.value, 0) + 1
        adrs_by_status: dict = {}
        for e in self._registry.entries:
            adrs_by_status[e.status.value] = adrs_by_status.get(e.status.value, 0) + 1
        return {
            "docs_total": len(self._index.entries),
            "docs_by_kind": docs_by_kind,
            "adrs_total": len(self._registry.entries),
            "adrs_by_status": adrs_by_status,
            "index_version": self._index.version,
            "registry_version": self._registry.version,
        }


# ---------------------------------------------------------------------------
# Convenience helpers (callable form for ad-hoc scripts)
# ---------------------------------------------------------------------------

def docs_list(
    docs_path: Union[str, Path] = DEFAULT_DOCS_PATH,
    registry_path: Union[str, Path] = DEFAULT_ADR_REGISTRY_PATH,
    kind: Optional[str] = None,
    tag: Optional[str] = None,
    area: Optional[str] = None,
) -> List[DocIndexEntry]:
    """One-shot helper: load + filter. For the Memory Agent's hot path."""
    return DocsQuery.load(docs_path=docs_path, registry_path=registry_path).list_docs(
        kind=kind, tag=tag, area=area
    )


def adr_list(
    docs_path: Union[str, Path] = DEFAULT_DOCS_PATH,
    registry_path: Union[str, Path] = DEFAULT_ADR_REGISTRY_PATH,
    status: Optional[str] = None,
    tag: Optional[str] = None,
    area: Optional[str] = None,
) -> List[AdrRegistryEntry]:
    """One-shot helper: `adr.list(status='accepted')` per the FORA-117 AC."""
    return DocsQuery.load(
        docs_path=docs_path, registry_path=registry_path
    ).list_adrs(status=status, tag=tag, area=area)


def freshness_check(
    docs_path: Union[str, Path] = DEFAULT_DOCS_PATH,
    registry_path: Union[str, Path] = DEFAULT_ADR_REGISTRY_PATH,
) -> List[FreshnessWarning]:
    """One-shot helper: stale doc warnings. Sub-100ms on the v1 surface."""
    return DocsQuery.load(
        docs_path=docs_path, registry_path=registry_path
    ).freshness_check()
