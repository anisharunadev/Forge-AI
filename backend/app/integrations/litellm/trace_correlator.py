"""F-829k — Forge ↔ LiteLLM trace correlation.

Every LLM call made through :class:`app.integrations.litellm.llm_client.ForgeLLMClient`
emits one row in :class:`app.db.models.litellm_call_record.LiteLLMCallRecord`.
The ``forge_trace_id`` is the OpenTelemetry trace id that the caller was
already carrying; the LiteLLM ``litellm_call_id`` is captured from the
response so the audit UI can join Forge spans with LiteLLM's spend logs.

This module is the canonical owner of trace-id minting and DB writes
for the new integration layer. It uses ``tenant_context`` on every
write so the new ``litellm_call_records`` RLS policy filters correctly.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.core.telemetry import get_tracer
from app.db.models.litellm_call_record import LiteLLMCallRecord
from app.db.rls import tenant_context
from app.db.session import get_session_factory

logger = get_logger(__name__)

# Per-call OTel span helper — safe to call before init_telemetry();
# get_tracer() is idempotent and will fall back to a no-op provider
# when no OTLP endpoint is configured.
_tracer = get_tracer(__name__)


class TraceCorrelator:
    """Writes :class:`LiteLLMCallRecord` rows and mints trace ids.

    The class is intentionally tiny — it is a focused collaborator of
    :class:`ForgeLLMClient`, not a general-purpose audit sink. Cost
    attribution flows through :class:`app.services.cost_ledger.CostLedger`;
    correlation rows live here.
    """

    def __init__(self) -> None:
        # No internal state for now; method exists to keep parity with
        # the other singleton services and to give tests an injection
        # seam later.
        pass

    # ------------------------------------------------------------------
    # Trace-id minting
    # ------------------------------------------------------------------

    def mint_trace_id(self) -> str:
        """Return a 32-char hex trace id (uuid4 without dashes).

        Stable length keeps it usable as an HTTP header value and as a
        Postgres indexed column without surprises.
        """
        return uuid.uuid4().hex

    def mint_trace_id_from_active_span(self) -> str:
        """Mint a trace id correlated with the active OTel span, if any.

        When the call site is already inside an OpenTelemetry span, the
        128-bit trace id from the active span context is preferred —
        it lets the audit UI click straight from a LiteLLM call record
        to the parent Forge span. When no span is active we fall back
        to :func:`mint_trace_id` so the field is never empty.
        """
        try:
            span = _tracer.start_span("litellm.trace_correlator.mint")
            ctx = span.get_span_context()
            if ctx and ctx.trace_id:
                # trace_id is a 128-bit int; format as 32-char hex.
                return format(ctx.trace_id, "032x")
        except Exception:  # noqa: BLE001 — never let telemetry fail the call path
            pass
        return self.mint_trace_id()

    # ------------------------------------------------------------------
    # Persisted call records
    # ------------------------------------------------------------------

    async def record_call(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        actor_id: UUID | str | None,
        forge_trace_id: str,
        litellm_call_id: str | None,
        model: str,
        status: str,
        prompt_tokens: int,
        completion_tokens: int,
        cost_usd: float,
        latency_ms: int,
        error: str | None = None,
    ) -> None:
        """Persist a single :class:`LiteLLMCallRecord` row.

        Uses :func:`tenant_context` so the RLS policy on
        ``litellm_call_records`` accepts the write. ``project_id`` is
        required by Rule 2 — callers should always pass one; we
        defensively fall back to the nil-UUID sentinel when a call
        somehow arrives without it (which would already fail upstream
        checks in :class:`ForgeLLMClient`).
        """
        tid = str(tenant_id)
        pid = str(project_id) if project_id else "00000000-0000-0000-0000-000000000000"
        factory = get_session_factory()
        async with factory() as session:
            async with tenant_context(session, tid, pid):
                row = LiteLLMCallRecord(
                    tenant_id=tid,
                    project_id=pid,
                    workflow_id=str(workflow_id) if workflow_id else None,
                    actor_id=str(actor_id) if actor_id else None,
                    forge_trace_id=forge_trace_id,
                    litellm_call_id=litellm_call_id,
                    model=model,
                    status=status,
                    prompt_tokens=int(prompt_tokens or 0),
                    completion_tokens=int(completion_tokens or 0),
                    cost_usd=float(cost_usd or 0.0),
                    latency_ms=int(latency_ms or 0),
                    error=error,
                    metadata_={},
                    occurred_at=datetime.now(timezone.utc),
                )
                session.add(row)
                await session.commit()
        logger.info(
            "litellm.call_recorded",
            tenant_id=tid,
            project_id=pid,
            workflow_id=str(workflow_id) if workflow_id else None,
            forge_trace_id=forge_trace_id,
            litellm_call_id=litellm_call_id,
            model=model,
            status=status,
            latency_ms=int(latency_ms or 0),
        )

    async def get_by_trace_id(self, forge_trace_id: str) -> list[LiteLLMCallRecord]:
        """Return every call row carrying this ``forge_trace_id``.

        Joins Forge spans with LiteLLM spend logs from the audit UI.
        Filters by ``forge_trace_id`` only — RLS still applies so
        callers from other tenants never see rows they don't own.
        """
        factory = get_session_factory()
        async with factory() as session:
            # tenant_context is required for the SELECT to match RLS;
            # when the caller already runs inside a tenant-scoped
            # session this is a no-op GUC write. When the caller is
            # the audit admin (Steward) they pass their own
            # tenant_id; we don't know it here, so the caller should
            # wrap this in tenant_context before calling.
            stmt = select(LiteLLMCallRecord).where(
                LiteLLMCallRecord.forge_trace_id == forge_trace_id
            )
            rows = (await session.execute(stmt)).scalars().all()
        return list(rows)

    # ------------------------------------------------------------------
    # Convenience: extract forge_trace_id from an httpx response.
    # ------------------------------------------------------------------

    @staticmethod
    def extract_litellm_call_id(response_headers: Any) -> str | None:
        """Pull the LiteLLM-assigned call id from response headers.

        The LiteLLM proxy surfaces ``x-litellm-call-id`` on every
        response. We don't fail if it isn't there — the call record is
        still useful for audit even without the join.
        """
        if response_headers is None:
            return None
        try:
            value = response_headers.get("x-litellm-call-id")
            return str(value) if value else None
        except Exception:  # noqa: BLE001
            return None


# Module-level singleton for convenience (DI-friendly).
trace_correlator = TraceCorrelator()


__all__ = ["TraceCorrelator", "trace_correlator"]