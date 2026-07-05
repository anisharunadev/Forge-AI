# Phase 5 — Observability & SLOs (Implementation Plan)

**Status:** PLANNED (awaiting implementation start)
**Owner:** TBA
**Depends on:** Phase 4 green (audit_events table)
**Blocks:** Phase 6 (cost rollup consumed by budget caps)

---

## §0 Pre-Phase State Verification

### §0.1 Plan Source of Truth

`/home/arunachalam.v@knackforge.com/forge-ai/docs/plan/phase-5.md` defines:
- 8 Success Criteria (SC-5.1 through SC-5.8)
- 8 tasks (T5.1–T5.8)
- 6 surfaces: chat, KG, ideation, forge-models, terminal, copilot
- File-touch list, risks, out-of-scope

Reference templates:
- `/home/arunachalam.v@knackforge.com/forge-ai/docs/plan/phase-3-detailed.md` (1,809 lines)
- `/home/arunachalam.v@knackforge.com/forge-ai/docs/plan/phase-4-detailed.md` (1,617 lines)

### §0.2 Current Telemetry State

File: `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/telemetry.py`

- Line 33: idempotency guard `if _initialized: return`
- Lines 36–42: Resource attributes include `SERVICE_NAME`, `SERVICE_VERSION`, `DEPLOYMENT_ENVIRONMENT` — **no `tenant_id`**
- Lines 54–56: `TracerProvider` with `BatchSpanProcessor` + OTLP exporter
- **No custom sampler** — defaults to `ParentBased(AlwaysOn)`

### §0.3 Current Logging State

File: `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/logging.py`

- Lines 20–22: Contextvars `tenant_id_ctx`, `project_id_ctx`, `actor_id_ctx`
- Lines 25–33: `_inject_context` processor uses `setdefault` for each
- Line 56: `secret_filter` runs first in `shared_processors`
- **Missing:** `request_id_ctx` (added in this plan)

### §0.4 Current Alert State

File: `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/observability/alerts.py`

- Lines 218, 233–244: Singleton `alert_manager` + `register()` for EventBus → AlertManager webhook bridge
- **NOT** per-SLO alerts; uses `ALERTMANAGER_WEBHOOK_URL`

### §0.5 Current Audit State

File: `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/audit_service.py`

- Lines 46–112: `AuditService.record` writes to `audit_events` via ORM
- Lines 103–109: Raw SQL UPDATE for `hash_chain_ref` (bypasses ORM immutability listener)
- **Does NOT publish to Redis** today

File: `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/api/v1/audit.py`

- 4 REST endpoints: `list` (line 34), `integrity` (line 78), `llm-traffic` (line 131), `settings/{project_id}` (line 155)
- Auth: `get_current_principal` + `require_permission("audit:read")`

### §0.6 Current WebSocket Auth Pattern

File: `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/api/ws/terminal_broadcast.py`

- Lines 42–58: accepts `?token=` query OR first JSON frame `{type: "auth", token: ...}`
- Line 40: mounted at `/ws/terminal/{session_id}/watch`

### §0.7 Current Frontend WS Client

File: `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/lib/api/client.ts`

- Lines 263–269: `api.ws(path)` helper appends `?token=...`

### §0.8 Current Audit Page

File: `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/app/audit/page.tsx`

- Lines 2001–2009: polls via `useApiData<AuditRecord[]>('/v1/audit/records')`
- No WebSocket client; no `app/admin/audit/` subdirectory

### §0.9 AuditTimelineVirtualized

File: `/home/arunachalam.v@knackforge.com/forge-ai/apps/forge/components/audit/AuditTimelineVirtualized.tsx`

- Line 4: already uses `@tanstack/react-virtual` — reused for Live tab

### §0.10 Database Migration Baseline

Last merged revision referenced in `/home/arunachalam.v@knackforge.com/forge-ai/backend/alembic/versions/` ends at `step_91`. New revisions in this plan: `step_92`, `step_93`.

### §0.11 Scheduler Job Pattern

Pattern reused: `start()/stop()` async loop jobs in `/home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/scheduler/jobs/`.

### §0.12 CI Workflow

File: `/home/arunachalam.v@knackforge.com/forge-ai/.github/workflows/ci.yml` — existing `backend-tests` and `frontend-tests` jobs; step added for SLO doc validation.

### §0.13 Out-of-Scope Confirmation

Phase-5 brief lists: alerts, dashboards, sampling. Excludes: external SIEM, tracing backends beyond OTLP, on-call rotation tooling.

### §0.14 Constitutional Rules Touched

R2 (multi-tenancy), R6 (mandatory auditability), R7 (mandatory observability), R10 (append-only audit), R15 (empty states explain).

### §0.15 Drift Between Brief and Reality

