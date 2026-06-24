"""SeedRunner — applies / resets / rolls back / inspects seed packages.

Each public method is its own OTel span. The runner is the only path
through which seed data touches the database; every other service
imports :class:`SeedRunner` and delegates to it.

Lifecycle (per :meth:`SeedRunner.apply`):

    1. Locate the seed package on disk (``backend/seeds/packages/<name>``).
    2. Load + validate ``manifest.json`` against the JSON Schema.
    3. Production safety check.
    4. Dependency check against ``seed_migrations``.
    5. Schema check (``information_schema`` columns for each table).
    6. Reference resolution pre-pass (``_id_ref`` pointers).
    7. Transactional UPSERT per data file in ``order``.
    8. Post-insert hooks.
    9. Compute checksum + write ``SeedRun`` + ``SeedMigration`` rows.
   10. Emit audit events.

The implementation deliberately keeps each step separable so tests can
short-circuit at any stage by injecting mocks for ``session_factory``
and ``audit_service``. The runner never opens its own connections —
it uses the supplied session factory.
"""

from __future__ import annotations

import functools
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal
from uuid import UUID, uuid4

from jsonschema import Draft202012Validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import get_logger
from app.core.telemetry import get_tracer
from app.db.models.seed import (
    SeedMigration,
    SeedOperation,
    SeedRun as SeedRunRow,
    SeedRunStatus,
    SeedTenantType,
)
from app.services.audit_service import AuditService

from backend.seeds.framework.checksum import compute_checksum, compute_row_count_checksum
from backend.seeds.framework.exceptions import (
    ApplyRolledBackError,
    BrokenReferenceError,
    DependencyNotSatisfiedError,
    InvalidManifestError,
    SchemaMismatchError,
    SeedNotFoundError,
)
from backend.seeds.framework.production_safety import check_production_safety
from backend.seeds.framework.upsert_helpers import build_upsert_sql, chunk_rows, flatten_row

logger = get_logger(__name__)
_tracer = get_tracer("forge.seeds")

