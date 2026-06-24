"""Production safety gate for demo seeds (F-821 / OQ-14).

Refuses to apply a demo seed against ``environment=production`` unless
the caller explicitly opts in with ``--allow-in-prod``. Every block
emits an audit event so the refusal is visible in the timeline.

The gate is intentionally permissive for non-demo seeds: reference and
customer seeds are not refused in production because they are the
content that production tenants actually need.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.db.models.seed import SeedTenantType
from app.services.audit_service import AuditService
from backend.seeds.framework.exceptions import ProductionSeedBlockedError

logger = get_logger(__name__)


async def check_production_safety(
    manifest: dict[str, Any],
    env: str,
    allow_in_prod: bool,
    audit_service: AuditService,
    actor_id: UUID | str,
    *,
    tenant_id: UUID | str | None = None,
    project_id: UUID | str | None = None,
) -> None:
    """Refuse demo seeds in production unless explicitly allowed.

    Raises:
        ProductionSeedBlockedError: when ``env == "production"`` and the
            manifest is a demo seed and ``allow_in_prod`` is False.

    Side effects:
        Emits ``seed.production_blocked`` audit events for refused
        attempts and ``seed.production_override`` for allowed ones so
        the timeline shows exactly when a Steward (or CI job) chose to
        apply demo data into a production-like environment.
    """
    tenant_type = str(manifest.get("tenant_type", "")).lower()
    is_demo = tenant_type == SeedTenantType.DEMO.value
    manifest_allow = bool(
        (manifest.get("production_safety") or {}).get("allow_in_prod", False)
    )

    if env != "production":
        return

    if not is_demo:
        return

    if allow_in_prod or manifest_allow:
        await audit_service.record(
            tenant_id=tenant_id or "00000000-0000-0000-0000-000000000000",
            project_id=project_id or "00000000-0000-0000-0000-000000000000",
            actor_id=actor_id,
            action="seed.production_override",
            target_type="seed",
            target_id=str(manifest.get("name", "<unknown>")),
            payload={
                "manifest_allow": manifest_allow,
                "caller_allow": allow_in_prod,
                "manifest_version": manifest.get("version"),
            },
        )
        logger.warning(
            "seed.production_override",
            seed=manifest.get("name"),
            manifest_allow=manifest_allow,
            caller_allow=allow_in_prod,
        )
        return

    # Block: emit an audit event before raising so the refusal leaves a trail.
    await audit_service.record(
        tenant_id=tenant_id or "00000000-0000-0000-0000-000000000000",
        project_id=project_id or "00000000-0000-0000-0000-000000000000",
        actor_id=actor_id,
        action="seed.production_blocked",
        target_type="seed",
        target_id=str(manifest.get("name", "<unknown>")),
        payload={
            "env": env,
            "tenant_type": tenant_type,
            "manifest_version": manifest.get("version"),
        },
    )
    logger.warning(
        "seed.production_blocked",
        seed=manifest.get("name"),
        env=env,
    )
    raise ProductionSeedBlockedError(
        f"Seed {manifest.get('name')!r} has tenant_type=demo and environment={env!r}. "
        "Refusing to apply without --allow-in-prod."
    )


__all__ = ["check_production_safety"]