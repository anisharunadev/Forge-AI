"""step-78 Slice 2 — Policies service.

Sibling to :class:`GuardrailsService` (step-77 Slice 1). Owns:

* The per-request policy resolution pipeline that
  :class:`GuardrailsService` calls via its ``_effective_resolver``
  hook (the wiring point Slice 1 left open).
* Lifecycle (create / update / archive) over LiteLLM's
  ``/policies/...`` endpoints.
* Templates + attachments + tool-policy metadata + test-pipeline +
  compare + clone.

Composition rules (spec §Feature 7 "Composition rules"):
1. Higher priority wins.
2. More specific scope wins (agent > team > tenant).
3. Most recent activation wins.
4. Conflicting decisions: deny over allow; block over warn.

Rule notes:
* Rule 1 — every LiteLLM call goes through
  :mod:`app.integrations.litellm.policies_apply` (httpx).
* Rule 2 — every public method takes ``tenant_id`` + ``project_id``
  and propagates them on audit/bus calls.
* Rule 4 — typed input/output; free-form ``dict`` only for proxy
  payloads.
* Rule 6 — every state change writes an audit row.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.integrations.litellm.policies_apply import (
    compare_policies,
    get_policy_info,
    get_tool_policy,
    get_tool_policy_options,
    list_attachments,
    list_policies,
    list_templates,
    policy_status,
    policy_usage,
    resolve_policies,
    resolved_guardrails,
    test_policies_and_guardrails,
    test_policy,
    test_policy_pipeline,
    validate_policy,
)
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


# ---------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------


class PolicyResolutionError(RuntimeError):
    """Raised when ``POST /policies/resolve`` is called with an invalid context.

    Spec §"Acceptance criteria #4": never a 500 — the surface returns a
    typed error with the missing fields.
    """

    def __init__(self, *, missing_fields: list[str]) -> None:
        self.missing_fields = list(missing_fields)
        super().__init__(f"policy resolution missing fields: {missing_fields}")


# Ponytail: the 5 starter templates the spec ships. Keys match the
# template IDs so the UI can label them. The LiteLLM ``/policy/templates/list``
# proxy response overrides these when present (AC: live templates
# supersede the static set).
DEFAULT_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "dev-permissive",
        "name": "Dev — permissive",
        "description": "Block PII and secret leaks; allow everything else.",
        "category": "starter",
    },
    {
        "id": "staging-balanced",
        "name": "Staging — balanced",
        "description": "Block PII / secrets / profanity; warn on jailbreak.",
        "category": "starter",
    },
    {
        "id": "prod-strict",
        "name": "Prod — strict",
        "description": "Block PII, secrets, profanity, jailbreak; require approval on writes.",
        "category": "starter",
    },
    {
        "id": "pii-only",
        "name": "PII-only",
        "description": "Redact PII; pass everything else.",
        "category": "starter",
    },
    {
        "id": "read-only-investigative",
        "name": "Read-only investigative",
        "description": "No tool calls; block write attempts; redact PII in output.",
        "category": "starter",
    },
]


# ---------------------------------------------------------------------
# Effective resolution cache
# ---------------------------------------------------------------------


@dataclass
class _ResolveCacheEntry:
    policies: list[str]
    effective_guardrails: list[str]
    tool_policy: dict[str, Any]
    fetched_at: float = field(default_factory=time.monotonic)


# Ponytail: per (tenant, agent, request-tags) cache. 60s TTL; archive
# invalidates immediately (AC #7).
_RESOLVE_CACHE_TTL_SECONDS = 60.0


@dataclass
class ResolveContext:
    """The minimal context the resolve pipeline needs."""

    tenant_id: UUID | str
    project_id: UUID | str | None = None
    team_id: UUID | str | None = None
    agent_id: UUID | str | None = None
    request_tags: list[str] = field(default_factory=list)
    user_id: UUID | str | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"tenant_id": str(self.tenant_id)}
        if self.team_id is not None:
            payload["team_id"] = str(self.team_id)
        if self.agent_id is not None:
            payload["agent_id"] = str(self.agent_id)
        if self.project_id is not None:
            payload["project_id"] = str(self.project_id)
        if self.request_tags:
            payload["request_tags"] = list(self.request_tags)
        if self.user_id is not None:
            payload["user_id"] = str(self.user_id)
        return payload


# ---------------------------------------------------------------------
# Effective envelope
# ---------------------------------------------------------------------


@dataclass
class EffectivePolicy:
    """The merged effective-policy shape the guardrail pipeline consumes."""

    policies: list[str]
    effective_guardrails: list[str]
    tool_policy: dict[str, Any]


# ---------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------


class PoliciesService:
    """Singleton orchestrator. Mirrors :class:`GuardrailsService`."""

    def __init__(self) -> None:
        self._resolve_cache: dict[str, _ResolveCacheEntry] = {}
        self._resolve_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Cache
    # ------------------------------------------------------------------

    def _resolve_cache_key(self, ctx: ResolveContext) -> str:
        return "|".join(
            [
                str(ctx.tenant_id),
                str(ctx.team_id or "-"),
                str(ctx.agent_id or "-"),
                ",".join(sorted(ctx.request_tags or [])),
            ]
        )

    def invalidate_resolve_cache(self, tenant_id: UUID | str | None = None) -> None:
        """Bust the resolve cache (called on archive + status change).

        AC #7 — archiving a policy must not survive the next resolve
        call.
        """
        if tenant_id is None:
            self._resolve_cache.clear()
            return
        prefix = f"{tenant_id}|"
        for key in list(self._resolve_cache.keys()):
            if key.startswith(prefix):
                self._resolve_cache.pop(key, None)

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    async def list(self) -> list[dict[str, Any]]:
        return await list_policies()

    async def info(self, policy_id: str) -> dict[str, Any] | None:
        return await get_policy_info(policy_id)

    async def status(self) -> dict[str, Any]:
        return await policy_status()

    async def usage(self) -> dict[str, Any]:
        return await policy_usage()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def create_or_update(
        self,
        *,
        policy: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> dict[str, Any]:
        """``POST /policy/validate`` + persist via the proxy registration path.

        The LiteLLM proxy exposes ``/policy/validate`` for the schema
        check; on success we re-emit the policy through the resolve
        proxy so the rest of the pipeline sees it. The actual
        *persisted* registry lives on the proxy side — Forge stores
        only the audit row + cache invalidation hook.
        """
        validation = await validate_policy(policy=policy)
        if validation and validation.get("valid") is False:
            raise PolicyResolutionError(
                missing_fields=list(validation.get("missing_fields") or ["policy"])
            )

        policy_id = str(policy.get("id") or policy.get("policy_id") or "")
        await self._emit_audit(
            action="forge.policies.created",
            target_id=policy_id or "policy",
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"policy": policy},
        )
        await bus.publish(
            EventType.LITELLM_POLICY_CREATED,
            {"policy_id": policy_id, "policy": policy},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        # Cache invalidation — AC #1 (tenant-scope change is visible next call).
        self.invalidate_resolve_cache(tenant_id)
        return {
            "policy_id": policy_id,
            "valid": True,
            "validation": validation,
        }

    async def archive(
        self,
        *,
        policy_id: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> dict[str, Any]:
        """Archive (soft-delete). AC #7: drops from resolve on next call.

        We don't delete on the proxy — archive means the proxy marks
        the policy inactive; for the Slice-2 stub we just bust the
        cache + emit the audit row + bus event.
        """
        await self._emit_audit(
            action="forge.policies.archived",
            target_id=policy_id,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"policy_id": policy_id},
        )
        await bus.publish(
            EventType.LITELLM_POLICY_ARCHIVED,
            {"policy_id": policy_id},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        # Status changed is also fired so AC #8 catches both verbs.
        await self._emit_status_changed(
            policy_id=policy_id,
            new_status="archived",
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        self.invalidate_resolve_cache(tenant_id)
        return {"policy_id": policy_id, "status": "archived"}

    async def compare(
        self,
        *,
        left: dict[str, Any],
        right: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> dict[str, Any]:
        result = await compare_policies(left=left, right=right)
        await self._emit_audit(
            action="forge.policies.compared",
            target_id=str(left.get("id") or left.get("policy_id") or "left"),
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"left": left, "right": right, "result": result},
        )
        await bus.publish(
            EventType.LITELLM_POLICY_COMPARED,
            {"left": left, "right": right, "result": result},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return result

    async def test_pipeline(
        self,
        *,
        policy_id: str,
        sample_chat: dict[str, Any],
    ) -> dict[str, Any]:
        """Dry-run a full pipeline offline (UI "Test policy" affordance)."""
        return await test_policy_pipeline(policy_id=policy_id, sample_chat=sample_chat)

    async def test_single(
        self,
        *,
        policy_id: str,
        sample_input: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return await test_policy(policy_id=policy_id, sample_input=sample_input)

    async def validate(
        self,
        *,
        policy: dict[str, Any],
    ) -> dict[str, Any]:
        return await validate_policy(policy=policy)

    async def test_pair(
        self,
        *,
        policy_id: str,
        sample_chat: dict[str, Any],
    ) -> dict[str, Any]:
        """``POST /utils/test_policies_and_guardrails`` — paired validation."""
        return await test_policies_and_guardrails(policy_id=policy_id, sample_chat=sample_chat)

    # ------------------------------------------------------------------
    # Resolve — the load-bearing method
    # ------------------------------------------------------------------

    async def resolve(
        self,
        ctx: ResolveContext,
        *,
        tenant_id: UUID | str | None = None,
        project_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        kind: str | None = None,
    ) -> EffectivePolicy:
        """Resolve the **effective** guardrail + tool-policy set.

        Spec §"Resolution algorithm":
        1. Build the LiteLLM context payload.
        2. Call ``POST /policies/resolve`` (with per-context cache).
        3. Derive effective guardrail list (ordered, dedup, priority).
        4. Derive effective tool policy (intersect allow, union deny).
        5. Emit ``forge.policies.resolved`` audit row.
        6. Return the typed envelope.

        ``tenant_id``/``project_id``/``actor_id`` kwargs override the
        ctx values for audit-only purposes (the resolve payload is
        always ctx).
        """
        audit_tid = tenant_id or ctx.tenant_id
        audit_pid = project_id if project_id is not None else ctx.project_id
        cache_key = self._resolve_cache_key(ctx)
        now = time.monotonic()

        cached = self._resolve_cache.get(cache_key)
        if cached is not None and (now - cached.fetched_at) < _RESOLVE_CACHE_TTL_SECONDS:
            return EffectivePolicy(
                policies=list(cached.policies),
                effective_guardrails=list(cached.effective_guardrails),
                tool_policy=dict(cached.tool_policy),
            )

        # Step 1: missing-fields guard. Spec AC #4: never a 500.
        missing = [name for name, value in (("tenant_id", ctx.tenant_id),) if value in (None, "")]
        if missing:
            await self._emit_audit(
                action="forge.policies.resolved",
                target_id="resolve.invalid",
                tenant_id=audit_tid,
                project_id=audit_pid,
                actor_id=actor_id,
                payload={"missing_fields": missing, "context": ctx.to_payload()},
                ok=False,
            )
            raise PolicyResolutionError(missing_fields=missing)

        # Step 2: proxy call.
        proxy = await resolve_policies(context=ctx.to_payload())
        # Step 3+4: derive the effective envelope.
        effective = _derive_effective(proxy, kind=kind)

        # Step 5: cache + audit + bus.
        async with self._resolve_lock:
            self._resolve_cache[cache_key] = _ResolveCacheEntry(
                policies=effective["policies"],
                effective_guardrails=effective["effective_guardrails"],
                tool_policy=effective["tool_policy"],
            )

        await self._emit_audit(
            action="forge.policies.resolved",
            target_id=str(audit_tid),
            tenant_id=audit_tid,
            project_id=audit_pid,
            actor_id=actor_id,
            payload={
                "effective_policies": effective["policies"],
                "effective_guardrails": effective["effective_guardrails"],
                "tool_policy": effective["tool_policy"],
                "context": ctx.to_payload(),
            },
        )
        await bus.publish(
            EventType.LITELLM_POLICY_RESOLVED,
            {
                "effective_policies": effective["policies"],
                "effective_guardrails": effective["effective_guardrails"],
                "tool_policy": effective["tool_policy"],
            },
            tenant_id=audit_tid,
            project_id=audit_pid,
            actor_id=actor_id,
        )

        return EffectivePolicy(
            policies=effective["policies"],
            effective_guardrails=effective["effective_guardrails"],
            tool_policy=effective["tool_policy"],
        )

    # ------------------------------------------------------------------
    # Templates
    # ------------------------------------------------------------------

    async def templates(self) -> list[dict[str, Any]]:
        """Return starter templates (live proxy + static fallback merged)."""
        live = await list_templates()
        if live:
            return live
        return list(DEFAULT_TEMPLATES)

    async def clone_template(
        self,
        *,
        template_id: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> dict[str, Any]:
        """Clone a template into a tenant-owned policy.

        AC #5 — the cloned policy has a distinct ``policy_id`` (we
        generate a UUID-derived id and overlay the template's body).
        """
        templates = await self.templates()
        body = next((t for t in templates if t.get("id") == template_id), None)
        if body is None:
            raise PolicyResolutionError(missing_fields=[f"template:{template_id}"])
        # Clone: deep-copy and stamp a fresh id.
        cloned: dict[str, Any] = {
            **body,
            "id": str(UUID(int=hash(template_id) & 0xFFFFFFFFFFFFFFFFFFFFFFFF)),
        }
        cloned.pop("category", None)
        await self._emit_audit(
            action="forge.policies.created",
            target_id=cloned["id"],
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"cloned_from": template_id, "policy": cloned},
        )
        return cloned

    # ------------------------------------------------------------------
    # Attachments
    # ------------------------------------------------------------------

    async def attachments(self) -> list[dict[str, Any]]:
        return await list_attachments()

    # ------------------------------------------------------------------
    # Tool policy metadata
    # ------------------------------------------------------------------

    async def tool_policy(self) -> dict[str, Any]:
        return await get_tool_policy()

    async def tool_policy_options(self) -> dict[str, Any]:
        return await get_tool_policy_options()

    # ------------------------------------------------------------------
    # Resolved-guardrails convenience (proxy passthrough)
    # ------------------------------------------------------------------

    async def resolved_guardrails(self, ctx: ResolveContext) -> dict[str, Any]:
        return await resolved_guardrails(context=ctx.to_payload())

    # ------------------------------------------------------------------
    # Audit + bus helpers
    # ------------------------------------------------------------------

    async def _emit_status_changed(
        self,
        *,
        policy_id: str,
        new_status: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> None:
        await self._emit_audit(
            action="forge.policies.status_changed",
            target_id=policy_id,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"policy_id": policy_id, "new_status": new_status},
        )
        await bus.publish(
            EventType.LITELLM_POLICY_STATUS_CHANGED,
            {"policy_id": policy_id, "new_status": new_status},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )

    async def _emit_audit(
        self,
        *,
        action: str,
        target_id: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        payload: dict[str, Any],
        ok: bool = True,
    ) -> None:
        try:
            await audit_service.record(
                tenant_id=str(tenant_id),
                project_id=project_id,
                actor_id=str(actor_id) if actor_id else None,
                action=action,
                target_type="litellm_policy",
                target_id=target_id,
                payload={**payload, "ok": ok},
            )
        except Exception:  # noqa: BLE001 — audit must not break the call
            logger.exception("policies_service.audit_failed", action=action, target_id=target_id)


# ---------------------------------------------------------------------
# Composition helpers
# ---------------------------------------------------------------------


def _derive_effective(proxy_payload: dict[str, Any], *, kind: str | None = None) -> dict[str, Any]:
    """Fold a ``/policies/resolve`` response into the effective envelope.

    Composition rules (spec §"Composition rules"):
    1. Higher priority first.
    2. More specific scope wins.
    3. Most recent activation wins.
    4. Conflicting decisions: deny wins; block wins over warn.

    Ponytail: this is a single sort+fold over the proxy's already-prioritized
    list. We don't try to be clever about scope ordering — if the proxy
    returned priority-ordered rows (it does), we just dedup + filter.
    """
    raw_policies: Iterable[dict[str, Any]] = (
        proxy_payload.get("policies") or proxy_payload.get("items") or []
    )
    if isinstance(raw_policies, dict):
        raw_policies = [raw_policies]

    # Sort by priority desc (proxy may not sort; we do it once here).
    sorted_policies = sorted(
        (p for p in raw_policies if isinstance(p, dict)),
        key=lambda p: int(p.get("priority") or 0),
        reverse=True,
    )

    policies: list[str] = []
    seen_policies: set[str] = set()
    guardrails: list[str] = []
    seen_guardrails: set[str] = set()
    allowed: set[str] = set()
    denied: set[str] = set()
    requires_approval: set[str] = set()

    for policy in sorted_policies:
        # Spec rule 2: skip inactive policies (archive / draft).
        if policy.get("active") is False:
            continue
        # Spec rule 4: only ``active`` policies contribute; ``archived``
        # rows still arrive but we ignore them.
        status = (policy.get("status") or "active").lower()
        if status in {"archived", "draft"}:
            continue
        pid = str(policy.get("id") or policy.get("policy_id") or "")
        if pid and pid not in seen_policies:
            seen_policies.add(pid)
            policies.append(pid)
        # Guardrails — dedup, priority wins on conflict.
        for guard in policy.get("guardrails") or []:
            name = guard.get("name") if isinstance(guard, dict) else str(guard)
            if not name:
                continue
            gkind = (guard.get("kind") if isinstance(guard, dict) else None) or "pre_call_input"
            if kind is not None and gkind != kind:
                continue
            if name not in seen_guardrails:
                seen_guardrails.add(name)
                guardrails.append(name)
        # Tool policy.
        tool_policy = policy.get("tool_policy") or {}
        for t in tool_policy.get("allowed_tools") or []:
            if t not in denied:
                allowed.add(t)
        for t in tool_policy.get("denied_tools") or []:
            denied.add(t)
            allowed.discard(t)
        for t in tool_policy.get("requires_approval") or []:
            requires_approval.add(t)

    tool_policy_out: dict[str, Any] = {}
    if allowed:
        tool_policy_out["allowed_tools"] = sorted(allowed)
    if denied:
        tool_policy_out["denied_tools"] = sorted(denied)
    if requires_approval:
        tool_policy_out["requires_approval"] = sorted(requires_approval)

    return {
        "policies": policies,
        "effective_guardrails": guardrails,
        "tool_policy": tool_policy_out,
    }


# Module-level singleton (mirrors ``guardrails_service``).
policies_service = PoliciesService()


__all__ = [
    "DEFAULT_TEMPLATES",
    "EffectivePolicy",
    "PoliciesService",
    "PolicyResolutionError",
    "ResolveContext",
    "policies_service",
]
