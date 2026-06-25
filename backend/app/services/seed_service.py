"""SeedService — thin orchestration layer over SeedRunner.

The runner is the only path through which seed data touches the
database; this service is the only path through which the API layer
calls the runner. It exists to:

1. Construct a fresh ``SeedRunner`` per call (the runner is cheap).
2. Convert runner dataclasses → Pydantic DTOs from
   ``app.schemas.seeds``.
3. Emit domain-level audit events via ``AuditService`` (the runner
   already emits its own; the service emits a service-level event so
   the timeline shows ``api → service → runner`` transitions).
4. Surface the runner's typed exceptions unchanged so the API layer
   can map them to HTTP responses.

The service never opens its own connections; the runner uses the
supplied session factory which is created by the request-scoped
``DbSession`` dependency.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.seeds import (
    SeedDataFileRead,
    SeedDiffRead,
    SeedManifestRead,
    SeedManifestSummary,
    SeedRunRead,
    SeedStatusRead,
)
from app.services.audit_service import AuditService

from backend.seeds.framework.exceptions import SeedNotFoundError
from backend.seeds.framework.seed_runner import (
    SEEDS_ROOT,
    SeedDiff,
    SeedRun,
    SeedRunner,
    SeedStatus,
    SeedSummary,
)

logger = get_logger(__name__)


class SeedService:
    """Orchestrates seed operations for the API surface.

    Args:
        session_factory: SQLAlchemy async session factory. Created
            from the request-scoped ``DbSession`` via ``session.get_bind()``
            or ``get_session_factory()``.
        audit_service: Audit emitter (DI). Defaults to the global
            ``AuditService`` instance.
        env: Environment string passed to the runner. Defaults to
            ``settings.environment`` (``development``/``test``/etc.).
        seeds_root: Override the on-disk seed packages location
            (mostly useful for tests).
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        audit_service: AuditService | None = None,
        *,
        env: str | None = None,
        seeds_root: Path | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._audit_service = audit_service or AuditService()
        self._env = env or settings.environment
        self._seeds_root = seeds_root or SEEDS_ROOT

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_seeds(self) -> list[SeedManifestSummary]:
        """Enumerate all seed packages on disk."""
        runner = self._build_runner()
        return [_summary_to_dto(s) for s in runner.list()]

    async def get_seed(self, name: str) -> SeedManifestRead:
        """Return the full manifest for ``name``.

        Raises :class:`SeedNotFoundError` if the package is absent
        on disk.
        """
        runner = self._build_runner()
        manifest, _ = runner._load_manifest(name)  # noqa: SLF001 — internal load is intentional
        return _manifest_to_dto(manifest)

    async def apply(
        self,
        name: str,
        actor_id: UUID,
        triggered_by: str,
        allow_in_prod: bool = False,
        *,
        tenant_id: UUID | None = None,
        project_id: UUID | None = None,
    ) -> SeedRunRead:
        """Apply a seed package idempotently."""
        runner = self._build_runner()
        result = await runner.apply(
            seed_name=name,
            actor_id=actor_id,
            triggered_by=triggered_by,
            allow_in_prod=allow_in_prod,
        )
        await self._record_service_event(
            action="seed.apply.api",
            seed_name=name,
            actor_id=actor_id,
            tenant_id=tenant_id,
            project_id=project_id,
            status=result.status,
            duration_ms=result.duration_ms,
        )
        return _run_to_dto(result, tenant_id=tenant_id)

    async def reset(
        self,
        name: str,
        actor_id: UUID,
        triggered_by: str,
        scope: Literal["demo_only", "all"] = "demo_only",
        *,
        tenant_id: UUID | None = None,
        project_id: UUID | None = None,
    ) -> SeedRunRead:
        """Reset (delete) rows owned by a seed package."""
        runner = self._build_runner()
        result = await runner.reset(
            seed_name=name,
            actor_id=actor_id,
            triggered_by=triggered_by,
            scope=scope,
        )
        await self._record_service_event(
            action="seed.reset.api",
            seed_name=name,
            actor_id=actor_id,
            tenant_id=tenant_id,
            project_id=project_id,
            scope=scope,
            status=result.status,
            dropped_rows=result.dropped_rows,
        )
        return _run_to_dto(result, tenant_id=tenant_id)

    async def rollback(
        self,
        name: str,
        actor_id: UUID,
        *,
        tenant_id: UUID | None = None,
        project_id: UUID | None = None,
    ) -> SeedRunRead:
        """Roll back the most recent apply."""
        runner = self._build_runner()
        result = await runner.rollback(
            seed_name=name,
            actor_id=actor_id,
        )
        await self._record_service_event(
            action="seed.rollback.api",
            seed_name=name,
            actor_id=actor_id,
            tenant_id=tenant_id,
            project_id=project_id,
            status=result.status,
        )
        return _run_to_dto(result, tenant_id=tenant_id)

    async def status(self, name: str) -> SeedStatusRead:
        """Return durable state for a seed (apply + drift)."""
        runner = self._build_runner()
        st = await runner.status(name)
        # Augment with drift info from diff if the seed is applied.
        drift: SeedStatusRead.model_fields["drift"].default = "unknown"  # type: ignore[attr-defined]
        row_counts: dict[str, int] = {}
        production_safe = False
        checksum_match = False
        if st.applied:
            try:
                d = await runner.diff(name)
                row_counts = d.actual_row_counts
                checksum_match = d.checksum_match
            except SeedNotFoundError:
                pass
            try:
                m, _ = runner._load_manifest(name)  # noqa: SLF001
                production_safe = bool(
                    (m.get("production_safety") or {}).get("allow_in_prod", False)
                )
            except Exception:  # noqa: BLE001 — best-effort
                production_safe = False
            drift = _drift_label(st.checksum, checksum_match, row_counts)
        return SeedStatusRead(
            seed_name=name,
            applied=st.applied,
            applied_version=st.manifest_version,
            last_run_at=st.last_applied_at,
            last_run_status=st.last_run_status,
            checksum=st.checksum,
            checksum_match=checksum_match,
            drift=drift,
            row_counts=row_counts,
            production_safe=production_safe,
        )

    async def diff(self, name: str) -> SeedDiffRead:
        """Compare expected vs. actual row counts + checksum match."""
        runner = self._build_runner()
        d = await runner.diff(name)
        changes: dict[str, tuple[int, int]] = {}
        for table, expected in d.expected_row_counts.items():
            actual = d.actual_row_counts.get(table, 0)
            if actual != expected:
                changes[table] = (expected, actual)
        summary = _summarize_diff(d, changes)
        return SeedDiffRead(
            seed_name=name,
            checksum_match=d.checksum_match,
            row_count_changes=changes,
            missing_files=[],  # surfaced by apply/list paths, not by diff
            extra_rows={t: a - e for t, (e, a) in changes.items() if a > e},
            summary=summary,
        )

    async def runs(self, name: str, limit: int = 50) -> list[SeedRunRead]:
        """Return recent run history for a seed (newest first)."""
        from sqlalchemy import select

        from app.db.models.seed import SeedRun as SeedRunRow

        factory = self._session_factory
        async with factory() as session:
            res = await session.execute(
                select(SeedRunRow)
                .where(SeedRunRow.seed_name == name)
                .order_by(SeedRunRow.started_at.desc())
                .limit(limit)
            )
            rows = res.scalars().all()
        return [_orm_run_to_dto(r) for r in rows]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _build_runner(self) -> SeedRunner:
        return SeedRunner(
            session_factory=self._session_factory,
            audit_service=self._audit_service,
            env=self._env,
            seeds_root=self._seeds_root,
        )

    async def _record_service_event(
        self,
        *,
        action: str,
        seed_name: str,
        actor_id: UUID,
        tenant_id: UUID | None,
        project_id: UUID | None,
        **extra: Any,
    ) -> None:
        payload: dict[str, Any] = dict(extra)
        try:
            await self._audit_service.record(
                tenant_id=tenant_id or "00000000-0000-0000-0000-000000000000",
                project_id=project_id or "00000000-0000-0000-0000-000000000000",
                actor_id=actor_id,
                action=action,
                target_type="seed",
                target_id=seed_name,
                payload={"seed_name": seed_name, **payload},
            )
        except Exception as exc:  # noqa: BLE001 — audit must never fail a run
            logger.warning("seed.service.audit_failed", action=action, error=str(exc))


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------