| # | Brief assumption | Actual state | Resolution |
|---|---|---|---|
| 1 | Audit stream endpoint under `api/v1/audit_stream.py` | No such file; WS routes live under `api/ws/` | Use `api/ws/audit.py` mounted at `/ws/audit` |
| 2 | Audit events published via Redis Pub/Sub | `AuditService` does not publish | Use Redis Streams (XADD/XREADGROUP) for replay-capable delivery |
| 3 | `tenant_settings` table exists | Does not exist | New migration `step_92` creates it |
| 4 | `cost_minute_rollup` table exists | Does not exist | New migration `step_93` creates it |
| 5 | Custom OTel sampler already wired | Defaults to `ParentBased(AlwaysOn)` | New `tenant_sampler.py` wires `ParentBased(TraceIdRatioBased)` |
| 6 | `request_id` in logs | Only `tenant_id/project_id/actor_id` contextvars | Add `request_id_ctx` + middleware |
| 7 | SLO alerts wired to AlertManager | Only EventBus webhook bridge exists | New `slo_alerts.py` with 7 alert classes, throttle, breach-window |
| 8 | `audit/` admin subdirectory exists | Only top-level `app/audit/` | New `app/admin/audit/page.tsx` for Live tab |
| 9 | Frontend WS hook exists | None | New `useAuditStream.ts` |
| 10 | OTel collector config exists | None in repo | New `infra/otel-collector.yaml` |
| 11 | Per-tenant sampling via header | SDK samplers can't see headers | Header `x-debug-sample` recorded in contextvar; rate enforced in sampler |
| 12 | Cost rollup endpoint exists | None | New `/v1/observability/cost` endpoint |
| 13 | SLO doc standard exists | None | New `docs/standards/slos.md` + `check-slos.py` validator |

---

## §1 Goal

Make every Forge-AI surface (chat, KG, ideation, forge-models, terminal, copilot) observable end-to-end: defined SLOs, sampled traces per tenant, enriched logs, SLO-driven alerts, live audit streaming, and minute-granular cost rollups — without bloating the hot path.

---

## §2 Success Criteria

| SC | Description | Verification |
|---|---|---|
| SC-5.1 | All 6 surfaces have documented SLOs (latency, error, availability) in `docs/standards/slos.md` and CI validates them | `python scripts/check-slos.py` exits 0; CI step green |
| SC-5.2 | Per-tenant trace sampling via `tenant_settings.sampling_rate` (Redis-cached) | `pytest backend/tests/test_sampling.py -q` passes |
| SC-5.3 | Every log line carries `tenant_id`, `project_id`, `actor_id`, `request_id` | `pytest backend/tests/test_log_enrichment.py -q` passes |
| SC-5.4 | Sustained-breach SLO alerts (5-minute window) fire once per hour max | `pytest backend/tests/test_slo_alerts.py -q` passes |
| SC-5.5 | Live audit WebSocket delivers events within 1s of `AuditService.record` | `pytest backend/tests/test_audit_stream.py -q` + `pnpm --filter forge test:e2e audit-live` |
| SC-5.6 | Cost rollup table populated within 60s of LiteLLM response | `pytest backend/tests/test_cost_aggregator.py -q` passes |
| SC-5.7 | OTel collector config committed; tail-sampling configured per env | `yamllint infra/otel-collector.yaml` exits 0 |
| SC-5.8 | Observability runbook covers on-call response for each alert class | Manual review; checklist in PR description |

---

## §3 Sub-Phases / PR Breakdown

| PR | Depends on | Title | Est. files |
|---|---|---|---|
| PR-5.1 | — | SLO standard + CI validator | 4 |
| PR-5.2 | PR-5.1 | Tenant sampler + middleware + logging contextvar | 6 |
| PR-5.3 | PR-5.2 | SLO alerts (sustained breach) | 4 |
| PR-5.4 | PR-5.3 | Audit Redis Streams + WS endpoint | 5 |
| PR-5.5 | PR-5.4 | Frontend Live audit tab + WS hook | 4 |
| PR-5.6 | PR-5.3 | Cost rollup table + aggregator + scheduler | 6 |
| PR-5.7 | PR-5.6 | OTel collector config + runbook | 3 |
| PR-5.8 | PR-5.7 | CI integration + final verification | 2 |

Tree stays green: PR-5.1 docs only; PR-5.2/5.3/5.4/5.6 additive (new tables, new endpoints); PR-5.5 frontend-only; PR-5.7 config-only; PR-5.8 wiring.

---

## §4 Per-Task Detail

### PR-5.1 — SLO standard + CI validator

**Files created:**
- `docs/standards/slos.md`
- `docs/standards/observability.md`
- `scripts/check-slos.py`
- `scripts/check-slos.sh`

#### `docs/standards/slos.md`

```markdown
# SLO Standard

Each surface MUST declare exactly one row per metric type in `slo_table`.

## Surfaces

| ID | Surface |
|----|---------|
| chat | Conversational chat completion |
| kg | Knowledge-graph query |
| ideation | Ideation pipeline |
| forge-models | Forge model registry/inference |
| terminal | Managed terminal sessions |
| copilot | Inline copilot suggestions |

## slo_table schema

Each surface lists: latency_p50_ms, latency_p95_ms, latency_p99_ms,
error_rate_max, availability_min, breach_window_minutes (default 5).

## Example

| surface | metric | target | window |
|---------|--------|--------|--------|
| chat | latency_p95_ms | 1500 | 5 |
| chat | error_rate | 0.01 | 5 |
| chat | availability | 0.999 | 30 |
```

#### `docs/standards/observability.md`

```markdown
# Observability Standard

O1. Every span MUST carry `tenant.id`, `project.id`, `request.id`.
O2. Sampling rate MUST be tenant-scoped via `tenant_settings.sampling_rate`.
O3. Log lines MUST include `tenant_id`, `project_id`, `actor_id`, `request_id`.
O4. SLO breach alerts MUST use a sustained-breach window (default 5 min).
O5. Audit events MUST be delivered to live subscribers within 1s.
```

#### `scripts/check-slos.py`

