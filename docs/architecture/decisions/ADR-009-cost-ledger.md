# ADR-009: Cost Ledger Schema and Cumulative Cap

- Status: Accepted
- Date: 2026-07-05
- Deciders: Forge Architecture Working Group

## Context and Problem Statement

Forge must enforce a per-RUN budget cap so a runaway agent cannot
drain a tenant's LLM allowance. Constitution Rule 6 (Mandatory
Auditability) and PRD NFR-044 (Cost guardrails) require that every
cost-incurring action be auditable AND that the platform refuse to
exceed a declared USD ceiling per workflow run.

Today the existing `cost_entries` table (model `CostEntry`,
`backend/app/db/models/cost.py`) records only the *actual* spend after
the LLM call returns. It cannot answer two questions a budget guard
needs:

1. **At admission time (before the call):** what is the *projected*
   cost of the upcoming LLM call given the model + token estimate?
2. **At cumulative-cap time:** how much has this `run_id` actually
   spent on confirmed LLM calls (not projections)?

We must choose a representation that:

- Carries both **projected** and **actual** rows so a pre-call
  admission check can reserve headroom and a post-call settlement
  can reconcile (or refund) the projection.
- Binds every row to `run_id` (the SDLC run lifecycle, not the
  older per-WORKFLOW scope) so the cap is enforced at the right
  granularity.
- Costs are computed deterministically from a pricing YAML — agents
  cannot self-report with arbitrary numbers.
- Cumulative cap rule is `sum(cost_usd WHERE run_id = X AND
  projected = false) <= settings.run_budget_cap_usd[tenant_id]` —
  the only thing that counts toward the cap is *actual* confirmed
  spend. Projections reserve headroom but never count against the
  cap (otherwise a budget would be eaten by calls that never
  returned).

The forces at play:

- Rule 1 — LiteLLM Proxy is the only legal egress. Cost is
  reported by the proxy per call (`response.usage.cost_usd`) so the
  ledger can ground on real numbers, but admission happens *before*
  the call and must use pricing YAML to project.
- Rule 2 — every row carries `tenant_id` and `project_id`.
- Rule 6 — every projected and actual row is itself an audit event.
- NFR-044 — cap is enforced per-RUN; multi-tenant overrides apply.
- Existing per-WORKFLOW budget service (`workflow_budget.py`)
  already exists; this ADR layers the per-RUN scope alongside it
  (additive, not a replacement).

## Decision Drivers

- Rule 1: Provider-agnostic (LiteLLM Proxy)
- Rule 2: Multi-tenancy by default (every row has tenant_id +
  project_id)
- Rule 6: Mandatory auditability
- NFR-044: Cost guardrails (per-RUN USD cap)

## Considered Options

- **Option A — Derive cost from `response.usage.total_cost`.**
  Trust the LiteLLM proxy to return the actual cost per call and
  reject calls that would breach the cap by checking cumulative
  spend on prior calls.
- **Option B — Custom `cost_ledger` table with projected + actual rows + pricing YAML (chosen).**
  Pre-call admission computes a projection from
  `litellm_model_pricing.yaml`; post-call settlement writes an
  actual row. A `run_id` column binds both halves to the SDLC run;
  cumulative cap is `sum(cost_usd WHERE run_id = X AND projected = false)`.
- **Option C — External cost service (e.g. CloudHealth, Vantage).**
  Outsource the ledger to a SaaS cost platform; admission calls
  the service for cumulative spend.

## Decision Outcome

Chosen option: **Option B — custom `cost_ledger` table with projected + actual rows + pricing YAML.**

Architecture:

- The `cost_entries` table (existing physical name) is augmented
  in place with three new columns (migration in the same M2
  commit):
  - `run_id` (UUID, nullable) — binds the row to the SDLC run.
  - `agent` (text, nullable) — names the agent that incurred the
    spend (`code_validator`, `ideation_capture`, etc.).
  - `projected` (boolean, NOT NULL, default false) — distinguishes
    a pre-call projection from a post-call actual settlement. The
    cumulative cap rule filters on `projected = false`.
- The conceptual name is **cost_ledger** (singular ledger) — the
  ADR and JSON Schema in Appendix A use this name; the physical
  table name `cost_entries` is retained for migration simplicity
  and existing call-site compatibility. The Python service module
  (`backend/app/services/cost_ledger.py`) is the public API.