def _summary_to_dto(summary: SeedSummary) -> SeedManifestSummary:
    return SeedManifestSummary(
        name=summary.name,
        version=1,  # SeedSummary doesn't expose version; get_seed() is the rich path
        tenant_type=summary.tenant_type if summary.tenant_type in {"demo", "reference", "production"} else "reference",
        description=summary.description,
        depends_on=[],
    )


def _manifest_to_dto(manifest: dict[str, Any]) -> SeedManifestRead:
    data_files = [
        SeedDataFileRead(
            file=str(df["file"]),
            table=str(df["table"]),
            order=int(df["order"]),
            idempotency_key=list(df.get("idempotency_key") or []),
            description=df.get("description"),
        )
        for df in sorted(manifest.get("data_files") or [], key=lambda d: int(d["order"]))
    ]
    return SeedManifestRead(
        name=str(manifest["name"]),
        version=int(manifest["version"]),
        tenant_type=manifest.get("tenant_type", "reference"),
        description=manifest.get("description"),
        depends_on=list(manifest.get("depends_on") or []),
        data_files=data_files,
        row_counts_expected=dict(manifest.get("row_counts_expected") or {}),
        production_safety=dict(manifest.get("production_safety") or {}),
    )


def _run_to_dto(run: SeedRun, *, tenant_id: UUID | None = None) -> SeedRunRead:
    return SeedRunRead(
        id=run.run_id,
        seed_name=run.seed_name,
        manifest_version=run.manifest_version,
        operation=run.operation if run.operation in {"apply", "reset", "rollback"} else "apply",
        status=run.status if run.status in {"running", "completed", "failed", "rolled_back"} else "completed",
        env="unknown",  # SeedRun doesn't carry env; populated from ORM via runs()
        triggered_by="api",
        actor_id=run.run_id,  # placeholder; populated from ORM via runs()
        tenant_id=tenant_id,
        row_counts=run.row_counts,
        dropped_rows=run.dropped_rows,
        checksum_after=run.checksum_after,
        started_at=run.started_at,
        completed_at=run.completed_at,
        duration_ms=run.duration_ms,
        error={k: str(v) for k, v in (run.error or {}).items()},
    )


