"""M9-G2 — Sample seed loaded on Day-One Bootstrap completion.

After :meth:`DayOneBootstrapService.load_baseline` commits, a freshly
onboarded pilot has a project full of *reference* standards / templates /
policies but zero *content* — the Connector Center, Architecture Center
and Ideation Center all render empty. This module seeds a minimal,
namespaced sample set so the dashboard is populated on first login:

* 1 sample **connector** (GitHub, HEALTHY) — Connector Center has a row.
* 1 sample **ADR** artifact — Architecture Center has a decision record.
* 1 sample **idea** — Ideation Center has an intake item.

Everything is scoped to the new ``(tenant_id, project_id)`` and lives in
the ``sample-{tenant_id}`` idspace so it never collides with production
seeds (M3 connectors, M4 ideation) — see M9 spec §6 (Risks).

The loader is:

* **Idempotent** — a bootstrap rerun re-checks each row by its namespaced
  key and skips inserts that already exist (artifacts are append-only, so
  we must never insert a duplicate).
* **Best-effort** — the caller (:meth:`load_baseline`) wraps this in a
  guard so a seed failure can never roll back the bootstrap.

This module deliberately imports **only** ORM models + the event bus (no
``app.agents`` / LangGraph), so the onboarding test suite can import and
exercise it directly without the optional agent-runtime dependencies.
"""

from __future__ import annotations

import hashlib
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.artifact import Artifact, ArtifactStatus
from app.db.models.connector import Connector, ConnectorStatus, ConnectorType
from app.db.models.ideation import Idea, IdeaSource, IdeaStatus
from app.db.session import get_session_factory
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)

# The three kinds we seed, in a stable order. Surfaced verbatim in the
# ``BOOTSTRAP_SAMPLE_DATA_LOADED`` payload so subscribers know exactly
# what landed.
SAMPLE_KINDS: list[str] = ["connector", "adr", "idea"]

_SYSTEM_ACTOR = UUID(int=0)


def _coerce_uuid(value: UUID | str) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def _idspace(tenant_id: UUID | str) -> str:
    """Return the collision-proof namespace prefix for this tenant."""
    return f"sample-{tenant_id}"


def _sample_content_hash(tenant_id: UUID | str, project_id: UUID | str) -> str:
    """Deterministic hash so a rerun resolves to the same sample ADR row."""
    raw = f"{_idspace(tenant_id)}-{project_id}-adr".encode()
    return hashlib.sha256(raw).hexdigest()


async def load_sample_data(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    run_id: UUID | str | None,
    actor_id: UUID | str | None = None,
    bus: Any | None = None,
) -> dict[str, Any]:
    """Seed 1 connector + 1 ADR + 1 idea, then emit the loaded event.

    Returns a summary dict::

        {"loaded": ["connector", "adr", "idea"], "skipped": [...],
         "sample_kinds": ["connector", "adr", "idea"]}

    ``loaded`` lists the kinds inserted on this call; ``skipped`` lists the
    kinds that already existed (idempotent rerun). The event is published
    regardless so downstream listeners always observe completion.

    Parameters
    ----------
    bus:
        Event bus to publish on. Defaults to the module-level singleton;
        tests inject a capturing fake.
    """
    tid = _coerce_uuid(tenant_id)
    pid = _coerce_uuid(project_id)
    created_by = _coerce_uuid(actor_id) if actor_id else _SYSTEM_ACTOR
    ns = _idspace(tenant_id)

    loaded: list[str] = []
    skipped: list[str] = []

    factory = get_session_factory()
    async with factory() as session:
        # --- 1. Sample connector -------------------------------------
        connector_name = f"{ns}-connector"
        existing_conn = (
            await session.execute(
                select(Connector).where(
                    Connector.tenant_id == tid,
                    Connector.project_id == pid,
                    Connector.name == connector_name,
                )
            )
        ).scalar_one_or_none()
        if existing_conn is None:
            session.add(
                Connector(
                    tenant_id=tid,
                    project_id=pid,
                    name=connector_name,
                    type=ConnectorType.GITHUB,
                    config={
                        "sample": True,
                        "idspace": ns,
                        "repo": "knackforge/forge-sample",
                        "note": "Seeded on Day-One Bootstrap completion (M9-G2).",
                    },
                    status=ConnectorStatus.HEALTHY,
                    created_by=created_by,
                )
            )
            loaded.append("connector")
        else:
            skipped.append("connector")

        # --- 2. Sample ADR artifact ----------------------------------
        content_hash = _sample_content_hash(tenant_id, project_id)
        existing_adr = (
            await session.execute(
                select(Artifact).where(
                    Artifact.tenant_id == tid,
                    Artifact.project_id == pid,
                    Artifact.type == "adr",
                    Artifact.content_hash == content_hash,
                )
            )
        ).scalar_one_or_none()
        if existing_adr is None:
            session.add(
                Artifact(
                    tenant_id=tid,
                    project_id=pid,
                    type="adr",
                    version=1,
                    status=ArtifactStatus.ACTIVE,
                    created_by=created_by,
                    content_hash=content_hash,
                    payload={
                        "sample": True,
                        "idspace": ns,
                        "title": "ADR-0001: Adopt the KnackForge reference baseline",
                        "status": "accepted",
                        "context": "This sample ADR is seeded on onboarding so the "
                        "Architecture Center is populated for a new pilot.",
                        "decision": "Adopt the Day-One Bootstrap standards, templates, "
                        "and governance policies as the project baseline.",
                        "consequences": "Delete this sample ADR once real decisions "
                        "are recorded.",
                    },
                )
            )
            loaded.append("adr")
        else:
            skipped.append("adr")

        # --- 3. Sample idea ------------------------------------------
        idea_title = f"{ns}: Explore your first automated intel run"
        existing_idea = (
            await session.execute(
                select(Idea).where(
                    Idea.tenant_id == tid,
                    Idea.project_id == pid,
                    Idea.title == idea_title,
                )
            )
        ).scalar_one_or_none()
        if existing_idea is None:
            session.add(
                Idea(
                    tenant_id=tid,
                    project_id=pid,
                    title=idea_title,
                    description="Sample idea seeded on Day-One Bootstrap completion "
                    "so the Ideation Center has an intake item to explore. Safe to "
                    "delete once you submit your own ideas.",
                    source=IdeaSource.SIGNAL,
                    submitted_by=created_by,
                    status=IdeaStatus.NEW,
                    tags=["sample", "onboarding"],
                    attachments=[],
                )
            )
            loaded.append("idea")
        else:
            skipped.append("idea")

        await session.commit()

    logger.info(
        "bootstrap.sample_data.loaded",
        tenant_id=str(tenant_id),
        project_id=str(project_id),
        run_id=str(run_id) if run_id is not None else None,
        loaded=loaded,
        skipped=skipped,
    )

    # Emit regardless of insert/skip so subscribers always see completion.
    publish_bus = bus if bus is not None else default_bus
    await publish_bus.publish(
        EventType.BOOTSTRAP_SAMPLE_DATA_LOADED,
        {
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "run_id": str(run_id) if run_id is not None else None,
            "sample_kinds": list(SAMPLE_KINDS),
        },
        tenant_id=tid,
        project_id=pid,
        actor_id=created_by,
    )

    return {
        "loaded": loaded,
        "skipped": skipped,
        "sample_kinds": list(SAMPLE_KINDS),
    }


__all__ = ["load_sample_data", "SAMPLE_KINDS"]
