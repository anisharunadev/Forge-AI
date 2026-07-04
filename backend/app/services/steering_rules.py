"""Steering Rules Engine (F-504).

Auto-discovers Markdown files under the workspace, parses their YAML
front-matter, and indexes them into Postgres so the agent runtime can
inject them as ``system_message`` fragments before each invocation.

Pipeline::

    workspace root
        │
        ▼
    [_discover_files]   (glob **/steering/*.md, **/.forge/steering.md,
        │                 **/AGENTS.md, **/CLAUDE.md)
        ▼
    [_parse_front_matter]   (extract rule_id, scope, applies_to_stages)
        │
        ▼
    [SteeringRuleCatalog]   (Pydantic, in-memory typed view)
        │
        ▼
    [_persist]   (UPSERT into `steering_rules`, RLS-scoped)
        │
        ▼
    [inject_into_context(agent_state)]   (returns dict[stage, markdown])


Watchdog
--------
A ``watchdog`` observer re-indexes on create/modify/delete. The observer
runs in a daemon thread owned by the singleton :data:`steering_engine`.
``start_watcher`` is idempotent and safe to call from app startup.

Configuration
-------------
* ``STEERING_FILE_PATTERNS`` (comma-separated glob) overrides defaults.
* ``STEERING_WATCH_ENABLED`` (bool, default ``True``) toggles the watcher.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping
from uuid import UUID, uuid4

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.steering_rule import SteeringRule
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.schemas.steering_rules import (
    STEERING_STAGES,
    InjectionResult,
    SteeringCatalog,
    SteeringDecision,
    SteeringRuleCreate,
    SteeringRuleRead,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_PATTERNS: tuple[str, ...] = (
    "**/steering/*.md",
    "**/.forge/steering.md",
    "**/AGENTS.md",
    "**/CLAUDE.md",
)

# YAML front-matter is fenced by --- ... --- at the very top of the file.
_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|$)", re.DOTALL)


# ---------------------------------------------------------------------------
# YAML front-matter parsing (minimal)
# ---------------------------------------------------------------------------
#
# Front-matter in steering rules uses a tiny subset of YAML — only scalar
# key: value pairs, simple lists, and inline [a, b] lists. We parse it
# inline to avoid pulling in PyYAML for a 30-line grammar. A future
# commit can swap this for `import yaml.safe_load` if rules grow richer.

def _strip_inline_comment(value: str) -> str:
    v = value.strip()
    if v.startswith("#"):
        return ""
    if " #" in v:
        v = v.split(" #", 1)[0].rstrip()
    return v


def _coerce_scalar(raw: str) -> Any:
    """Best-effort coerce a YAML-ish scalar to a Python value."""
    s = _strip_inline_comment(raw)
    if not s:
        return ""
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    low = s.lower()
    if low in {"true", "yes", "on"}:
        return True
    if low in {"false", "no", "off"}:
        return False
    if low in {"null", "~", ""}:
        return None
    return s


def _coerce_list(raw: str) -> list[Any]:
    """Parse a YAML-ish list — either `[a, b]` inline or `- a\n- b` block."""
    s = _strip_inline_comment(raw)
    if s.startswith("[") and s.endswith("]"):
        inner = s[1:-1]
        items: list[Any] = []
        for piece in _split_top_commas(inner):
            item = piece.strip()
            if not item:
                continue
            items.append(_coerce_scalar(item))
        return items
    # block-style fallback
    return [item for item in (line.strip() for line in s.splitlines()) if item]


def _split_top_commas(s: str) -> list[str]:
    out: list[str] = []
    depth = 0
    cur = []
    in_str: str | None = None
    for ch in s:
        if in_str:
            cur.append(ch)
            if ch == in_str:
                in_str = None
            continue
        if ch in {'"', "'"}:
            in_str = ch
            cur.append(ch)
            continue
        if ch in "[{(":
            depth += 1
            cur.append(ch)
            continue
        if ch in "]})":
            depth -= 1
            cur.append(ch)
            continue
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    if cur:
        out.append("".join(cur))
    return out


def parse_front_matter(text: str) -> tuple[dict[str, Any], str]:
    """Split ``text`` into ``(front_matter_dict, body_markdown)``.

    Returns an empty dict and the original text if the front-matter
    fence is missing or malformed; callers treat that as "no metadata".
    """
    if not text:
        return {}, ""
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    block = match.group(1)
    body = text[match.end():]
    parsed: dict[str, Any] = {}
    pending_key: str | None = None
    pending_list: list[str] = []
    for raw_line in block.splitlines():
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if pending_key is not None:
            if line.startswith("  ") or line.startswith("\t"):
                stripped = line.lstrip()
                if stripped.startswith("- "):
                    pending_list.append(stripped[2:])
                elif stripped:
                    pending_list.append(stripped)
                continue
            parsed[pending_key] = [_coerce_scalar(x) for x in pending_list]
            pending_key = None
            pending_list = []
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if value == "" or value == "|":
            pending_key = key
            pending_list = []
            continue
        if value.startswith("[") and value.endswith("]"):
            parsed[key] = _coerce_list(value)
            continue
        parsed[key] = _coerce_scalar(value)
    if pending_key is not None:
        parsed[pending_key] = [_coerce_scalar(x) for x in pending_list]
    return parsed, body


# ---------------------------------------------------------------------------
# Catalog types (Pydantic mirrors the DB rows in memory)
# ---------------------------------------------------------------------------


@dataclass
class CatalogEntry:
    """In-memory projection of one :class:`SteeringRule` row."""

    id: UUID
    rule_id: str
    file_path: str
    content: str
    scope: str
    applies_to_stages: list[str] = field(default_factory=list)
    content_hash: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_row(cls, row: SteeringRule) -> "CatalogEntry":
        return cls(
            id=row.id,
            rule_id=row.rule_id,
            file_path=row.file_path,
            content=row.content or "",
            scope=row.scope or "project",
            applies_to_stages=list(row.applies_to_stages or []),
            content_hash=row.content_hash,
            metadata=dict(row.metadata_ or {}) if row.metadata_ else {},
        )


@dataclass
class SteeringRuleCatalog:
    """Typed catalog assembled at session start."""

    tenant_id: UUID
    project_id: UUID
    entries: list[CatalogEntry] = field(default_factory=list)

    def rules_for_stage(self, stage: str) -> list[CatalogEntry]:
        return [e for e in self.entries if stage in (e.applies_to_stages or [])]

    def all_stages(self) -> set[str]:
        stages: set[str] = set()
        for e in self.entries:
            stages.update(e.applies_to_stages or [])
        return stages


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


def _file_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _resolve_patterns(extra: Iterable[str] | None = None) -> list[str]:
    """Build the glob list used by :meth:`SteeringEngine._discover_files`."""
    env = os.environ.get("STEERING_FILE_PATTERNS")
    patterns: list[str] = []
    if env:
        patterns.extend(p.strip() for p in env.split(",") if p.strip())
    else:
        patterns.extend(DEFAULT_PATTERNS)
    if extra:
        patterns.extend(extra)
    return patterns


class SteeringEngine:
    """The orchestrator. One process-wide instance is sufficient."""

    def __init__(self) -> None:
        self._catalogs: dict[tuple[str, str], SteeringRuleCatalog] = {}
        self._lock = threading.Lock()
        self._observer: Any | None = None  # watchdog Observer when running

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @staticmethod
    def discover_files(
        workspace_root: str | Path,
        patterns: Iterable[str] | None = None,
    ) -> list[Path]:
        """Walk ``workspace_root`` and return matching Markdown files.

        Hidden directories (``.git``, ``node_modules``, ``.venv``, …)
        are skipped to keep indexing fast on large repos.
        """
        root = Path(workspace_root).expanduser().resolve()
        if not root.exists():
            return []
        patterns = list(patterns) if patterns else _resolve_patterns()
        seen: set[Path] = set()
        for pattern in patterns:
            for path in root.glob(pattern):
                if not path.is_file():
                    continue
                if any(part in path.parts for part in _SKIP_DIRS):
                    continue
                seen.add(path.resolve())
        return sorted(seen)

    async def build_catalog(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        workspace_root: str | Path,
        patterns: Iterable[str] | None = None,
        persist: bool = True,
    ) -> SteeringRuleCatalog:
        """Discover, parse, optionally persist, and cache the catalog."""
        tid = UUID(str(tenant_id))
        pid = UUID(str(project_id))
        files = self.discover_files(workspace_root, patterns)
        entries: list[CatalogEntry] = []
        for path in files:
            entry = self._parse_file(path, workspace_root)
            if entry is None:
                continue
            entries.append(entry)
        catalog = SteeringRuleCatalog(
            tenant_id=tid, project_id=pid, entries=entries
        )
        with self._lock:
            self._catalogs[(str(tid), str(pid))] = catalog
        if persist and entries:
            await self._persist_catalog(catalog)
        logger.info(
            "steering.catalog_built",
            tenant_id=str(tid),
            project_id=str(pid),
            files=len(entries),
        )
        return catalog

    def get_catalog(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> SteeringRuleCatalog | None:
        return self._catalogs.get((str(tenant_id), str(project_id)))

    def invalidate(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> None:
        self._catalogs.pop((str(tenant_id), str(project_id)), None)

    async def list_rules(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[SteeringRuleRead]:
        """Return persisted rules from the DB (RLS-scoped)."""
        tid = str(tenant_id)
        pid = str(project_id)
        factory = get_session_factory()
        async with factory() as session:
            async with _maybe_tenant_context(session, tid, pid):
                stmt = select(SteeringRule).where(
                    SteeringRule.tenant_id == tid,
                    SteeringRule.project_id == pid,
                )
                rows = (await session.execute(stmt)).scalars().all()
                return [SteeringRuleRead.model_validate(r) for r in rows]

    async def add_rule(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        body: SteeringRuleCreate,
    ) -> SteeringRuleRead:
        """Insert one rule row directly (POST /steering-rules)."""
        tid = str(tenant_id)
        pid = str(body.project_id or project_id)
        content = body.content or ""
        factory = get_session_factory()
        async with factory() as session:
            async with _maybe_tenant_context(session, tid, pid):
                stmt = (
                    pg_insert(SteeringRule)
                    .values(
                        id=uuid4(),
                        tenant_id=tid,
                        project_id=pid,
                        rule_id=body.rule_id,
                        file_path=body.file_path,
                        content=content,
                        content_hash=_file_hash(content),
                        indexed_at=datetime.now(timezone.utc),
                        scope=body.scope or "project",
                        applies_to_stages=list(body.applies_to_stages or []),
                        metadata_=body.metadata or {},
                    )
                    .on_conflict_do_update(
                        index_elements=["tenant_id", "project_id", "rule_id"],
                        set_={
                            "file_path": body.file_path,
                            "content": content,
                            "content_hash": _file_hash(content),
                            "indexed_at": datetime.now(timezone.utc),
                            "scope": body.scope or "project",
                            "applies_to_stages": list(body.applies_to_stages or []),
                            "metadata": body.metadata or {},
                            "updated_at": datetime.now(timezone.utc),
                        },
                    )
                    .returning(SteeringRule)
                )
                result = await session.execute(stmt)
                await session.commit()
                row = result.scalar_one()
                return SteeringRuleRead.model_validate(row)

    async def delete_rule(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        rule_id: UUID | str,
    ) -> bool:
        tid = str(tenant_id)
        pid = str(project_id)
        rid = str(rule_id)
        factory = get_session_factory()
        async with factory() as session:
            async with _maybe_tenant_context(session, tid, pid):
                # Try to interpret `rule_id` as either the DB row id or
                # the human-readable `rule_id` column.
                if _looks_like_uuid(rid):
                    stmt = delete(SteeringRule).where(
                        SteeringRule.tenant_id == tid,
                        SteeringRule.project_id == pid,
                        SteeringRule.id == rid,
                    )
                else:
                    stmt = delete(SteeringRule).where(
                        SteeringRule.tenant_id == tid,
                        SteeringRule.project_id == pid,
                        SteeringRule.rule_id == rid,
                    )
                result = await session.execute(stmt)
                await session.commit()
                return bool(result.rowcount)

    def inject_into_context(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        stage: str | None = None,
        agent_state: Mapping[str, Any] | None = None,
    ) -> dict[str, str]:
        """Return rule markdown keyed by stage.

        ``stage`` is honored when supplied (single-stage call from the
        hook orchestrator). When omitted, all known stages are emitted
        so the caller can fan-out to whatever it needs.

        ``agent_state`` is currently unused but accepted so the signature
        is stable for future per-agent filtering (e.g. by agent_type).
        """
        catalog = self.get_catalog(
            tenant_id=tenant_id, project_id=project_id
        )
        if catalog is None:
            return {}
        out: dict[str, list[str]] = {}
        target_stages: Iterable[str]
        if stage:
            target_stages = [stage]
        else:
            target_stages = catalog.all_stages() or set(STEERING_STAGES)
        for s in target_stages:
            matches = catalog.rules_for_stage(s)
            if not matches:
                continue
            out[s] = [self._format_injection_block(e) for e in matches]
        return out

    def as_catalog_model(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> SteeringCatalog | None:
        catalog = self.get_catalog(
            tenant_id=tenant_id, project_id=project_id
        )
        if catalog is None:
            return None
        return SteeringCatalog(
            tenant_id=catalog.tenant_id,
            project_id=catalog.project_id,
            rules=[
                SteeringRuleRead(
                    id=e.id,
                    tenant_id=catalog.tenant_id,
                    project_id=catalog.project_id,
                    rule_id=e.rule_id,
                    file_path=e.file_path,
                    content=e.content,
                    scope=e.scope,
                    applies_to_stages=list(e.applies_to_stages or []),
                    metadata=e.metadata,
                    content_hash=e.content_hash,
                    indexed_at=datetime.now(timezone.utc),
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
                for e in catalog.entries
            ],
        )

    def evaluate(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        stage: str,
        draft_payload: Mapping[str, Any] | None = None,
    ) -> SteeringDecision:
        """Evaluate the rules catalog for ``stage`` and return a typed ``SteeringDecision``.

        M2 Plan 01-07 (T-C2). The decision is **rules-only** per
        ADR-009: we walk the catalog, match rules whose
        ``applies_to_stages`` includes ``stage``, and combine their
        ``severity`` hints into a single ``allow`` / ``warn`` / ``block``
        action.

        Action policy (deliberately simple, deterministic, and
        documented):

        * No matching rules -> ``allow`` (no rule fired).
        * All matches ``info`` / unset  -> ``allow``.
        * Any match ``warn`` -> ``warn``.
        * Any match ``block`` -> ``block`` (block wins over warn).

        Front-matter ``severity`` is optional; rules without a
        severity are treated as ``info``. This matches the
        ``CodeValidator`` semantics already used by ``F-501``.

        Parameters
        ----------
        tenant_id, project_id:
            Same scoping as :meth:`inject_into_context`.
        stage:
            One of :data:`STEERING_STAGES`. Unknown stages raise
            :class:`ValueError` so the supervisor fails fast instead
            of silently allowing.
        draft_payload:
            Optional agent payload to surface in ``metadata``. The
            evaluator never reads it for the action decision (rules
            are the only source of truth) but the audit row carries
            the payload so reviewers can correlate decisions to
            drafts.

        Returns
        -------
        SteeringDecision
            Typed Pydantic model with ``stage``, ``rules_applied``,
            ``action`` (literal ``allow``/``warn``/``block``),
            ``reason``, and ``metadata``.
        """
        if stage not in STEERING_STAGES:
            raise ValueError(
                f"unknown steering stage {stage!r}; "
                f"expected one of {STEERING_STAGES}"
            )

        catalog = self.get_catalog(
            tenant_id=tenant_id, project_id=project_id
        )
        if catalog is None:
            # No catalog means no rules fired -- safe default is allow.
            return SteeringDecision(
                stage=stage,
                rules_applied=[],
                action="allow",
                reason="no catalog indexed for this tenant/project",
                metadata={
                    "tenant_id": str(tenant_id),
                    "project_id": str(project_id),
                    "draft_keys": sorted((draft_payload or {}).keys()),
                },
            )

        matches = catalog.rules_for_stage(stage)
        rule_ids: list[str] = [m.rule_id for m in matches]
        severities = [
            str((m.metadata or {}).get("severity") or "info").lower()
            for m in matches
        ]

        if any(s == "block" for s in severities):
            action: str = "block"
        elif any(s in {"warn", "warning"} for s in severities):
            action = "warn"
        else:
            action = "allow"

        reason_suffix = f" {len(matches)} rule(s) matched" if matches else " no rules matched"
        reason = (
            f"rules-only evaluation of stage={stage!r}; "
            + (
                f"severity ladder says {action!r} because"
                + reason_suffix
            )
            if False
            else (
                f"severity ladder resolved to {action!r} (matched "
                f"severities: {sorted(set(severities)) or 'none'})"
            )
        )

        return SteeringDecision(
            stage=stage,
            rules_applied=rule_ids,
            action=action,  # type: ignore[arg-type]  # narrowed by ladder above
            reason=reason,
            metadata={
                "tenant_id": str(tenant_id),
                "project_id": str(project_id),
                "severities": severities,
                "catalog_files": len(catalog.entries),
                "draft_keys": sorted((draft_payload or {}).keys()),
            },
        )

    # ------------------------------------------------------------------
    # Watchdog integration
    # ------------------------------------------------------------------

    def start_watcher(
        self,
        workspace_root: str | Path,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        patterns: Iterable[str] | None = None,
    ) -> bool:
        """Start a watchdog Observer for live re-indexing.

        Returns True if a new observer was started, False if one was
        already running or watchdog is unavailable. The observer is
        daemon-threaded and exits when the process exits.
        """
        if os.environ.get("STEERING_WATCH_ENABLED", "true").lower() in {
            "0",
            "false",
            "no",
        }:
            logger.info("steering.watcher_disabled_by_env")
            return False
        try:
            from watchdog.events import FileSystemEvent, FileSystemEventHandler
            from watchdog.observers import Observer
        except ImportError:
            logger.warning("steering.watcher_unavailable: watchdog not installed")
            return False
        if self._observer is not None and self._observer.is_alive():
            return False

        root = Path(workspace_root).expanduser().resolve()
        if not root.exists():
            return False

        engine_ref = self
        tid = str(tenant_id)
        pid = str(project_id)
        patterns_list = list(patterns) if patterns else _resolve_patterns()
        _watched_parents: set[Path] = set()

        def _matches(path: Path) -> bool:
            p = path.resolve()
            for pat in patterns_list:
                # fnmatchcase with relative-to-root semantics.
                try:
                    rel = p.relative_to(root).as_posix()
                except ValueError:
                    return False
                if _fnmatch(rel, _strip_glob_prefix(pat)):
                    return True
            return False

        class _Handler(FileSystemEventHandler):  # type: ignore[misc]
            def on_any_event(self, event: "FileSystemEvent") -> None:  # type: ignore[override]
                if event.is_directory:
                    return
                path = Path(str(event.src_path))
                if not _matches(path):
                    return
                logger.info(
                    "steering.watcher_event",
                    kind=event.event_type,
                    path=str(path),
                )
                # Re-index the whole project; cheap enough and avoids
                # incremental diffing for the rule-counts we expect.
                try:
                    import asyncio

                    loop = asyncio.new_event_loop()
                    try:
                        loop.run_until_complete(
                            engine_ref.build_catalog(
                                tenant_id=tid,
                                project_id=pid,
                                workspace_root=root,
                                patterns=patterns_list,
                            )
                        )
                    finally:
                        loop.close()
                except Exception as exc:  # noqa: BLE001
                    logger.error("steering.reindex_failed", error=str(exc))

        observer = Observer()
        # Schedule only the directories that could contain matches.
        # Pragmatic: schedule every dir under root that's not in
        # _SKIP_DIRS, up to a depth cap.
        for dirpath, dirnames, _filenames in os.walk(root):
            depth = Path(dirpath).relative_to(root).parts
            if len(depth) > 8:
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            _watched_parents.add(Path(dirpath))
        for parent in _watched_parents:
            observer.schedule(_Handler(), str(parent), recursive=False)
        observer.daemon = True
        observer.start()
        self._observer = observer
        logger.info("steering.watcher_started", root=str(root), dirs=len(_watched_parents))
        return True

    def stop_watcher(self) -> None:
        if self._observer is None:
            return
        try:
            self._observer.stop()
            self._observer.join(timeout=2.0)
        finally:
            self._observer = None
            logger.info("steering.watcher_stopped")

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _parse_file(
        self,
        path: Path,
        workspace_root: str | Path,
    ) -> CatalogEntry | None:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None
        meta, body = parse_front_matter(text)
        rel = _relative_posix(path, workspace_root)
        rule_id = str(meta.get("rule_id") or path.stem or rel)
        scope = str(meta.get("scope") or "project")
        stages_raw = meta.get("applies_to_stages") or meta.get("stages") or []
        if isinstance(stages_raw, str):
            stages = [s.strip() for s in stages_raw.split(",") if s.strip()]
        else:
            stages = [str(s) for s in stages_raw]
        return CatalogEntry(
            id=uuid4(),
            rule_id=rule_id,
            file_path=rel,
            content=text,
            scope=scope,
            applies_to_stages=stages,
            content_hash=_file_hash(text),
            metadata={k: v for k, v in meta.items() if k not in _META_RESERVED},
        )

    async def _persist_catalog(self, catalog: SteeringRuleCatalog) -> None:
        factory = get_session_factory()
        async with factory() as session:
            async with _maybe_tenant_context(
                session, str(catalog.tenant_id), str(catalog.project_id)
            ):
                for entry in catalog.entries:
                    stmt = (
                        pg_insert(SteeringRule)
                        .values(
                            id=entry.id,
                            tenant_id=str(catalog.tenant_id),
                            project_id=str(catalog.project_id),
                            rule_id=entry.rule_id,
                            file_path=entry.file_path,
                            content=entry.content,
                            content_hash=entry.content_hash,
                            indexed_at=datetime.now(timezone.utc),
                            scope=entry.scope,
                            applies_to_stages=list(entry.applies_to_stages or []),
                            metadata_=entry.metadata or {},
                        )
                        .on_conflict_do_update(
                            index_elements=["tenant_id", "project_id", "rule_id"],
                            set_={
                                "file_path": entry.file_path,
                                "content": entry.content,
                                "content_hash": entry.content_hash,
                                "indexed_at": datetime.now(timezone.utc),
                                "scope": entry.scope,
                                "applies_to_stages": list(entry.applies_to_stages or []),
                                "metadata": entry.metadata or {},
                                "updated_at": datetime.now(timezone.utc),
                            },
                        )
                    )
                    try:
                        await session.execute(stmt)
                    except SQLAlchemyError as exc:
                        logger.warning(
                            "steering.persist_skip",
                            rule_id=entry.rule_id,
                            error=str(exc),
                        )
                await session.commit()

    @staticmethod
    def _format_injection_block(entry: CatalogEntry) -> str:
        header = (
            f"<!-- forge-steering rule_id={entry.rule_id} "
            f"scope={entry.scope} stages={','.join(entry.applies_to_stages)} -->\n"
        )
        return header + (entry.content or "").rstrip() + "\n"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SKIP_DIRS = frozenset(
    {
        ".git",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".next",
        "dist",
        "build",
        ".pnpm-store",
        ".omc",
        ".claude",
    }
)

_META_RESERVED = frozenset({"rule_id", "scope", "applies_to_stages", "stages"})


def _relative_posix(path: Path, root: str | Path) -> str:
    root_p = Path(root).expanduser().resolve()
    try:
        return path.resolve().relative_to(root_p).as_posix()
    except ValueError:
        return str(path)


def _strip_glob_prefix(pattern: str) -> str:
    """Convert a glob like ``**/steering/*.md`` to fnmatch ``steering/*.md``."""

    p = pattern
    while p.startswith("**/"):
        p = p[3:]
    return p


def _fnmatch(name: str, pattern: str) -> bool:
    import fnmatch

    return fnmatch.fnmatchcase(name, pattern)


def _looks_like_uuid(value: str) -> bool:
    try:
        UUID(value)
    except (ValueError, TypeError):
        return False
    return True


@asynccontextmanager
async def _maybe_tenant_context(
    session: AsyncSession,
    tenant_id: str,
    project_id: str,
):
    """Apply RLS GUCs on Postgres; no-op on SQLite (test runtime).

    The DB-layer RLS contract is enforced by Postgres policies; the
    application layer scopes every query by tenant_id and project_id
    explicitly. This helper exists so the same code path works in
    production and in unit tests that run against SQLite.
    """
    bind = session.bind
    if bind is not None and getattr(bind, "dialect", None) is not None:
        if bind.dialect.name == "postgresql":
            async with tenant_context(session, tenant_id, project_id):
                yield session
            return
    yield session


# Module-level singleton
steering_engine = SteeringEngine()


__all__ = [
    "CatalogEntry",
    "DEFAULT_PATTERNS",
    "SteeringEngine",
    "SteeringRuleCatalog",
    "parse_front_matter",
    "steering_engine",
]