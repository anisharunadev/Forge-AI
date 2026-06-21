"""LiteLLM Proxy HTTP client (Rule 1 — no direct provider SDKs).

All LLM traffic flows through the LiteLLM Proxy. This client is the
only place in the backend that knows the proxy URL.

NFR-044 — every chat / embed call passes through a pre-call admission
control that consults the workflow budget service. Calls that would
breach a declared ceiling raise :class:`BudgetExceeded` before any
provider traffic is sent.
"""

from __future__ import annotations

from typing import Any, AsyncIterator
from uuid import UUID

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.services.cost_ledger import CostLedger, cost_ledger
from app.services.event_bus import EventType, bus as default_bus
from app.services.workflow_budget import (
    BudgetExceeded,
    Decision,
    workflow_budget_service,
)

logger = get_logger(__name__)


# Conservative defaults used when the caller does not pre-compute a
# projected cost. They only bound the admission check; actual spend
# is recorded after the call completes.
_DEFAULT_PROJECTED_CHAT_USD = 0.05
_DEFAULT_PROJECTED_EMBED_USD = 0.0001


class LiteLLMClient:
    """Thin async HTTP client for the LiteLLM Proxy.

    Streaming is supported for chat completions via httpx's
    `stream("POST", ...)` so the API contract stays OpenAI-compatible.
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 60.0,
        cost_ledger: CostLedger | None = None,
        budget_service: Any | None = None,
    ) -> None:
        self._base_url = (base_url or settings.litellm_proxy_url).rstrip("/")
        self._api_key = api_key or settings.litellm_api_key
        self._timeout = timeout
        self._cost_ledger = cost_ledger or cost_ledger
        self._budget_service = budget_service or workflow_budget_service
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "LiteLLMClient":
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._timeout,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError("LiteLLMClient must be used as an async context manager")
        return self._client

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
        """Call /v1/chat/completions and record cost.

        Non-streaming returns the full response dict; streaming returns
        an async iterator of chunk dicts (the SSE-decoded JSON bodies).

        Admission control (NFR-044): if ``workflow_id`` has a declared
        budget and ``spent + projected_cost_usd > ceiling``, this method
        raises :class:`BudgetExceeded` *before* any provider traffic is
        sent. ``projected_cost_usd`` defaults to a conservative bound.
        """
        model = model or settings.litellm_default_model
        body: dict[str, Any] = {"model": model, "messages": messages, "stream": stream, **kwargs}

        await self._admit_call(
            workflow_id=workflow_id,
            projected_cost_usd=projected_cost_usd
            if projected_cost_usd is not None
            else _DEFAULT_PROJECTED_CHAT_USD,
            actor_id=actor_id,
        )

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

    async def _chat_stream(
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
                # The terminal usage chunk carries `usage`; record then.
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
        body = {"model": model, "input": texts}
        await self._admit_call(
            workflow_id=workflow_id,
            projected_cost_usd=projected_cost_usd
            if projected_cost_usd is not None
            else _DEFAULT_PROJECTED_EMBED_USD,
            actor_id=None,
        )
        response = await self.client.post("/v1/embeddings", json=body)
        response.raise_for_status()
        data = response.json()
        vectors = [item["embedding"] for item in data.get("data", [])]

        # Embedding cost: $0.00002 / 1k tokens (typical); we record as 0
        # unless the proxy returns usage. Cost determination is the
        # proxy's job — we record what it tells us.
        await self._record_cost(data, tenant_id, project_id, workflow_id, model)
        await self._commit_spend(workflow_id, data, tenant_id, project_id)
        return vectors

    async def list_models(self) -> list[dict[str, Any]]:
        """Call /v1/models."""
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
        usage = response_body.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", 0))
        completion_tokens = int(usage.get("completion_tokens", 0))
        # The proxy may pre-compute cost_usd and surface it; otherwise
        # we estimate at zero and let a reconciler backfill.
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


__all__ = ["LiteLLMClient"]