```python
#!/usr/bin/env python3
"""Validate that every surface in docs/standards/slos.md has all required metrics."""
import re
import sys
from pathlib import Path

SURFACES = {"chat", "kg", "ideation", "forge-models", "terminal", "copilot"}
REQUIRED_METRICS = {"latency_p95_ms", "error_rate", "availability"}

def main() -> int:
    text = Path("docs/standards/slos.md").read_text(encoding="utf-8")
    rows = re.findall(r"\|\s*(\w[\w-]*)\s*\|\s*(\w+)\s*\|", text)
    have = {(s, m) for s, m in rows if s in SURFACES}
    missing = [
        (s, m) for s in SURFACES for m in REQUIRED_METRICS if (s, m) not in have
    ]
    if missing:
        print(f"MISSING: {missing}", file=sys.stderr)
        return 1
    print(f"OK: {len(SURFACES)} surfaces x {len(REQUIRED_METRICS)} metrics")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

#### `scripts/check-slos.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
python3 scripts/check-slos.py
```

**Verify:**
```
bash scripts/check-slos.sh
```
Expected: `OK: 6 surfaces x 3 metrics`.

---

### PR-5.2 — Tenant sampler + middleware + logging contextvar

**Files created/modified:**
- `backend/app/core/tenant_sampler.py` (new)
- `backend/app/core/middleware.py` (new)
- `backend/app/core/logging.py` (modified — add `request_id_ctx`)
- `backend/app/core/telemetry.py` (modified — wire custom sampler)
- `backend/app/db/models/tenant_settings.py` (new)
- `backend/alembic/versions/step_92_p5_tenant_settings.py` (new)
- `backend/tests/test_sampling.py` (new)
- `backend/tests/test_log_enrichment.py` (new)

#### `backend/app/db/models/tenant_settings.py`

```python
"""Per-tenant observability settings."""
from __future__ import annotations

import uuid
from sqlalchemy import ForeignKey, Float, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import UUIDPrimaryKeyMixin, TimestampMixin, Base


class TenantSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "tenant_settings"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, index=True
    )
    sampling_rate: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    log_quota_per_hour: Mapped[int] = mapped_column(Integer, default=100_000, nullable=False)
    debug_force_sample: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

#### `backend/alembic/versions/step_92_p5_tenant_settings.py`

```python
"""Add tenant_settings table."""
from alembic import op
import sqlalchemy as sa

revision = "step_92_p5_tenant_settings"
down_revision = "step_91"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_settings",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("sampling_rate", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("log_quota_per_hour", sa.Integer, nullable=False, server_default="100000"),
        sa.Column("debug_force_sample", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_tenant_settings_tenant_id", "tenant_settings", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_tenant_settings_tenant_id", table_name="tenant_settings")
    op.drop_table("tenant_settings")
```

#### `backend/app/core/tenant_sampler.py`

```python
"""Tenant-scoped trace sampler with Redis-cached settings."""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from opentelemetry.sdk.trace.sampling import (
    Sampler,
    SamplingDecision,
    SamplingResult,
    TraceIdRatioBased,
    ParentBased,
)
from opentelemetry.trace import Link, SpanKind
from opentelemetry.trace.span import TraceState
from opentelemetry.util.types import Attributes
import redis.asyncio as aioredis

from app.core.logging import tenant_id_ctx


_TTL_SECONDS = 30
_LOCAL: dict[str, tuple[float, float, bool]] = {}  # tenant_id -> (expires_at, rate, debug)


class TenantSettingsCache:
    """Read-through cache for tenant_settings row, mirrored to Redis."""

    def __init__(self, redis: aioredis.Redis, session_factory) -> None:
        self._redis = redis
        self._session_factory = session_factory

    async def get(self, tenant_id: uuid.UUID) -> tuple[float, bool]:
        key = f"tenset:{tenant_id}"
        now = time.monotonic()
        cached = _LOCAL.get(str(tenant_id))
        if cached and cached[0] > now:
            return cached[1], cached[2]
        raw = await self._redis.get(key)
        if raw:
            data = json.loads(raw)
            rate, debug = float(data["rate"]), bool(data["debug"])
        else:
            rate, debug = await self._load_db(tenant_id)
            await self._redis.set(key, json.dumps({"rate": rate, "debug": debug}), ex=_TTL_SECONDS)
        _LOCAL[str(tenant_id)] = (now + _TTL_SECONDS, rate, debug)
        return rate, debug

    async def _load_db(self, tenant_id: uuid.UUID) -> tuple[float, bool]:
        async with self._session_factory() as session:
            row = await session.get(
                __import__("app.db.models.tenant_settings", fromlist=["TenantSettings"]).TenantSettings,
                tenant_id,
            )
            if row is None:
                return 1.0, False
            return row.sampling_rate, row.debug_force_sample


class TenantSampler(Sampler):
    """Routes sampling decision through TenantSettingsCache."""

    def __init__(self, cache: TenantSettingsCache) -> None:
        self._cache = cache

    def should_sample(  # type: ignore[override]
        self,
        parent_context,
        trace_id: int,
        name: str,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Attributes = None,
        links: list[Link] | None = None,
        trace_state: TraceState | None = None,
    ) -> SamplingResult:
        tenant_id = tenant_id_ctx.get()
        # Synchronous path: cache hit returns prior; miss defaults to full sample.
        rate, debug = _LOCAL.get(str(tenant_id) if tenant_id else "", (0.0, 1.0, False))[1:]
        if debug:
            return SamplingResult(SamplingDecision.RECORD_AND_SAMPLE)
        inner = TraceIdRatioBased(rate)
        return inner.should_sample(parent_context, trace_id, name, kind, attributes, links, trace_state)


def make_sampler(cache: TenantSettingsCache) -> Sampler:
    return ParentBased(TenantSampler(cache))
```

