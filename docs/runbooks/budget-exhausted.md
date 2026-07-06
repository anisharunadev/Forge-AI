# Runbook — Tenant Budget Exhausted

> **Severity.** High (P2) when 100% budget hit but tenant has
> workflows still running; Medium (P3) when only future calls
> affected.
> **Owner.** L1 on-call (initial triage). Steward (decision to raise
> budget). L2 platform engineer (audit trail investigation).
> **When to use this runbook.** When `BudgetExceededModal` appears
> in the UI, when the audit log shows `litellm.budget.exceeded` for a
> tenant, or when a customer reports blocked workflows.

## Detection

The 100% threshold surfaces in three places:

| Signal | Where |
|---|---|
| `BudgetExceededModal` | Forge UI, mounted globally. Shown when a workflow's per-workflow budget hits 100% mid-run. |
| `BudgetGauge` turns red | Tenant LLM config page at `/admin/llm-gateway/tenants/{id}` |
| Audit event `litellm.budget.exceeded` | Audit log + Pulse feed; emitted by `BudgetSync.record_spend` when spend crosses the ceiling |

The 80% threshold (`BudgetGauge` turns yellow; audit event
`litellm.budget.threshold_reached`) is a *warning*, not an outage.
No customer action required, but Steward should plan to raise the
budget before the next billing cycle.

## Triage (≤15 minutes)

### 1. Identify the tenant

```bash
# From the audit event payload
curl -fsS "http://localhost:8000/api/v1/audit/events?type=litellm.budget.exceeded&since=-1h" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '.events[] | {tenant_id, project_id, occurred_at, payload}'
```

Or from the UI: the `BudgetExceededModal` shows the tenant name and
project id directly.

### 2. Look at the spend breakdown

```bash
# Per-tenant spend breakdown (last 30 days)
curl -fsS "http://localhost:8000/api/v1/analytics/usage?tenant_id=$TENANT_ID&since=-30d" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '{
      total_spend: .total_spend_usd,
      by_model: .by_model,
      by_user: .by_user_top_10,
      by_workflow: .by_workflow_top_10
    }'
```

The breakdown shows whether the spend spike is concentrated in one
user, one workflow, or one model. This determines the next step.

### 3. Check the budget history

```bash
# Was the budget raised recently?
curl -fsS "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/budget/history" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Look for recent budget changes. If the budget was raised yesterday
and exhausted today, the customer's expected volume was wrong — they
need to either raise the budget further or pause non-essential
workflows.

## Mitigation

You have three options, in order of preference:

### Option A — Raise the budget (recommended for legitimate spike)

```bash
curl -fsS -X POST \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/budget" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"usd": "1500.00", "period": "monthly"}'
```

Or in the UI: `/admin/llm-gateway/tenants/{id}` → "Budget" field →
save.

The change propagates to LiteLLM within 5s. The next call goes
through.

### Option B — Pause specific workflows

If the spike is from one runaway workflow, pause it instead of
raising the budget:

```bash
curl -fsS -X POST \
  "http://localhost:8000/api/v1/workflows/$RUN_ID/pause" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The workflow stops cleanly; subsequent runs of the same workflow
fail with `workflow_paused` until the operator resumes it.

### Option C — Investigate before acting

If the breakdown shows an unknown user or an unknown workflow
consuming the budget, this may be a misuse or compromise. Pause the
tenant's Virtual Key and escalate to L4 CISO delegate.