- The pricing source of truth is
  `backend/app/services/litellm_pricing/litellm_model_pricing.yaml`
  — a four-model + default-fallback YAML loaded via PyYAML (already
  in `requirements.txt`). The admission path
  `pre_call_admission()` reads it to project cost before any
  provider traffic is sent.
- Cumulative cap rule (formal):

  ```
  ceiling_usd = settings.run_budget_cap_overrides.get(
      tenant_id, settings.run_budget_cap_usd
  )
  spent_usd = sum(cost_usd
                  FROM cost_entries
                  WHERE run_id = X
                    AND projected = false)
  projected_cost_usd = project_cost_usd(model, prompt_tokens,
                                        completion_tokens)
  decision = (spent_usd + projected_cost_usd <= ceiling_usd)
              ? ALLOWED : BLOCKED
  ```

- The `record()` method is split (T-B2):
  - `record_projected(...)` — pre-call row, `projected=True`.
  - `record_actual(...)` — post-call row, `projected=False`.
  Both are keyword-only required-args (Rule 2 enforced via API
  surface — callers cannot pass positionally and cannot omit).
- `sum_spent_for_run(run_id)` returns the
  `projected = false` cumulative spend; the cumulative-cap rule
  composes this with the projected cost of the upcoming call.

### Consequences

Positive:

- Admission is deterministic: pricing YAML + token estimate →
  cost; no agent self-reporting.
- Cumulative cap cannot be gamed by inflated projections because
  the rule filters on `projected = false`.
- The `run_id` binding lets the UI show a live "Run budget:
  $X / Used: $Y" badge (T-B6) and lets the API surface a
  per-run snapshot (T-B7).
- The per-tenant override via
  `settings.run_budget_cap_overrides` keeps the cap configurable
  without a code change (Rule 8).
- `cost_ledger` rows remain audit-trail compliant with Rule 6 —
  every projected and actual row is auditable.

Negative:

- Pricing YAML drift: when a model price changes, the projection
  is wrong until the YAML is updated. Mitigated by
  `default_fallback` pricing + monthly refresh runbook (TBD by
  Track C).
- Projections can over-reserve headroom (the actual cost is
  usually smaller). The `projected = false` filter on the cap
  ensures over-reservation does not silently cap the run.
- Adding columns to `cost_entries` requires a migration; this is
  scoped to M2 only (no backfill — projections are not retroactive).

Neutral:

- The existing per-WORKFLOW budget service (`workflow_budget.py`)
  coexists alongside the per-RUN ledger — workflows that declared
  a budget continue to flow through `WorkflowBudgetService`;
  per-RUN is a new scope (Track C's `surface_at_run_start`).

## Alternatives Considered

### Option A — Derive cost from `response.usage.total_cost`

Pros:

- Single source of truth (the proxy).
- No pricing YAML to maintain.

Cons:

- Admission happens *before* the call; we cannot look at
  `response.usage.total_cost` until the call returns, which means
  the cap is reactive (we discover overage after the fact) rather
  than preventive.
- Rejected: NFR-044 demands preventive enforcement.

### Option C — External cost service (CloudHealth, Vantage)

Pros:

- No ledger to maintain; SaaS handles aggregation.
- Cross-cloud cost rollups (useful if Forge ever expands beyond
  AWS).

Cons:

- Latency on the admission path (SaaS round-trip).
- External dependency for a constitutional rule (Rule 6).
- Vendor lock-in.
- Rejected: cost guardrails are a security control, not a
  reporting convenience; they belong in-process.

## Pros and Cons of the Chosen Option

Pros:

- Deterministic admission from pricing YAML + tokens.
- Cumulative cap filters on `projected = false` so projections
  cannot consume the budget.
- `run_id` binding aligns the cap with the SDLC run lifecycle.
- Per-tenant overrides via `settings.run_budget_cap_overrides`.
- No external dependency on the hot path.

Cons:

- Pricing YAML drift risk.
- Adds three columns to `cost_entries` (migration).
- Splits `record()` into two methods; existing call sites must
  migrate (T-B2 enumerates them).

## References

- ADR-001: Cloud-only AWS deployment
- ADR-002: PostgreSQL 17 + Apache AGE + pgvector (`cost_entries`
  table co-located)
- ADR-005: LiteLLM Proxy as Provider Abstraction Layer (the proxy
  is the source of `response.usage.cost_usd`)
- ADR-008: Append-only WORM audit trail (the cost ledger inherits
  the append-only invariant from the audit_log pattern)
- Constitution Rule 1, Rule 2, Rule 6, Rule 8
- PRD NFR-044 (cost guardrails)
- `backend/app/db/models/cost.py` — physical `cost_entries` model
- `backend/app/services/cost_ledger.py` — Python service module
- `backend/app/services/litellm_pricing/litellm_model_pricing.yaml`
  — pricing source of truth

---

## Appendix A — JSON Schema for the `cost_ledger` table

The cost ledger (physical table `cost_entries`) records one row per
projected or actual cost-incurring event. The schema below is the
authoritative contract — every projected row carries the projected
cost the admission check reserved; every actual row carries the
cost the LiteLLM proxy reported on `response.usage.cost_usd`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://forge.ai/schemas/cost_ledger.schema.json",
  "title": "cost_ledger",
  "description": "Append-only cost ledger (projected + actual rows).",
  "type": "object",
  "required": [
    "ledger_id",
    "tenant_id",
    "project_id",
    "model",
    "prompt_tokens",
    "completion_tokens",
    "cost_usd",
    "projected",
    "recorded_at"
  ],
  "properties": {
    "ledger_id": {
      "type": "string",
      "format": "uuid",
      "description": "Primary key (UUIDv4)."
    },
    "run_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "SDLC run this row belongs to. Nullable for tool spend rows that pre-date the per-RUN scope (T-B9)."
    },
    "tenant_id": {
      "type": "string",
      "format": "uuid",
      "description": "Rule 2 tenant scope."
    },
    "project_id": {
      "type": "string",
      "format": "uuid",
      "description": "Rule 2 project scope."
    },
    "agent": {
      "type": ["string", "null"],
      "description": "Agent that incurred the spend (e.g. 'code_validator', 'ideation_capture')."
    },
    "model": {
      "type": ["string", "null"],
      "description": "Provider/model identifier (e.g. 'gpt-4o-mini')."
    },
    "prompt_tokens": {
      "type": "integer",
      "minimum": 0
    },
    "completion_tokens": {
      "type": "integer",
      "minimum": 0
    },
    "cost_usd": {
      "type": "number",
      "minimum": 0,
      "description": "USD cost of this row. Projected for `projected=true`; confirmed for `projected=false`."
    },
    "projected": {
      "type": "boolean",
      "description": "true = pre-call projection (does NOT count toward the cap); false = post-call actual (DOES count)."
    },
    "recorded_at": {
      "type": "string",
      "format": "date-time",
      "description": "UTC ISO-8601 timestamp of when the row was written."
    }
  },
  "additionalProperties": false
}
```

## Appendix B — Cumulative cap rule

The cumulative cap rule closes the loop on `pre_call_admission()`.
It is the *only* rule that decides whether the upcoming LLM call
proceeds:

```
ceiling_usd = settings.run_budget_cap_overrides.get(
    tenant_id, settings.run_budget_cap_usd
)

spent_usd = sum(cost_usd
                FROM cost_entries
                WHERE run_id = X
                  AND tenant_id = T
                  AND projected = false)

projected_cost_usd = project_cost_usd(
    model, prompt_tokens, completion_tokens
)

if spent_usd + projected_cost_usd > ceiling_usd:
    raise CostCapExceeded(
        projected_usd=projected_cost_usd,
        spent_usd=spent_usd,
        ceiling_usd=ceiling_usd,
        run_id=X,
        tenant_id=T,
    )

# Admitted — record a projected row, then run the call.
await cost_ledger.record_projected(
    run_id=X, tenant_id=T, project_id=P, agent=A, model=M,
    prompt_tokens=PT, completion_tokens=CT, cost_usd=projected_cost_usd,
)

# ... after the call returns ...
await cost_ledger.record_actual(
    run_id=X, tenant_id=T, project_id=P, agent=A, model=M,
    prompt_tokens=PT, completion_tokens=CT, cost_usd=actual_cost_usd,
)
```

**Important:** the cap rule filters on `projected = false` so that
over-reserved headroom (a projection that turned out to be larger
than the actual cost) does not silently consume the budget. Only
confirmed spend counts toward the cap.