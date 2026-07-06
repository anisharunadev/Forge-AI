"""Session Cost Tracking (F-412).

Per-session LLM cost rollup. Every command recorded via the terminal
audit layer is metered here:

- ``record_usage`` — exact token count when the CLI surfaces one
  (Claude Code / Codex / Gemini all return usage in their NDJSON
  streams; we capture those).
- ``estimate_from_output`` — byte-based heuristic when token counts
  aren't exposed. Empirically calibrated: an LLM answer is roughly
  4 characters per token, so ``bytes / 4`` is a usable upper bound
  for the completion side, with a small fixed prompt overhead.
- ``get_burn_rate`` — USD/hour, derived from cost over the last
  ``window_seconds`` minutes of activity, so a session that just
  finished a $0.02 command shows up immediately on the dashboard.

The actual ``CostEntry`` rows live in :mod:`app.db.models.cost`; this
module is a rollup + the public surface the API layer calls.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models.cost import CostEntry
from app.db.models.terminal_cost import TerminalSessionCost
from app.db.session import get_session_factory
from app.services.cost_ledger import cost_ledger
from app.services.event_bus import EventType, bus

logger = get_logger(__name__)


# Heuristic: roughly 4 chars per token for English-language LLM output;
# multiplier lets us tune the safety factor upward for chatty CLIs.
_OUTPUT_BYTES_PER_TOKEN = 4
_PROMPT_OVERHEAD_TOKENS = 50
_DEFAULT_MODEL_COST_PER_1K = 0.003  # USD per 1k completion tokens


@dataclass
class CostTrackerHandle:
    """Opaque handle returned by :meth:`CostTracker.start_session_tracking`.

    Holds the counters used by the live session; on stop we flush the
    handle into a final rollup row.
    """

    session_id: str
    tenant_id: str
    project_id: str
    model: str
    started_at: datetime
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    command_count: int = 0
    last_activity_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class CostSummary:
    """Public-facing rollup for one session."""

    session_id: str
    tenant_id: str
    project_id: str
    total_cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    breakdown_by_model: dict[str, float]
    command_count: int
    burn_rate_usd_per_hour: float
    started_at: datetime
    last_activity_at: datetime
    is_active: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "total_cost_usd": self.total_cost_usd,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "breakdown_by_model": dict(self.breakdown_by_model),
            "command_count": self.command_count,
            "burn_rate_usd_per_hour": self.burn_rate_usd_per_hour,
            "started_at": self.started_at.isoformat(),
            "last_activity_at": self.last_activity_at.isoformat(),
            "is_active": self.is_active,
        }


# Per-model cost-per-1k-tokens. Real CLIs expose this; we ship a
# reasonable default table for the three first-party integrations
# and fall back to the catch-all default for unknown models.
_MODEL_COSTS: dict[str, tuple[float, float]] = {
    # model -> (prompt_per_1k, completion_per_1k)
    "claude-sonnet-4-6": (0.003, 0.015),
    "claude-opus-4-7": (0.015, 0.075),
    "claude-haiku-4-5": (0.0008, 0.004),
    "gpt-4o": (0.005, 0.015),
    "gpt-4o-mini": (0.00015, 0.0006),
    "codex": (0.003, 0.012),
    "gemini-1.5-pro": (0.00125, 0.005),
}


def cost_for(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Compute USD cost for a (model, tokens) tuple."""
    prompt_rate, completion_rate = _MODEL_COSTS.get(
        model, (_DEFAULT_MODEL_COST_PER_1K, _DEFAULT_MODEL_COST_PER_1K)
    )
    return (prompt_tokens / 1000.0) * prompt_rate + (completion_tokens / 1000.0) * completion_rate