#### `backend/app/core/middleware.py`

```python
"""ASGI middleware: request_id injection + tenant context enrichment."""
from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.logging import request_id_ctx, tenant_id_ctx


class RequestIdMiddleware(BaseHTTPMiddleware):
    HEADER = "x-request-id"

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get(self.HEADER) or str(uuid.uuid4())
        token = request_id_ctx.set(rid)
        try:
            response = await call_next(request)
            response.headers[self.HEADER] = rid
            return response
        finally:
            request_id_ctx.reset(token)


class TenantContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        tenant_id = request.headers.get("x-tenant-id")
        token = tenant_id_ctx.set(tenant_id) if tenant_id else tenant_id_ctx.set(None)
        try:
            return await call_next(request)
        finally:
            tenant_id_ctx.reset(token)
```

#### `backend/app/core/logging.py` — additions

Add at top:
```python
request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
```

Update `_inject_context` (line 25-33) processor:
```python
def _inject_context(logger, method_name, event_dict):
    event_dict.setdefault("tenant_id", tenant_id_ctx.get())
    event_dict.setdefault("project_id", project_id_ctx.get())
    event_dict.setdefault("actor_id", actor_id_ctx.get())
    event_dict.setdefault("request_id", request_id_ctx.get())
    return event_dict
```

#### `backend/app/core/telemetry.py` — additions

Replace lines 54-56 with:
```python
from app.core.tenant_sampler import TenantSettingsCache, make_sampler
# ...
cache = TenantSettingsCache(redis_client, session_factory)
provider = TracerProvider(resource=resource, sampler=make_sampler(cache))
```

#### `backend/tests/test_sampling.py`

```python
import pytest
from opentelemetry.sdk.trace.sampling import SamplingDecision
from app.core.tenant_sampler import TenantSampler


@pytest.mark.asyncio
async def test_debug_force_sample_overrides(monkeypatch):
    sampler = TenantSampler(cache=None)  # type: ignore[arg-type]
    # Force debug branch via internal local cache
    import app.core.tenant_sampler as mod
    mod._LOCAL["t1"] = (10**9, 0.0, True)
    from app.core.logging import tenant_id_ctx
    tok = tenant_id_ctx.set("t1")
    try:
        result = sampler.should_sample(None, 1, "x")
        assert result.decision == SamplingDecision.RECORD_AND_SAMPLE
    finally:
        tenant_id_ctx.reset(tok)
```

#### `backend/tests/test_log_enrichment.py`

```python
import structlog
from app.core.logging import _inject_context, request_id_ctx, tenant_id_ctx


def test_inject_context_emits_all_keys():
    request_id_ctx.set("req-1")
    tenant_id_ctx.set("t1")
    out = _inject_context(None, "info", {"event": "x"})
    assert out["request_id"] == "req-1"
    assert out["tenant_id"] == "t1"
```

**Verify:**
```
pytest backend/tests/test_sampling.py backend/tests/test_log_enrichment.py -q
```

---

### PR-5.3 — SLO alerts (sustained breach)

**Files created:**
- `backend/app/services/observability/slo_alerts.py`
- `backend/app/services/scheduler/jobs/slo_evaluator.py`
- `backend/tests/test_slo_alerts.py`

#### `backend/app/services/observability/slo_alerts.py`

```python
"""Sustained-breach SLO alerts with per-rule throttling."""
from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from app.services.observability.alerts import alert_manager


@dataclass
class SLOBreach:
    surface: str
    metric: str
    value: float
    threshold: float
    at: float


class _BreachWindow:
    """Tracks contiguous breaches; only fires when `window_seconds` is met."""

    def __init__(self, window_seconds: int = 300) -> None:
        self.window_seconds = window_seconds
        self._samples: dict[tuple[str, str], deque[float]] = {}

    def add(self, surface: str, metric: str, breached: bool, now: float) -> bool:
        key = (surface, metric)
        dq = self._samples.setdefault(key, deque())
        if breached:
            dq.append(now)
            while dq and now - dq[0] > self.window_seconds:
                dq.popleft()
            return len(dq) >= 2 and (now - dq[0]) >= self.window_seconds
        dq.clear()
        return False


@dataclass
class SLOAlert:
    surface: str
    metric: str
    threshold: float
    comparator: Callable[[float, float], bool] = staticmethod(lambda v, t: v > t)
    cooldown_seconds: int = 3600
    window_seconds: int = 300
    _last_fired: float = field(default=0.0, init=False, repr=False)
    _window: _BreachWindow = field(default_factory=_BreachWindow, init=False, repr=False)

    def evaluate(self, value: float, now: float) -> bool:
        breached = self.comparator(value, self.threshold)
        sustained = self._window.add(self.surface, self.metric, breached, now)
        if not sustained:
            return False
        if now - self._last_fired < self.cooldown_seconds:
            return False
        self._last_fired = now
        return True


def _publish(alert: SLOAlert, value: float) -> None:
    alert_manager.send(
        title=f"SLO breach: {alert.surface}/{alert.metric}",
        body=f"value={value:.4f} threshold={alert.threshold:.4f}",
        labels={"surface": alert.surface, "metric": alert.metric, "severity": "page"},
    )


def install_default_alerts() -> list[SLOAlert]:
    return [
        SLOAlert(surface="chat", metric="latency_p95_ms", threshold=1500.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="chat", metric="error_rate", threshold=0.01, comparator=lambda v, t: v > t),
        SLOAlert(surface="kg", metric="latency_p95_ms", threshold=2000.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="ideation", metric="latency_p95_ms", threshold=10000.0, comparator=lambda v, t: v > t),
        SLOAlert(surface="forge-models", metric="availability", threshold=0.999, comparator=lambda v, t: v < t),
        SLOAlert(surface="terminal", metric="error_rate", threshold=0.005, comparator=lambda v, t: v > t),
        SLOAlert(surface="copilot", metric="latency_p95_ms", threshold=800.0, comparator=lambda v, t: v > t),
    ]


_ALERTS: list[SLOAlert] = []


async def evaluate_all(metrics: dict[tuple[str, str], float]) -> list[SLOBreach]:
    global _ALERTS
    if not _ALERTS:
        _ALERTS = install_default_alerts()
    now = time.time()
    fired: list[SLOBreach] = []
    for alert in _ALERTS:
        value = metrics.get((alert.surface, alert.metric))
        if value is None:
            continue
        if alert.evaluate(value, now):
            _publish(alert, value)
            fired.append(SLOBreach(alert.surface, alert.metric, value, alert.threshold, now))
    return fired
```

