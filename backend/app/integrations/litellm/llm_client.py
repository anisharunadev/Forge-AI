"""F-829j — ``ForgeLLMClient`` — the new canonical LLM client.

This client replaces the master-key path of
:class:`app.services.litellm_client.LiteLLMClient` with a per-tenant
Virtual Key + per-tenant Budget + trace-correlated flow. The existing
``LiteLLMClient`` is preserved as a thin facade (Phase A migration
strategy); new code calls :class:`ForgeLLMClient` directly.

Hot path (per chat/embed call)
------------------------------
1. Resolve the per-tenant Virtual Key via ``key_manager.get_key``.
2. Resolve the concrete model via ``model_resolver.resolve`` when no
   ``model`` argument was passed.
3. Mint a ``forge_trace_id`` from the active OTel span (or uuid4).
4. Call LiteLLM via :class:`LiteLLMBaseClient` with
   ``X-Forge-Trace-Id`` + ``Authorization: Bearer <virtual_key>``.
5. Record cost via :class:`CostLedger`, write a
   :class:`LiteLLMCallRecord` row via :class:`TraceCorrelator`,
   emit ``EventType.LITELLM_CALL_COMPLETED``.
6. Admission control (NFR-044): delegate to
   :class:`WorkflowBudgetService.check_budget`; raise
   :class:`BudgetExceeded` if blocked.

Sibling modules
---------------
* :class:`LiteLLMBaseClient` — owned by another Phase-A agent.
* :class:`VirtualKeyManager` — owned by another Phase-A agent.
* :class:`BudgetSync` — owned by another Phase-A agent.
* :class:`ModelAssignmentResolver` — owned by another Phase-A agent.
* :class:`TraceCorrelator` — this same Phase-A agent (``trace_correlator``).
* :class:`LiteLLMHealthMonitor` — this same Phase-A agent (``health_monitor``).

All five injected collaborators are optional with sensible defaults:
``None`` means "use the module-level singleton from its package", and
constructing the singleton lazily means this module is import-safe
even when the sibling files haven't landed yet.
"""

from __future__ import annotations

import contextvars
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, AsyncIterator
from uuid import UUID, uuid4

from app.core.config import settings
from app.core.logging import get_logger
from app.core.telemetry import get_tracer
from app.db.models.litellm_call_record import LiteLLMCallStatus
from app.services.cost_ledger import CostLedger, cost_ledger as default_cost_ledger
from app.services.event_bus import EventType, bus as default_bus
from app.services.workflow_budget import (
    BudgetExceeded,
    Decision,
    WorkflowBudgetService,
    workflow_budget_service as default_workflow_budget,
)

if TYPE_CHECKING:
    from app.core.security import AuthenticatedPrincipal
    from app.integrations.litellm.budget_sync import BudgetSync
    from app.integrations.litellm.health_monitor import LiteLLMHealthMonitor
    from app.integrations.litellm.key_manager import VirtualKeyManager
    from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
    from app.integrations.litellm.model_assignment import ModelAssignmentResolver
    from app.integrations.litellm.trace_correlator import TraceCorrelator

logger = get_logger(__name__)
_tracer = get_tracer(__name__)


# step-80 — Phase 4 metadata envelope.
# A FastAPI dependency (``app.api.deps.set_current_principal``) populates
# this ContextVar at request scope; ``_enrich_metadata`` reads it to
# attach forge_* fields to every LiteLLM call so spend logs can
# reconcile against Forge without each call site repeating itself.
_current_principal: contextvars.ContextVar["AuthenticatedPrincipal | None"] = contextvars.ContextVar(
    "forge_current_principal", default=None
)


def set_current_principal(principal: "AuthenticatedPrincipal | None") -> contextvars.Token:
    """Populate the request-scoped principal for metadata envelope injection.

    Called from a FastAPI dependency; the token is unused by callers but
    is part of the public API for symmetry with ``reset_current_principal``.
    """
    return _current_principal.set(principal)


def reset_current_principal(token: contextvars.Token) -> None:
    _current_principal.reset(token)


def get_current_principal() -> "AuthenticatedPrincipal | None":
    return _current_principal.get()


# Conservative defaults used when the caller does not pre-compute a
# projected cost. They only bound the admission check; actual spend
# is recorded after the call completes.
_DEFAULT_PROJECTED_CHAT_USD = 0.05
_DEFAULT_PROJECTED_EMBED_USD = 0.0001