def _orm_run_to_dto(row: Any) -> SeedRunRead:
    """Map a ``SeedRun`` ORM row to the read DTO (richer than the runner dataclass)."""
    op_value = getattr(row.operation, "value", row.operation)
    status_value = getattr(row.status, "value", row.status)
    env_value = getattr(row.env, "value", row.env) or "unknown"
    return SeedRunRead(
        id=row.id,
        seed_name=row.seed_name,
        manifest_version=row.manifest_version,
        operation=op_value if op_value in {"apply", "reset", "rollback"} else "apply",
        status=status_value if status_value in {"running", "completed", "failed", "rolled_back"} else "completed",
        env=str(env_value),
        triggered_by=row.triggered_by or "unknown",
        actor_id=row.actor_id,
        tenant_id=getattr(row, "tenant_id", None),
        row_counts=dict(row.row_counts or {}),
        dropped_rows=dict(row.dropped_rows or {}),
        checksum_after=row.checksum_after,
        started_at=row.started_at,
        completed_at=row.completed_at,
        duration_ms=row.duration_ms,
        error=dict(row.error or {}),
    )


def _drift_label(stored: str | None, match: bool, row_counts: dict[str, int]) -> Literal["none", "checksum", "row_count", "unknown"]:
    """Classify drift for the status DTO."""
    if stored is None:
        return "unknown"
    if not match:
        return "checksum"
    if any(c > 0 for c in row_counts.values()):
        return "row_count"
    return "none"


def _summarize_diff(d: SeedDiff, changes: dict[str, tuple[int, int]]) -> str:
    """Human-readable roll-up of a diff."""
    if d.checksum_match and not changes:
        return "No drift — checksum and row counts match the manifest."
    bits: list[str] = []
    if not d.checksum_match:
        bits.append("checksum drift")
    if changes:
        bits.append(f"{len(changes)} table(s) with row count drift")
    return "Drift detected: " + ", ".join(bits) + "."


__all__ = ["SeedService"]