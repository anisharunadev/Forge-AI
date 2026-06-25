# Runbook — LiteLLM Downtime

> **Severity.** Critical (P1) — every `forge-*` command that requires
> an LLM call will fail.
> **Owner.** L1 on-call (initial triage). L2 platform engineer for
> remediation. L3 architect for extended outage.
> **When to use this runbook.** When `LLMUnavailableBanner` is
> visible in the UI, when `GET /api/v1/health/litellm` returns
> `{"healthy": false}`, or when the customer reports LLM failures.

## Detection

The outage surfaces in three places. Any one of these is sufficient
to start the runbook.

| Signal | Where | Latency |
|---|---|---|
| `LLMUnavailableBanner` | Global banner in Forge UI, mounted in `apps/forge/components/providers.tsx` | ≤90s after first failed probe (3 × 30s) |
| `GET /api/v1/health/litellm` returns `{"healthy": false}` | Steward dashboard at `/admin/llm-gateway/health` | Same as above |
| `litellm.health.changed` audit event with `healthy=false` | Audit log; Pulse feed | Same as above |

The 30s `LiteLLMHealthMonitor` loop (started in `app/main.py`
lifespan) is what flips the cached health state.

## Triage (≤15 minutes)

### 1. Confirm the proxy is down

```bash
# Direct probe of the proxy
curl -sS -w "\nHTTP %{http_code}\n" http://litellm:4000/health/liveliness
# Expected when healthy: HTTP 200, {"status":"healthy"}
# When down: connection refused, timeout, or 5xx.
```

If `curl` succeeds, the proxy itself is up and the issue is in
Forge's connection to it. Skip to step 4.

### 2. Check container status

```bash
docker compose ps litellm
docker compose ps | grep -E "(litellm|backend)"
```

Note the container's status (`Up`, `Restarting`, `Exit 1`, `OOMKilled`).
This determines which sub-section below applies.

### 3. Pull recent logs

```bash
docker compose logs litellm --tail=200 --since=10m
docker compose logs backend --tail=200 --since=10m | grep -i litellm
```

Look for the smoking gun in the first 50 lines: OOMKiller, a
`config.yaml` parse error, a provider key revocation, an SSL/TLS
error from upstream, an unhandled exception in the proxy itself.

### 4. Confirm Forge is not the problem

```bash
# Backend's own health (rule out backend-only issue)
curl -fsS http://localhost:8000/health/live
curl -fsS http://localhost:8000/health/ready
```

If `/health/ready` fails on a dependency other than LiteLLM, this
is a different incident. Pivot to the matching runbook.

## Common causes and fixes

### Cause 1 — Out of memory (OOM)

**Symptoms.** `docker compose ps litellm` shows `OOMKilled`. `dmesg`
on the host shows the container was killed.

**Fix.**

```bash
# Increase memory in docker-compose.yml, then:
docker compose up -d litellm

# Or, immediately, restart with the current limits:
docker compose restart litellm
```

After restart, verify health (see "Recovery verification" below).
Long-term fix is to raise the memory limit in `docker-compose.yml`
(currently `2g`).

### Cause 2 — Bad config (`config.yaml` parse error)

**Symptoms.** `docker compose logs litellm` shows a YAML parse error
or "missing required field" on startup.

**Fix.**

```bash
# Validate the config without booting the container
docker compose run --rm litellm litellm --config /app/config.yaml --test
# Or, in the running container:
docker compose exec litellm litellm --config /app/config.yaml --test
```

If the config is invalid, fix `infra/litellm/config.yaml` and:

```bash
docker compose restart litellm
```

### Cause 3 — Network partition

**Symptoms.** Container is `Up` but `curl http://litellm:4000/...`
times out. `docker network ls` and `docker network inspect forge_default`
show no obvious errors, but `ping` from one container to another fails.

**Fix.**

```bash
# Recreate the network
docker compose down
docker network prune
docker compose up -d
```

If this recurs, escalate to L2 platform engineer — the host's Docker
networking is unstable.

