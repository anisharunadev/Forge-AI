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
