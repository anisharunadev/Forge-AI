# Phase 8 — Load Test Report

**Status:** PENDING — harness ready (`scripts/loadtest/chat_1000.py`),
awaiting a run against the staging backend.

## How to run

```bash
cd backend && PYTHONPATH=. \
  python3 ../scripts/loadtest/chat_1000.py \
    --base-url "$BACKEND_URL" \
    --token "$JWT_TOKEN" \
    --tenant-id "$TENANT_ID" \
    --total 1000 \
    --concurrency 100
```

## Pass criteria

- p95 latency < 2000ms
- error rate < 0.1%

## First run results

_Filled in after the first successful staging run._