### Cause 4 — Provider key revocation

**Symptoms.** `docker compose logs litellm` shows
`AuthenticationError` from OpenAI / Anthropic / Bedrock.
Forge UI shows LiteLLM as `healthy` (the proxy itself is up), but
all calls fail.

**Fix.**

This is a *partial* outage — the proxy is up but cannot reach
upstream. The customer-facing banner will say "degraded", not
"unavailable".

```bash
# Identify which provider is failing
docker compose logs litellm --tail=200 | grep -E "(AuthenticationError|401|403)"

# Rotate the key in AWS Secrets Manager (or whichever secret store)
# Then restart LiteLLM so it picks up the new env:
docker compose restart litellm
```

Verify the rotation via `/admin/llm-gateway/health` — the per-provider
status indicators should flip back to `ok`.

### Cause 5 — Forge-side connection pool exhausted

**Symptoms.** Proxy is healthy; Forge backend is healthy; calls still
fail with `LLMUnavailableError`. Logs show `httpx.PoolTimeout` or
`ConnectError`.

**Fix.**

```bash
docker compose restart backend
```

If this recurs, the Forge backend's httpx pool size may be too small
(currently 100 connections). File a follow-up to bump it.

## Recovery verification

A successful recovery shows all three signals flipping back to
healthy. Run them in this order:

```bash
# 1. Direct proxy health
curl -fsS http://litellm:4000/health/liveliness
# Expect: HTTP 200, {"status":"healthy"}

# 2. Forge-side cached health (will clear within 30s of step 1)
for i in 1 2 3 4 5 6; do
  echo "attempt $i: $(curl -fsS http://localhost:8000/api/v1/health/litellm)"
  sleep 5
done
# Expect: {"healthy": true, ...} within 30s.

# 3. UI banner cleared
# Visit http://localhost:3000 in a browser; LLMUnavailableBanner is gone.
```

If step 2 takes more than 60s, the health monitor is stuck. Restart
the backend:

```bash
docker compose restart backend
```

## User-facing communication

What to tell customers during the outage:

| Channel | Message template |
|---|---|
| Status page | "We are investigating an issue affecting AI-assisted features in Forge. Existing artifacts remain accessible; new generation may be delayed." |
| In-app banner (automatic) | "AI features are temporarily unavailable. Cached data remains visible. Engineering is investigating." |
| Customer Slack (if P0 customer) | "Forge AI is currently degraded. We expect normal operation within [ETA]. We will update this thread every 30 minutes." |

**Do not** speculate on root cause in customer-facing channels. Wait
for step 1–4 of triage to complete, then update.

## Escalation

| Condition | Escalate to | Channel |
|---|---|---|
| Outage >15 min, no root cause identified | L2 platform engineer | `#forge-oncall-escalation` |
| Outage >30 min, multi-tenant impact | L3 architect | `#forge-oncall-escalation` + page |
| Outage >60 min OR customer-facing data exposure suspected | L4 CISO delegate | Page directly + open incident per [docs/operations/incident-response.md](../operations/incident-response.md) |
| Provider key revocation with confirmed external compromise | L4 CISO delegate | Page directly |

## Post-incident

Within 24 hours of recovery:

1. Write post-incident notes per
   [docs/operations/rollback-procedures.md §PIR](../operations/rollback-procedures.md#post-incident-review-template).
2. Capture the timeline (UTC): detection → triage → mitigation → recovery.
3. Identify the root cause and any contributing factors.
4. Propose a remediation: either a code change, a config change, a
   monitoring improvement, or a runbook update.
5. File a follow-up ticket and link it from the PIR.

## Related

- [oncall-runbook.md](../operations/oncall-runbook.md) — general on-call
- [rollback-procedures.md](../operations/rollback-procedures.md) — full rollback
- [backend/app/integrations/litellm/README.md](../../backend/app/integrations/litellm/README.md) — developer guide
- [budget-exhausted.md](./budget-exhausted.md) — sibling runbook for budget outages