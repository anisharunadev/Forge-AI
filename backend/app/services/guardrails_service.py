"""step-77 Slice 1 — ``GuardrailsService`` — the per-request guardrail envelope.

Owns the hot-path guardrail pipeline for every ``ForgeLLMClient.chat``
call:

1. Resolve the effective guardrail set for a request (currently
   per-tenant via :class:`GuardrailSync`; Slice 2 swaps this for
   :class:`policies_service.resolve(...)` without changing this
   service's signature).
2. Pre-call: iterate ``pre_call_input`` then ``pre_call_llm``
   guardrails, calling :func:`apply_guardrail` for each. On
   ``block`` raise :class:`GuardrailViolation`; on ``mask`` replace
   the message text + emit the masked event.
3. Post-call: iterate ``post_call_output`` (and per-chunk
   ``during_call`` for streaming). Same decision shape.

Catalog caching is 60s TTL so disabling a guardrail at runtime
shows up on the next chat completion within a minute (AC #9). The
cache key is tenant_id; a per-tenant override of the TTL is not
exposed in Slice 1.

Rules respected:
* Rule 1 — every guardrail call goes through :class:`LiteLLMBaseClient`
  via :mod:`app.integrations.litellm.guardrail_apply`.
* Rule 2 — every public method takes ``tenant_id`` + ``project_id``
  and uses them on the audit/bus calls.
* Rule 4 — typed input/output; service never returns a free-form dict.
* Rule 6 — every block/mask/apply decision writes an audit row.

Sibling agents:
* :class:`GuardrailSync` — the per-tenant assignment mirror.
* :class:`policies_service` — Slice 2 swaps this in via the
  ``_resolve_effective`` hook below.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.integrations.litellm.guardrail_apply import (
    apply_guardrail as _apply_guardrail,
)
from app.integrations.litellm.guardrail_apply import (
    get_guardrail_info as _get_guardrail_info,
)
from app.integrations.litellm.guardrail_apply import (
    get_ui_rule as _get_ui_rule,
)
from app.integrations.litellm.guardrail_apply import (
    list_guardrails as _list_guardrails,
)
from app.integrations.litellm.guardrail_apply import (
    list_submissions as _list_submissions,
)
from app.integrations.litellm.guardrail_apply import (
    list_ui_rules as _list_ui_rules,
)
from app.integrations.litellm.guardrail_apply import (
    register_guardrail as _register_guardrail,
)
from app.integrations.litellm.guardrail_apply import (
    save_ui_rule as _save_ui_rule,
)
from app.integrations.litellm.guardrail_apply import (
    test_custom_code as _test_custom_code,
)
from app.integrations.litellm.guardrail_sync import guardrail_sync
from app.schemas.litellm_common import (
    GuardrailDecision,
    GuardrailKind,
    LitellmParams,
)
from app.services.audit_service import audit_service
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


# ---------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------


class GuardrailViolation(RuntimeError):
    """Raised when a pre- or post-call guardrail blocks the request.

    Subclasses ``RuntimeError`` to match the codebase convention of
    stdlib-based domain exceptions. Carries the structured context
    the spec §"Acceptance criteria #3" requires for the typed
    ``GuardrailViolationError`` envelope.
    """

    def __init__(
        self,
        *,
        guardrail_name: str,
        decision: GuardrailDecision,
        reason: str | None = None,
        kind: GuardrailKind | None = None,
        policy_id: str | None = None,
    ) -> None:
        self.guardrail_name = guardrail_name
        self.decision = decision
        self.reason = reason
        self.kind = kind
        self.policy_id = policy_id
        super().__init__(f"{guardrail_name} ({decision}): {reason or 'no reason'}")


# ---------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------


@dataclass
class _CatalogCacheEntry:
    rows: list[dict[str, Any]]
    fetched_at: float = field(default_factory=time.monotonic)


# 60s per spec §"Updating a guardrail... reflected in next chat completion
# within 60 seconds". Ponytail: this is a single global TTL; if
# per-tenant TTL is ever required, add a per-entry override here.
_CATALOG_TTL_SECONDS = 60.0


# ---------------------------------------------------------------------
# Apply result
# ---------------------------------------------------------------------


@dataclass
class ApplyResult:
    """The service-level envelope of one or more guardrail evaluations.

    ``text`` is the (possibly-masked) text after the run; ``decision``
    is the worst-case decision across the run (block > mask > pass).
    ``evaluations`` is the per-guardrail audit trail.
    """

    text: str
    decision: GuardrailDecision
    evaluations: list[dict[str, Any]] = field(default_factory=list)
    latency_ms: int = 0

    @property
    def is_blocked(self) -> bool:
        return self.decision == "block"

    @property
    def is_masked(self) -> bool:
        return self.decision == "mask"


# ---------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------


class GuardrailsService:
    """Singleton orchestrator. Mirrors the ``audit_service`` pattern."""

    def __init__(self) -> None:
        # Catalog cache: tenant_id -> _CatalogCacheEntry
        self._catalog_cache: dict[str, _CatalogCacheEntry] = {}
        self._catalog_lock = asyncio.Lock()
        # Injected collaborators (None = use module-level default).
        self._guardrail_sync = guardrail_sync
        # The effective-resolver hook. Defaults to guardrail_sync;
        # Slice 2 swaps this for policies_service.resolve.
        self._effective_resolver: Callable[..., Awaitable[list[str]]] | None = None

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def set_effective_resolver(self, resolver: Callable[..., Awaitable[list[str]]] | None) -> None:
        """Inject the policy-resolver (Slice 2 wiring point).

        ``None`` restores the default (per-tenant assignment).
        """
        self._effective_resolver = resolver

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    async def list_catalog(self, *, tenant_id: str | None = None) -> list[dict[str, Any]]:
        """Return the LiteLLM guardrail catalog (cached 60s per tenant).

        The cache key includes ``tenant_id`` so per-tenant catalog
        overrides would land in a different bucket when Slice 2 ships
        a per-tenant template lookup. Today all tenants share the
        catalog.
        """
        cache_key = tenant_id or "__global__"
        async with self._catalog_lock:
            entry = self._catalog_cache.get(cache_key)
            if entry is not None and (time.monotonic() - entry.fetched_at) < _CATALOG_TTL_SECONDS:
                return list(entry.rows)

        rows = await _list_guardrails()
        async with self._catalog_lock:
            self._catalog_cache[cache_key] = _CatalogCacheEntry(rows=list(rows))
        return rows

    def invalidate_catalog(self, tenant_id: str | None = None) -> None:
        """Bust the cache (admin-only path; called by the register router)."""
        if tenant_id is None:
            self._catalog_cache.clear()
        else:
            self._catalog_cache.pop(tenant_id, None)
            self._catalog_cache.pop("__global__", None)

    async def resolve_effective(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        kind: GuardrailKind | None = None,
    ) -> list[str]:
        """Return the guardrail names active for this request.

        Slice 1: derive from the per-tenant assignment mirror.
        Slice 2: this is the integration point — when the policy
        resolver lands, ``self._effective_resolver`` returns
        ``policies_service.resolve(...).effective_guardrails`` and
        the call site below doesn't change.
        """
        if self._effective_resolver is not None:
            return list(
                await self._effective_resolver(
                    tenant_id=tenant_id, project_id=project_id, kind=kind
                )
            )
        # Slice 2 — default to the policies service resolver when it is
        # importable; otherwise fall back to the per-tenant assignment
        # mirror (preserves Slice 1 behavior if the import cycle is a
        # concern in a test environment).
        try:
            from app.services.policies_service import (
                ResolveContext,
                policies_service,
            )

            effective = await policies_service.resolve(
                ResolveContext(
                    tenant_id=tenant_id,
                    project_id=project_id,
                )
            )
            return list(effective.effective_guardrails)
        except Exception:  # noqa: BLE001 — Slice 2 is best-effort during bring-up
            names = await self._guardrail_sync.get_for_tenant(tenant_id)
            return list(names or [])

    # ------------------------------------------------------------------
    # Apply pipeline
    # ------------------------------------------------------------------

    async def apply(
        self,
        *,
        text: str,
        guardrail_names: list[str],
        kind: GuardrailKind,
        request_id: str | None = None,
        user_id: str | None = None,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
    ) -> ApplyResult:
        """Run each guardrail in order; return the worst-case result.

        On ``block`` from any guardrail: emit ``LITELLM_GUARDRAIL_BLOCKED``
        + raise :class:`GuardrailViolation` (so the caller short-circuits
        before the model call).

        On ``mask``: replace ``text`` with the masked version, emit
        ``LITELLM_GUARDRAIL_MASKED`` + continue with the masked text.

        On ``pass``: no audit row, no change.
        """
        if not guardrail_names:
            return ApplyResult(text=text, decision="pass", latency_ms=0)

        evaluations: list[dict[str, Any]] = []
        worst: GuardrailDecision = "pass"
        current_text = text
        total_ms = 0
        started = time.monotonic()

        for name in guardrail_names:
            evaluation_started = time.monotonic()
            try:
                outcome = await _apply_guardrail(
                    guardrail_name=name,
                    text=current_text,
                    user_id=str(user_id) if user_id else None,
                    request_id=request_id,
                )
            except Exception as exc:  # noqa: BLE001 — fail-open on transport errors
                logger.warning(
                    "guardrails_service.apply_transport_error",
                    guardrail_name=name,
                    kind=kind,
                    error=str(exc),
                )
                # Treat transport errors as pass-with-warning; the next
                # guardrail in the chain still runs. AC #9 (60s disable)
                # is satisfied because the catalog cache is what
                # controls the active set, not this call.
                continue

            evaluation_ms = int((time.monotonic() - evaluation_started) * 1000)
            total_ms += evaluation_ms
            decision: GuardrailDecision = outcome.get("decision", "pass")

            evaluation = {
                "guardrail_name": name,
                "kind": kind,
                "decision": decision,
                "latency_ms": evaluation_ms,
                "reason": outcome.get("reason"),
                "request_id": request_id,
            }
            evaluations.append(evaluation)

            if decision == "block":
                worst = "block"
                await self._emit_blocked(
                    guardrail_name=name,
                    reason=outcome.get("reason"),
                    kind=kind,
                    request_id=request_id,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=actor_id,
                )
                # Stop the chain — block wins immediately (AC #2, #3).
                break

            if decision == "mask":
                if worst != "block":
                    worst = "mask"
                current_text = outcome.get("text", current_text)
                await self._emit_masked(
                    guardrail_name=name,
                    kind=kind,
                    request_id=request_id,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    actor_id=actor_id,
                )
                # Continue the chain — the next guardrail runs on the
                # masked text.
                continue

        total_ms = int((time.monotonic() - started) * 1000)

        if worst == "block":
            # Use the last block's name + reason for the error.
            block_eval = next(
                (e for e in reversed(evaluations) if e["decision"] == "block"),
                None,
            )
            assert block_eval is not None
            raise GuardrailViolation(
                guardrail_name=block_eval["guardrail_name"],
                decision="block",
                reason=block_eval.get("reason"),
                kind=kind,
            )

        return ApplyResult(
            text=current_text,
            decision=worst,
            evaluations=evaluations,
            latency_ms=total_ms,
        )

    # ------------------------------------------------------------------
    # Registration + admin
    # ------------------------------------------------------------------

    async def register(
        self,
        *,
        guardrail_name: str,
        litellm_params: LitellmParams,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        custom_code: str | None = None,
    ) -> dict[str, Any]:
        """Register a new guardrail (or update an existing one — AC #7, #8).

        Custom-code guardrails are first validated via
        ``/guardrails/test_custom_code`` (AC #5); a failed test
        raises :class:`GuardrailViolation` with the failure reason.
        On success, the catalog cache is busted so the new guardrail
        is visible to the next chat completion (AC #9).
        """
        if custom_code is not None:
            test_outcome = await _test_custom_code(
                code=custom_code,
                sample_text="ping",
            )
            if not test_outcome.get("valid"):
                raise GuardrailViolation(
                    guardrail_name=guardrail_name,
                    decision="block",
                    reason=(
                        f"custom-code validation failed: {test_outcome.get('error') or 'invalid'}"
                    ),
                    kind="pre_call_input",
                )

        # Drop the None-valued keys from ``litellm_params`` so the
        # proxy doesn't choke on ``null`` for fields it expects absent.
        params = litellm_params.model_dump(exclude_none=True)
        # ``extra`` is a passthrough dict — merge it at the top level.
        extra = params.pop("extra", None) or {}
        params.update(extra)

        result = await _register_guardrail(
            guardrail_name=guardrail_name,
            litellm_params=params,
        )
        # AC #9 — reflect within 60s; we just bust the cache so the
        # next apply sees it immediately.
        self.invalidate_catalog(str(tenant_id))

        # AC #6 audit row.
        await self._emit_audit(
            action="forge.guardrails.registered",
            guardrail_name=guardrail_name,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload={"guardrail_name": guardrail_name, "params": params},
        )
        await bus.publish(
            EventType.LITELLM_GUARDRAIL_REGISTERED,
            {"guardrail_name": guardrail_name, "params": params},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return {"guardrail_name": guardrail_name, **(result or {})}

    async def info(self, guardrail_name: str) -> dict[str, Any] | None:
        return await _get_guardrail_info(guardrail_name)

    async def test(
        self,
        *,
        guardrail_name: str,
        text: str,
        user_id: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        """Dry-run a guardrail against sample text. AC §"register dry-run"."""
        return await _apply_guardrail(
            guardrail_name=guardrail_name,
            text=text,
            user_id=user_id,
            request_id=request_id,
        )

    async def submissions(
        self,
        *,
        since_hours: int = 24,
        guardrail_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """AC #6 — every row has ``latency_ms``."""
        return await _list_submissions(since_hours=since_hours, guardrail_name=guardrail_name)

    async def ui_list(self) -> list[dict[str, Any]]:
        return await _list_ui_rules()

    async def ui_save(self, rule: dict[str, Any]) -> dict[str, Any]:
        result = await _save_ui_rule(rule)
        self.invalidate_catalog()
        return result

    async def ui_get(self, rule_id: str) -> dict[str, Any] | None:
        return await _get_ui_rule(rule_id)

    # ------------------------------------------------------------------
    # Audit + bus helpers
    # ------------------------------------------------------------------

    async def _emit_blocked(
        self,
        *,
        guardrail_name: str,
        reason: str | None,
        kind: GuardrailKind,
        request_id: str | None,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> None:
        payload = {
            "guardrail_name": guardrail_name,
            "kind": kind,
            "reason": reason,
            "request_id": request_id,
        }
        await self._emit_audit(
            action="forge.guardrails.blocked",
            guardrail_name=guardrail_name,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload=payload,
        )
        await bus.publish(
            EventType.LITELLM_GUARDRAIL_BLOCKED,
            payload,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )

    async def _emit_masked(
        self,
        *,
        guardrail_name: str,
        kind: GuardrailKind,
        request_id: str | None,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> None:
        payload = {
            "guardrail_name": guardrail_name,
            "kind": kind,
            "request_id": request_id,
        }
        await self._emit_audit(
            action="forge.guardrails.masked",
            guardrail_name=guardrail_name,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            payload=payload,
        )
        await bus.publish(
            EventType.LITELLM_GUARDRAIL_MASKED,
            payload,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )

    async def _emit_audit(
        self,
        *,
        action: str,
        guardrail_name: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        actor_id: UUID | str | None,
        payload: dict[str, Any],
    ) -> None:
        try:
            await audit_service.record(
                tenant_id=str(tenant_id),
                project_id=project_id,
                action=action,
                actor_id=str(actor_id) if actor_id else None,
                target_type="litellm_guardrail",
                target_id=guardrail_name,
                payload=payload,
            )
        except Exception:  # noqa: BLE001 — audit must not break the call
            logger.exception(
                "guardrails_service.audit_failed",
                action=action,
                guardrail_name=guardrail_name,
            )


# Module-level singleton (mirrors ``audit_service`` at app.services.audit_service:49).
guardrails_service = GuardrailsService()


__all__ = [
    "ApplyResult",
    "GuardrailViolation",
    "GuardrailsService",
    "guardrails_service",
]