class LLMUnavailableError(Exception):
    """Raised when the LiteLLM proxy is unreachable or returns 5xx.

    The :class:`LiteLLMHealthMonitor` is the source of truth for
    availability, but this client raises immediately when its own
    request encounters a connection failure or upstream error so
    the caller can fail fast (and the audit record captures the
    outage precisely).
    """


class ForgeLLMClient:
    """Canonical per-tenant LLM client for Forge (Rule 1 + NFR-044).

    Mirrors the public surface of :class:`LiteLLMClient` (chat, embed,
    list_models, create_virtual_key) so the existing call sites can be
    migrated by changing the imported symbol — the call shapes are
    identical.
    """

    def __init__(
        self,
        *,
        base_client: "LiteLLMBaseClient | None" = None,
        key_manager: "VirtualKeyManager | None" = None,
        budget_sync: "BudgetSync | None" = None,
        model_resolver: "ModelAssignmentResolver | None" = None,
        trace_correlator: "TraceCorrelator | None" = None,
        health_monitor: "LiteLLMHealthMonitor | None" = None,
        cost_ledger: CostLedger | None = None,
        workflow_budget: WorkflowBudgetService | None = None,
    ) -> None:
        # Hold the injected collaborators. None means "resolve at
        # call time from the module-level singleton" — this keeps the
        # constructor cheap and avoids AttributeError when a sibling
        # module hasn't been written yet.
        self._base_client = base_client
        self._key_manager = key_manager
        self._budget_sync = budget_sync
        self._model_resolver = model_resolver
        self._trace_correlator = trace_correlator
        self._health_monitor = health_monitor
        self._cost_ledger = cost_ledger or default_cost_ledger
        self._workflow_budget = workflow_budget or default_workflow_budget

    # ------------------------------------------------------------------
    # Lazy collaborator resolution
    # ------------------------------------------------------------------

    def _resolve_base_client(self) -> "LiteLLMBaseClient | None":
        if self._base_client is not None:
            return self._base_client
        try:
            from app.integrations.litellm.litellm_base_client import (
                LiteLLMBaseClient as _Base,
            )

            return _Base()
        except Exception:  # noqa: BLE001 — sibling agent hasn't landed yet
            return None

    def _resolve_key_manager(self) -> "VirtualKeyManager | None":
        if self._key_manager is not None:
            return self._key_manager
        try:
            from app.integrations.litellm.key_manager import (
                VirtualKeyManager as _K,
            )

            return _K()
        except Exception:  # noqa: BLE001
            return None

    def _resolve_model_resolver(self) -> "ModelAssignmentResolver | None":
        if self._model_resolver is not None:
            return self._model_resolver
        try:
            from app.integrations.litellm.model_assignment import (
                ModelAssignmentResolver as _R,
            )

            return _R()
        except Exception:  # noqa: BLE001
            return None

    def _resolve_budget_sync(self) -> "BudgetSync | None":
        if self._budget_sync is not None:
            return self._budget_sync
        try:
            from app.integrations.litellm.budget_sync import BudgetSync as _B

            return _B()
        except Exception:  # noqa: BLE001
            return None

    def _resolve_trace_correlator(self) -> "TraceCorrelator":
        if self._trace_correlator is not None:
            return self._trace_correlator
        # trace_correlator.py is owned by this same agent and is
        # guaranteed to be importable.
        from app.integrations.litellm.trace_correlator import trace_correlator as _t

        return _t

    # ------------------------------------------------------------------
    # Public API — mirrors LiteLLMClient
    # ------------------------------------------------------------------

    async def chat(
        self,
        messages: list[dict[str, Any]],
        model: str | None = None,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        projected_cost_usd: float | None = None,
        stream: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """Chat completion through the per-tenant Virtual Key flow.

        See module docstring for the full hot path. On LiteLLM-down
        (ConnectionError or 5xx) raises :class:`LLMUnavailableError`
        and writes a ``LITELLM_DOWN`` call record so the outage shows
        up in the audit timeline.
        """
        forge_trace_id = self._resolve_trace_correlator().mint_trace_id_from_active_span()
        # step-80 — Phase 4 metadata envelope (auto-attach forge_* keys).
        kwargs = self._enrich_metadata(kwargs, forge_trace_id=forge_trace_id)

        # 1. Per-tenant Virtual Key (cache-first).
        virtual_key = await self._resolve_virtual_key(tenant_id)
        if not virtual_key:
            raise LLMUnavailableError(
                f"No LiteLLM Virtual Key provisioned for tenant {tenant_id}"
            )

        # 2. Resolve concrete model when not provided by the caller.
        resolved_model = model or await self._resolve_model(tenant_id)

        # 6. Admission control (NFR-044) — short-circuit before any
        # provider traffic if a workflow budget is declared.
        await self._admit_call(
            workflow_id=workflow_id,
            projected_cost_usd=(
                projected_cost_usd
                if projected_cost_usd is not None
                else _DEFAULT_PROJECTED_CHAT_USD
            ),
            actor_id=actor_id,
        )

        # 4. Downstream call.
        base_client = self._resolve_base_client()
        if base_client is None:
            await self._record_unavailable(
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=actor_id,
                forge_trace_id=forge_trace_id,
                model=resolved_model,
                error="LiteLLM base client not configured",
            )
            raise LLMUnavailableError("LiteLLM base client not configured")

        started = time.monotonic()
        try:
            if stream:
                return self._chat_stream(
                    base_client=base_client,
                    messages=messages,
                    model=resolved_model,
                    tenant_id=tenant_id,
                    project_id=project_id,
                    workflow_id=workflow_id,
                    actor_id=actor_id,
                    forge_trace_id=forge_trace_id,
                    virtual_key=virtual_key,
                    extra_kwargs=kwargs,
                )

            response_body, response_headers = await base_client.chat(
                messages=messages,
                model=resolved_model,
                virtual_key=virtual_key,
                forge_trace_id=forge_trace_id,
                stream=False,
                extra_kwargs=kwargs,
            )
        except (LLMUnavailableError,):
            raise
        except Exception as exc:  # noqa: BLE001 — map any other failure to LLMUnavailableError
            latency_ms = int((time.monotonic() - started) * 1000)
            await self._record_failed_call(
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=actor_id,
                forge_trace_id=forge_trace_id,
                model=resolved_model,
                latency_ms=latency_ms,
                status=LiteLLMCallStatus.LITELLM_DOWN,
                error=str(exc),
            )
            logger.exception(
                "litellm.call_failed",
                tenant_id=str(tenant_id),
                forge_trace_id=forge_trace_id,
                model=resolved_model,
                error=str(exc),
            )
            raise LLMUnavailableError(str(exc)) from exc

        latency_ms = int((time.monotonic() - started) * 1000)
        await self._record_successful_call(
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=workflow_id,
            actor_id=actor_id,
            forge_trace_id=forge_trace_id,
            response_headers=response_headers,
            response_body=response_body,
            model=resolved_model,
            latency_ms=latency_ms,
        )
        await self._commit_workflow_spend(
            workflow_id=workflow_id,
            tenant_id=tenant_id,
            project_id=project_id,
            response_body=response_body,
        )
        await self._emit_call_completed(
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=workflow_id,
            actor_id=actor_id,
            forge_trace_id=forge_trace_id,
            response_body=response_body,
            model=resolved_model,
            latency_ms=latency_ms,
        )
        return response_body

    async def embed(
        self,
        texts: list[str],
        model: str = "text-embedding-3-small",
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None = None,
        projected_cost_usd: float | None = None,
    ) -> list[list[float]]:
        """Embeddings via the per-tenant Virtual Key flow."""
        forge_trace_id = self._resolve_trace_correlator().mint_trace_id_from_active_span()
        virtual_key = await self._resolve_virtual_key(tenant_id)
        if not virtual_key:
            raise LLMUnavailableError(
                f"No LiteLLM Virtual Key provisioned for tenant {tenant_id}"
            )

        await self._admit_call(
            workflow_id=workflow_id,
            projected_cost_usd=(
                projected_cost_usd
                if projected_cost_usd is not None
                else _DEFAULT_PROJECTED_EMBED_USD
            ),
            actor_id=None,
        )

        base_client = self._resolve_base_client()
        if base_client is None:
            await self._record_unavailable(
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=None,
                forge_trace_id=forge_trace_id,
                model=model,
                error="LiteLLM base client not configured",
            )
            raise LLMUnavailableError("LiteLLM base client not configured")

        started = time.monotonic()
        try:
            response_body, response_headers = await base_client.embed(
                texts=texts,
                model=model,
                virtual_key=virtual_key,
                forge_trace_id=forge_trace_id,
            )
        except LLMUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001
            latency_ms = int((time.monotonic() - started) * 1000)
            await self._record_failed_call(
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=None,
                forge_trace_id=forge_trace_id,
                model=model,
                latency_ms=latency_ms,
                status=LiteLLMCallStatus.LITELLM_DOWN,
                error=str(exc),
            )
            raise LLMUnavailableError(str(exc)) from exc

        latency_ms = int((time.monotonic() - started) * 1000)
        vectors: list[list[float]] = [
            list(item["embedding"]) for item in (response_body.get("data") or [])
        ]
        await self._record_successful_call(
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=workflow_id,
            actor_id=None,
            forge_trace_id=forge_trace_id,
            response_headers=response_headers,
            response_body=response_body,
            model=model,
            latency_ms=latency_ms,
        )
        await self._emit_call_completed(
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=workflow_id,
            actor_id=None,
            forge_trace_id=forge_trace_id,
            response_body=response_body,
            model=model,
            latency_ms=latency_ms,
        )
        return vectors

    async def list_models(self) -> list[dict[str, Any]]:
        """Return the model catalog the proxy exposes.

        Uses the admin key (``settings.litellm_api_key``) rather than a
        per-tenant Virtual Key — listing is a platform-level operation
        and is not budgeted.
        """
        base_client = self._resolve_base_client()
        if base_client is None:
            raise LLMUnavailableError("LiteLLM base client not configured")
        # list_models is a platform-level call; the base client's own
        # admin key covers it. Pass the admin key as the bearer.
        return await base_client.list_models(virtual_key=None)

    async def create_virtual_key(
        self,
        *,
        key_alias: str,
        duration: str | None = None,
        models: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        team_id: str | None = None,
    ) -> dict[str, Any]:
        """Mint a scoped virtual key (used by the code_validator subgraph).

        Delegates to the base client's admin endpoint. The caller is
        expected to persist the resulting key into Secrets Manager and
        record a :class:`LiteLLMKeyAudit` row.
        """
        base_client = self._resolve_base_client()
        if base_client is None:
            raise LLMUnavailableError("LiteLLM base client not configured")
        return await base_client.create_virtual_key(
            key_alias=key_alias,
            duration=duration,
            models=models,
            metadata=metadata,
            team_id=team_id,
        )

    # ------------------------------------------------------------------
    # Internals — key + model + budget + recording
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # step-80 — Phase 4 metadata envelope (Rule 6 spend reconciliation)
    # ------------------------------------------------------------------

    def _enrich_metadata(
        self,
        kwargs: dict[str, Any],
        *,
        forge_trace_id: str,
    ) -> dict[str, Any]:
        """Attach ``metadata.forge_*`` keys to the request kwargs.

        Reads the request-scoped ``_current_principal`` ContextVar; if no
        principal is set (background task, batch job), the call proceeds
        unchanged. Never overwrites caller-supplied keys.
        """
        principal = _current_principal.get()
        if principal is None:
            return kwargs
        meta = kwargs.setdefault("metadata", {})
        if not isinstance(meta, dict):
            return kwargs
        meta.setdefault("forge_tenant_id", str(principal.tenant_id))
        meta.setdefault("forge_user_id", str(getattr(principal, "user_id", "") or ""))
        meta.setdefault("forge_run_id", str(getattr(principal, "run_id", "") or uuid4()))
        agent_id = getattr(principal, "agent_id", None)
        if agent_id is not None:
            meta.setdefault("forge_agent_id", str(agent_id))
        meta.setdefault("forge_trace_id", forge_trace_id)
        return kwargs

    async def _resolve_virtual_key(self, tenant_id: UUID | str) -> str | None:
        """Cache-first per-tenant Virtual Key lookup."""
        key_manager = self._resolve_key_manager()
        if key_manager is None:
            return None
        try:
            return await key_manager.get_key(tenant_id)
        except Exception:  # noqa: BLE001 — never let a key fetch mask the call
            logger.exception("litellm.key_resolve_failed", tenant_id=str(tenant_id))
            return None

    async def _resolve_model(self, tenant_id: UUID | str) -> str:
        """Use the tenant's assigned model when no caller override.

        Falls back to ``settings.litellm_default_model`` so chat still
        works while the model_assignment module is being bootstrapped.
        """
        resolver = self._resolve_model_resolver()
        if resolver is None:
            return settings.litellm_default_model
        try:
            resolved = await resolver.resolve(tenant_id, tier=None)
            return resolved or settings.litellm_default_model
        except Exception:  # noqa: BLE001
            logger.exception("litellm.model_resolve_failed", tenant_id=str(tenant_id))
            return settings.litellm_default_model

    async def _admit_call(
        self,
        *,
        workflow_id: UUID | str | None,
        projected_cost_usd: float,
        actor_id: UUID | str | None,
    ) -> None:
        """NFR-044 — block the call before provider traffic on budget.

        A workflow without a declared budget is admitted unconditionally
        — the budget service is opt-in per workflow.
        """
        if workflow_id is None:
            return
        check = await self._workflow_budget.check_budget(
            workflow_id=workflow_id,
            projected_cost_usd=float(projected_cost_usd),
            actor_id=actor_id,
        )
        if check.decision is Decision.BLOCKED:
            logger.warning(
                "litellm.budget_blocked",
                workflow_id=str(workflow_id),
                spent_usd=check.spent_usd,
                ceiling_usd=check.ceiling_usd,
                projected_cost_usd=check.projected_cost_usd,
            )
            raise BudgetExceeded(
                workflow_id,
                spent=check.spent_usd,
                ceiling=check.ceiling_usd,
            )

    async def _chat_stream(
        self,
        *,
        base_client: "LiteLLMBaseClient",
        messages: list[dict[str, Any]],
        model: str,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
        forge_trace_id: str,
        virtual_key: str,
        extra_kwargs: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        """Async generator for streaming chat; records on terminal chunk.

        Mirrors the legacy streaming surface so existing call sites
        that consume SSE chunks continue to work after migration.
        """

        async def _gen() -> AsyncIterator[dict[str, Any]]:
            started = time.monotonic()
            terminal_chunk: dict[str, Any] | None = None
            terminal_headers: Any = None
            try:
                stream = base_client.chat_stream(
                    messages=messages,
                    model=model,
                    virtual_key=virtual_key,
                    forge_trace_id=forge_trace_id,
                    extra_kwargs=extra_kwargs,
                )
                async for chunk, headers in stream:
                    if chunk.get("usage"):
                        terminal_chunk = chunk
                        terminal_headers = headers
                    yield chunk
            except Exception as exc:  # noqa: BLE001
                latency_ms = int((time.monotonic() - started) * 1000)
                await self._record_failed_call(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    workflow_id=workflow_id,
                    actor_id=actor_id,
                    forge_trace_id=forge_trace_id,
                    model=model,
                    latency_ms=latency_ms,
                    status=LiteLLMCallStatus.LITELLM_DOWN,
                    error=str(exc),
                )
                raise LLMUnavailableError(str(exc)) from exc

            if terminal_chunk is not None:
                latency_ms = int((time.monotonic() - started) * 1000)
                await self._record_successful_call(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    workflow_id=workflow_id,
                    actor_id=actor_id,
                    forge_trace_id=forge_trace_id,
                    response_headers=terminal_headers,
                    response_body=terminal_chunk,
                    model=model,
                    latency_ms=latency_ms,
                )

        return _gen()

    # ------------------------------------------------------------------
    # Recording helpers
    # ------------------------------------------------------------------

    async def _record_successful_call(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
        forge_trace_id: str,
        response_headers: Any,
        response_body: dict[str, Any],
        model: str,
        latency_ms: int,
    ) -> None:
        usage = response_body.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        cost_usd = float(response_body.get("cost_usd") or usage.get("cost_usd") or 0.0)

        litellm_call_id = self._resolve_trace_correlator().extract_litellm_call_id(
            response_headers
        )

        # 5a. Cost ledger (canonical spend record).
        if prompt_tokens or completion_tokens or cost_usd:
            try:
                await self._cost_ledger.record(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    workflow_id=workflow_id,
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    cost_usd=cost_usd,
                    source="litellm",
                )
            except Exception:  # noqa: BLE001 — ledger must not mask the call result
                logger.exception("litellm.cost_record_failed", forge_trace_id=forge_trace_id)

        # 5b. Trace correlator — the LiteLLMCallRecord row.
        try:
            await self._resolve_trace_correlator().record_call(
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=actor_id,
                forge_trace_id=forge_trace_id,
                litellm_call_id=litellm_call_id,
                model=model,
                status=LiteLLMCallStatus.SUCCESS.value,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                latency_ms=latency_ms,
            )
        except Exception:  # noqa: BLE001
            logger.exception("litellm.call_record_failed", forge_trace_id=forge_trace_id)

    async def _record_failed_call(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
        forge_trace_id: str,
        model: str,
        latency_ms: int,
        status: LiteLLMCallStatus,
        error: str | None,
    ) -> None:
        try:
            await self._resolve_trace_correlator().record_call(
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=actor_id,
                forge_trace_id=forge_trace_id,
                litellm_call_id=None,
                model=model,
                status=status.value,
                prompt_tokens=0,
                completion_tokens=0,
                cost_usd=0.0,
                latency_ms=latency_ms,
                error=error,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "litellm.failed_call_record_error",
                forge_trace_id=forge_trace_id,
                status=status.value,
            )

    async def _record_unavailable(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
        forge_trace_id: str,
        model: str,
        error: str,
    ) -> None:
        """Emit a ``LITELLM_DOWN`` call record without raising."""
        await self._record_failed_call(
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=workflow_id,
            actor_id=actor_id,
            forge_trace_id=forge_trace_id,
            model=model,
            latency_ms=0,
            status=LiteLLMCallStatus.LITELLM_DOWN,
            error=error,
        )

    async def _commit_workflow_spend(
        self,
        *,
        workflow_id: UUID | str | None,
        tenant_id: UUID | str | None,
        project_id: UUID | str | None,
        response_body: dict[str, Any],
    ) -> None:
        """Apply post-call spend against the workflow's budget.

        Best-effort — a missing budget or an exhausted budget never
        fails the LLM call result. Mirrors the legacy surface.
        """
        if workflow_id is None:
            return
        cost_usd = float(
            response_body.get("cost_usd")
            or (response_body.get("usage") or {}).get("cost_usd")
            or 0.0
        )
        if cost_usd <= 0:
            return
        try:
            await self._workflow_budget.record_spend(
                workflow_id=workflow_id,
                actual_cost_usd=cost_usd,
                tenant_id=tenant_id,
                project_id=project_id,
            )
        except BudgetExceeded:
            logger.warning(
                "litellm.spend_exceeded_post_call",
                workflow_id=str(workflow_id),
                cost_usd=cost_usd,
            )
        except LookupError:
            logger.debug("litellm.no_budget_to_commit", workflow_id=str(workflow_id))
        except Exception:  # noqa: BLE001
            logger.exception(
                "litellm.budget_commit_failed", workflow_id=str(workflow_id)
            )

    async def _emit_call_completed(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
        forge_trace_id: str,
        response_body: dict[str, Any],
        model: str,
        latency_ms: int,
    ) -> None:
        """Publish ``EventType.LITELLM_CALL_COMPLETED`` (and ``AGENT_RUN_COMPLETED``).

        Falls back to ``AGENT_RUN_COMPLETED`` when the new enum member
        hasn't landed yet (sibling agent). We reference it by string
        via ``getattr`` so the file stays importable while the
        EventType migration is in flight.
        """
        usage = response_body.get("usage") or {}
        payload: dict[str, Any] = {
            "model": model,
            "usage": usage,
            "forge_trace_id": forge_trace_id,
            "latency_ms": latency_ms,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            event_type = getattr(
                EventType,
                "LITELLM_CALL_COMPLETED",
                EventType.AGENT_RUN_COMPLETED,
            )
            await default_bus.publish(
                event_type,
                payload,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "litellm.event_publish_failed",
                forge_trace_id=forge_trace_id,
                event_type=str(getattr(EventType, "LITELLM_CALL_COMPLETED", "AGENT_RUN_COMPLETED")),
            )


# Module-level singleton for convenience (DI-friendly).
forge_llm_client = ForgeLLMClient()


async def _chat_stream_iter(
    *,
    messages: list[dict[str, Any]],
    model: str,
    tenant_id: UUID | str,
    project_id: UUID | str | None,
    workflow_id: UUID | str | None = None,
    actor_id: UUID | str | None = None,
    **kwargs: Any,
) -> AsyncIterator[dict[str, Any]]:
    """Adapter: yield chunks from the singleton's stream chat path.

    forge_chat.stream_chat can call this directly without instantiating
    ForgeLLMClient. Wraps :meth:`ForgeLLMClient.chat` with ``stream=True``
    and delegates to :meth:`ForgeLLMClient._chat_stream` underneath.
    """
    iterator = await forge_llm_client.chat(
        messages=messages,
        model=model,
        tenant_id=tenant_id,
        project_id=project_id,
        workflow_id=workflow_id,
        actor_id=actor_id,
        stream=True,
        **kwargs,
    )
    # chat() returns the AsyncIterator directly when stream=True.
    async for chunk in iterator:  # type: ignore[union-attr]
        yield chunk


__all__ = [
    "ForgeLLMClient",
    "forge_llm_client",
    "_chat_stream_iter",
    "LLMUnavailableError",
    "set_current_principal",
    "reset_current_principal",
    "get_current_principal",
]