class CostTracker:
    """Process-wide tracker with in-memory handle cache + DB rollup."""

    def __init__(self) -> None:
        self._handles: dict[str, CostTrackerHandle] = {}
        self._lock = asyncio.Lock()
        # Time window used for burn-rate calculation. Configurable
        # through settings later; this default works for typical
        # CLI sessions where commands take 1-30 seconds each.
        self.burn_rate_window_seconds = 300

    # -- session lifecycle ------------------------------------------------

    async def start_session_tracking(
        self,
        session_id: str,
        model: str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> CostTrackerHandle:
        """Open a tracking handle for a freshly-launched session."""
        async with self._lock:
            existing = self._handles.get(session_id)
            if existing is not None:
                return existing
            handle = CostTrackerHandle(
                session_id=session_id,
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                model=model,
                started_at=datetime.now(UTC),
            )
            self._handles[session_id] = handle
            return handle

    async def stop_session_tracking(self, handle: CostTrackerHandle) -> CostSummary:
        """Flush a handle to the rollup table and return the final summary."""
        async with self._lock:
            self._handles.pop(handle.session_id, None)
        await self._flush_rollup(handle)
        return await self.get_session_cost(handle.session_id)

    # -- recording --------------------------------------------------------

    async def record_usage(
        self,
        handle: CostTrackerHandle,
        prompt_tokens: int,
        completion_tokens: int,
        model: str,
    ) -> None:
        """Record an exact token usage report from the CLI."""
        async with handle._lock:
            handle.prompt_tokens += int(prompt_tokens)
            handle.completion_tokens += int(completion_tokens)
            handle.command_count += 1
            handle.last_activity_at = datetime.now(UTC)
            cost = cost_for(model, prompt_tokens, completion_tokens)
            handle.cost_usd += cost
            await self._record_ledger_row(
                handle=handle,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost,
                source="terminal.exact",
            )

    async def estimate_from_output(
        self,
        handle: CostTrackerHandle,
        output_bytes: int,
        *,
        command_count_delta: int = 1,
    ) -> float:
        """Estimate cost when token counts aren't exposed.

        Used by the PTY hook that watches every N bytes of CLI output.
        Returns the cost incurred (USD) so callers can surface it
        without re-querying.
        """
        if output_bytes <= 0:
            return 0.0
        completion_tokens = max(1, output_bytes // _OUTPUT_BYTES_PER_TOKEN)
        prompt_tokens = _PROMPT_OVERHEAD_TOKENS
        cost = cost_for(handle.model, prompt_tokens, completion_tokens)
        async with handle._lock:
            handle.prompt_tokens += prompt_tokens
            handle.completion_tokens += completion_tokens
            handle.cost_usd += cost
            handle.command_count += command_count_delta
            handle.last_activity_at = datetime.now(UTC)
        await self._record_ledger_row(
            handle=handle,
            model=handle.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost,
            source="terminal.estimate",
            metadata={"output_bytes": output_bytes, "heuristic": "bytes/4"},
        )
        await bus.publish(
            EventType.COST_INCURRED,
            {
                "session_id": handle.session_id,
                "model": handle.model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cost_usd": cost,
                "source": "terminal.estimate",
                "output_bytes": output_bytes,
            },
            tenant_id=handle.tenant_id,
            project_id=handle.project_id,
            actor_id=None,
        )
        return cost

    async def estimate_command(
        self,
        handle: CostTrackerHandle,
        output_bytes: int,
        *,
        model: str | None = None,
    ) -> dict[str, Any]:
        """What-if estimate for a command — does NOT record anything."""
        model = model or handle.model
        completion_tokens = max(1, int(output_bytes) // _OUTPUT_BYTES_PER_TOKEN)
        prompt_tokens = _PROMPT_OVERHEAD_TOKENS
        cost = cost_for(model, prompt_tokens, completion_tokens)
        return {
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost_usd": cost,
            "output_bytes": int(output_bytes),
            "source": "terminal.what_if",
        }

    # -- queries ----------------------------------------------------------

    async def get_session_cost(self, session_id: str) -> CostSummary:
        """Aggregate live handle + persisted rollup rows for a session."""
        handle = self._handles.get(session_id)
        factory = get_session_factory()
        async with factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(TerminalSessionCost).where(
                            TerminalSessionCost.session_id == session_id
                        )
                    )
                )
                .scalars()
                .all()
            )

        breakdown: dict[str, float] = {}
        rollup_prompt = 0
        rollup_completion = 0
        rollup_cost = 0.0
        rollup_command_count = 0
        for r in rows:
            breakdown[r.model] = breakdown.get(r.model, 0.0) + float(r.cost_usd)
            rollup_prompt += int(r.prompt_tokens)
            rollup_completion += int(r.completion_tokens)
            rollup_cost += float(r.cost_usd)
            rollup_command_count += int(r.command_count)

        if handle is not None:
            breakdown[handle.model] = breakdown.get(handle.model, 0.0) + handle.cost_usd
            total_prompt = rollup_prompt + handle.prompt_tokens
            total_completion = rollup_completion + handle.completion_tokens
            total_cost = rollup_cost + handle.cost_usd
            command_count = rollup_command_count + handle.command_count
            started_at = handle.started_at
            last_activity = handle.last_activity_at
            is_active = True
        else:
            total_prompt = rollup_prompt
            total_completion = rollup_completion
            total_cost = rollup_cost
            command_count = rollup_command_count
            if rows:
                started_at = min(r.recorded_at for r in rows)
                last_activity = max(r.recorded_at for r in rows)
            else:
                now = datetime.now(UTC)
                started_at = now
                last_activity = now
            is_active = False

        tenant_id = str(rows[0].tenant_id) if rows else (handle.tenant_id if handle else "")
        project_id = str(rows[0].project_id) if rows else (handle.project_id if handle else "")
        burn_rate = await self._compute_burn_rate(
            session_id=session_id,
            tenant_id=tenant_id,
            now=datetime.now(UTC),
        )
        return CostSummary(
            session_id=session_id,
            tenant_id=tenant_id,
            project_id=project_id,
            total_cost_usd=total_cost,
            prompt_tokens=total_prompt,
            completion_tokens=total_completion,
            breakdown_by_model=breakdown,
            command_count=command_count,
            burn_rate_usd_per_hour=burn_rate,
            started_at=started_at,
            last_activity_at=last_activity,
            is_active=is_active,
        )

    async def get_active_session_costs(self, tenant_id: UUID | str) -> list[CostSummary]:
        """Cost summaries for every active handle in a tenant."""
        async with self._lock:
            matching = [h for h in self._handles.values() if h.tenant_id == str(tenant_id)]
        out: list[CostSummary] = []
        for h in matching:
            out.append(await self.get_session_cost(h.session_id))
        return out

    async def get_burn_rate(self, tenant_id: UUID | str) -> float:
        """USD/hour aggregated over the configured window."""
        return await self._compute_burn_rate(
            session_id=None,
            tenant_id=str(tenant_id),
            now=datetime.now(UTC),
        )

    # -- internal helpers -------------------------------------------------

    async def _record_ledger_row(
        self,
        *,
        handle: CostTrackerHandle,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        cost_usd: float,
        source: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await cost_ledger.record(
            tenant_id=handle.tenant_id,
            project_id=handle.project_id,
            workflow_id=None,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost_usd,
            source=source,
            metadata={"session_id": handle.session_id, **(metadata or {})},
        )

    async def _flush_rollup(self, handle: CostTrackerHandle) -> None:
        """Insert one rollup row per (session, model) on stop."""
        factory = get_session_factory()
        async with factory() as session:
            duration = (datetime.now(UTC) - handle.started_at).total_seconds()
            row = TerminalSessionCost(
                session_id=handle.session_id,
                tenant_id=UUID(handle.tenant_id),
                project_id=UUID(handle.project_id),
                model=handle.model,
                prompt_tokens=handle.prompt_tokens,
                completion_tokens=handle.completion_tokens,
                cost_usd=handle.cost_usd,
                recorded_at=datetime.now(UTC),
                command_count=handle.command_count,
                duration_seconds=duration,
            )
            session.add(row)
            await session.commit()

    async def _compute_burn_rate(
        self,
        *,
        session_id: str | None,
        tenant_id: str,
        now: datetime,
    ) -> float:
        """Sum cost over the burn-rate window and project to USD/hour.

        Scoped to ``terminal.*`` source rows so a tenant's connector or
        workflow traffic doesn't pollute the terminal-center metric.
        """
        if not tenant_id:
            return 0.0
        since = now - timedelta(seconds=self.burn_rate_window_seconds)
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
                CostEntry.tenant_id == tenant_id,
                CostEntry.recorded_at >= since,
                CostEntry.source.like("terminal.%"),
            )
            if session_id is not None:
                stmt = stmt.where(CostEntry.metadata_["session_id"].astext == session_id)
            result = await session.scalar(stmt)
        cost_in_window = float(result or 0)
        # Project the window's cost to a 1-hour rate.
        hours = max(self.burn_rate_window_seconds / 3600.0, 1e-6)
        return cost_in_window / hours


cost_tracker = CostTracker()


__all__ = [
    "CostTracker",
    "CostTrackerHandle",
    "CostSummary",
    "cost_tracker",
    "cost_for",
]
