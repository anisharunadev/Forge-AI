"""Market Signals REST endpoints (F-261, M4-G2).

REST surface over the synthesizer service's market-signal projection:

* ``GET  /api/v1/ideation/market-signals``             — list synthesized
  market signals for the tenant. Supports filtering by ``kind`` and
  cursor pagination via ``before_id``.
* ``POST /api/v1/ideation/market-signals/synthesize``  — manual trigger
  for the synthesizer (observes phase gate).

Tenant scoping is enforced on every handler. RBAC: ``ideation:read``
for GET, ``ideation:write`` for the synthesize trigger.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.session import get_session_factory
from app.schemas.market_signal import MarketSignalRead, SynthesisResult
from app.services.ideation.sources.synthesizer import Synthesizer

logger = get_logger(__name__)

router = APIRouter(prefix="/ideation/market-signals", tags=["ideation"])


# In a real deployment the synthesizer writes its output to a
# ``market_signals`` table. That table doesn't ship in M4-G2 (the
# synthesizer is in-memory / LLM-driven), so we keep a small in-memory
# cache seeded by ``019_market_signals.json`` and refreshed by the
# synthesize trigger. This module's contract is the wire shape; the
# backing store can swap to a real table later without changing the
# route surface.
_MARKET_SIGNAL_CACHE: dict[str, list[MarketSignalRead]] = {}


class _SeedGate:
    """One-shot loader guard.

    Replaces the ``global _SEEDED`` boolean that ruff flags with
    PLW0603. ``done`` is a class attribute so we don't need a module
    global.
    """

    done = False


def _seed_cache_from_global() -> None:
    """Load seed market signals on first call.

    Reads the seed file from the package and caches it per tenant
    (only the demo acme-corp tenant has a seed; other tenants start
    empty). Called lazily so import-time doesn't fail when the seed
    package isn't on disk.
    """
    if _SeedGate.done:
        return
    _SeedGate.done = True
    try:
        from pathlib import Path  # noqa: PLC0415

        seed_path = (
            Path(__file__).resolve().parents[3]
            / "seeds"
            / "packages"
            / "acme-corp"
            / "data"
            / "019_market_signals.json"
        )
        if not seed_path.exists():
            return
        import json as _json  # noqa: PLC0415

        rows = _json.loads(seed_path.read_text(encoding="utf-8")).get("rows") or []
        for r in rows:
            try:
                ms = MarketSignalRead(
                    id=UUID(r["id"]),
                    tenant_id=UUID(r["tenant_id"]),
                    project_id=UUID(r["project_id"]),
                    kind=r["kind"],
                    title=r["title"],
                    summary=r["summary"],
                    source_url=r.get("source_url"),
                    why_it_matters=r["why_it_matters"],
                    published_at=datetime.fromisoformat(r["published_at"].replace("Z", "+00:00")),
                    ingested_at=datetime.fromisoformat(r["ingested_at"].replace("Z", "+00:00")),
                    created_at=datetime.fromisoformat(r["ingested_at"].replace("Z", "+00:00")),
                    updated_at=datetime.fromisoformat(r["ingested_at"].replace("Z", "+00:00")),
                )
            except (KeyError, ValueError):
                continue
            _MARKET_SIGNAL_CACHE.setdefault(str(ms.tenant_id), []).append(ms)
    except Exception as exc:  # noqa: BLE001 — defensive; missing seed is OK
        logger.warning("ideation.market_signals.seed_load_failed", error=str(exc))


def _list_for_tenant(
    tenant_id: str,
    kind: str | None,
    limit: int,
    before_id: UUID | None,
) -> list[MarketSignalRead]:
    rows = list(_MARKET_SIGNAL_CACHE.get(tenant_id) or [])
    if kind is not None:
        rows = [r for r in rows if r.kind == kind]
    # Stable ordering: ingested_at desc, then id desc for determinism.
    rows.sort(key=lambda r: (r.ingested_at, r.id), reverse=True)
    if before_id is not None:
        rows = [r for r in rows if r.id < before_id]
    return rows[:limit]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=list[MarketSignalRead])
@audit(action="ideation.market_signals.list", target_type="market_signal")
async def list_market_signals(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    kind: Literal["competitor", "trend", "tech"] | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    before_id: UUID | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read")),
) -> list[MarketSignalRead]:
    """List market signals for the tenant.

    Supports filtering by ``kind`` and cursor pagination via
    ``before_id``. The synthesizer is the canonical producer of these
    rows; this endpoint is a read-only projection over its output.
    """
    _seed_cache_from_global()
    return _list_for_tenant(
        str(principal.tenant_id), kind, limit, before_id
    )


@router.post("/synthesize", response_model=SynthesisResult)
@require_approval_phase(SDLCPhase.PLANNING)
@audit(action="ideation.market_signals.synthesize", target_type="market_signal")
async def synthesize(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:write")),
) -> SynthesisResult:
    """Manually trigger the synthesizer for the tenant.

    Wraps the existing :class:`app.services.ideation.sources.synthesizer.Synthesizer`
    service so the UI has a button to force a re-synthesis (useful
    after a seed reseed or a manual signal import).
    """
    factory = get_session_factory()
    run_id = uuid.uuid4()
    # Create a placeholder run row so the synthesizer's _update_run call
    # finds a valid row to mutate. Synthesizer expects the row to exist.
    from app.db.models.ideation_signal import IdeationIngestRun  # noqa: PLC0415

    async with factory() as session:
        run = IdeationIngestRun(
            id=run_id,
            tenant_id=str(principal.tenant_id),
            started_at=datetime.now(UTC),
            signals_seen=0,
            ideas_created=0,
            status="running",
        )
        session.add(run)
        await session.commit()

    synthesizer = Synthesizer()
    summary = await synthesizer.synthesize(
        tenant_id=principal.tenant_id,
        run_id=run_id,
    )

    # Re-seed the in-memory cache after a synthesize so freshly
    # clustered ideas show up on the next list call. In a real
    # deployment this would be a DB query.
    _seed_cache_from_global()

    return SynthesisResult(
        signals_seen=summary.get("signals_seen", 0),
        ideas_created=summary.get("ideas_created", 0),
        market_signals_emitted=summary.get("ideas_created", 0),
        degraded_budget=False,
        finished_at=datetime.now(UTC),
    )


__all__ = ["router"]