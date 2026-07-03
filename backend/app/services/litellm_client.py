"""Backward-compatible facade over :class:`ForgeLLMClient` (F-829j).

Historically this module was the only Rule 1 gateway — it constructed
the httpx client and knew the proxy URL. With F-829 the canonical
implementation lives in :mod:`app.integrations.litellm.llm_client`,
which adds per-tenant Virtual Keys, budget sync, trace correlation,
and guardrail awareness.

This file is kept as a thin facade so the 14 existing call sites that
do ``from app.services.litellm_client import LiteLLMClient`` (and call
``async with LiteLLMClient() as client: client.chat(...)``) keep
working without modification during Phase A. New code should import
:class:`ForgeLLMClient` from :mod:`app.integrations.litellm.llm_client`
directly.

Migration strategy (see plan §"Migration Strategy"):

1. The public surface (``chat``, ``embed``, ``list_models``,
   ``create_virtual_key``, ``__aenter__``/``__aexit__``, ``_admit_call``,
   ``_record_cost``, ``_commit_spend``) is preserved.
2. Internally the facade delegates every call to a
   :class:`ForgeLLMClient` instance that wraps the same httpx client.
3. The same return shapes are honored so 14 call sites compile and
   pass tests unchanged.
4. After Phase A GA, deprecated methods can be removed in a separate PR.
"""

from __future__ import annotations

from typing import Any, AsyncIterator
from uuid import UUID

from app.core.logging import get_logger
from app.services._litellm_tools import (
    ToolCall,
    ToolExecutor,
    ToolLoopExhausted,
    ToolResult,
    ToolSpec,
)
from app.services.workflow_budget import (
    BudgetExceeded,
    Decision,
    workflow_budget_service,
)

logger = get_logger(__name__)


# Conservative defaults used when the caller does not pre-compute a
# projected cost. They only bound the admission check; actual spend
# is recorded after the call completes. These mirror the historical
# defaults so facade callers see identical admission behavior.
_DEFAULT_PROJECTED_CHAT_USD = 0.05
_DEFAULT_PROJECTED_EMBED_USD = 0.0001


# ---------------------------------------------------------------------------
# Lazy import of the canonical implementation.
# The integration package is being created in parallel during Phase A;
# if it is not yet importable we fall back to a minimal local httpx
# client that preserves the legacy public surface so existing call
# sites continue to function.
# ---------------------------------------------------------------------------

def _load_canonical():
    """Import :class:`ForgeLLMClient` lazily, returning ``None`` if absent."""
    try:
        from app.integrations.litellm.llm_client import (  # type: ignore[import-not-found]
            ForgeLLMClient as _ForgeLLMClient,
        )

        return _ForgeLLMClient
    except ImportError:  # pragma: no cover — integration package still being built
        return None


def _load_forge_singleton():
    """Import the ``forge_llm_client`` module-level singleton if available."""
    try:
        from app.integrations.litellm.llm_client import (  # type: ignore[import-not-found]
            forge_llm_client as _forge_llm_client,
        )

        return _forge_llm_client
    except ImportError:  # pragma: no cover
        return None