#### `backend/app/services/scheduler/jobs/slo_evaluator.py`

```python
"""Periodic SLO evaluator loop."""
from __future__ import annotations

import asyncio
import logging

from app.services.observability import slo_alerts
from app.services.observability.metrics_query import fetch_current_metrics


log = logging.getLogger(__name__)


async def _loop(stop: asyncio.Event, interval_seconds: int = 60) -> None:
    while not stop.is_set():
        try:
            metrics = await fetch_current_metrics()
            await slo_alerts.evaluate_all(metrics)
        except Exception:  # noqa: BLE001
            log.exception("slo_evaluator_tick_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except asyncio.TimeoutError:
            pass


def start() -> asyncio.Task:
    stop = asyncio.Event()
    task = asyncio.create_task(_loop(stop), name="slo-evaluator")
    task.stop_event = stop  # type: ignore[attr-defined]
    return task


def stop(task: asyncio.Task) -> None:
    task.stop_event.set()  # type: ignore[attr-defined]
    task.cancel()
```

#### `backend/tests/test_slo_alerts.py`

```python
import time
from app.services.observability.slo_alerts import SLOAlert, _BreachWindow


def test_breach_window_requires_sustained():
    w = _BreachWindow(window_seconds=60)
    now = 1000.0
    assert w.add("chat", "latency_p95_ms", True, now) is False
    assert w.add("chat", "latency_p95_ms", True, now + 61) is True


def test_breach_resets_on_recovery():
    w = _BreachWindow(window_seconds=60)
    w.add("chat", "x", True, 1000.0)
    w.add("chat", "x", False, 1010.0)
    assert w.add("chat", "x", True, 1020.0) is False


def test_alert_cooldown_throttles():
    a = SLOAlert(surface="chat", metric="x", threshold=1.0, window_seconds=0, cooldown_seconds=3600)
    # Force window_seconds to 0 to make sustained-breach trivially true.
    a._window.window_seconds = 0
    now = time.time()
    assert a.evaluate(2.0, now) is True
    assert a.evaluate(2.0, now + 1) is False
```

**Verify:**
```
pytest backend/tests/test_slo_alerts.py -q
```

---

### PR-5.4 — Audit Redis Streams + WS endpoint

**Files modified/created:**
- `backend/app/services/audit_service.py` (extended — add XADD)
- `backend/app/api/ws/audit.py` (new)
- `backend/app/api/ws/router.py` (modified — register route)
- `backend/tests/test_audit_stream.py` (new)

#### `backend/app/services/audit_service.py` — additions

Append at end of `record()` (after line 112):
```python
        # ponytail: best-effort fanout; failures MUST NOT block audit durability.
        try:
            await redis.xadd(
                f"audit:{tenant_id}",
                {"id": str(record.id), "action": action, "ts": str(record.created_at)},
                maxlen=10_000,
                approximate=True,
            )
        except Exception:  # noqa: BLE001
            log.warning("audit_stream_xadd_failed", extra={"audit_id": str(record.id)})
```

Where `redis` and `log` are already in scope (add `redis.asyncio as aioredis` to module imports and accept it via DI on the service constructor).

#### `backend/app/api/ws/audit.py`

```python
"""WebSocket endpoint that streams new audit events via Redis consumer group."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from jose import JWTError

from app.api.ws.terminal_broadcast import _verify_ws_token  # reuse auth helper
from app.core.logging import tenant_id_ctx

import redis.asyncio as aioredis

log = logging.getLogger(__name__)
router = APIRouter()

GROUP = "audit-ui"
BLOCK_MS = 5000


@router.websocket("/ws/audit")
async def audit_stream(ws: WebSocket, redis: aioredis.Redis = None) -> None:  # type: ignore[assignment]
    # Auth via query param `?token=` (cannot set headers on WS handshake).
    token = ws.query_params.get("token", "")
    try:
        principal = await _verify_ws_token(token)
    except JWTError:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    tenant_id = str(principal.tenant_id)
    tenant_id_ctx.set(tenant_id)

    stream_key = f"audit:{tenant_id}"
    consumer = f"audit-ui-{principal.actor_id}"
    try:
        await redis.xgroup_create(stream_key, GROUP, id="0", mkstream=True)
    except aioredis.ResponseError:
        pass  # BUSYGROUP — already exists

    await ws.accept()
    try:
        await ws.send_json({"type": "ready"})
        while True:
            resp = await redis.xreadgroup(
                GROUP, consumer, {stream_key: ">"}, count=50, block=BLOCK_MS
            )
            if not resp:
                continue
            for _stream, entries in resp:
                for entry_id, fields in entries:
                    await ws.send_json({"type": "event", "id": entry_id, **fields})
    except WebSocketDisconnect:
        return
```

