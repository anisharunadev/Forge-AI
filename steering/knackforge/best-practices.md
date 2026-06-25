---
rule_id: knackforge-best-practices
scope: project
applies_to_stages: [pre_plan, pre_code, pre_review]
sources: [ADR-007, NFR-043]
---

# KnackForge — Best Practices

## Cost Budgets (ADR-007)

- Every workflow that calls an LLM declares a
  ``WorkflowBudget(ceiling_usd=...)`` BEFORE the first call.
  Default ceiling is set by workflow
  (``IDEATION_INGEST_CEILING_USD`` = $0.50 for daily ingest).
- ``workflow_budget_service.check_budget(...)`` is the admission
  gate; calls past the ceiling return ``Decision.BLOCKED`` and
  never reach the provider.
- The daily ingest synthesizer's budget-block path is a
  **graceful** fallback (single-idea-per-signal heuristic), not
  a hard failure. The run row stamps ``degraded_budget=True`` so
  the dashboard reflects the fallback.

## Refactor Agent Independence (NFR-043)

- Refactor agents must operate without shared mutable state with
  the agent they're refactoring. Pass context by value (typed
  Pydantic shapes) at the API boundary, not by reference to ORM
  sessions.
- A refactor agent invocation is itself a workflow with its own
  budget declaration (no inheritance from the parent).

## Performance & Backpressure

- Source pullers cap at ``MAX_SIGNALS_PER_PULL = 500`` per source
  per run. Overflow rolls over to the next day's run.
- The synthesizer caps uncategorized reads at 500 rows per pass;
  the nightly consolidate processes one tenant per call.
- The scheduler is in-process
  (``apscheduler.schedulers.asyncio.AsyncIOScheduler``). Multi-
  replica deployments need a Postgres advisory lock — flagged for
  Phase 4 follow-up.

## Observability

- Every service emits structured logs through
  ``get_logger(__name__)``. Log lines MUST carry ``tenant_id``
  and ``project_id`` (Rule 2) when in scope.
- OTel spans wrap every workflow entry/exit point. Names follow
  ``<domain>.<action>`` (``ideation.ingest.run``,
  ``persona.memory.append``).
- The dashboard indicator reads from
  ``ideation_ingest_runs`` (most recent row per tenant).

## Migration Discipline

- Every schema change goes through Alembic. Migration files
  increment monotonically and set ``down_revision``.
- New tenant-scoped tables MUST declare RLS
  (``ENABLE ROW LEVEL SECURITY`` + ``FORCE`` + a policy mirroring
  ``app.tenant_id`` from the GUC).
- Multi-tenant queries MUST filter by ``tenant_id`` in the WHERE
  clause even when RLS is in force — defense in depth.