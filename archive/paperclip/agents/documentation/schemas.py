"""Schemas for the Documentation Agent's input and output.

These are the contract every generator (README, CHANGELOG, ADR, API, Release
Notes) emits. The schemas live next to the agent so the prompt, smoke
test, and contract stay in sync.

Field names match the doc-generation spec in
[FORA-81 §"Agent contract"](/FORA/issues/FORA-81#document-doc-generation-spec).

The **storage contract** (DocIndex / AdrRegistry / Freshness SLA) is the v1
surface that the generators (FORA-119, FORA-120, FORA-121, FORA-122) write to
and that the Memory Agent (FORA-23 §0.1.3) and Audit Agent (FORA-23 §0.1.4)
read from. See `workspace/project/docs.md` and
`workspace/project/adr-registry.md` for the on-disk layout.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class GeneratorType(str, Enum):
    README = "readme"
    API_DOCS = "api_docs"
    CHANGELOG = "changelog"
    RELEASE_NOTES = "release_notes"
    ADR = "adr"


class RunStatus(str, Enum):
    OK = "ok"
    BLOCKED_PENDING_APPROVAL = "blocked_pending_approval"
    ABORTED = "aborted"


class ErrorKind(str, Enum):
    MISSING_INPUT_SHA = "MISSING_INPUT_SHA"
    OVERSIZED_DIFF = "OVERSIZED_DIFF"
    AMBIGUOUS_CONVENTIONAL_COMMIT = "AMBIGUOUS_CONVENTIONAL_COMMIT"
    MODEL_TIMEOUT = "MODEL_TIMEOUT"
    PARTIAL_KNOWLEDGE_LAYER_WRITE = "PARTIAL_KNOWLEDGE_LAYER_WRITE"
    INVALID_REPO_METADATA = "INVALID_REPO_METADATA"
    STORAGE_CONTRACT_MISSING = "STORAGE_CONTRACT_MISSING"


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@dataclass
class RepoMetadata:
    owner: str
    name: str
    default_branch: str
    license: str


@dataclass
class ConventionalCommit:
    sha: str
    message: str
    author: str
    timestamp: str
    parsed_type: Optional[str] = None        # "feat" | "fix" | "chore" | ...
    parsed_scope: Optional[str] = None
    breaking: bool = False
    is_ambiguous: bool = False               # True if conventional-parse failed


@dataclass
class CommitRange:
    from_sha: str
    to_sha: str
    conventional_commits: List[ConventionalCommit] = field(default_factory=list)


@dataclass
class MemorySnapshot:
    project_memory_sha: str
    customer_memory_sha: str
    docs_index_sha: str
    adr_registry_sha: str


@dataclass
class DocGenInput:
    """The full input the agent runs against."""
    input_sha: Optional[str]                 # REQUIRED by spec; None triggers MISSING_INPUT_SHA
    repo: RepoMetadata
    commit_range: CommitRange
    memory_snapshot: MemorySnapshot
    requested_artifacts: List[GeneratorType] = field(default_factory=list)
    cost_envelope: Dict[str, int] = field(default_factory=lambda: {
        "per_run_tokens_in": 100_000,
        "per_run_tokens_out": 30_000,
    })
    model: str = "claude-sonnet-4-6"
    fallback_model: str = "gemini-2.5-pro"
    timeout_ms: int = 30_000

    def validate(self) -> List[str]:
        """Return a list of human-readable error strings; [] means valid."""
        errors: List[str] = []
        if not self.input_sha:
            errors.append("input_sha is required (spec: determinism + source attribution)")
        if not self.repo.owner or not self.repo.name:
            errors.append("repo.owner and repo.name are required")
        if self.commit_range.from_sha == self.commit_range.to_sha:
            errors.append("commit_range.from_sha == to_sha; nothing to document")
        if not self.requested_artifacts:
            errors.append("requested_artifacts is empty; nothing to do")
        if not self.memory_snapshot.docs_index_sha:
            errors.append("memory_snapshot.docs_index_sha is required for doc index freshness")
        return errors


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

@dataclass
class DocArtifact:
    path: str                                # e.g., "README.md", "docs/adr/0042-use-postgres.md"
    content: str
    content_sha: str
    freshness_timestamp: str                 # ISO 8601 — REQUIRED
    source_sha: str                          # commit SHA the artifact was derived from — REQUIRED
    generator_type: GeneratorType
    approval_required: bool = False          # True for new ADR, README rewrite, breaking notes

    def validate(self) -> List[str]:
        errors: List[str] = []
        if not self.freshness_timestamp:
            errors.append(f"{self.path}: freshness_timestamp is required (spec: source attribution)")
        if not self.source_sha:
            errors.append(f"{self.path}: source_sha is required (spec: source attribution)")
        return errors


@dataclass
class AdrRef:
    """Pointer to a newly created ADR in the registry."""
    number: int
    title: str
    path: str                                # e.g., "docs/adr/0042-use-postgres.md"
    status: str                              # "proposed" | "accepted" | "superseded"


@dataclass
class FreshnessMetadata:
    docs_index_sha: str
    generated_at: str
    oldest_artifact_source_sha: str
    newest_artifact_source_sha: str


@dataclass
class CostRecord:
    prompt_hash: str
    model: str
    tokens_in: int
    tokens_out: int
    usd: float
    duration_ms: int
    fallback_used: bool = False


@dataclass
class DocGenError:
    kind: ErrorKind
    message: str
    recoverable: bool
    retry_after_seconds: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DocGenOutput:
    run_id: str
    input_sha: str
    status: RunStatus
    artifacts: List[DocArtifact] = field(default_factory=list)
    adr_index: List[AdrRef] = field(default_factory=list)
    freshness_metadata: Optional[FreshnessMetadata] = None
    cost_record: Optional[CostRecord] = None
    errors: List[DocGenError] = field(default_factory=list)
    # Storage contract (FORA-117): the on-disk doc index and ADR registry
    # that this run wrote or refreshed. Memory Agent reads from these.
    doc_index: Optional["DocIndex"] = None
    adr_registry: Optional["AdrRegistry"] = None
    freshness_warnings: List["FreshnessWarning"] = field(default_factory=list)

    def validate(self) -> List[str]:
        errors: List[str] = []
        for a in self.artifacts:
            errors.extend(a.validate())
        if self.status == RunStatus.OK:
            if not self.cost_record:
                errors.append("status=ok requires cost_record (Audit Agent contract)")
            if not self.freshness_metadata:
                errors.append("status=ok requires freshness_metadata")
            # Storage contract (FORA-117): status=ok requires a doc_index
            # and an adr_registry; partial writes are a DocGenError.
            if self.doc_index is None:
                errors.append("status=ok requires doc_index (FORA-117 storage contract)")
            if self.adr_registry is None:
                errors.append("status=ok requires adr_registry (FORA-117 storage contract)")
        return errors

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        d["artifacts"] = [
            {**asdict(a), "generator_type": a.generator_type.value}
            for a in self.artifacts
        ]
        d["errors"] = [e.to_dict() for e in self.errors]
        if self.doc_index is not None:
            d["doc_index"] = self.doc_index.to_dict()
        else:
            d["doc_index"] = None
        if self.adr_registry is not None:
            d["adr_registry"] = self.adr_registry.to_dict()
        else:
            d["adr_registry"] = None
        d["freshness_warnings"] = [w.to_dict() for w in self.freshness_warnings]
        return d


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Storage contract — FORA-117 (7.1.6)
# ---------------------------------------------------------------------------
# This is the v1 knowledge-layer surface that the doc generators
# (FORA-119, FORA-120, FORA-121, FORA-122) write to and that the Memory
# Agent and Audit Agent read from. The on-disk layout lives in
# `workspace/project/docs.md` and `workspace/project/adr-registry.md`.
#
# Idempotency contract: same `input_sha` + `source_sha` + `content_sha`
# produces a byte-identical `DocIndexEntry`. The Memory Agent re-derives
# the index on every doc-generation run, so a re-run is a no-op.

class DocKind(str, Enum):
    """The kinds of artifacts the agent owns.

    Mirrors `GeneratorType` 1:1; split so the *write* surface (storage) and
    the *run* surface (input) can evolve independently.
    """

    README = "readme"
    API_DOCS = "api_docs"
    CHANGELOG = "changelog"
    RELEASE_NOTES = "release_notes"
    ADR = "adr"


class AdrStatus(str, Enum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    SUPERSEDED = "superseded"
    DEPRECATED = "deprecated"


class FreshnessSlaKind(str, Enum):
    """How often a doc kind must be re-generated.

    Values map to a delta in the customer's release cadence.
    """

    EVERY_RELEASE = "every_release"   # README, CHANGELOG, Release Notes
    EVERY_MERGE = "every_merge"       # API docs
    ONCE = "once"                     # ADR (one entry per decision)


@dataclass
class FreshnessSla:
    """Per-kind freshness contract.

    - `kind` — the doc kind.
    - `cadence` — when it must be regenerated.
    - `max_age_seconds` — concrete budget. Stale = now - lastGeneratedAt > budget.
    - `warn_only` — True means a stale doc emits a warning through the
      knowledge layer but does not block the release stage. False means
      stale blocks.
    """

    kind: DocKind
    cadence: FreshnessSlaKind
    max_age_seconds: int
    warn_only: bool = True

    @classmethod
    def defaults(cls) -> Dict[DocKind, "FreshnessSla"]:
        """Default SLAs (FORA-117 acceptance: README 1 release, API every merge,
        ADR once, CHANGELOG every release)."""
        return {
            DocKind.README:       cls(DocKind.README,       FreshnessSlaKind.EVERY_RELEASE, 7 * 24 * 3600,  warn_only=True),
            DocKind.CHANGELOG:    cls(DocKind.CHANGELOG,    FreshnessSlaKind.EVERY_RELEASE, 7 * 24 * 3600,  warn_only=True),
            DocKind.RELEASE_NOTES: cls(DocKind.RELEASE_NOTES, FreshnessSlaKind.EVERY_RELEASE, 30 * 24 * 3600, warn_only=True),
            DocKind.API_DOCS:     cls(DocKind.API_DOCS,     FreshnessSlaKind.EVERY_MERGE,   24 * 3600,      warn_only=False),
            DocKind.ADR:          cls(DocKind.ADR,          FreshnessSlaKind.ONCE,          365 * 24 * 3600, warn_only=True),
        }


@dataclass
class DocIndexEntry:
    """One row of the doc index. The on-disk shape is the same fields, JSON.

    The generators write one entry per artifact on every run. The Memory
    Agent re-derives the index from the artifacts on disk; the index file
    is the query surface, not the source of truth.
    """

    path: str                                # e.g., "README.md", "docs/adr/0042-use-postgres.md"
    kind: DocKind
    title: str
    last_generated_at: str                   # ISO 8601 UTC
    source_commit: str                       # git SHA the artifact was derived from
    generator: str                           # the generator that produced it (matches GeneratorType)
    version: str                             # storage schema version, e.g., "1.0"
    content_sha: str = ""                    # optional: cached sha from DocArtifact
    approval_required: bool = False
    tags: List[str] = field(default_factory=list)
    architecture_area: Optional[str] = None  # e.g., "knowledge-layer", "iam", "secrets"

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["kind"] = self.kind.value
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DocIndexEntry":
        d = dict(d)
        d["kind"] = DocKind(d["kind"])
        return cls(**d)


@dataclass
class AdrRegistryEntry:
    """One row of the ADR registry. Mirrors `docs/adr/NNNN-*.md`."""

    number: int
    title: str
    path: str                                # "docs/adr/NNNN-slug.md"
    status: AdrStatus
    date: str                                # ISO date the ADR was opened
    architecture_area: str                   # e.g., "knowledge-layer"
    tags: List[str] = field(default_factory=list)
    supersedes: Optional[int] = None
    superseded_by: Optional[int] = None
    source_commit: str = ""                  # git SHA the ADR was committed at
    last_generated_at: str = ""              # ISO 8601 UTC, refreshed on every doc run that touches ADRs

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AdrRegistryEntry":
        d = dict(d)
        d["status"] = AdrStatus(d["status"])
        return cls(**d)


@dataclass
class FreshnessWarning:
    """Emitted by `docs.freshness_check` when an entry is past its SLA."""

    path: str
    kind: DocKind
    last_generated_at: str
    age_seconds: int
    max_age_seconds: int
    message: str
    blocks_release: bool

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["kind"] = self.kind.value
        return d


@dataclass
class DocIndex:
    """The full doc index — a typed list of `DocIndexEntry` with metadata.

    Serialized to `workspace/project/docs.md` (frontmatter + JSON body).
    """

    version: str
    entries: List[DocIndexEntry] = field(default_factory=list)
    generated_at: str = field(default_factory=now_iso)
    docs_index_sha: str = ""                 # set by the memory layer after write

    def by_kind(self, kind: DocKind) -> List[DocIndexEntry]:
        return [e for e in self.entries if e.kind == kind]

    def by_path(self, path: str) -> Optional[DocIndexEntry]:
        for e in self.entries:
            if e.path == path:
                return e
        return None

    def freshness_check(self, now: Optional[dt.datetime] = None) -> List[FreshnessWarning]:
        """Return warnings for entries past their SLA.

        Pure function (no I/O). Sub-100ms on the typical doc surface
        (≤ 10k entries) — verified by the smoke test.
        """
        now = now or dt.datetime.now(dt.timezone.utc)
        slas = FreshnessSla.defaults()
        warnings: List[FreshnessWarning] = []
        for e in self.entries:
            sla = slas.get(e.kind)
            if sla is None:
                continue
            try:
                ts = dt.datetime.fromisoformat(e.last_generated_at)
            except ValueError:
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=dt.timezone.utc)
            age = int((now - ts).total_seconds())
            if age > sla.max_age_seconds:
                msg = (
                    f"{e.path} ({e.kind.value}) is {age}s old, "
                    f"SLA {sla.max_age_seconds}s ({sla.cadence.value})"
                )
                warnings.append(FreshnessWarning(
                    path=e.path,
                    kind=e.kind,
                    last_generated_at=e.last_generated_at,
                    age_seconds=age,
                    max_age_seconds=sla.max_age_seconds,
                    message=msg,
                    blocks_release=not sla.warn_only,
                ))
        return warnings

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "generated_at": self.generated_at,
            "docs_index_sha": self.docs_index_sha,
            "entries": [e.to_dict() for e in self.entries],
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DocIndex":
        return cls(
            version=d["version"],
            generated_at=d.get("generated_at", now_iso()),
            docs_index_sha=d.get("docs_index_sha", ""),
            entries=[DocIndexEntry.from_dict(e) for e in d.get("entries", [])],
        )


@dataclass
class AdrRegistry:
    """The full ADR registry — a typed list of `AdrRegistryEntry`."""

    version: str
    entries: List[AdrRegistryEntry] = field(default_factory=list)
    generated_at: str = field(default_factory=now_iso)
    adr_registry_sha: str = ""

    def by_status(self, status: AdrStatus) -> List[AdrRegistryEntry]:
        return [e for e in self.entries if e.status == status]

    def by_tag(self, tag: str) -> List[AdrRegistryEntry]:
        return [e for e in self.entries if tag in e.tags]

    def by_area(self, area: str) -> List[AdrRegistryEntry]:
        return [e for e in self.entries if e.architecture_area == area]

    def by_date_range(self, start: dt.date, end: dt.date) -> List[AdrRegistryEntry]:
        out: List[AdrRegistryEntry] = []
        for e in self.entries:
            try:
                d = dt.date.fromisoformat(e.date)
            except ValueError:
                continue
            if start <= d <= end:
                out.append(e)
        return out

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "generated_at": self.generated_at,
            "adr_registry_sha": self.adr_registry_sha,
            "entries": [e.to_dict() for e in self.entries],
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AdrRegistry":
        return cls(
            version=d["version"],
            generated_at=d.get("generated_at", now_iso()),
            adr_registry_sha=d.get("adr_registry_sha", ""),
            entries=[AdrRegistryEntry.from_dict(e) for e in d.get("entries", [])],
        )
