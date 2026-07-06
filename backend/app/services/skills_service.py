"""step-78 Slice 3 — Skills service.

Sibling to :class:`GuardrailsService` and :class:`PoliciesService`.
Owns:

* Registration + versioning (idempotent on
  ``(tenant_id, name, version)`` per spec §"Registration").
* Listing + filtering (cached 60s per tenant; spec §"Listing").
* Jinja2 prompt rendering (AC #2, #10 — broken templates surface
  typed errors at save time, not at first chat use).
* Public hub browse + import (AC #6).
* ``forge.skills.injected`` audit hook called per chat when a skill
  is referenced (AC #7).

Versioning rules (spec §"Versioning"):
* Once active, a version is immutable.
* Updates create a new version; older versions remain accessible.
* Agent configs pin to a specific version (no auto-upgrade).

Composition (spec §"Composition"): multiple skills concatenate in
order; tool conflicts resolved by later skill. We validate at agent
save time (caller's responsibility), not in this service.

Rule notes:
* Rule 1 — every LiteLLM call goes through
  :mod:`app.integrations.litellm.skills_apply`.
* Rule 2 — every public method takes ``tenant_id`` + ``project_id``.
* Rule 4 — typed input/output.
* Rule 6 — every state change + every injection writes an audit row.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.integrations.litellm.skills_apply import (
    create_or_update_skill,
    dotprompt_to_json,
    get_skill,
    list_skills,
    public_hub,
    transform_request,
)
from app.schemas.litellm_common import ToolRef
from app.schemas.skills import (
    SkillConfig,
    SkillCreate,
    SkillMetadata,
    SkillRead,
    SkillUpdate,
)
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


# ---------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------


class SkillRenderError(RuntimeError):
    """Raised when a skill's Jinja template is malformed. AC #10."""

    def __init__(self, *, skill_id: str | None, message: str) -> None:
        self.skill_id = skill_id
        self.message = message
        super().__init__(f"skill {skill_id!r} render error: {message}")


# Ponytail: 60s per spec. A future per-tenant TTL would key into a
# dict-of-dicts; today one global constant is fine.
_SKILL_CACHE_TTL_SECONDS = 60.0


@dataclass
class _CacheEntry:
    rows: list[dict[str, Any]]
    fetched_at: float = field(default_factory=time.monotonic)


# ---------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------