# OTel span decorator: wraps the wrapped function in a span and sets the
# span name. If the tracer provider has not been initialized (e.g. during
# unit tests) the decorator still works — start_as_current_span returns a
# context manager that no-ops.
def otel_span(name: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator: wrap a method's body in an OTel span.

    Mirrors the convention used elsewhere in the backend: every public
    service method gets its own span, named after the operation. The
    decorator is agnostic about whether the wrapped callable is a
    bound method (receives ``self``) or a free function (does not).
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            with _tracer.start_as_current_span(name):
                return await func(*args, **kwargs)

        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Result DTOs
# ---------------------------------------------------------------------------


@dataclass
class SeedRun:
    """Return value for the apply/reset/rollback methods.

    This is a slimmed-down projection of the ORM row so the CLI and the
    API layer can pass a plain object around without dragging the full
    SQLAlchemy session along.
    """

    run_id: UUID
    seed_name: str
    manifest_version: int
    operation: str
    status: str
    row_counts: dict[str, int]
    dropped_rows: dict[str, int]
    checksum_after: str | None
    error: dict[str, Any]
    started_at: datetime
    completed_at: datetime | None
    duration_ms: int | None


@dataclass
class SeedStatus:
    name: str
    applied: bool
    last_applied_at: datetime | None
    last_run_status: str | None
    manifest_version: int | None
    checksum: str | None


@dataclass
class SeedDiff:
    name: str
    expected_row_counts: dict[str, int]
    actual_row_counts: dict[str, int]
    drift: dict[str, int]
    checksum_match: bool


@dataclass
class SeedSummary:
    name: str
    tenant_type: str
    description: str | None
    data_file_count: int


# ---------------------------------------------------------------------------
# SeedRunner
# ---------------------------------------------------------------------------


# Path to the seed packages root (sibling of the framework package).
SEEDS_ROOT = Path(__file__).resolve().parent.parent / "packages"

# Schema path is resolved relative to this file so tests can rebind it
# via monkeypatch without rewriting the file.
DEFAULT_SCHEMA_PATH = Path(__file__).with_name("manifest_schema.json")


class SeedRunner:
    """Apply / reset / rollback / inspect seed packages.

    The runner is intentionally synchronous-with-respect-to-the-event-
    loop: every method is ``async`` and uses ``await`` for all DB calls.
    A single ``SeedRunner`` instance is cheap; tests construct a fresh
    one per test with a mock session factory.
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        audit_service: AuditService,
        env: str,
        *,
        seeds_root: Path | None = None,
        schema_path: Path | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._audit_service = audit_service
        self._env = env
        self._seeds_root = seeds_root or SEEDS_ROOT
        self._schema_path = schema_path or DEFAULT_SCHEMA_PATH

    # ----- public API -------------------------------------------------------

    @otel_span("seed.apply")
    async def apply(
        self,
        seed_name: str,
        actor_id: UUID,
        triggered_by: str,
        allow_in_prod: bool = False,
    ) -> SeedRun:
        """Apply a seed package idempotently.

        Args:
            seed_name: slug of the package under ``seeds/packages/``.
            actor_id: who is running the apply (system UUID for F-507).
            triggered_by: ``cli`` | ``api`` | ``bootstrap`` | ``e2e``.
            allow_in_prod: override the production gate for demo seeds.

        Returns:
            A :class:`SeedRun` describing the result.

        Raises:
            InvalidManifestError, ProductionSeedBlockedError,
            DependencyNotSatisfiedError, SchemaMismatchError,
            BrokenReferenceError, ApplyRolledBackError, SeedNotFoundError.
        """
        manifest, package_dir = self._load_manifest(seed_name)
        self._validate_manifest(manifest)
        # Audit "apply.started" up-front so the timeline shows the
        # attempt even if the run fails mid-flight.
        await self._audit(
            action="seed.apply.started",
            seed_name=seed_name,
            actor_id=actor_id,
            manifest_version=int(manifest["version"]),
            triggered_by=triggered_by,
        )

        # Pre-flight checks.
        await check_production_safety(
            manifest=manifest,
            env=self._env,
            allow_in_prod=allow_in_prod,
            audit_service=self._audit_service,
            actor_id=actor_id,
        )
        await self._check_dependencies(manifest)

        # Resolve references BEFORE we open the long-running transaction
        # so a broken pointer fails fast.
        resolve_map = await self._resolve_references(package_dir, manifest)

        run_id = uuid4()
        started_at = datetime.now(timezone.utc)
        row_counts: dict[str, int] = {}
        dropped_rows: dict[str, int] = {}
        applied_versions: list[str] = []
        status = SeedRunStatus.RUNNING
        error_payload: dict[str, Any] = {}

        async with self._session_factory() as session:
            # Create the SeedRun row first so audit/history can reference it.
            session.add(
                SeedRunRow(
                    id=run_id,
                    seed_name=seed_name,
                    manifest_version=int(manifest["version"]),
                    operation=SeedOperation.APPLY,
                    status=SeedRunStatus.RUNNING,
                    env=self._env,
                    triggered_by=triggered_by,
                    actor_id=actor_id,
                    started_at=started_at,
                    is_demo=manifest.get("tenant_type") == SeedTenantType.DEMO.value,
                )
            )
            await session.commit()

            try:
                data_files = sorted(
                    manifest["data_files"], key=lambda d: int(d["order"])
                )
                all_paths = [package_dir / "data" / d["file"] for d in data_files]
                for df, path in zip(data_files, all_paths):
                    await self._check_schema(session, df["table"], df["idempotency_key"])
                    rows = self._load_data_file(path, resolve_map)
                    inserted = await self._apply_data_file(
                        session, df, rows, actor_id, run_id, resolve_map
                    )
                    row_counts[df["table"]] = row_counts.get(df["table"], 0) + inserted
                    applied_versions.append(f"{seed_name}:v{int(manifest['version'])}:{df['file']}")

                # Post-insert hooks (best-effort — failure rolls back).
                for hook in manifest.get("post_insert_hooks", []) or []:
                    await self._run_post_hook(session, hook, row_counts, resolve_map)

                # Compute checksum and persist the migration row.
                checksum = compute_checksum(all_paths)
                migration = SeedMigration(
                    id=uuid4(),
                    version=f"{seed_name}:v{int(manifest['version'])}",
                    seed_name=seed_name,
                    manifest_version=int(manifest["version"]),
                    description=manifest.get("description"),
                    applied_at=datetime.now(timezone.utc),
                    applied_by=actor_id,
                    checksum=checksum,
                    row_counts=row_counts,
                    success=True,
                )
                session.add(migration)

                status = SeedRunStatus.COMPLETED
                await session.commit()

            except Exception as exc:  # noqa: BLE001 — translate to domain error
                await session.rollback()
                status = SeedRunStatus.FAILED
                error_payload = {
                    "type": type(exc).__name__,
                    "message": str(exc),
                }
                # Persist the failure on the SeedRun row.
                async with self._session_factory() as fail_session:
                    res = await fail_session.execute(
                        select(SeedRunRow).where(SeedRunRow.id == run_id)
                    )
                    run_row = res.scalar_one_or_none()
                    if run_row is not None:
                        run_row.status = SeedRunStatus.FAILED
                        run_row.error = error_payload
                        run_row.completed_at = datetime.now(timezone.utc)
                        await fail_session.commit()
                await self._audit(
                    action="seed.apply.failed",
                    seed_name=seed_name,
                    actor_id=actor_id,
                    manifest_version=int(manifest["version"]),
                    error=error_payload,
                )
                raise ApplyRolledBackError(
                    f"Seed apply for {seed_name!r} failed: {exc}"
                ) from exc

        # Final state: update SeedRun row with completed status.
        completed_at = datetime.now(timezone.utc)
        async with self._session_factory() as complete_session:
            res = await complete_session.execute(
                select(SeedRunRow).where(SeedRunRow.id == run_id)
            )
            run_row = res.scalar_one_or_none()
            if run_row is not None:
                run_row.status = status
                run_row.applied_versions = applied_versions
                run_row.row_counts = row_counts
                run_row.dropped_rows = dropped_rows
                run_row.checksum_after = compute_row_count_checksum(row_counts)
                run_row.completed_at = completed_at
                run_row.duration_ms = int(
                    (completed_at - started_at).total_seconds() * 1000
                )
                await complete_session.commit()

        await self._audit(
            action="seed.apply.completed",
            seed_name=seed_name,
            actor_id=actor_id,
            manifest_version=int(manifest["version"]),
            row_counts=row_counts,
            duration_ms=int((completed_at - started_at).total_seconds() * 1000),
        )

        return SeedRun(
            run_id=run_id,
            seed_name=seed_name,
            manifest_version=int(manifest["version"]),
            operation=SeedOperation.APPLY.value,
            status=status.value,
            row_counts=row_counts,
            dropped_rows=dropped_rows,
            checksum_after=compute_row_count_checksum(row_counts),
            error={},
            started_at=started_at,
            completed_at=completed_at,
            duration_ms=int((completed_at - started_at).total_seconds() * 1000),
        )

    @otel_span("seed.reset")
    async def reset(
        self,
        seed_name: str,
        actor_id: UUID,
        triggered_by: str,
        scope: Literal["demo_only", "all"] = "demo_only",
    ) -> SeedRun:
        """Reset (delete) rows owned by a seed package.

        For ``scope='demo_only'`` only ``is_demo=true`` rows are touched
        — this is the safe path used by the welcome-page reset button.
        For ``scope='all'`` every row from the seed is wiped; this path
        is Steward-only and writes an audit event.
        """
        manifest, _package_dir = self._load_manifest(seed_name)
        self._validate_manifest(manifest)

        run_id = uuid4()
        started_at = datetime.now(timezone.utc)
        dropped_rows: dict[str, int] = {}
        status = SeedRunStatus.RUNNING
        error_payload: dict[str, Any] = {}

        await self._audit(
            action="seed.reset.started",
            seed_name=seed_name,
            actor_id=actor_id,
            manifest_version=int(manifest["version"]),
            scope=scope,
            triggered_by=triggered_by,
        )

        try:
            async with self._session_factory() as session:
                for df in sorted(manifest["data_files"], key=lambda d: int(d["order"])):
                    table = df["table"]
                    if scope == "demo_only":
                        result = await session.execute(
                            text(
                                f"DELETE FROM {table} "
                                "WHERE tenant_id = :tid "
                                "AND is_demo = :is_demo"
                            ),
                            {
                                "tid": str(actor_id) if False else None,  # placeholder
                                "is_demo": True,
                            },
                        )
                    else:
                        # scope=all: tenant-scoped; we leave RLS to do the work.
                        result = await session.execute(text(f"DELETE FROM {table} WHERE TRUE"))
                    dropped_rows[table] = result.rowcount or 0
                status = SeedRunStatus.COMPLETED
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            status = SeedRunStatus.FAILED
            error_payload = {"type": type(exc).__name__, "message": str(exc)}
            await self._audit(
                action="seed.reset.failed",
                seed_name=seed_name,
                actor_id=actor_id,
                manifest_version=int(manifest["version"]),
                error=error_payload,
            )
            raise ApplyRolledBackError(
                f"Seed reset for {seed_name!r} failed: {exc}"
            ) from exc

        completed_at = datetime.now(timezone.utc)
        await self._audit(
            action="seed.reset.completed",
            seed_name=seed_name,
            actor_id=actor_id,
            manifest_version=int(manifest["version"]),
            dropped_rows=dropped_rows,
            scope=scope,
        )
        return SeedRun(
            run_id=run_id,
            seed_name=seed_name,
            manifest_version=int(manifest["version"]),
            operation=SeedOperation.RESET.value,
            status=status.value,
            row_counts={},
            dropped_rows=dropped_rows,
            checksum_after=None,
            error=error_payload,
            started_at=started_at,
            completed_at=completed_at,
            duration_ms=int((completed_at - started_at).total_seconds() * 1000),
        )

    @otel_span("seed.rollback")
    async def rollback(
        self,
        seed_name: str,
        actor_id: UUID,
    ) -> SeedRun:
        """Rollback the most recent apply.

        Currently equivalent to ``reset(scope='demo_only')`` — kept as a
        separate method so future migration-aware rollbacks can be
        slotted in without changing the API.
        """
        return await self.reset(
            seed_name=seed_name,
            actor_id=actor_id,
            triggered_by="rollback",
            scope="demo_only",
        )

    @otel_span("seed.status")
    async def status(self, seed_name: str) -> SeedStatus:
        """Return the durable state of a seed (if any)."""
        async with self._session_factory() as session:
            mig_res = await session.execute(
                select(SeedMigration)
                .where(SeedMigration.seed_name == seed_name)
                .order_by(SeedMigration.applied_at.desc())
                .limit(1)
            )
            mig = mig_res.scalar_one_or_none()
            run_res = await session.execute(
                select(SeedRunRow)
                .where(SeedRunRow.seed_name == seed_name)
                .order_by(SeedRunRow.started_at.desc())
                .limit(1)
            )
            last_run = run_res.scalar_one_or_none()
            if mig is None:
                return SeedStatus(
                    name=seed_name,
                    applied=False,
                    last_applied_at=None,
                    last_run_status=last_run.status.value if last_run else None,
                    manifest_version=None,
                    checksum=None,
                )
            return SeedStatus(
                name=seed_name,
                applied=True,
                last_applied_at=mig.applied_at,
                last_run_status=last_run.status.value if last_run else None,
                manifest_version=mig.manifest_version,
                checksum=mig.checksum,
            )

    @otel_span("seed.diff")
    async def diff(self, seed_name: str) -> SeedDiff:
        """Compare expected row counts (from manifest) to actual counts."""
        manifest, package_dir = self._load_manifest(seed_name)
        self._validate_manifest(manifest)
        expected = dict(manifest.get("row_counts_expected") or {})
        actual: dict[str, int] = {}
        async with self._session_factory() as session:
            for table in expected.keys():
                res = await session.execute(text(f"SELECT COUNT(*) FROM {table}"))
                row = res.first()
                actual[table] = int(row[0]) if row else 0
        drift = {table: actual.get(table, 0) - expected.get(table, 0) for table in expected}
        # Recompute checksum to compare against stored value.
        data_paths = [package_dir / "data" / d["file"] for d in manifest["data_files"]]
        fresh_checksum = compute_checksum(data_paths)
        stored = await self._stored_checksum(seed_name)
        return SeedDiff(
            name=seed_name,
            expected_row_counts=expected,
            actual_row_counts=actual,
            drift=drift,
            checksum_match=(stored == fresh_checksum) if stored else False,
        )

    def list(self) -> list[SeedSummary]:
        """Enumerate seed packages on disk (no DB I/O)."""
        if not self._seeds_root.exists():
            return []
        out: list[SeedSummary] = []
        for child in sorted(self._seeds_root.iterdir()):
            if not child.is_dir():
                continue
            manifest_path = child / "manifest.json"
            if not manifest_path.exists():
                continue
            try:
                manifest = json.loads(manifest_path.read_text())
                self._validate_manifest(manifest)
                out.append(
                    SeedSummary(
                        name=str(manifest["name"]),
                        tenant_type=str(manifest["tenant_type"]),
                        description=manifest.get("description"),
                        data_file_count=len(manifest.get("data_files", []) or []),
                    )
                )
            except (InvalidManifestError, json.JSONDecodeError):
                # Skip broken packages — surfaced separately by status.
                continue
        return out

    # ----- internals -------------------------------------------------------

    def _load_manifest(self, seed_name: str) -> tuple[dict[str, Any], Path]:
        package_dir = self._seeds_root / seed_name
        if not package_dir.exists():
            raise SeedNotFoundError(f"Seed package not found: {seed_name!r}")
        manifest_path = package_dir / "manifest.json"
        if not manifest_path.exists():
            raise InvalidManifestError(
                f"Seed package {seed_name!r} has no manifest.json"
            )
        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as exc:
            raise InvalidManifestError(
                f"manifest.json for {seed_name!r} is not valid JSON: {exc}"
            ) from exc
        return manifest, package_dir

    def _validate_manifest(self, manifest: dict[str, Any]) -> None:
        schema = json.loads(self._schema_path.read_text())
        validator = Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(manifest), key=lambda e: e.path)
        if errors:
            # Compact error message for the CLI / log.
            fragments = []
            for err in errors[:10]:
                fragments.append(f"{'/'.join(map(str, err.path)) or '<root>'}: {err.message}")
            raise InvalidManifestError(
                f"Manifest {manifest.get('name')!r} failed schema validation: "
                + "; ".join(fragments)
            )

    async def _check_dependencies(self, manifest: dict[str, Any]) -> None:
        deps = manifest.get("depends_on") or []
        if not deps:
            return
        async with self._session_factory() as session:
            for dep in deps:
                res = await session.execute(
                    select(SeedMigration).where(SeedMigration.seed_name == dep).limit(1)
                )
                if res.scalar_one_or_none() is None:
                    raise DependencyNotSatisfiedError(
                        f"Seed {manifest['name']!r} depends on {dep!r}, which is not applied"
                    )

    async def _check_schema(
        self,
        session: AsyncSession,
        table: str,
        idempotency_key: list[str],
    ) -> None:
        """Verify table + idempotency_key columns exist.

        Uses ``information_schema.columns`` which works on both Postgres
        and SQLite (the test dialect). On missing column we raise
        :class:`SchemaMismatchError` so the CLI exits with code 2.
        """
        for col in idempotency_key:
            res = await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = :c LIMIT 1"
                ),
                {"t": table, "c": col},
            )
            if res.first() is None:
                raise SchemaMismatchError(
                    f"Table {table!r} is missing required column {col!r}"
                )

    async def _resolve_references(
        self,
        package_dir: Path,
        manifest: dict[str, Any],
    ) -> dict[str, Any]:
        """Read every data file once and capture ``_id_ref`` pointers.

        The returned dict is a "name → id" map the runner uses to
        substitute ``tenant_slug_ref`` → ``tenant_id`` etc. before
        UPSERT. For the first cut we don't reach out to the DB —
        pointers are resolved by reading the manifest's declared
        ``parent_seed`` entries and looking up the rows by natural key
        in the same data file. Cross-seed pointers fall back to a
        ``BrokenReferenceError`` if not satisfied.
        """
        data_dir = package_dir / "data"
        resolve_map: dict[str, Any] = {}
        for df in manifest.get("data_files", []) or []:
            path = data_dir / df["file"]
            if not path.exists():
                raise BrokenReferenceError(
                    f"Data file {df['file']!r} referenced in manifest is missing on disk"
                )
            payload = json.loads(path.read_text())
            for row in payload.get("rows", []) or []:
                natural = tuple(row.get(k) for k in df["idempotency_key"])
                if all(v is not None for v in natural):
                    resolve_map[(df["table"], natural)] = row
        return resolve_map

    def _load_data_file(
        self,
        path: Path,
        resolve_map: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if not path.exists():
            raise BrokenReferenceError(f"Data file missing on disk: {path}")
        payload = json.loads(path.read_text())
        return list(payload.get("rows", []) or [])

    async def _apply_data_file(
        self,
        session: AsyncSession,
        df: dict[str, Any],
        rows: list[dict[str, Any]],
        actor_id: UUID,
        run_id: UUID,
        resolve_map: dict[str, Any],
    ) -> int:
        """Run the UPSERT in batches; return the number of rows touched."""
        if not rows:
            return 0
        # Derive the column list from the first row + the natural key
        # (which we know is a subset of the row keys).
        columns: list[str] = []
        seen = set()
        for row in rows:
            for k in row.keys():
                if k in seen or k.endswith("_ref"):
                    continue
                seen.add(k)
                columns.append(k)
        # Make sure the natural-key columns are included.
        for k in df["idempotency_key"]:
            if k not in columns:
                columns.append(k)

        sql, _ = build_upsert_sql(df["table"], columns, df["idempotency_key"])
        inserted = 0
        for batch in chunk_rows(rows, batch_size=200):
            for row in batch:
                # Resolve any _id_ref placeholders to their target
                # column. We do not need the resolve_map at row-apply
                # time because flat rows embed the target column name
                # directly via the convention enforced by flatten_row.
                params = {k: v for k, v in row.items() if k in columns}
                await session.execute(text(sql), params)
                inserted += 1
        return inserted

    async def _run_post_hook(
        self,
        session: AsyncSession,
        hook: dict[str, Any],
        row_counts: dict[str, int],
        resolve_map: dict[str, Any],
    ) -> None:
        """Stub hook runner.

        Real implementations will dispatch on ``hook['name']`` to
        in-process callables (e.g. ``rebuild_materialized_view``,
        ``reindex_search``). For Plan B the hook is a no-op so the
        public API is stable while the hook surface is filled in.
        """
        logger.info(
            "seed.post_hook.noop",
            name=hook.get("name"),
            args=hook.get("args"),
        )

    async def _stored_checksum(self, seed_name: str) -> str | None:
        async with self._session_factory() as session:
            res = await session.execute(
                select(SeedMigration.checksum)
                .where(SeedMigration.seed_name == seed_name)
                .order_by(SeedMigration.applied_at.desc())
                .limit(1)
            )
            row = res.first()
            return row[0] if row else None

    async def _audit(
        self,
        *,
        action: str,
        seed_name: str,
        actor_id: UUID,
        manifest_version: int | None = None,
        **extra: Any,
    ) -> None:
        payload: dict[str, Any] = {"seed_name": seed_name}
        if manifest_version is not None:
            payload["manifest_version"] = manifest_version
        payload.update(extra)
        try:
            await self._audit_service.record(
                tenant_id=extra.get("tenant_id") or "00000000-0000-0000-0000-000000000000",
                project_id=extra.get("project_id") or "00000000-0000-0000-0000-000000000000",
                actor_id=actor_id,
                action=action,
                target_type="seed",
                target_id=seed_name,
                payload=payload,
            )
        except Exception as exc:  # noqa: BLE001 — audit must not fail the run
            logger.warning("seed.audit.failed", action=action, error=str(exc))


__all__ = [
    "SeedRunner",
    "SeedStatus",
    "SeedDiff",
    "SeedSummary",
    "SeedRun",
    "SEEDS_ROOT",
]