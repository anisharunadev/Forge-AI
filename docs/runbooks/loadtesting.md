# Runbook: Load Testing the Chat Surface

> **Status:** Phase 6 SC-6.5 owner
> **Source of truth:** `scripts/loadtest/chat_1000.py`
> **Last verified:** 2026-07-06

## When to run

- After any change to `backend/app/integrations/litellm/` (the chat hot path).
- After any change to `backend/app/core/rate_limit.py` (per-tenant gating).
- Quarterly as part of the Phase 8 sign-off.

## How to run

```bash
# 1. Confirm staging is healthy
curl https://staging.forge.example.com/api/v1/forge/health/services

# 2. Set env
export API_BASE=https://staging.forge.example.com
export LITELLM_BASE=https://staging-litellm.example.com
export LOADTEST_TOKEN=...

# 3. Run (5 minutes, 50 tenants × 20 users = 1000 concurrent)
python3 scripts/loadtest/chat_1000.py

# 4. Inspect the report
cat docs/plan/phase-6-loadtest-report.md
```

## Pass criteria

- p95 < 2000 ms (SC-6.5)
- error rate < 0.1% (SC-6.5)

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| p95 > 2s, error rate < 0.1% | LiteLLM saturation | Lower `--max-concurrency` to 100; rerun. If still slow, scale LiteLLM. |
| 429s on >5% of requests | Rate limit too aggressive | Raise `chat_rate_limit_per_min` for staging. |
| 502/504 on >0.5% | Upstream connection pool exhausted | Increase `httpx` connection pool size in `LiteLLMBaseClient`. |
| Queue full messages | LiteLLM down | Trigger `scripts/loadtest/litellm_kill.sh` recovery flow (separate runbook). |

## Reporting

Append a new section to `docs/plan/phase-6-loadtest-report.md` after
every green run. Failures do NOT get appended — the script exits 1
and the report is left untouched.