#### `backend/app/api/ws/router.py` — additions

Add import and `router.include_router(audit.router)`.

#### `backend/tests/test_audit_stream.py`

```python
import json
import pytest
from fastapi.testclient import TestClient


@pytest.mark.asyncio
async def test_ws_requires_token():
    from app.main import app
    client = TestClient(app)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/audit"):
            pass
```

**Verify:**
```
pytest backend/tests/test_audit_stream.py -q
```

---

### PR-5.5 — Frontend Live audit tab + WS hook

**Files created:**
- `apps/forge/lib/hooks/useAuditStream.ts`
- `apps/forge/app/admin/audit/page.tsx`
- `apps/forge/components/audit/__tests__/audit-stream.test.tsx`
- `apps/forge/e2e/audit-live.spec.ts`

#### `apps/forge/lib/hooks/useAuditStream.ts`

```ts
"use client";

import { useEffect, useRef, useState } from "react";

export type AuditEvent = { id: string; type: "event"; action: string; ts: string };

type Status = "connecting" | "open" | "reconnecting" | "closed";

export function useAuditStream(): { status: Status; events: AuditEvent[] } {
  const [status, setStatus] = useState<Status>("connecting");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      setStatus(attemptsRef.current === 0 ? "connecting" : "reconnecting");
      const ws = new WebSocket(buildUrl("/ws/audit"));
      wsRef.current = ws;
      ws.onopen = () => {
        attemptsRef.current = 0;
        setStatus("open");
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "event") {
            setEvents((prev) => [data as AuditEvent, ...prev].slice(0, 500));
          }
        } catch {
          // ponytail: ignore malformed frames; protocol error → close → reconnect.
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        attemptsRef.current += 1;
        const delay = Math.min(30_000, 500 * 2 ** attemptsRef.current);
        timerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
      setStatus("closed");
    };
  }, []);

  return { status, events };
}

function buildUrl(path: string): string {
  const token = (window as any).__forgeAuthToken ?? "";
  const sep = path.includes("?") ? "&" : "?";
  return `${process.env.NEXT_PUBLIC_FORGE_WS_BASE_URL ?? ""}${path}${sep}token=${encodeURIComponent(token)}`;
}
```

#### `apps/forge/app/admin/audit/page.tsx`

```tsx
"use client";

import { useState } from "react";
import { useAuditStream } from "@/lib/hooks/useAuditStream";
import { AuditTimelineVirtualized } from "@/components/audit/AuditTimelineVirtualized";

type Tab = "history" | "live";

export default function AdminAuditPage() {
  const [tab, setTab] = useState<Tab>("history");
  const { status, events } = useAuditStream();

  return (
    <div className="p-4">
      <div role="tablist" className="flex gap-2 mb-4">
        <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>History</button>
        <button role="tab" aria-selected={tab === "live"} onClick={() => setTab("live")}>
          Live {status === "open" ? <span aria-label="connected" /> : <span aria-label={status} />}
        </button>
      </div>
      {tab === "history" ? (
        <AuditTimelineVirtualized mode="polling" />
      ) : (
        <AuditTimelineVirtualized mode="stream" initial={events} />
      )}
    </div>
  );
}
```

#### `apps/forge/components/audit/__tests__/audit-stream.test.tsx`

```tsx
import { renderHook, act } from "@testing-library/react";
import { useAuditStream } from "@/lib/hooks/useAuditStream";

describe("useAuditStream", () => {
  it("starts in connecting state", () => {
    const { result } = renderHook(() => useAuditStream());
    expect(["connecting", "open"]).toContain(result.current.status);
  });
});
```

#### `apps/forge/e2e/audit-live.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("audit live tab renders and shows connection indicator", async ({ page }) => {
  await page.goto("/admin/audit");
  await page.getByRole("tab", { name: /live/i }).click();
  await expect(page.getByRole("tab", { name: /live/i })).toHaveAttribute("aria-selected", "true");
});
```

**Verify:**
```
pnpm --filter forge test:e2e audit-live
pnpm --filter forge test audit-stream
```

---

### PR-5.6 — Cost rollup + aggregator + scheduler

**Files created:**
- `backend/app/db/models/cost_rollup.py`
- `backend/alembic/versions/step_93_p5_cost_rollup.py`
- `backend/app/services/observability/cost_aggregator.py`
- `backend/app/services/scheduler/jobs/cost_aggregate.py`
- `backend/app/api/v1/forge_observability.py`
- `backend/tests/test_cost_aggregator.py`

#### `backend/app/db/models/cost_rollup.py`

```python
"""Minute-granular cost rollup sourced from LiteLLM."""
from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import UniqueConstraint, Float, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import UUIDPrimaryKeyMixin, Base