class SkillsService:
    """Singleton orchestrator. Mirrors :class:`GuardrailsService`."""

    def __init__(self) -> None:
        self._list_cache: dict[str, _CacheEntry] = {}
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Cache
    # ------------------------------------------------------------------

    def invalidate_cache(self, tenant_id: UUID | str | None = None) -> None:
        if tenant_id is None:
            self._list_cache.clear()
            return
        self._list_cache.pop(str(tenant_id), None)
        self._list_cache.pop("__global__", None)

    async def _load(
        self, *, tenant_id: UUID | str | None, category: str | None, status: str | None
    ) -> list[dict[str, Any]]:
        cache_key = f"{tenant_id or '__global__'}|{category or ''}|{status or ''}"
        now = time.monotonic()
        async with self._lock:
            entry = self._list_cache.get(cache_key)
            if entry is not None and (now - entry.fetched_at) < _SKILL_CACHE_TTL_SECONDS:
                return [dict(r) for r in entry.rows]

        rows = await list_skills()
        # Tenant + category + status filters applied locally because
        # the LiteLLM proxy doesn't expose filter params uniformly.
        if tenant_id is not None:
            tid = str(tenant_id)
            rows = [
                r
                for r in rows
                if str((r.get("metadata") or {}).get("forge_tenant_id") or "") in {tid, ""}
            ]
        if category:
            rows = [
                r for r in rows if ((r.get("metadata") or {}).get("category") or "") == category
            ]
        if status:
            rows = [r for r in rows if (r.get("status") or "active") == status]

        async with self._lock:
            self._list_cache[cache_key] = _CacheEntry(rows=[dict(r) for r in rows])
        return rows

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    async def list(
        self,
        *,
        tenant_id: UUID | str | None,
        category: str | None = None,
        status: str | None = None,
    ) -> list[SkillRead]:
        rows = await self._load(tenant_id=tenant_id, category=category, status=status)
        return [_row_to_read(r) for r in rows]

    async def detail(
        self, skill_id: str, *, tenant_id: UUID | str | None = None
    ) -> SkillRead | None:
        raw = await get_skill(skill_id)
        if raw is None:
            return None
        if tenant_id is not None:
            tid = str(tenant_id)
            md = raw.get("metadata") or {}
            row_tid = str(md.get("forge_tenant_id") or "")
            if row_tid and row_tid != tid:
                return None
        return _row_to_read(raw)

    # ------------------------------------------------------------------
    # Registration + versioning
    # ------------------------------------------------------------------

    async def create_or_update(
        self,
        *,
        body: SkillCreate,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> SkillRead:
        """``POST /v1/skills``. Idempotent on (tenant, name, version)."""
        # Stamp tenant + actor metadata so the row is tenant-scoped.
        metadata = dict(body.metadata.model_dump(exclude_none=True))
        metadata["forge_tenant_id"] = str(tenant_id)
        if actor_id is not None:
            metadata["created_by"] = str(actor_id)
        body_dict = body.model_dump(exclude_none=True)
        body_dict["metadata"] = metadata
        body_dict["forge_tenant_id"] = str(tenant_id)

        # Validate the prompt template now (AC #10) so we don't ship
        # a broken template that only fails at first chat use.
        try:
            render_template(body.prompt_template, variables={})
        except SkillRenderError:
            raise

        try:
            saved = await create_or_update_skill(skill=body_dict)
        except SkillRenderError:
            raise

        self.invalidate_cache(tenant_id)

        await self._emit_audit(
            action="forge.skills.created",
            target_id=str(saved.get("id") or body_dict.get("id") or body.name),
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"skill": body_dict, "version": body.version},
        )
        await bus.publish(
            EventType.LITELLM_SKILL_CREATED,
            {"skill_id": saved.get("id") or body.name, "version": body.version},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return _row_to_read(saved if isinstance(saved, dict) else body_dict)

    async def update(
        self,
        *,
        skill_id: str,
        body: SkillUpdate,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> SkillRead:
        """``PATCH /api/v1/skills/{id}`` — creates a new version (AC §"Versioning")."""
        existing = await get_skill(skill_id)
        if existing is None:
            return None

        # Compose the new version by overlaying non-null fields.
        merged: dict[str, Any] = dict(existing)
        for key in ("name", "description", "prompt_template", "tools", "config", "metadata"):
            value = getattr(body, key)
            if value is not None:
                if isinstance(value, SkillMetadata) or isinstance(value, SkillConfig):
                    merged[key] = value.model_dump(exclude_none=True)
                elif isinstance(value, list):
                    merged[key] = [v.model_dump() if isinstance(v, ToolRef) else v for v in value]
                else:
                    merged[key] = value

        # AC: bump_version = True (default) creates a new semver tag.
        if body.bump_version:
            merged["version"] = _bump_version(str(merged.get("version") or "1.0.0"))
            merged["id"] = f"{merged.get('name') or skill_id}@{merged['version']}"

        # Validate Jinja now (AC #10).
        try:
            render_template(str(merged.get("prompt_template") or ""), variables={})
        except SkillRenderError:
            raise

        saved = await create_or_update_skill(skill=merged)
        self.invalidate_cache(tenant_id)

        await self._emit_audit(
            action="forge.skills.updated",
            target_id=str(saved.get("id") or merged.get("id") or skill_id),
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"skill_id": skill_id, "new_version": merged.get("version")},
        )
        await bus.publish(
            EventType.LITELLM_SKILL_UPDATED,
            {"skill_id": skill_id, "new_version": merged.get("version")},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return _row_to_read(saved if isinstance(saved, dict) else merged)

    async def archive(
        self,
        *,
        skill_id: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> SkillRead | None:
        existing = await get_skill(skill_id)
        if existing is None:
            return None
        existing["status"] = "archived"
        existing["active"] = False
        saved = await create_or_update_skill(skill=existing)
        self.invalidate_cache(tenant_id)

        await self._emit_audit(
            action="forge.skills.archived",
            target_id=skill_id,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"skill_id": skill_id},
        )
        await bus.publish(
            EventType.LITELLM_SKILL_ARCHIVED,
            {"skill_id": skill_id},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return _row_to_read(saved if isinstance(saved, dict) else existing)

    # ------------------------------------------------------------------
    # Render / preview
    # ------------------------------------------------------------------

    async def preview(
        self,
        *,
        prompt_template: str,
        variables: dict[str, Any],
        skill_id: str | None = None,
    ) -> str:
        """Render a template with sample variables (no chat call). AC #2."""
        return render_template(prompt_template, variables=variables, skill_id=skill_id)

    # ------------------------------------------------------------------
    # Public hub
    # ------------------------------------------------------------------

    async def hub(self) -> list[dict[str, Any]]:
        return await public_hub()

    async def hub_import(
        self,
        *,
        hub_id: str,
        tenant_id: UUID | str,
        actor_id: UUID | str | None,
    ) -> SkillRead:
        """Clone a public skill into a tenant-local copy. AC #6."""
        # Fetch the public entry.
        hub_rows = await public_hub()
        body = next(
            (r for r in hub_rows if str(r.get("id") or r.get("name") or "") == hub_id),
            None,
        )
        if body is None:
            raise LookupError(f"hub_id {hub_id!r} not found")

        cloned: dict[str, Any] = {
            **body,
            "id": f"{body.get('name') or hub_id}@import-{int(time.time())}",
            "metadata": {
                **(body.get("metadata") or {}),
                "forge_tenant_id": str(tenant_id),
                "source": "hub",
            },
        }
        saved = await create_or_update_skill(skill=cloned)
        self.invalidate_cache(tenant_id)
        await self._emit_audit(
            action="forge.skills.created",
            target_id=str(saved.get("id") or cloned["id"]),
            tenant_id=tenant_id,
            project_id=None,
            actor_id=actor_id,
            payload={"hub_id": hub_id, "skill": cloned},
        )
        return _row_to_read(saved if isinstance(saved, dict) else cloned)

    # ------------------------------------------------------------------
    # Injection — called per chat when an agent references skills
    # ------------------------------------------------------------------

    async def inject(
        self,
        *,
        skills: Iterable[SkillRead],
        request: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> dict[str, Any]:
        """AC #7 — emit ``forge.skills.injected`` for each skill referenced.

        AC #9 — ``/utils/transform_request`` is called once per skill.
        The merged request is the per-skill transform folded in
        sequence (later skill wins on tool conflicts — caller decides).
        """
        merged = dict(request)
        for skill in skills:
            # The Forge /proxy/ endpoint may be down; transform is
            # best-effort and the caller continues with the merged
            # request even if a single skill fails.
            try:
                merged = await transform_request(
                    skill=skill.model_dump(exclude_none=True), request=merged
                )
            except Exception as exc:  # noqa: BLE001 — best-effort
                logger.warning(
                    "skills_service.inject_transform_failed",
                    skill_id=skill.id,
                    error=f"{type(exc).__name__}: {exc}",
                )
            await self._emit_audit(
                action="forge.skills.injected",
                target_id=skill.id,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
                payload={"skill_id": skill.id, "version": skill.version},
            )
            await bus.publish(
                EventType.LITELLM_SKILL_INJECTED,
                {"skill_id": skill.id, "version": skill.version},
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )
        return merged

    # ------------------------------------------------------------------
    # Dotprompt utility
    # ------------------------------------------------------------------

    async def dotprompt_convert(self, dotprompt: str) -> dict[str, Any]:
        return await dotprompt_to_json(dotprompt=dotprompt)

    # ------------------------------------------------------------------
    # Audit + bus helpers
    # ------------------------------------------------------------------

    async def _emit_audit(
        self,
        *,
        action: str,
        target_id: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        payload: dict[str, Any],
    ) -> None:
        try:
            await audit_service.record(
                tenant_id=str(tenant_id),
                project_id=project_id,
                actor_id=str(actor_id) if actor_id else None,
                action=action,
                target_type="litellm_skill",
                target_id=target_id,
                payload=payload,
            )
        except Exception:  # noqa: BLE001
            logger.exception("skills_service.audit_failed", action=action, target_id=target_id)


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


def render_template(
    template: str, *, variables: dict[str, Any], skill_id: str | None = None
) -> str:
    """Render a Jinja2-style prompt template. AC #2, #10.

    Ponytail: prefer Jinja2 (stdlib of templates) and fall back to a
    brace-substitution regex if Jinja2 isn't installed. This keeps the
    service importable without an extra dependency, but the rendered
    output stays compatible with ``/utils/transform_request`` when
    both shapes are used.
    """
    try:
        from jinja2 import Environment, StrictUndefined
    except Exception:  # noqa: BLE001 — fallback path
        return _brace_substitute(template, variables, skill_id=skill_id)

    try:
        env = Environment(undefined=StrictUndefined, autoescape=False)
        ast = env.parse(template)
        used = sorted(
            {
                n.value
                for n in ast.find_all(__import__("jinja2").nodes.Name)
                if isinstance(n, __import__("jinja2").nodes.Name)
            }
        )
        missing = [v for v in used if v not in variables]
        if missing:
            raise SkillRenderError(
                skill_id=skill_id,
                message=f"missing variables: {missing}",
            )
        return env.from_string(template).render(**variables)
    except SkillRenderError:
        raise
    except Exception as exc:  # noqa: BLE001 — render errors → typed
        raise SkillRenderError(skill_id=skill_id, message=f"{type(exc).__name__}: {exc}") from exc


def _brace_substitute(template: str, variables: dict[str, Any], *, skill_id: str | None) -> str:
    import re

    pattern = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
    used: set[str] = set()

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        used.add(name)
        if name not in variables:
            raise SkillRenderError(skill_id=skill_id, message=f"missing variable: {name}")
        return str(variables[name])

    return pattern.sub(_replace, template)


def _row_to_read(row: dict[str, Any]) -> SkillRead:
    metadata = row.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            import json

            metadata = json.loads(metadata)
        except (TypeError, ValueError):
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    config = row.get("config") or {}
    if not isinstance(config, dict):
        config = {}

    tools_raw = row.get("tools") or []
    tools: list[ToolRef] = []
    if isinstance(tools_raw, list):
        for t in tools_raw:
            if isinstance(t, dict):
                tools.append(
                    ToolRef(
                        name=str(t.get("name") or ""),
                        kind=t.get("kind") or "function",
                        server_id=t.get("server_id"),
                    )
                )
            elif isinstance(t, str):
                tools.append(ToolRef(name=t, kind="function"))

    return SkillRead(
        id=str(row.get("id") or row.get("name") or ""),
        name=str(row.get("name") or row.get("id") or ""),
        description=str(row.get("description") or ""),
        version=str(row.get("version") or "1.0.0"),
        status=row.get("status") or "draft",
        prompt_template=str(row.get("prompt_template") or ""),
        tools=tools,
        config=SkillConfig(**{k: v for k, v in config.items() if k in SkillConfig.model_fields}),
        metadata=SkillMetadata(
            **{k: v for k, v in metadata.items() if k in SkillMetadata.model_fields}
        ),
        active=bool(row.get("active", (row.get("status") or "active") == "active")),
        extra={
            k: v
            for k, v in row.items()
            if k
            not in {
                "id",
                "name",
                "description",
                "version",
                "status",
                "prompt_template",
                "tools",
                "config",
                "metadata",
                "active",
            }
        },
    )


def _bump_version(version: str) -> str:
    """Semver-ish: bump the patch digit on update."""
    parts = version.split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        parts[2] = str(int(parts[2]) + 1)
    except ValueError:
        parts[2] = "1"
    return ".".join(parts)


# Module-level singleton.
skills_service = SkillsService()


__all__ = [
    "SkillRenderError",
    "SkillsService",
    "render_template",
    "skills_service",
]
