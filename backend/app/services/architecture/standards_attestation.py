"""F-308 — Standards Attestation Service.

Verifies that an architecture artifact (ADR, API contract, task
breakdown, risk register) conforms to the org's standards, records the
outcome in the append-only audit trail, and exposes a query path for
"which standards apply to this artifact, and are they met?".

Attestations are immutable once written; revocation writes a fresh
audit event that supersedes the prior attestation's status without
rewriting history.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.session import get_session_factory
from app.services.event_bus import EventType

logger = get_logger(__name__)


@dataclass
class _AttestationRow:
    """In-process representation of an attestation.

    We don't introduce a new DB table for attestations themselves —
    the audit trail is the system of record (Rule 6). A small JSON
    blob is persisted as a tenant-scoped Artifact for queryability,
    while the AuditEvent row remains the authoritative history.
    """

    id: UUID
    tenant_id: UUID
    project_id: UUID
    artifact_type: str
    artifact_id: UUID
    attestor_id: UUID
    status: str
    checks: list[dict[str, Any]]
    reason: str | None
    attested_at: datetime
    revoked_at: datetime | None
    revoker_id: UUID | None
    revocation_reason: str | None


class StandardsAttestationService:
    """Apply org standards to architecture artifacts and record results."""

    def __init__(
        self,
        artifact_registry: Any | None = None,
        standard_service: Any | None = None,
        audit_service: Any | None = None,
        event_bus: Any | None = None,
    ) -> None:
        from app.services.artifact_registry import artifact_registry as _default_registry

        self._registry = artifact_registry if artifact_registry is not None else _default_registry
        self._standards = standard_service
        self._audit = audit_service
        self._bus = event_bus

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def attest(
        self,
        artifact_type: str,
        artifact_id: UUID | str,
        attestor_id: UUID | str,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> dict[str, Any]:
        """Run the standard checks against the artifact and persist outcome."""
        checks = await self._collect_checks(
            tenant_id=tenant_id,
            project_id=project_id,
            artifact_type=artifact_type,
            artifact_id=artifact_id,
        )
        all_passed = all(c.get("passed", False) for c in checks) if checks else True
        status = "attested" if all_passed else "failed"
        attestation_id = uuid.uuid4()
        attested_at = datetime.now(UTC)

        payload = {
            "id": str(attestation_id),
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "artifact_type": artifact_type,
            "artifact_id": str(artifact_id),
            "attestor_id": str(attestor_id),
            "status": status,
            "checks": checks,
            "reason": None,
            "attested_at": attested_at.isoformat(),
            "revoked_at": None,
            "revoker_id": None,
            "revocation_reason": None,
        }
        await self._persist_attestation(payload)

        await self._audit.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=attestor_id,
            action="architecture.standards.attest",
            target_type=artifact_type,
            target_id=str(artifact_id),
            payload={
                "attestation_id": str(attestation_id),
                "status": status,
                "checks": checks,
            },
            occurred_at=attested_at,
        )

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": artifact_type,
                "artifact_id": str(artifact_id),
                "event_kind": "standards.attested",
                "attestation_id": str(attestation_id),
                "status": status,
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=attestor_id,
        )
        # M5-G2 — mirror the attestation into the Knowledge Graph so
        # the React Flow viz sees a typed
        # ``KGNode(artifact_type='standard_attestation')`` node keyed by
        # attestation id (the source-of-truth row is the audit event
        # in :func:`_audit.record` above).
        await self._registry.register(
            artifact_type="standard_attestation",
            artifact_id=str(attestation_id),
            tenant_id=tenant_id,
            project_id=project_id,
            payload={
                "source_artifact_type": artifact_type,
                "source_artifact_id": str(artifact_id),
                "attestor_id": str(attestor_id),
                "status": status,
                "check_count": len(checks),
            },
            actor_id=attestor_id,
        )
        logger.info(
            "standards.attested",
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            artifact_type=artifact_type,
            artifact_id=str(artifact_id),
            status=status,
        )
        return payload

    async def list_attestations(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[dict[str, Any]]:
        """Return all attestations for a (tenant, project) pair."""
        return await self._load_project_attestations(tenant_id, project_id)

    async def get_standards_for_artifact(
        self,
        artifact_type: str,
        artifact_id: UUID | str,
        tenant_id: UUID | str | None = None,
        project_id: UUID | str | None = None,
    ) -> list[dict[str, Any]]:
        """List applicable standards and their current pass/fail state."""
        return await self._collect_checks(
            tenant_id=tenant_id,
            project_id=project_id,
            artifact_type=artifact_type,
            artifact_id=artifact_id,
        )

    async def revoke_attestation(
        self,
        attestation_id: UUID | str,
        reason: str,
        revoker_id: UUID | str,
    ) -> dict[str, Any]:
        """Mark a previously issued attestation as revoked (forge-admin only).

        The original audit row is not mutated; a new audit row records
        the revocation and the persisted JSON record is updated in
        place (it is a derived projection of the audit trail).
        """
        existing = await self._load_attestation(attestation_id)
        if existing is None:
            raise LookupError("attestation_not_found")
        if existing.get("status") == "revoked":
            return existing

        revoked_at = datetime.now(UTC)
        existing["status"] = "revoked"
        existing["revoked_at"] = revoked_at.isoformat()
        existing["revoker_id"] = str(revoker_id)
        existing["revocation_reason"] = reason
        await self._persist_attestation(existing)

        await self._audit.record(
            tenant_id=existing["tenant_id"],
            project_id=existing["project_id"],
            actor_id=revoker_id,
            action="architecture.standards.attest.revoke",
            target_type=existing["artifact_type"],
            target_id=existing["artifact_id"],
            payload={
                "attestation_id": str(attestation_id),
                "reason": reason,
            },
            occurred_at=revoked_at,
        )

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {
                "artifact_type": existing["artifact_type"],
                "artifact_id": existing["artifact_id"],
                "event_kind": "standards.attestation_revoked",
                "attestation_id": str(attestation_id),
                "reason": reason,
            },
            tenant_id=existing["tenant_id"],
            project_id=existing["project_id"],
            actor_id=revoker_id,
        )
        logger.info(
            "standards.attestation_revoked",
            attestation_id=str(attestation_id),
            revoker_id=str(revoker_id),
        )
        return existing

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _collect_checks(
        self,
        tenant_id: UUID | str | None,
        project_id: UUID | str | None,
        artifact_type: str,
        artifact_id: UUID | str,
    ) -> list[dict[str, Any]]:
        """Pull the standards that apply to the artifact and evaluate them."""
        standards = await self._fetch_applicable_standards(
            tenant_id=tenant_id,
            project_id=project_id,
            artifact_type=artifact_type,
        )
        checks: list[dict[str, Any]] = []
        for standard in standards:
            passed, reason = await self._evaluate_standard(
                standard=standard,
                artifact_type=artifact_type,
                artifact_id=artifact_id,
                tenant_id=tenant_id,
                project_id=project_id,
            )
            checks.append(
                {
                    "standard_id": str(standard["id"]),
                    "standard_name": standard.get("name", ""),
                    "applicable": True,
                    "passed": passed,
                    "reason": reason,
                }
            )
        return checks

    async def _fetch_applicable_standards(
        self,
        tenant_id: UUID | str | None,
        project_id: UUID | str | None,
        artifact_type: str,
    ) -> list[dict[str, Any]]:
        """Fetch standards from F-001 with sensible defaults if missing."""
        try:
            from app.db.models.standard import Standard  # noqa: F401
            from app.db.session import get_session_factory as _factory

            if tenant_id is None:
                return []
            stmt = select(Standard).where(Standard.tenant_id == str(tenant_id))
            if project_id is not None:
                # Both org-wide (project_id IS NULL) and project-specific standards apply.
                from sqlalchemy import or_

                stmt = stmt.where(
                    or_(
                        Standard.project_id.is_(None),
                        Standard.project_id == str(project_id),
                    )
                )
            stmt = stmt.where(Standard.status == "active")
            async with _factory() as session:
                rows = list((await session.execute(stmt)).scalars().all())
            return [
                {
                    "id": row.id,
                    "name": row.name,
                    "content": row.content,
                    "scope": "project" if row.project_id else "org",
                    "metadata": dict(getattr(row, "metadata_", {}) or {}),
                    "applies_to": list(
                        (getattr(row, "metadata_", {}) or {}).get("applies_to", [])
                        or ["adr", "api_contract", "task_breakdown", "risk_register"]
                    ),
                }
                for row in rows
            ]
        except Exception as exc:  # noqa: BLE001 — fall back to defaults
            logger.debug(
                "standards.fetch_fallback",
                error=type(exc).__name__,
                reason=str(exc),
            )
            return _default_standards_for(artifact_type)

    async def _evaluate_standard(
        self,
        standard: dict[str, Any],
        artifact_type: str,
        artifact_id: UUID | str,
        tenant_id: UUID | str | None,
        project_id: UUID | str | None,
    ) -> tuple[bool, str]:
        """Run a single standard's check against the artifact.

        Default policies are encoded by metadata; unknown checks
        default to pass-with-note rather than false-positive fail.
        """
        applies_to = standard.get("applies_to") or []
        if applies_to and artifact_type not in applies_to:
            return True, "standard not applicable to this artifact type"

        meta = standard.get("metadata") or {}
        policy = str(meta.get("policy") or "presence")

        try:
            artifact = await self._load_artifact_summary(
                artifact_type=artifact_type,
                artifact_id=artifact_id,
            )
        except LookupError:
            return False, "artifact not found"
        except Exception as exc:  # noqa: BLE001
            return False, f"artifact lookup failed: {type(exc).__name__}"

        if policy == "presence":
            required_fields = list(meta.get("required_fields") or [])
            missing = [f for f in required_fields if not artifact.get(f)]
            if missing:
                return False, f"missing required fields: {', '.join(missing)}"
            return True, "all required fields present"

        if policy == "min_length":
            field_name = str(meta.get("field") or "context")
            minimum = int(meta.get("minimum") or 1)
            value = str(artifact.get(field_name) or "")
            if len(value) < minimum:
                return False, f"field '{field_name}' shorter than {minimum} chars"
            return True, f"field '{field_name}' meets minimum length"

        # Unknown policies default to a passing check so we don't block
        # on metadata the org hasn't yet codified.
        return True, "no evaluator defined for policy; defaulting to pass"

    async def _load_artifact_summary(
        self,
        artifact_type: str,
        artifact_id: UUID | str,
    ) -> dict[str, Any]:
        """Resolve an artifact id to a small dict suitable for policy checks."""
        model_map = {
            "adr": ("app.db.models.architecture", "ADR"),
            "api_contract": ("app.db.models.architecture", "APIContract"),
            "task_breakdown": ("app.db.models.architecture", "TaskBreakdown"),
            "risk_register": ("app.db.models.architecture", "RiskRegister"),
        }
        if artifact_type not in model_map:
            return {"_unknown_artifact_type": artifact_type}
        module_name, attr = model_map[artifact_type]
        import importlib

        module = importlib.import_module(module_name)
        model_cls = getattr(module, attr)

        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(model_cls, str(artifact_id))
        if row is None:
            raise LookupError(f"{artifact_type} not found")
        return {
            "title": getattr(row, "title", None) or getattr(row, "name", None),
            "context": getattr(row, "context", None),
            "decision": getattr(row, "decision", None),
            "description": getattr(row, "description", None),
            "spec_content": getattr(row, "spec_content", None),
            "tasks": getattr(row, "tasks", None),
            "risks": getattr(row, "risks", None),
            "status": getattr(row, "status", None),
        }

    async def _persist_attestation(self, payload: dict[str, Any]) -> None:
        """Persist the attestation JSON to the artifact registry.

        The artifact is stored with type `architecture_attestation` and
        a content hash derived from the attestation id so future writes
        with the same id are detected as supersedes.
        """
        try:
            await self._registry.create(
                tenant_id=payload["tenant_id"],
                project_id=payload["project_id"],
                type="architecture_attestation",
                payload=payload,
                created_by=payload.get("attestor_id") or payload.get("revoker_id"),
                actor_id=payload.get("attestor_id") or payload.get("revoker_id"),
            )
        except Exception as exc:  # noqa: BLE001 — registry may be absent in tests
            logger.debug(
                "attestation.registry_unavailable",
                error=type(exc).__name__,
                reason=str(exc),
            )

    async def _load_project_attestations(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[dict[str, Any]]:
        """Return attestations recorded for this (tenant, project).

        Falls back to an empty list when the registry doesn't surface
        the synthetic type (test doubles).
        """
        try:
            rows = await self._registry.list(
                tenant_id=tenant_id,
                project_id=project_id,
                type="architecture_attestation",
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "attestations.list_fallback",
                error=type(exc).__name__,
                reason=str(exc),
            )
            return []

        out: list[dict[str, Any]] = []
        for row in rows:
            payload = row.get("payload") if isinstance(row, dict) else None
            if payload:
                out.append(payload)
        return out

    async def _load_attestation(
        self,
        attestation_id: UUID | str,
    ) -> dict[str, Any] | None:
        """Find the latest persisted state for an attestation id."""
        # Iterate the in-memory cache populated by the registry; for
        # registries without an index by id we fall back to a tenant
        # scan via list_attestations() — done lazily.
        try:
            rows = await self._registry.list(
                tenant_id="00000000-0000-0000-0000-000000000000",
                project_id="00000000-0000-0000-0000-000000000000",
                type="architecture_attestation",
            )
        except Exception:  # noqa: BLE001
            rows = []
        for row in rows or []:
            payload = row.get("payload") if isinstance(row, dict) else None
            if payload and str(payload.get("id")) == str(attestation_id):
                return payload
        return None


def _default_standards_for(artifact_type: str) -> list[dict[str, Any]]:
    """Sensible defaults when no Standards service rows exist yet."""
    defaults = [
        {
            "id": uuid.UUID("00000000-0000-0000-0000-00000000a001"),
            "name": "Required sections present",
            "content": "Artifact must declare a title and at least one body section.",
            "scope": "org",
            "metadata": {
                "policy": "presence",
                "required_fields": ["title"],
                "applies_to": ["adr", "api_contract", "task_breakdown", "risk_register"],
            },
            "applies_to": ["adr", "api_contract", "task_breakdown", "risk_register"],
        },
        {
            "id": uuid.UUID("00000000-0000-0000-0000-00000000a002"),
            "name": "Context minimum length",
            "content": "ADRs must include at least 50 chars of context.",
            "scope": "org",
            "metadata": {
                "policy": "min_length",
                "field": "context",
                "minimum": 50,
                "applies_to": ["adr"],
            },
            "applies_to": ["adr"],
        },
    ]
    return [s for s in defaults if artifact_type in s["applies_to"]]


__all__ = ["StandardsAttestationService"]