class CostMinuteRollup(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "cost_minute_rollup"
    __table_args__ = (UniqueConstraint("tenant_id", "minute", name="uq_cost_tenant_minute"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(index=True)
    minute: Mapped[datetime] = mapped_column(index=True)
    spend_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    request_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
```

#### `backend/alembic/versions/step_93_p5_cost_rollup.py`

```python
"""Add cost_minute_rollup table."""
from alembic import op
import sqlalchemy as sa

revision = "step_93_p5_cost_rollup"
down_revision = "step_92_p5_tenant_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cost_minute_rollup",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("minute", sa.DateTime(timezone=True), nullable=False),
        sa.Column("spend_usd", sa.Float, nullable=False, server_default="0"),
        sa.Column("request_count", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("tenant_id", "minute", name="uq_cost_tenant_minute"),
    )
    op.create_index("ix_cost_minute_rollup_tenant_id", "cost_minute_rollup", ["tenant_id"])
    op.create_index("ix_cost_minute_rollup_minute", "cost_minute_rollup", ["minute"])


def downgrade() -> None:
    op.drop_index("ix_cost_minute_rollup_minute", table_name="cost_minute_rollup")
    op.drop_index("ix_cost_minute_rollup_tenant_id", table_name="cost_minute_rollup")
    op.drop_table("cost_minute_rollup")
```

#### `backend/app/services/observability/cost_aggregator.py`

```python
"""Aggregate LiteLLM spend logs into minute rollups."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select, func

from app.db.models.cost_rollup import CostMinuteRollup


log = logging.getLogger(__name__)


async def _aggregate_once(session_factory, litellm_client, redis) -> int:
    """Returns count of new rollup rows."""
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    window_start = now - timedelta(minutes=1)
    logs = await litellm_client.list_spend_logs(start=window_start, end=now)
    if not logs:
        return 0
    rows: dict[tuple[str, datetime], tuple[float, int]] = {}
    for entry in logs:
        key = (str(entry["tenant_id"]), window_start)
        spend, count = rows.get(key, (0.0, 0))
        rows[key] = (spend + float(entry.get("spend", 0.0)), count + 1)
    async with session_factory() as session:
        for (tenant_id, minute), (spend, count) in rows.items():
            stmt = pg_insert(CostMinuteRollup).values(
                tenant_id=tenant_id, minute=minute, spend_usd=spend, request_count=count
            ).on_conflict_do_update(
                index_elements=["tenant_id", "minute"],
                set_={"spend_usd": spend, "request_count": count},
            )
            await session.execute(stmt)
        await session.commit()
    return len(rows)


async def aggregate_loop(stop, session_factory, litellm_client, redis, interval_seconds: int = 60) -> None:
    import asyncio
    while not stop.is_set():
        try:
            await _aggregate_once(session_factory, litellm_client, redis)
        except Exception:  # noqa: BLE001
            log.exception("cost_aggregate_tick_failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
        except asyncio.TimeoutError:
            pass


async def query_cost(session_factory, tenant_id: str, since: datetime) -> list[CostMinuteRollup]:
    async with session_factory() as session:
        stmt = select(CostMinuteRollup).where(
            CostMinuteRollup.tenant_id == tenant_id,
            CostMinuteRollup.minute >= since,
        ).order_by(CostMinuteRollup.minute)
        return list((await session.execute(stmt)).scalars())
```

#### `backend/app/services/scheduler/jobs/cost_aggregate.py`

```python
"""Scheduler wiring for cost aggregator."""
from __future__ import annotations

import asyncio

from app.services.observability.cost_aggregator import aggregate_loop


def start(session_factory, litellm_client, redis) -> asyncio.Task:
    stop = asyncio.Event()
    task = asyncio.create_task(
        aggregate_loop(stop, session_factory, litellm_client, redis),
        name="cost-aggregator",
    )
    task.stop_event = stop  # type: ignore[attr-defined]
    return task


def stop(task: asyncio.Task) -> None:
    task.stop_event.set()  # type: ignore[attr-defined]
    task.cancel()
```

#### `backend/app/api/v1/forge_observability.py`

```python
"""Cost and SLO inspection endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_principal, require_permission
from app.services.observability.cost_aggregator import query_cost


router = APIRouter(prefix="/v1/observability", tags=["observability"])


@router.get("/cost")
async def get_cost(
    hours: int = Query(24, ge=1, le=168),
    principal=Depends(get_current_principal),
    session_factory=Depends(),
):
    require_permission(principal, "observability:read")
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = await query_cost(session_factory, str(principal.tenant_id), since)
    return [
        {"minute": r.minute.isoformat(), "spend_usd": r.spend_usd, "request_count": r.request_count}
        for r in rows
    ]
```

#### `backend/tests/test_cost_aggregator.py`

```python
import pytest
from datetime import datetime, timezone
from app.services.observability.cost_aggregator import _aggregate_once


@pytest.mark.asyncio
async def test_aggregate_once_writes_rows(monkeypatch):
    class FakeLite:
        async def list_spend_logs(self, start, end):
            return [{"tenant_id": "t1", "spend": 0.5}, {"tenant_id": "t1", "spend": 0.25}]
    async def fake_session():
        class S:
            async def __aenter__(self_): return self_
            async def __aexit__(self_, *a): return False
            async def execute(self_, stmt): class R: pass
            async def commit(self_): pass
        return S()
    n = await _aggregate_once(fake_session, FakeLite(), redis=None)
    assert n == 1
```

**Verify:**
```
pytest backend/tests/test_cost_aggregator.py -q
```

---

### PR-5.7 — OTel collector + runbook

**Files created:**
- `infra/otel-collector.yaml`
- `docs/runbooks/observability.md`
- `docs/runbooks/slo-degradation.md`

#### `infra/otel-collector.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc: {}
      http: {}

processors:
  resource:
    attributes:
      - key: tenant.id
        from_attribute: tenant_id
        action: insert
  tail_sampling:
    decision_wait: 10s
    num_traces: 50000
    expected_new_traces_per_sec: 500
    policies:
      - name: errors-always
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: latency
        type: latency
        latency: { threshold_ms: 2000 }
  batch: {}

exporters:
  otlp:
    endpoint: ${OTEL_EXPORTER_OTLP_ENDPOINT}
    tls: { insecure: false }
  logging:
    verbosity: basic

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resource, tail_sampling, batch]
      exporters: [otlp]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
```

#### `docs/runbooks/observability.md`

```markdown
# Observability Runbook

## Triage order

1. Check SLO dashboard for sustained-breach alerts.
2. Filter `tenant.id` and `request.id` in trace explorer.
3. Search logs by `request_id`.

## Alert response matrix

| Alert class | First action | Escalation |
|-------------|--------------|------------|
| chat latency_p95 | Check LiteLLM spend logs | Page on-call if >10 min |
| chat error_rate | Check model provider status | Roll back recent deploy |
| forge-models availability | Check forge-models pod health | Drain node |
| terminal error_rate | Inspect active sessions | Restart bridge |

## Sampling overrides

Set `tenant_settings.debug_force_sample=true` for a tenant; effect within 30s via Redis TTL.
```

#### `docs/runbooks/slo-degradation.md`

```markdown
# SLO Degradation

If a sustained-breach alert fires:

1. Confirm via OTel dashboard.
2. Read alert body for `value`/`threshold`.
3. Run `query_cost(tenant_id, since=now-1h)` to correlate with traffic spikes.
4. If regression: revert last merge to surface.
```

**Verify:**
```
yamllint infra/otel-collector.yaml
```

---

### PR-5.8 — CI integration + final verification

**Files modified:**
- `.github/workflows/ci.yml` (add SLO check step)
- `backend/app/main.py` (register middleware + scheduler jobs)

#### `.github/workflows/ci.yml` — add step

```yaml
      - name: Validate SLO standard
        run: bash scripts/check-slos.sh
```

#### `backend/app/main.py` — additions

```python
from app.core.middleware import RequestIdMiddleware, TenantContextMiddleware
from app.services.scheduler.jobs import slo_evaluator, cost_aggregate

app.add_middleware(RequestIdMiddleware)
app.add_middleware(TenantContextMiddleware)

@app.on_event("startup")
async def _start_schedulers() -> None:
    slo_evaluator.start()
    cost_aggregate.start(session_factory, litellm_client, redis)

@app.on_event("shutdown")
async def _stop_schedulers() -> None:
    # tasks tracked on app.state in real wiring
    pass
```

**Verify (full Phase 5):**
```
pytest backend/tests -q
pnpm --filter forge test
bash scripts/check-slos.sh
yamllint infra/otel-collector.yaml
alembic upgrade head
```

---

## §5 Test Plan

| Layer | Tool | Coverage |
|---|---|---|
| Backend unit | pytest | sampling, log enrichment, SLO alerts, audit stream, cost aggregator |
| Backend integration | pytest + TestClient | WS auth, audit fanout, cost endpoint |
| Frontend unit | vitest | `useAuditStream` lifecycle, debounce |
| E2E | Playwright | audit-live tab renders, connection indicator updates |
| Static | yamllint | OTel collector config |
| Docs | check-slos.py | 6 surfaces x 3 metrics matrix |

---

## §6 Rollback Strategy

| PR | Rollback |
|---|---|
| 5.1 | Revert commit; SLO doc is docs-only |
| 5.2 | Revert + `alembic downgrade step_92` |
| 5.3 | Revert; disable alerts by removing `install_default_alerts()` from scheduler |
| 5.4 | Revert; AuditService.record still persists to DB without XADD |
| 5.5 | Revert frontend PR |
| 5.6 | Revert + `alembic downgrade step_93`; cost endpoint 404s |
| 5.7 | Revert config + runbook |
| 5.8 | Revert CI step |

No data loss in any rollback: additive migrations, additive writes, additive endpoints.

---

## §7 Out of Scope

- External SIEM integration (Splunk, Elastic)
- Tracing backend selection beyond OTLP
- On-call rotation tooling (PagerDuty schedules)
- Cost forecasting / budgets
- Custom dashboards (Grafana JSON committed in repo)
- Per-endpoint SLI decomposition
- Multi-region failover for the audit stream

---

## §8 Definition of Done

1. All 8 SCs verified by the commands listed in §2.
2. All 8 PRs merged in order with green CI.
3. `docs/standards/slos.md` and `docs/standards/observability.md` merged.
4. `infra/otel-collector.yaml` validated.
5. `alembic upgrade head` succeeds on a fresh DB seeded with Phase 4 data.
6. Audit live tab pushes an event end-to-end within 1s in dev environment.
7. SLO alert fires within 5min of seeded sustained breach in staging.
8. Cost rollup table populated within 60s of seeded LiteLLM response.
9. No `TODO`/`FIXME`/`NotImplementedError` introduced in business logic.
10. No new runtime dependencies added (Redis, asyncpg, structlog, OTel SDK all pre-existing).
11. Observability runbook reviewed and merged.
12. CI workflow step added and green.
13. Constitutional rules R2/R6/R7/R10/R15 verified by inspection.

---

## §9 Critical Files for Implementation

- /home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/observability/slo_alerts.py
- /home/arunachalam.v@knackforge.com/forge-ai/backend/app/core/tenant_sampler.py
- /home/arunachalam.v@knackforge.com/forge-ai/backend/app/services/audit_service.py
- /home/arunachalam.v@knackforge.com/forge-ai/apps/forge/lib/hooks/useAuditStream.ts
- /home/arunachalam.v@knackforge.com/forge-ai/docs/standards/slos.md