class LiteLLMClient:
    """Thin async HTTP client for the LiteLLM Proxy.

    Backward-compatible facade over :class:`ForgeLLMClient`. The method
    signatures, return shapes, and async-context-manager protocol match
    the pre-F-829 implementation so existing call sites compile and
    pass tests unchanged.

    Streaming is supported for chat completions via the wrapped
    client's httpx ``stream("POST", ...)`` so the API contract stays
    OpenAI-compatible.
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 60.0,
        cost_ledger: Any | None = None,
        budget_service: Any | None = None,
    ) -> None:
        self._base_url = base_url
        self._api_key = api_key
        self._timeout = timeout
        self._cost_ledger = cost_ledger
        self._budget_service = budget_service or workflow_budget_service
        # The wrapped canonical client (or a fallback local httpx client
        # if the integration package has not landed yet). Lazily bound
        # inside ``__aenter__`` so the constructor never raises.
        self._impl: Any | None = None

    async def __aenter__(self) -> "LiteLLMClient":
        ForgeLLMClient = _load_canonical()
        if ForgeLLMClient is not None:
            # Delegate to the canonical implementation. Forward only
            # the kwargs it understands; facade-only kwargs (cost_ledger,
            # budget_service) are kept on ``self`` for the legacy helpers.
            impl_kwargs: dict[str, Any] = {"timeout": self._timeout}
            if self._base_url is not None:
                impl_kwargs["base_url"] = self._base_url
            if self._api_key is not None:
                impl_kwargs["api_key"] = self._api_key
            self._impl = ForgeLLMClient(**impl_kwargs)
            await self._impl.__aenter__()
        else:  # pragma: no cover — fallback when integration layer is absent
            await self._init_legacy_client()
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        if self._impl is not None and hasattr(self._impl, "__aexit__"):
            try:
                await self._impl.__aexit__(*_exc)
            finally:
                self._impl = None
        elif self._impl is not None and hasattr(self._impl, "aclose"):  # pragma: no cover
            await self._impl.aclose()
            self._impl = None

    async def _init_legacy_client(self) -> None:  # pragma: no cover — legacy fallback
        """Build a minimal httpx client when the integration layer is missing.

        This preserves the pre-F-829 behavior so the 14 call sites still
        work even before ``app.integrations.litellm.llm_client`` lands.
        """
        import httpx

        from app.core.config import settings
        from app.services.cost_ledger import cost_ledger

        base_url = (self._base_url or settings.litellm_proxy_url).rstrip("/")
        api_key = self._api_key or settings.litellm_api_key
        if self._cost_ledger is None:
            self._cost_ledger = cost_ledger
        self._impl = httpx.AsyncClient(
            base_url=base_url,
            timeout=self._timeout,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    @property
    def client(self) -> Any:
        if self._impl is None:
            raise RuntimeError("LiteLLMClient must be used as an async context manager")
        # The canonical ``ForgeLLMClient`` exposes ``.client`` as an
        # httpx ``AsyncClient``; the legacy fallback stores the client
        # directly on ``_impl``. Both paths expose the same attribute.
        if hasattr(self._impl, "client"):
            inner = self._impl.client
            if inner is not None:
                return inner
        return self._impl

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
        proxy_token: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        """Call /v1/chat/completions and record cost.

        Non-streaming returns the full response dict; streaming returns
        an async iterator of chunk dicts (the SSE-decoded JSON bodies).

        Admission control (NFR-044): if ``workflow_id`` has a declared
        budget and ``spent + projected_cost_usd > ceiling``, this method
        raises :class:`BudgetExceeded` *before* any provider traffic is
        sent. ``projected_cost_usd`` defaults to a conservative bound.

        step-65: pass ``proxy_token`` (RS256 JWT, signed at login) to
        switch auth from the per-tenant Virtual Key to the proxy's
        JWT-auth mode.  When ``None`` the call falls back to the
        existing Virtual Key path (default for the 14 existing call
        sites).  Both paths coexist during the rollout.
        """
        projected = (
            projected_cost_usd
            if projected_cost_usd is not None
            else _DEFAULT_PROJECTED_CHAT_USD
        )
        # Pre-call admission — same logic as the legacy client, kept
        # here so the facade works even if the canonical client evolves.
        await self._admit_call(
            workflow_id=workflow_id,
            projected_cost_usd=projected,
            actor_id=actor_id,
        )

        if self._impl is not None and hasattr(self._impl, "chat"):
            # Delegate to ForgeLLMClient.chat — it preserves the same
            # signature and return shape as the legacy client.
            chat_kwargs = dict(kwargs)
            if proxy_token is not None:
                chat_kwargs["proxy_token"] = proxy_token
            return await self._impl.chat(
                messages,
                model,
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=actor_id,
                projected_cost_usd=projected,
                stream=stream,
                **chat_kwargs,
            )

        # Legacy fallback path (integration package missing).
        chat_kwargs = dict(kwargs)
        if proxy_token is not None:
            chat_kwargs["proxy_token"] = proxy_token
        return await self._legacy_chat(
            messages,
            model,
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=workflow_id,
            actor_id=actor_id,
            stream=stream,
            projected_cost_usd=projected,
            **chat_kwargs,
        )

    async def _legacy_chat(  # pragma: no cover — fallback
        self,
        messages: list[dict[str, Any]],
        model: str | None,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
        projected_cost_usd: float,
        stream: bool,
        **kwargs: Any,
    ) -> dict[str, Any] | AsyncIterator[dict[str, Any]]:
        from app.core.config import settings
        from app.services.event_bus import EventType, bus as default_bus

        model = model or settings.litellm_default_model
        body: dict[str, Any] = {"model": model, "messages": messages, "stream": stream, **kwargs}

        if stream:
            return self._chat_stream(body, tenant_id, project_id, workflow_id, actor_id)

        response = await self.client.post("/v1/chat/completions", json=body)
        response.raise_for_status()
        data = response.json()

        await self._record_cost(data, tenant_id, project_id, workflow_id, model)
        await self._commit_spend(workflow_id, data, tenant_id, project_id)
        await default_bus.publish(
            EventType.AGENT_RUN_COMPLETED,
            {"model": model, "usage": data.get("usage", {})},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        return data

    async def _chat_stream(  # pragma: no cover — fallback streaming path
        self,
        body: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield SSE-decoded chunks; record cost on the terminal chunk."""
        async with self.client.stream("POST", "/v1/chat/completions", json=body) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                chunk = line[len("data:"):].strip()
                if chunk == "[DONE]":
                    break
                try:
                    import json as _json

                    parsed = _json.loads(chunk)
                except Exception:  # noqa: BLE001 — pass through raw
                    continue
                usage = parsed.get("usage")
                if usage:
                    await self._record_cost(
                        parsed, tenant_id, project_id, workflow_id, body["model"]
                    )
                    await self._commit_spend(workflow_id, parsed, tenant_id, project_id)
                yield parsed

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
        """Call /v1/embeddings.

        Admission control (NFR-044) runs before the call when a
        ``workflow_id`` is provided.
        """
        projected = (
            projected_cost_usd
            if projected_cost_usd is not None
            else _DEFAULT_PROJECTED_EMBED_USD
        )
        await self._admit_call(
            workflow_id=workflow_id,
            projected_cost_usd=projected,
            actor_id=None,
        )

        if self._impl is not None and hasattr(self._impl, "embed"):
            return await self._impl.embed(
                texts,
                model,
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                projected_cost_usd=projected,
            )

        return await self._legacy_embed(
            texts,
            model,
            tenant_id=tenant_id,
            project_id=project_id,
            workflow_id=workflow_id,
        )

    async def _legacy_embed(  # pragma: no cover — fallback
        self,
        texts: list[str],
        model: str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
    ) -> list[list[float]]:
        body = {"model": model, "input": texts}
        response = await self.client.post("/v1/embeddings", json=body)
        response.raise_for_status()
        data = response.json()
        vectors = [item["embedding"] for item in data.get("data", [])]
        await self._record_cost(data, tenant_id, project_id, workflow_id, model)
        await self._commit_spend(workflow_id, data, tenant_id, project_id)
        return vectors

    async def list_models(self) -> list[dict[str, Any]]:
        """Call /v1/models."""
        if self._impl is not None and hasattr(self._impl, "list_models"):
            return await self._impl.list_models()
        # Legacy fallback.
        response = await self.client.get("/v1/models")
        response.raise_for_status()
        return response.json().get("data", [])

    async def create_virtual_key(
        self,
        *,
        key_alias: str,
        duration: str | None = None,
        models: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        team_id: str | None = None,
    ) -> dict[str, Any]:
        """Mint a new virtual key on the LiteLLM proxy.

        Used by sub-graphs (e.g. ``code_validator``) that need their
        own scoped credentials. The ``key_alias`` MUST carry the
        sub-graph's namespace prefix — e.g. ``forge_validator_*``.

        Reference: https://docs.litellm.ai/docs/proxy/virtual_keys
        """
        if self._impl is not None and hasattr(self._impl, "create_virtual_key"):
            return await self._impl.create_virtual_key(
                key_alias=key_alias,
                duration=duration,
                models=models,
                metadata=metadata,
                team_id=team_id,
            )

        body: dict[str, Any] = {"key_alias": key_alias}
        if duration is not None:
            body["duration"] = duration
        if models:
            body["models"] = models
        if team_id:
            body["team_id"] = team_id
        if metadata:
            body["metadata"] = metadata
        response = await self.client.post("/key/generate", json=body)
        response.raise_for_status()
        return response.json()

    async def _record_cost(
        self,
        response_body: dict[str, Any],
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        model: str,
    ) -> None:
        """Extract usage and forward to CostLedger."""
        if self._cost_ledger is None:
            from app.services.cost_ledger import cost_ledger as _cost_ledger_default

            self._cost_ledger = _cost_ledger_default
        usage = response_body.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        cost_usd = float(response_body.get("cost_usd") or usage.get("cost_usd") or 0.0)
        if prompt_tokens or completion_tokens or cost_usd:
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

    # ------------------------------------------------------------------
    # F-800 Plan 0.2 — Tool-calling helper surface
    # ------------------------------------------------------------------

    async def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSpec],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        projected_cost_usd: float | None = None,
        tool_choice: str | dict[str, Any] = "auto",
        model: str | None = None,
        **kwargs: Any,
    ) -> tuple[dict[str, Any], list[ToolCall]]:
        """Single ``/v1/chat/completions`` call with a ``tools=`` body.

        Mirrors :meth:`chat` so callers can swap the two without
        touching admission control, cost recording, or budget commit:

        - Pre-call admission via :meth:`_admit_call`.
        - Post-call cost recording via :meth:`_record_cost`.
        - Post-call budget commit via :meth:`_commit_spend`.
        - One ``AGENT_RUN_COMPLETED`` event per call.

        Args:
            messages: OpenAI-style message list. May already contain a
                trailing ``assistant`` message with ``tool_calls`` and
                one ``tool`` message per result — :meth:`agent_loop`
                builds up that history between turns.
            tools: OpenAI function-calling specs the model may invoke.
            tenant_id: Required Rule 2 tenant scope.
            project_id: Optional Rule 2 project scope.
            workflow_id: Optional NFR-044 budget scope. When set, the
                pre-call admission check runs against the workflow's
                declared ceiling.
            actor_id: Audit attribution; echoed in the event bus payload.
            projected_cost_usd: Caller's best-effort upper bound on
                cost for the upcoming call. Defaults to a conservative
                constant so admission is always armed.
            tool_choice: Forwarded verbatim to the proxy. ``"auto"``
                lets the model decide; ``"required"`` forces at least
                one tool call; ``"none"`` disables tool calls.
            model: Optional model override; falls back to
                ``Settings.litellm_default_model``.
            **kwargs: Extra body fields (temperature, top_p, etc.).

        Returns:
            ``(response_dict, tool_calls)`` where ``response_dict`` is
            the raw OpenAI-shaped response and ``tool_calls`` is the
            list of :class:`ToolCall` requests extracted from the
            assistant message (empty when the model answered directly).
        """
        projected = (
            projected_cost_usd
            if projected_cost_usd is not None
            else _DEFAULT_PROJECTED_CHAT_USD
        )
        await self._admit_call(
            workflow_id=workflow_id,
            projected_cost_usd=projected,
            actor_id=actor_id,
        )

        from app.core.config import settings
        from app.services.event_bus import EventType, bus as default_bus

        chosen_model = model or settings.litellm_default_model
        body: dict[str, Any] = {
            "model": chosen_model,
            "messages": messages,
            "tools": list(tools),
            "tool_choice": tool_choice,
            **kwargs,
        }

        response = await self.client.post("/v1/chat/completions", json=body)
        response.raise_for_status()
        data = response.json()

        await self._record_cost(data, tenant_id, project_id, workflow_id, chosen_model)
        await self._commit_spend(workflow_id, data, tenant_id, project_id)
        await default_bus.publish(
            EventType.AGENT_RUN_COMPLETED,
            {"model": chosen_model, "usage": data.get("usage", {})},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )

        tool_calls = _extract_tool_calls(data)
        return data, tool_calls

    async def agent_loop(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolSpec],
        tool_executor: ToolExecutor,
        *,
        max_turns: int = 5,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        projected_cost_usd: float | None = None,
        model: str | None = None,
    ) -> tuple[dict[str, Any], list[ToolCall], list[ToolResult]]:
        """Run the tool-calling loop until the model answers or the cap hits.

        Loop invariant (per turn):

        1. ``chat_with_tools`` — single LLM call with the current
           message history + the same ``tools`` list every turn.
        2. If the response carries no ``tool_calls``, return the
           final assistant answer to the caller.
        3. Otherwise, append the assistant message
           (``role="assistant"``, ``tool_calls=[...]``) plus one
           ``role="tool"`` message per executor result and call the
           model again. ``is_error=True`` results are forwarded as-is;
           the model sees the error content and decides whether to
           retry, surface it, or escalate.

        Args:
            messages: Initial OpenAI message list. The list is *not*
                mutated in place; the loop builds a local working
                copy so caller's history stays untouched.
            tools: OpenAI tool specs available to the model.
            tool_executor: Async callable invoked once per tool call
                to produce a :class:`ToolResult`.
            max_turns: Cap on LLM calls before :class:`ToolLoopExhausted`
                is raised. Defaults to 5 (``copilot_tool_call_max``).
            tenant_id: Required Rule 2 tenant scope.
            project_id: Optional Rule 2 project scope.
            workflow_id: Optional NFR-044 budget scope. Admission runs
                *every turn* so a half-finished loop cannot exceed
                the ceiling mid-flight.
            actor_id: Audit attribution.
            projected_cost_usd: Per-turn cost projection forwarded to
                ``chat_with_tools``. Defaults to a conservative bound.
            model: Optional model override.

        Returns:
            ``(final_response, accumulated_tool_calls, accumulated_results)``.
            ``accumulated_tool_calls`` and ``accumulated_results`` are
            parallel lists in execution order so callers can render a
            transcript or audit the chain.

        Raises:
            ToolLoopExhausted: The model kept requesting tool calls
                for ``max_turns`` turns without producing a final
                assistant message.
            BudgetExceeded: Admission control blocked a turn before
                the HTTP call.
        """
        working: list[dict[str, Any]] = list(messages)
        accumulated_calls: list[ToolCall] = []
        accumulated_results: list[ToolResult] = []

        for _turn in range(max_turns):
            response, calls = await self.chat_with_tools(
                working,
                tools,
                tenant_id=tenant_id,
                project_id=project_id,
                workflow_id=workflow_id,
                actor_id=actor_id,
                projected_cost_usd=projected_cost_usd,
                model=model,
            )
            if not calls:
                return response, accumulated_calls, accumulated_results

            assistant_message = _assistant_tool_message(response)
            if assistant_message is not None:
                working.append(assistant_message)
            accumulated_calls.extend(calls)

            for call in calls:
                result = await tool_executor(call)
                accumulated_results.append(result)
                working.append(_tool_result_message(result))

        logger.warning(
            "litellm.agent_loop.exhausted",
            max_turns=max_turns,
            accumulated_calls=len(accumulated_calls),
            workflow_id=str(workflow_id) if workflow_id else None,
        )
        raise ToolLoopExhausted(max_turns)

    # ------------------------------------------------------------------
    # NFR-044 — Workflow budget admission control
    # ------------------------------------------------------------------

    async def _admit_call(
        self,
        *,
        workflow_id: UUID | str | None,
        projected_cost_usd: float,
        actor_id: UUID | str | None,
    ) -> None:
        """Block the call before any provider traffic if the budget is exhausted.

        A workflow with no declared budget is admitted unconditionally —
        the budget service is opt-in per workflow. A declared budget
        that would be exceeded by the projection raises
        :class:`BudgetExceeded`, which the caller can map to a 429-style
        domain error at the API boundary.
        """

        if workflow_id is None:
            return
        check = await self._budget_service.check_budget(
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

    async def _commit_spend(
        self,
        workflow_id: UUID | str | None,
        response_body: dict[str, Any],
        tenant_id: UUID | str | None,
        project_id: UUID | str | None,
    ) -> None:
        """Apply the post-call spend against the workflow's budget.

        Best-effort: a missing budget or an exhausted budget will not
        cause the LLM call result to fail. We log and continue.
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
            await self._budget_service.record_spend(
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
            logger.debug(
                "litellm.no_budget_to_commit",
                workflow_id=str(workflow_id),
            )
        except Exception:  # noqa: BLE001 — never let budget commit mask LLM result
            logger.exception(
                "litellm.budget_commit_failed",
                workflow_id=str(workflow_id),
            )


__all__ = [
    "LiteLLMClient",
    "chat_with_tools",
    "agent_loop",
    "ToolCall",
    "ToolResult",
    "ToolSpec",
    "ToolLoopExhausted",
    "ToolExecutor",
]


# ---------------------------------------------------------------------------
# Module-private helpers for chat_with_tools / agent_loop.
# Kept at module scope so they are easy to unit-test in isolation and
# don't capture the wrapped ``ForgeLLMClient`` instance.
# ---------------------------------------------------------------------------


def _extract_tool_calls(response: dict[str, Any]) -> list[ToolCall]:
    """Parse OpenAI-shaped ``tool_calls`` from a chat-completions response.

    Returns an empty list when the assistant answered directly (no tool
    use) or when the response is missing/malformed — both are valid
    termination signals for the agent loop.
    """
    try:
        choices = response.get("choices") or []
        if not choices:
            return []
        message = choices[0].get("message") or {}
        raw_calls = message.get("tool_calls") or []
    except (AttributeError, TypeError):  # pragma: no cover — defensive
        return []

    parsed: list[ToolCall] = []
    for raw in raw_calls:
        if not isinstance(raw, dict):
            continue
        tool_id = raw.get("id") or ""
        function = raw.get("function") or {}
        name = function.get("name") or ""
        arguments = function.get("arguments") or "{}"
        if isinstance(arguments, dict):
            import json as _json

            arguments = _json.dumps(arguments)
        if not tool_id or not name:
            continue
        parsed.append(
            ToolCall(
                id=str(tool_id),
                name=str(name),
                arguments_json=str(arguments),
            )
        )
    return parsed


def _assistant_tool_message(response: dict[str, Any]) -> dict[str, Any] | None:
    """Build the ``assistant`` message carrying ``tool_calls``.

    The proxy returns the assistant message inside ``choices[0].message``;
    we echo it back verbatim so the next call's history is exactly the
    shape OpenAI expects.
    """
    try:
        choices = response.get("choices") or []
        if not choices:
            return None
        message = choices[0].get("message") or {}
    except (AttributeError, TypeError):  # pragma: no cover
        return None
    if not message.get("tool_calls"):
        return None
    return {
        "role": "assistant",
        "content": message.get("content") or "",
        "tool_calls": list(message.get("tool_calls") or []),
    }


def _tool_result_message(result: ToolResult) -> dict[str, Any]:
    """Serialize a :class:`ToolResult` into the OpenAI tool-message shape."""
    return {
        "role": "tool",
        "tool_call_id": result.tool_call_id,
        "name": result.name,
        "content": result.content,
    }


# ---------------------------------------------------------------------------
# Re-exports so new code can use the canonical implementation without
# changing the import path. ``from app.services.litellm_client import
# ForgeLLMClient`` continues to work after F-829 ships.
# ---------------------------------------------------------------------------

try:
    from app.integrations.litellm.llm_client import (  # type: ignore[import-not-found]
        ForgeLLMClient,
        forge_llm_client,
    )
    __all__ = ["LiteLLMClient", "ForgeLLMClient", "forge_llm_client"]
except ImportError:  # pragma: no cover — integration package still being built
    ForgeLLMClient = None  # type: ignore[assignment,misc]
    forge_llm_client = None  # type: ignore[assignment,misc]