"""F-507 — Day-One Bootstrap with Reference Standards.

Loads the KnackForge reference standard library (F-001 baseline catalog)
into a freshly-onboarded project, layers customer-specific overrides on
top, persists the resolved set, and emits an F-005 audit event. The
bootstrap must complete before a project is marked ``active`` — until
it does, downstream services (architecture attestation, policy engine,
ideation intake) cannot trust that the baseline is in place.

Idempotency contract (F-507): re-running ``load_baseline`` for the same
project must not duplicate references. The persisted state is keyed by
``(tenant_id, project_id, run_id)`` and a fingerprint of the resolved
bundle is stored on the run row so that a subsequent call with the same
inputs is a no-op and a subsequent call with different inputs replaces
the prior references in-place.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.audit import AuditEvent
from app.db.models.policy import Policy, PolicySeverity
from app.db.models.standard import Standard
from app.db.models.template import Template
from app.db.session import get_session_factory
from app.schemas.day_one_bootstrap import (
    BootstrapResult,
    BootstrapStatus,
    BootstrapStatusRead,
    Policy as PolicyDTO,
    Standard as StandardDTO,
    SteeringRule,
    Template as TemplateDTO,
)
from app.services.audit_service import audit_service

# M2 T-A3 — Day-One Bootstrap persists Standards / Templates / Policies /
# SteeringRule rows that all mutate project state.  Decorate the public
# ``load_baseline`` and ``rerun`` entry points so the bootstrap cannot run
# without a recorded PLANNING approval.  Read-only helpers
# (``get_status``, ``status_read``, ``is_project_bootstrap_ready``) are
# left undecorated — they don't write artifacts.
from app.agents.approval_gate import require_approval_phase  # noqa: E402
from app.agents.sdlc_state import SDLCPhase  # noqa: E402

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class BootstrapError(RuntimeError):
    """Raised when a bootstrap operation is invalid or fails."""


# ---------------------------------------------------------------------------
# Reference baseline (F-001 catalog seed)
# ---------------------------------------------------------------------------
#
# In production this is loaded from the F-001 standards library. To keep
# the bootstrap service self-contained and testable, we ship a minimal
# baseline here. The shape matches what F-001 returns: a dict keyed by
# entity kind whose values are lists of dicts ready to be projected to
# typed DTOs.


_KNACKFORGE_BASELINE: dict[str, list[dict[str, Any]]] = {
    "standards": [
        {
            "name": "KFG-STD-001: API Design",
            "content": "All public HTTP APIs MUST follow REST resource modeling, "
            "use plural noun collection paths, and document every endpoint "
            "with an OpenAPI 3.1 contract under /contracts/.",
            "version": 1,
            "metadata": {"domain": "architecture", "severity": "warn"},
        },
        {
            "name": "KFG-STD-002: Test Coverage",
            "content": "All merged code MUST be covered by automated tests; line "
            "coverage must be >= 80% on changed files and every new public "
            "function MUST have at least one unit test.",
            "version": 1,
            "metadata": {"domain": "quality", "severity": "block"},
        },
        {
            "name": "KFG-STD-003: Secrets Handling",
            "content": "No secrets in source control. All credentials MUST flow "
            "through the connector credentials vault. Detected secret-like "
            "patterns fail the build.",
            "version": 1,
            "metadata": {"domain": "security", "severity": "block"},
        },
        {
            "name": "KFG-STD-004: ADR Required",
            "content": "Every architecture-impacting change MUST be accompanied "
            "by a Forge ADR artifact with traceability to the requirement.",
            "version": 1,
            "metadata": {"domain": "architecture", "severity": "warn"},
        },
    ],
    "templates": [
        {
            "type": "adr",
            "name": "ADR Default Scaffold",
            "content": {
                "sections": [
                    "Context",
                    "Decision",
                    "Consequences",
                    "Alternatives Considered",
                ],
                "placeholders": {"title": "", "status": "proposed", "deciders": []},
            },
            "variables": [
                {"name": "title", "type": "string", "required": True},
                {"name": "status", "type": "enum", "values": ["proposed", "accepted", "superseded"]},
                {"name": "deciders", "type": "list<string>", "required": False},
            ],
            "version": 1,
        },
        {
            "type": "task",
            "name": "Task Breakdown Default Scaffold",
            "content": {
                "sections": ["Goal", "Acceptance Criteria", "Dependencies", "Estimate"],
                "placeholders": {"epic_id": "", "estimate_points": 3},
            },
            "variables": [
                {"name": "epic_id", "type": "uuid", "required": True},
                {"name": "estimate_points", "type": "int", "required": True},
            ],
            "version": 1,
        },
        {
            "type": "risk",
            "name": "Risk Register Default Scaffold",
            "content": {
                "sections": ["Description", "Likelihood", "Impact", "Mitigation", "Owner"],
                "placeholders": {"owner": ""},
            },
            "variables": [
                {"name": "owner", "type": "string", "required": True},
            ],
            "version": 1,
        },
    ],
    "policies": [
        {
            "name": "KFG-POL-001: Block on missing ADR",
            "description": "Block promotion of any change that lacks a linked ADR.",
            "expression": {
                "all": [{"var": "artifact.adr_id"}, {"!=": [{"var": "artifact.adr_id"}, None]}]
            },
            "severity": "block",
            "enabled": True,
        },
        {
            "name": "KFG-POL-002: Warn on coverage drop",
            "description": "Warn when PR coverage falls below project baseline.",
            "expression": {">=": [{"var": "pr.coverage_delta"}, 0]},
            "severity": "warn",
            "enabled": True,
        },
    ],
    "steering_rules": [
        {
            "name": "KFG-RULE-001: Prefer Postgres",
            "description": "All new persistence MUST target Postgres 17 unless an exception is recorded.",
            "applies_to": "*",
            "expression": {
                "all": [
                    {"in": [{"var": "artifact.db_engine"}, ["postgres", "postgresql", None]]}
                ]
            },
            "source": "baseline",
        },
    ],
}


def _empty_bundle() -> dict[str, list[dict[str, Any]]]:
    return {
        "standards": [],
        "templates": [],
        "policies": [],
        "steering_rules": [],
    }


def _fingerprint(bundle: dict[str, list[dict[str, Any]]]) -> str:
    """Deterministic hash of a resolved bundle, used for idempotency."""
    payload = json.dumps(bundle, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------


@dataclass
class _BootstrapRunRow:
    """In-memory view of a bootstrap run row.

    We deliberately do NOT introduce a new DB table — the audit trail
    (F-005 / ``AuditEvent``) is the system of record for bootstrap
    history (Rule 6). A small JSON row is persisted as a project-scoped
    ``Standard`` of type ``day_one_bootstrap`` so it is queryable and
    idempotent at the same time. This mirrors the pattern used by F-308
    standards attestation.
    """

    run_id: UUID
    tenant_id: UUID
    project_id: UUID
    status: BootstrapStatus
    counts: dict[str, int]
    started_at: datetime
    completed_at: datetime | None
    error: str | None
    fingerprint: str

    @property
    def storage_standard_name(self) -> str:
        # The Standard row name that holds the bundle's fingerprint + metadata.
        return f"day_one_bootstrap:{self.run_id}"


async def _load_run_row_async(
    tenant_id: UUID | str, project_id: UUID | str
) -> _BootstrapRunRow | None:
    factory = get_session_factory()
    tid = str(tenant_id)
    pid = str(project_id)
    stmt = (
        select(Standard)
        .where(
            Standard.tenant_id == tid,
            Standard.project_id == pid,
            Standard.name.like("day_one_bootstrap:%"),
        )
        .order_by(Standard.created_at.desc())
        .limit(1)
    )
    async with factory() as session:
        row: Standard | None = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    meta = dict(row.metadata_ or {})
    return _BootstrapRunRow(
        run_id=UUID(str(meta["run_id"])),
        tenant_id=UUID(tid),
        project_id=UUID(pid),
        status=BootstrapStatus(str(meta.get("status", BootstrapStatus.NOT_STARTED.value))),
        counts=dict(meta.get("counts", {})),
        started_at=row.created_at,
        completed_at=row.updated_at if meta.get("status") == BootstrapStatus.COMPLETED.value else None,
        error=meta.get("error"),
        fingerprint=str(meta.get("fingerprint", "")),
    )


async def _persist_run_row(row: _BootstrapRunRow) -> None:
    """Upsert the bootstrap-run Standard row keyed by run_id."""
    factory = get_session_factory()
    storage_name = row.storage_standard_name
    stmt = select(Standard).where(
        Standard.tenant_id == str(row.tenant_id),
        Standard.project_id == str(row.project_id),
        Standard.name == storage_name,
    )
    async with factory() as session:
        existing: Standard | None = (await session.execute(stmt)).scalar_one_or_none()
        meta = {
            "kind": "day_one_bootstrap",
            "run_id": str(row.run_id),
            "status": row.status.value,
            "counts": row.counts,
            "fingerprint": row.fingerprint,
        }
        if row.error:
            meta["error"] = row.error
        if existing is not None:
            existing.status = row.status.value
            existing.metadata_ = meta
            existing.version = existing.version + 1
        else:
            session.add(
                Standard(
                    tenant_id=str(row.tenant_id),
                    project_id=str(row.project_id),
                    name=storage_name,
                    content=json.dumps(
                        {
                            "run_id": str(row.run_id),
                            "status": row.status.value,
                            "started_at": row.started_at.isoformat(),
                            "completed_at": row.completed_at.isoformat()
                            if row.completed_at
                            else None,
                            "counts": row.counts,
                            "fingerprint": row.fingerprint,
                        },
                        default=str,
                    ),
                    status=row.status.value,
                    version=1,
                    metadata_=meta,
                )
            )
        await session.commit()


# ---------------------------------------------------------------------------
# Project metadata overlay
# ---------------------------------------------------------------------------


def _project_overlay(
    project_metadata: dict[str, Any] | None,
) -> dict[str, list[dict[str, Any]]]:
    """Read the customer-specific overlay from project metadata.

    The overlay is a dict with the same shape as the baseline. The
    caller is responsible for reading ``project.metadata`` (or a
    per-project config row) and passing it in; this keeps the service
    decoupled from any particular project storage layout.
    """
    if not project_metadata:
        return _empty_bundle()
    overlay = project_metadata.get("day_one_overlay") or {}
    return {
        "standards": list(overlay.get("standards", [])),
        "templates": list(overlay.get("templates", [])),
        "policies": list(overlay.get("policies", [])),
        "steering_rules": list(overlay.get("steering_rules", [])),
    }


def _merge_overlay(
    baseline: dict[str, list[dict[str, Any]]],
    overlay: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """Layer overlay entries over the baseline, keyed by ``name``.

    For each kind, an overlay entry with the same ``name`` as a
    baseline entry wins and is tagged ``source='overlay'``. Entries
    that exist only in the overlay are appended. Order is stable:
    baseline first, then any purely-overlaid entries.
    """
    out: dict[str, list[dict[str, Any]]] = {}
    for kind in ("standards", "templates", "policies", "steering_rules"):
        baseline_entries = [dict(e) for e in baseline.get(kind, [])]
        overlay_entries = [dict(e) for e in overlay.get(kind, [])]

        by_name: dict[str, dict[str, Any]] = {}
        for e in baseline_entries:
            e["source"] = "baseline"
            by_name[str(e["name"])] = e
        appended: list[dict[str, Any]] = []
        for e in overlay_entries:
            name = str(e.get("name"))
            if name in by_name:
                merged = {**by_name[name], **e, "source": "overlay"}
                by_name[name] = merged
            else:
                e["source"] = "overlay"
                appended.append(e)

        out[kind] = list(by_name.values()) + appended
    return out


# ---------------------------------------------------------------------------
# Public service
# ---------------------------------------------------------------------------


class DayOneBootstrapService:
    """Run, query, and re-run the Day-One Bootstrap for a project."""

    # ----- baseline loading -------------------------------------------------

    @require_approval_phase(SDLCPhase.PLANNING)
    async def load_baseline(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        project_metadata: dict[str, Any] | None = None,
    ) -> BootstrapResult:
        """Run the bootstrap, persist resolved state, and emit an audit event.

        Idempotent: if the most recent run for the project has the same
        fingerprint as the resolved bundle, the call is a no-op and the
        stored result is returned without re-writing.
        """
        run_id = uuid.uuid4()
        tid = str(tenant_id) if tenant_id is not None else None
        pid = str(project_id)

        if tid is None:
            # Bootstrap must always be tenant-scoped (Rule 2). If the
            # caller didn't supply one, look it up from the project's
            # onboarding session — best-effort, falls back to a
            # placeholder with an audit warning.
            tid = await self._resolve_tenant_id(pid)
            if tid is None:
                logger.warning("bootstrap.tenant_id_missing", project_id=pid)
                tid = "00000000-0000-0000-0000-000000000000"

        started_at = datetime.now(timezone.utc)

        # 1. Resolve bundle.
        baseline = {
            kind: list(entries)
            for kind, entries in _KNACKFORGE_BASELINE.items()
        }
        overlay = _project_overlay(project_metadata)
        bundle = _merge_overlay(baseline, overlay)
        fingerprint = _fingerprint(bundle)

        # 2. Idempotency check.
        prior = await _load_run_row_async(tid, pid)
        if (
            prior is not None
            and prior.status == BootstrapStatus.COMPLETED
            and prior.fingerprint == fingerprint
        ):
            logger.info(
                "bootstrap.idempotent_no_op",
                project_id=pid,
                run_id=str(prior.run_id),
            )
            return await self.get_status(project_id=pid, tenant_id=tid)

        # 3. Persist project-scoped references for downstream services.
        counts = await self._persist_resolved(
            tenant_id=tid,
            project_id=pid,
            bundle=bundle,
        )

        # 4. Mark project metadata in a sidecar so the wizard can flip
        #    the project to 'active' only after this completes.
        await self._mark_bootstrap_completed(tid, pid, fingerprint)

        completed_at = datetime.now(timezone.utc)

        # 5. Update the run row.
        run_row = _BootstrapRunRow(
            run_id=run_id,
            tenant_id=UUID(tid),
            project_id=UUID(pid),
            status=BootstrapStatus.COMPLETED,
            counts=counts,
            started_at=started_at,
            completed_at=completed_at,
            error=None,
            fingerprint=fingerprint,
        )
        await _persist_run_row(run_row)

        # 6. Audit (Rule 6 / F-005).
        await audit_service.record(
            tenant_id=tid,
            project_id=pid,
            actor_id=actor_id,
            action="day_one_bootstrap.completed",
            target_type="project",
            target_id=pid,
            payload={
                "run_id": str(run_id),
                "fingerprint": fingerprint,
                "counts": counts,
            },
        )

        logger.info(
            "bootstrap.completed",
            project_id=pid,
            run_id=str(run_id),
            counts=counts,
        )

        # 7. Post-commit seed hook (F-821 / Plan B commit 5).
        # The kn-base reference seed is applied AFTER the bootstrap commits
        # so a seed failure cannot roll back the project bootstrap state.
        # If the seed is unavailable or fails, the bootstrap remains
        # successful — the seed is a best-effort content overlay that the
        # admin can re-trigger from /admin/seeds.
        await self._apply_kn_base_post_commit(
            tenant_id=tid,
            project_id=pid,
            actor_id=actor_id,
        )

        # 8. Sample-data seed hook (M9-G2). Also post-commit and
        # best-effort: after the bootstrap commits, load 1 sample
        # connector + 1 sample ADR + 1 sample idea into the new
        # tenant/project so the dashboard isn't empty on first login,
        # and emit ``BOOTSTRAP_SAMPLE_DATA_LOADED``. A failure here must
        # never roll back the completed bootstrap.
        await self._load_sample_data_on_completion(
            tenant_id=tid,
            project_id=pid,
            run_id=run_id,
            actor_id=actor_id,
        )

        return await self.get_status(project_id=pid, tenant_id=tid)

    # ----- status & rerun ---------------------------------------------------

    async def get_status(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str | None = None,
    ) -> BootstrapResult:
        """Return the current bootstrap state for a project.

        If the project has not been bootstrapped, returns a
        ``NOT_STARTED`` result with empty collections (this is the
        default; the wizard uses it to gate the project-active flag).
        """
        tid = str(tenant_id) if tenant_id else None
        pid = str(project_id)
        run = await _load_run_row_async(tid, pid) if tid else None
        if run is None:
            return await self._build_result(
                tenant_id=tid or "00000000-0000-0000-0000-000000000000",
                project_id=pid,
                status=BootstrapStatus.NOT_STARTED,
                run_id=None,
                completed_at=None,
                error=None,
            )

        # Re-hydrate the bundle from the persisted references.
        standards = await self._list_project_standards(tid, pid)
        templates = await self._list_project_templates(tid, pid)
        policies = await self._list_project_policies(tid, pid)
        steering = await self._list_project_steering(tid, pid)

        return BootstrapResult(
            tenant_id=UUID(tid),
            project_id=UUID(pid),
            status=run.status,
            standards=[StandardDTO.model_validate(s) for s in standards],
            templates=[TemplateDTO.model_validate(t) for t in templates],
            governance_policies=[PolicyDTO.model_validate(p) for p in policies],
            steering_rules=[SteeringRule.model_validate(r) for r in steering],
            run_id=run.run_id,
            completed_at=run.completed_at,
            error=run.error,
            created_at=run.started_at,
            updated_at=run.completed_at or run.started_at,
        )

    @require_approval_phase(SDLCPhase.PLANNING)
    async def rerun(
        self,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        project_metadata: dict[str, Any] | None = None,
    ) -> BootstrapResult:
        """Idempotent rerun — calls ``load_baseline`` with the same semantics.

        A rerun with the same overlay produces an identical result and
        does not duplicate references. A rerun with a different overlay
        replaces the prior references in-place.
        """
        return await self.load_baseline(
            project_id=project_id,
            tenant_id=tenant_id,
            actor_id=actor_id,
            project_metadata=project_metadata,
        )

    # ----- internals --------------------------------------------------------

    async def _build_result(
        self,
        *,
        tenant_id: str,
        project_id: str,
        status: BootstrapStatus,
        run_id: UUID | None,
        completed_at: datetime | None,
        error: str | None,
    ) -> BootstrapResult:
        now = datetime.now(timezone.utc)
        return BootstrapResult(
            tenant_id=UUID(tenant_id),
            project_id=UUID(project_id),
            status=status,
            standards=[],
            templates=[],
            governance_policies=[],
            steering_rules=[],
            run_id=run_id,
            completed_at=completed_at,
            error=error,
            created_at=now,
            updated_at=now,
        )

    async def _resolve_tenant_id(self, project_id: str) -> str | None:
        """Best-effort tenant lookup via the latest onboarding session."""
        from app.db.models.onboarding import OnboardingSession

        factory = get_session_factory()
        stmt = (
            select(OnboardingSession)
            .where(OnboardingSession.project_id == project_id)
            .order_by(OnboardingSession.created_at.desc())
            .limit(1)
        )
        async with factory() as session:
            row = (await session.execute(stmt)).scalar_one_or_none()
        return str(row.tenant_id) if row else None

    async def _persist_resolved(
        self,
        *,
        tenant_id: str,
        project_id: str,
        bundle: dict[str, list[dict[str, Any]]],
    ) -> dict[str, int]:
        """Upsert project-scoped reference rows.

        We deliberately re-use the existing ``standards`` / ``templates``
        / ``policies`` tables (F-001/F-002/F-003) and scope them to the
        project via ``project_id``. Org-level baseline rows
        (``project_id IS NULL``) remain untouched.

        Idempotency strategy: for each entry, key by
        ``(tenant_id, project_id, name)``. If a row exists, update
        ``content`` / ``metadata_`` and bump ``version``. If not,
        insert.
        """
        factory = get_session_factory()
        counts = {"standards": 0, "templates": 0, "policies": 0, "steering_rules": 0}
        async with factory() as session:
            # Standards
            for entry in bundle["standards"]:
                name = str(entry["name"])
                stmt = select(Standard).where(
                    Standard.tenant_id == tenant_id,
                    Standard.project_id == project_id,
                    Standard.name == name,
                )
                existing: Standard | None = (
                    await session.execute(stmt)
                ).scalar_one_or_none()
                meta = dict(entry.get("metadata", {}))
                meta["bootstrap_source"] = entry.get("source", "baseline")
                meta["bootstrap_kind"] = "day_one"
                if existing is None:
                    session.add(
                        Standard(
                            tenant_id=tenant_id,
                            project_id=project_id,
                            name=name,
                            content=str(entry["content"]),
                            status=str(entry.get("status", "active")),
                            version=int(entry.get("version", 1)),
                            metadata_=meta,
                        )
                    )
                else:
                    existing.content = str(entry["content"])
                    existing.status = str(entry.get("status", "active"))
                    existing.version = existing.version + 1
                    existing.metadata_ = meta
                counts["standards"] += 1

            # Templates
            for entry in bundle["templates"]:
                name = str(entry["name"])
                stmt = select(Template).where(
                    Template.tenant_id == tenant_id,
                    Template.project_id == project_id,
                    Template.name == name,
                )
                existing: Template | None = (
                    await session.execute(stmt)
                ).scalar_one_or_none()
                if existing is None:
                    session.add(
                        Template(
                            tenant_id=tenant_id,
                            project_id=project_id,
                            type=str(entry["type"]),
                            name=name,
                            content=dict(entry.get("content", {})),
                            variables=list(entry.get("variables", [])),
                            version=int(entry.get("version", 1)),
                        )
                    )
                else:
                    existing.type = str(entry["type"])
                    existing.content = dict(entry.get("content", {}))
                    existing.variables = list(entry.get("variables", []))
                    existing.version = existing.version + 1
                counts["templates"] += 1

            # Policies — tenant-scoped (F-003 has no project_id), so we
            # suffix the policy name with the project id to keep the
            # project-local set isolated.
            for entry in bundle["policies"]:
                name = str(entry["name"])
                stmt = select(Policy).where(
                    Policy.tenant_id == tenant_id,
                    Policy.name == name,
                )
                existing: Policy | None = (
                    await session.execute(stmt)
                ).scalar_one_or_none()
                sev_value = str(entry.get("severity", "warn"))
                try:
                    severity = PolicySeverity(sev_value)
                except ValueError:
                    severity = PolicySeverity.WARN
                if existing is None:
                    session.add(
                        Policy(
                            tenant_id=tenant_id,
                            name=name,
                            description=entry.get("description"),
                            expression=dict(entry.get("expression", {})),
                            severity=severity,
                            enabled=bool(entry.get("enabled", True)),
                        )
                    )
                else:
                    existing.description = entry.get("description")
                    existing.expression = dict(entry.get("expression", {}))
                    existing.severity = severity
                    existing.enabled = bool(entry.get("enabled", True))
                counts["policies"] += 1

            # Steering rules — persisted as project-scoped Standards
            # with a sentinel name prefix, since they share the same
            # shape (name, content, metadata).
            for entry in bundle["steering_rules"]:
                name = f"steering:{entry['name']}"
                stmt = select(Standard).where(
                    Standard.tenant_id == tenant_id,
                    Standard.project_id == project_id,
                    Standard.name == name,
                )
                existing: Standard | None = (
                    await session.execute(stmt)
                ).scalar_one_or_none()
                meta = {
                    "applies_to": entry.get("applies_to", "*"),
                    "expression": entry.get("expression", {}),
                    "bootstrap_source": entry.get("source", "overlay"),
                    "bootstrap_kind": "day_one_steering",
                }
                content = json.dumps(
                    {
                        "description": entry.get("description"),
                        "applies_to": entry.get("applies_to", "*"),
                        "expression": entry.get("expression", {}),
                    },
                    default=str,
                )
                if existing is None:
                    session.add(
                        Standard(
                            tenant_id=tenant_id,
                            project_id=project_id,
                            name=name,
                            content=content,
                            status="active",
                            version=1,
                            metadata_=meta,
                        )
                    )
                else:
                    existing.content = content
                    existing.status = "active"
                    existing.version = existing.version + 1
                    existing.metadata_ = meta
                counts["steering_rules"] += 1

            await session.commit()
        return counts

    async def _mark_bootstrap_completed(
        self,
        tenant_id: str,
        project_id: str,
        fingerprint: str,
    ) -> None:
        """Record bootstrap completion in audit so wizard can gate active.

        Until this audit event is observed, the project must remain
        ``pending_bootstrap`` — F-021 wizard reads it on completion.
        """
        factory = get_session_factory()
        async with factory() as session:
            session.add(
                AuditEvent(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=None,
                    action="day_one_bootstrap.gate",
                    target_type="project",
                    target_id=project_id,
                    payload={"fingerprint": fingerprint, "ready": True},
                    occurred_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()

    async def _list_project_standards(
        self, tenant_id: str, project_id: str
    ) -> list[dict[str, Any]]:
        """Project-scoped standards + the bootstrap marker row, minus it."""
        factory = get_session_factory()
        stmt = (
            select(Standard)
            .where(
                Standard.tenant_id == tenant_id,
                Standard.project_id == project_id,
            )
            .order_by(Standard.name)
        )
        async with factory() as session:
            rows = list((await session.execute(stmt)).scalars().all())
        out: list[dict[str, Any]] = []
        for r in rows:
            if r.name.startswith("day_one_bootstrap:") or r.name.startswith("steering:"):
                continue
            out.append(
                {
                    "name": r.name,
                    "content": r.content,
                    "version": r.version,
                    "status": r.status,
                    "source": (r.metadata_ or {}).get("bootstrap_source", "baseline"),
                    "metadata": dict(r.metadata_ or {}),
                }
            )
        return out

    async def _list_project_templates(
        self, tenant_id: str, project_id: str
    ) -> list[dict[str, Any]]:
        factory = get_session_factory()
        stmt = (
            select(Template)
            .where(
                Template.tenant_id == tenant_id,
                Template.project_id == project_id,
            )
            .order_by(Template.name)
        )
        async with factory() as session:
            rows = list((await session.execute(stmt)).scalars().all())
        return [
            {
                "type": r.type,
                "name": r.name,
                "content": dict(r.content or {}),
                "variables": list(r.variables or []),
                "version": r.version,
                "source": "baseline",
            }
            for r in rows
        ]

    async def _list_project_policies(
        self, tenant_id: str, project_id: str
    ) -> list[dict[str, Any]]:
        # Policies are tenant-scoped; for a project bootstrap we return
        # the tenant's full set so the read is honest about what is
        # available. (Idempotency in the persistence step ensures we
        # don't double-write the same row.)
        factory = get_session_factory()
        stmt = select(Policy).where(Policy.tenant_id == tenant_id).order_by(Policy.name)
        async with factory() as session:
            rows = list((await session.execute(stmt)).scalars().all())
        out: list[dict[str, Any]] = []
        for r in rows:
            # Policy has no metadata_ column (F-003) — source defaults to baseline.
            out.append(
                {
                    "name": r.name,
                    "description": r.description,
                    "expression": dict(r.expression or {}),
                    "severity": r.severity.value if hasattr(r.severity, "value") else str(r.severity),
                    "enabled": bool(r.enabled),
                    "source": "baseline",
                }
            )
        return out

    async def _list_project_steering(
        self, tenant_id: str, project_id: str
    ) -> list[dict[str, Any]]:
        factory = get_session_factory()
        stmt = (
            select(Standard)
            .where(
                Standard.tenant_id == tenant_id,
                Standard.project_id == project_id,
                Standard.name.like("steering:%"),
            )
            .order_by(Standard.name)
        )
        async with factory() as session:
            rows = list((await session.execute(stmt)).scalars().all())
        out: list[dict[str, Any]] = []
        for r in rows:
            try:
                blob = json.loads(r.content)
            except (TypeError, ValueError):
                blob = {}
            meta = dict(r.metadata_ or {})
            out.append(
                {
                    "name": r.name.split(":", 1)[1],
                    "description": blob.get("description"),
                    "applies_to": blob.get("applies_to", "*"),
                    "expression": blob.get("expression", {}),
                    "source": meta.get("bootstrap_source", "overlay"),
                }
            )
        return out

    # ----- helpers used by tests / wizard -----------------------------------

    async def status_read(
        self, project_id: UUID | str, *, tenant_id: UUID | str | None = None
    ) -> BootstrapStatusRead:
        """Lightweight read for the status endpoint."""
        tid = str(tenant_id) if tenant_id else None
        pid = str(project_id)
        run = await _load_run_row_async(tid, pid) if tid else None
        if run is None:
            return BootstrapStatusRead(
                project_id=UUID(pid),
                status=BootstrapStatus.NOT_STARTED,
                run_id=None,
                counts={},
                started_at=None,
                completed_at=None,
                error=None,
            )
        return BootstrapStatusRead(
            project_id=run.project_id,
            status=run.status,
            run_id=run.run_id,
            counts=run.counts,
            started_at=run.started_at,
            completed_at=run.completed_at,
            error=run.error,
        )

    async def is_project_bootstrap_ready(
        self, project_id: UUID | str, *, tenant_id: UUID | str | None = None
    ) -> bool:
        """True iff the most recent bootstrap for the project is COMPLETED.

        Used by the F-021 wizard to gate the project-active transition.
        """
        run = await _load_run_row_async(
            tenant_id or "00000000-0000-0000-0000-000000000000", project_id
        )
        return run is not None and run.status == BootstrapStatus.COMPLETED

    # ----- F-821 / Plan B commit 5: post-commit kn-base seed hook --------

    async def _apply_kn_base_post_commit(
        self,
        *,
        tenant_id: str,
        project_id: str,
        actor_id: UUID | str | None,
    ) -> None:
        """Apply the ``kn-base`` reference seed after the bootstrap commits.

        This hook is called from :meth:`load_baseline` AFTER every step
        has committed, so a failure here cannot roll back the project
        bootstrap state. The hook is best-effort: any exception is
        logged and swallowed so the bootstrap returns ``COMPLETED``
        even when the seed package is missing or broken.

        The actor_id is a system UUID when the bootstrap is triggered
        by F-021 onboarding; the seed's audit trail captures it so
        the timeline shows ``triggered_by='bootstrap'``.
        """
        try:
            # Lazy import: avoid a circular dep between services and
            # the seed framework, and let the CLI exist without the
            # bootstrap importing it.
            from uuid import UUID as _UUID

            from seeds.framework.seed_runner import SeedRunner

            system_actor: _UUID
            try:
                system_actor = _UUID(str(actor_id)) if actor_id else _UUID(int=0)
            except (ValueError, AttributeError, TypeError):
                system_actor = _UUID(int=0)

            runner = SeedRunner(
                session_factory=get_session_factory(),
                audit_service=audit_service,
                env=__import__(
                    "app.core.config", fromlist=["settings"]
                ).settings.environment,
            )
            try:
                await runner.apply(
                    seed_name="kn-base",
                    actor_id=system_actor,
                    triggered_by="bootstrap",
                )
                logger.info(
                    "bootstrap.kn_base.applied",
                    project_id=project_id,
                    tenant_id=tenant_id,
                )
                # ponytail: also seed the ideation pipeline (Step-57-v2
                # Zone 4) — `seed_ideation.seed()` is idempotent and
                # no-ops when ideas already exist, so it's safe to call
                # on every bootstrap. Runs only for the acme-corp
                # tenant (guarded inside the seed itself).
                try:
                    from scripts.seed_ideation import seed as seed_ideation

                    await seed_ideation()
                    logger.info(
                        "bootstrap.ideation.applied",
                        project_id=project_id,
                        tenant_id=tenant_id,
                    )
                except Exception as ideation_exc:  # noqa: BLE001
                    logger.warning(
                        "bootstrap.ideation.skipped",
                        project_id=project_id,
                        tenant_id=tenant_id,
                        error=str(ideation_exc),
                    )
            except Exception as apply_exc:  # noqa: BLE001 — best-effort
                # Seed package may not be on disk yet (Plan D ships
                # the data); treat that as a no-op with a warning.
                logger.warning(
                    "bootstrap.kn_base.skipped",
                    project_id=project_id,
                    tenant_id=tenant_id,
                    error=str(apply_exc),
                )
                try:
                    await audit_service.record(
                        tenant_id=tenant_id,
                        project_id=project_id,
                        actor_id=actor_id,
                        action="seed.bootstrap.skipped",
                        target_type="seed",
                        target_id="kn-base",
                        payload={"reason": str(apply_exc)},
                    )
                except Exception:  # noqa: BLE001 — audit failure must not bubble
                    pass
        except Exception as exc:  # noqa: BLE001 — final safety net
            # Anything in the import path / runner construction that
            # fails must NOT propagate to the bootstrap caller.
            logger.warning(
                "bootstrap.kn_base.unavailable",
                project_id=project_id,
                tenant_id=tenant_id,
                error=str(exc),
            )

    async def _load_sample_data_on_completion(
        self,
        *,
        tenant_id: str,
        project_id: str,
        run_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> None:
        """Load the M9-G2 sample seed after the bootstrap commits.

        Best-effort, post-commit companion to
        :meth:`_apply_kn_base_post_commit`: seeds 1 sample connector +
        1 sample ADR + 1 sample idea into the new tenant/project (idspace
        ``sample-<tenant_id>``) and emits
        ``EventType.BOOTSTRAP_SAMPLE_DATA_LOADED``. Any exception is
        logged and swallowed so the bootstrap still returns COMPLETED.

        The loader lives in :mod:`app.services.project_onboarding.sample_data`
        (no LangGraph deps) so the onboarding suite can exercise it
        directly; here we just guard it.
        """
        try:
            from app.services.project_onboarding.sample_data import (  # noqa: PLC0415
                load_sample_data,
            )

            summary = await load_sample_data(
                tenant_id=tenant_id,
                project_id=project_id,
                run_id=run_id,
                actor_id=actor_id,
            )
            logger.info(
                "bootstrap.sample_data.applied",
                project_id=project_id,
                tenant_id=tenant_id,
                loaded=summary.get("loaded"),
                skipped=summary.get("skipped"),
            )
        except Exception as exc:  # noqa: BLE001 — best-effort, must not bubble
            logger.warning(
                "bootstrap.sample_data.skipped",
                project_id=project_id,
                tenant_id=tenant_id,
                error=str(exc),
            )


# Module-level singleton — matches the rest of the backend.
day_one_bootstrap = DayOneBootstrapService()


__all__ = [
    "DayOneBootstrapService",
    "day_one_bootstrap",
    "BootstrapError",
]
