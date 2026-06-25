"""F-829f — Bidirectional skill sync between Forge command catalog and LiteLLM Skills.

Forge commands (defined in :mod:`app.services.forge_commands`) are
exposed to LiteLLM as Skills so the gateway can route / reason about
them. LiteLLM Skills defined directly in the gateway are pulled into
the Forge command catalog under ``source=litellm`` so they surface in
``/commands?source=litellm``.

The module does not need its own DB tables — Forge commands are the
authoritative source and LiteLLM Skills are pulled via the admin API
and recorded in-memory per process (the periodic pull refreshes them).

Failures are best-effort and logged at WARNING — the integration must
not block either the Forge command catalog or the LiteLLM gateway.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


@dataclass(frozen=True)
class Skill:
    """Lightweight view of a LiteLLM Skill (or a Forge command pushed as one)."""

    name: str
    description: str
    category: str | None = None
    tier: str | None = None
    requires_approval: bool = False
    source: str = "litellm"  # "litellm" | "forge"


class SkillSync:
    """Bidirectional sync between Forge commands and LiteLLM Skills.

    Methods
    -------
    push_to_litellm(forge_commands)
        Registers each Forge command as a LiteLLM Skill. Returns the
        number of skills pushed (idempotent on the LiteLLM side via
        skill name).
    pull_from_litellm()
        Fetches all Skills registered in LiteLLM and returns them as a
        list of :class:`Skill` (with ``source='litellm'``).
    sync_all()
        Runs both directions; returns a summary dict.
    """

    def __init__(self, base_client_factory: Any | None = None) -> None:
        # ``base_client_factory`` lets tests inject a custom client.
        self._base_client_factory = base_client_factory

    # ------------------------------------------------------------------
    # push (Forge -> LiteLLM)
    # ------------------------------------------------------------------
    async def push_to_litellm(
        self, forge_commands: Iterable[Any]
    ) -> int:
        """Register each Forge command as a LiteLLM Skill.

        ``forge_commands`` is an iterable of objects with attributes
        ``forge_cmd``, ``description``, ``category``, ``tier``,
        ``requires_approval`` (matches :class:`ForgeCommand`).

        Returns the count of skills successfully registered. LiteLLM
        errors are logged at WARNING and counted as skipped — the push
        is best-effort.
        """
        pushed = 0
        skipped = 0

        for cmd in forge_commands:
            body = {
                "name": getattr(cmd, "forge_cmd", None) or getattr(cmd, "name", ""),
                "description": getattr(cmd, "description", ""),
                "metadata": {
                    "category": getattr(cmd, "category", None),
                    "tier": getattr(cmd, "tier", None),
                    "requires_approval": getattr(cmd, "requires_approval", False),
                    "source": "forge",
                },
            }
            if not body["name"]:
                skipped += 1
                continue

            try:
                await self._admin_post("/skills", json_body=body)
                pushed += 1
            except Exception as exc:  # noqa: BLE001 — best-effort
                skipped += 1
                logger.warning(
                    "litellm.skill_sync.push_failed",
                    name=body["name"],
                    error=f"{type(exc).__name__}: {exc}",
                )

        logger.info(
            "litellm.skill_sync.pushed",
            pushed=pushed,
            skipped=skipped,
        )
        return pushed

    # ------------------------------------------------------------------
    # pull (LiteLLM -> Forge)
    # ------------------------------------------------------------------
    async def pull_from_litellm(self) -> list[Skill]:
        """Fetch LiteLLM Skills and return them as :class:`Skill` rows.

        The LiteLLM admin endpoint may return either a bare list or a
        ``{"skills": [...]}`` envelope; both shapes are tolerated.
        """
        try:
            response = await self._admin_get("/skills")
        except Exception as exc:  # noqa: BLE001 — best-effort
            logger.warning(
                "litellm.skill_sync.pull_failed",
                error=f"{type(exc).__name__}: {exc}",
            )
            return []

        raw_list: list[dict[str, Any]] = []
        if isinstance(response, list):
            raw_list = [r for r in response if isinstance(r, dict)]
        elif isinstance(response, dict):
            for key in ("skills", "data", "items"):
                value = response.get(key)
                if isinstance(value, list):
                    raw_list = [r for r in value if isinstance(r, dict)]
                    break
            else:
                # Single skill fallback
                if "name" in response:
                    raw_list = [response]

        skills: list[Skill] = []
        for row in raw_list:
            metadata = row.get("metadata") or {}
            if isinstance(metadata, str):
                # Tolerate JSON-string metadata (LiteLLM sometimes returns str)
                try:
                    import json
                    metadata = json.loads(metadata)
                except (TypeError, ValueError):
                    metadata = {}
            if not isinstance(metadata, dict):
                metadata = {}
            source = metadata.get("source") or "litellm"

            skills.append(
                Skill(
                    name=str(row.get("name") or ""),
                    description=str(row.get("description") or ""),
                    category=metadata.get("category"),
                    tier=metadata.get("tier"),
                    requires_approval=bool(metadata.get("requires_approval", False)),
                    source=str(source),
                )
            )

        logger.info("litellm.skill_sync.pulled", count=len(skills))
        return skills

    # ------------------------------------------------------------------
    # both
    # ------------------------------------------------------------------
    async def sync_all(self) -> dict[str, int]:
        """Run push then pull. Returns a summary dict.

        ``conflicts`` is currently 0 — LiteLLM treats Skills as
        authoritative on its side. Future work may compare Forge
        commands against pulled Skills and surface drift here.
        """
        # Lazy import to keep module importable without the full
        # forge_commands dependency tree.
        from app.services.forge_commands import list_forge_commands

        commands = list(list_forge_commands())
        pushed = await self.push_to_litellm(commands)
        pulled_list = await self.pull_from_litellm()
        return {
            "pushed": pushed,
            "pulled": len(pulled_list),
            "conflicts": 0,
        }

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    async def _admin_get(self, path: str) -> Any:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.get(path)
                return self._parse(response)
        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.get(path)
            return self._parse(response)

    async def _admin_post(self, path: str, *, json_body: dict[str, Any]) -> Any:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.post(path, json=json_body)
                return self._parse(response)
        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.post(path, json=json_body)
            return self._parse(response)

    @staticmethod
    def _parse(response: Any) -> Any:
        if response is None:
            return {}
        try:
            return response.json()
        except Exception:
            return {}


# Module-level singleton (mirrors `audit_service.py:49`).
skill_sync = SkillSync()


__all__ = ["SkillSync", "Skill", "skill_sync"]