```bash
# Revoke all keys (forces tenant to contact Steward)
curl -fsS -X POST \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/keys/revoke-all" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Then page L4. See
[docs/operations/incident-response.md](../operations/incident-response.md).

## Customer communication

What to tell customers when they hit the budget:

| Channel | Message template |
|---|---|
| In-app modal (automatic) | "This workflow has hit its budget limit. Contact your Steward to raise the limit, or pause non-essential workflows." |
| Email (Steward-sent, not automatic) | "Your Forge tenant has hit its LLM budget of $X for [period]. Current spend: $X. Top consumers: [user/workflow/model]. Options: (a) raise the budget, (b) pause specific workflows, (c) investigate the breakdown at /admin/llm-gateway/tenants/{id}/usage." |
| Customer Slack (P0 customers only) | Same as email, with a personal offer to walk through the breakdown. |

**Do not** raise the budget without the customer's explicit
approval. The 100% gate is a feature, not a bug — it prevents
runaway costs.

## Audit trail

The full spend log is queryable. Two locations:

### In Forge (canonical for Forge-side attribution)

```bash
# All spend events for a tenant in the last 24h
curl -fsS "http://localhost:8000/api/v1/audit/events?type=litellm.spend.recorded&tenant_id=$TENANT_ID&since=-24h" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | jq '.events[] | {occurred_at, payload}'
```

### In LiteLLM (canonical for provider-side attribution)

LiteLLM's spend log is at `/spend/logs` on the proxy. Query it via
the admin client:

```bash
docker compose exec litellm curl -fsS \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  http://localhost:4000/spend/logs?team_id=$LITELLM_TEAM_ID
```

The two are reconciled nightly by the
`litellm_reconcile` APScheduler job (Phase D). Drift is surfaced in
`/admin/llm-gateway/health` → `DriftTable`.

### Audit events to expect

| Event | Emitted when |
|---|---|
| `litellm.budget.threshold_reached` | Spend crosses 80% |
| `litellm.budget.exceeded` | Spend crosses 100% and a call is blocked |
| `litellm.budget.raised` | Steward raises the budget |
| `litellm.spend.recorded` | Every chat/embed call completes |

## Escalation

| Condition | Escalate to | Channel |
|---|---|---|
| Budget exhausted and customer is unresponsive | Steward of record | Email + Slack DM |
| Budget exhausted + suspected compromise (unknown user/workflow) | L4 CISO delegate | Page directly |
| Repeat exhaustion (3+ times in 30 days for same tenant) | L3 architect | `#forge-oncall-escalation` — consider default-budget raise |
| Budget audit log shows drift >5% vs LiteLLM spend log | L2 platform engineer | `#forge-oncall-escalation` |

## Post-incident

Within 24 hours of resolution:

1. Note the outcome in the customer's pilot record.
2. If the customer is at P0 tier, schedule a 30-min review call to
   discuss whether the default budget is mis-sized.
3. Capture the spend breakdown (by user / workflow / model) in the
   post-incident notes.
4. If the root cause was a runaway workflow, file a ticket to add
   per-workflow budget defaults.

## Related

- [oncall-runbook.md](../operations/oncall-runbook.md) — general on-call
- [litellm-downtime.md](./litellm-downtime.md) — sibling runbook for proxy outages
- [pilot/llm-gateway-setup.md](../pilot/llm-gateway-setup.md) — budget defaults during onboarding
- [backend/app/integrations/litellm/README.md](../../backend/app/integrations/litellm/README.md) — `BudgetSync` developer guide
---

## Phase 6 — v2: Tenant ceiling

Phase 6 SC-6.1 adds a **tenant-scoped** ceiling on top of the
per-agent budget already in this runbook.

- Source: `backend/app/services/forge_budget_guard.py::TenantBudgetGuard`
- Enforcement: `Tenant.settings['budget_enforcement_v2']` (default `True`
  for new tenants via `settings.tenant_budget_enforcement_v2_default`).
- Ceiling: `Tenant.settings['tenant_budget_usd']` (default
  `TenantBudgetGuard.DEFAULT_CEILING_USD = 5000.00`).
- Window: trailing 30 days.
- HTTP behavior: pre-call `TenantBudgetExceeded` → FastAPI maps to
  `HTTP 429` + `Retry-After: 3600`.

### Quick check

```bash
# Read the tenant's current snapshot
curl -H "Authorization: Bearer $TOKEN" \
  https://api.forge.example.com/api/v1/forge/observability/budget/$TENANT_ID

# Disable enforcement per tenant while you investigate
psql -c "UPDATE tenants SET settings = settings || '{\"budget_enforcement_v2\": false}'::jsonb WHERE id = '$TENANT_ID'"
```
