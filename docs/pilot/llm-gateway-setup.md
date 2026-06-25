# Pilot Onboarding — LLM Gateway Setup

> **Audience.** Pilot onboarding engineer (L2 platform engineer or
> designated SRE).
> **Assumed environment.** Production-like. No dev shortcuts. Real
> AWS, real Keycloak, real LiteLLM Proxy.
> **Outcome.** Pilot customer can run their first Co-pilot call
> against a properly provisioned LiteLLM Team + Virtual Key +
> Budget + Guardrails.
> **Companion.** [checklist.md](./checklist.md) — a printed
> line-by-line version of this playbook. Use both side-by-side.

## Pre-flight (must be true before starting)

| # | Requirement | Verified by |
|---|---|---|
| 1 | LiteLLM Proxy is deployed and reachable at the prod URL | `curl -fsS https://litellm.<env>.forge.example.com/health/liveliness` returns 200 |
| 2 | Keycloak realm `forge` is imported with the pilot customer's realm-roles | Keycloak admin console shows the realm |
| 3 | RLS migration `add_litellm_integration_tables` is applied | `psql -c '\d litellm_team_mappings'` lists 5 new tables, each with `ENABLE ROW LEVEL SECURITY` |
| 4 | Backend service can reach Secrets Manager with the `forge/tenants/*` prefix | IAM role on backend task allows `secretsmanager:GetSecretValue` and `PutSecret` for the prefix |
| 5 | Backend container has all 10 `LITELLM_*` env vars set (see `backend/app/core/config.py`) | `docker compose exec backend env | grep LITELLM_` lists them all |
| 6 | `LITELLM_INTEGRATION_ENABLED=true` in the pilot env | `docker compose exec backend env | grep LITELLM_INTEGRATION_ENABLED` |
| 7 | Steward has a Forge user with `steward` role in the pilot tenant | Keycloak user has the realm-role |
| 8 | Pilot customer has signed the LLM Gateway addendum (data residency, model allowlist, budget cap) | Addendum on file |

If any of the above is not true, halt and resolve before proceeding.

## 1. Tenant provisioning

The pilot tenant must already exist in Forge (created via the
`/admin/tenants` flow). This section assumes `tenant_id` is known.

### 1.1 Verify the Forge tenant exists

```bash
curl -fsS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/api/v1/admin/tenants/$TENANT_ID"
# Expect: 200, {"tenant_id": "...", "name": "...", "policy": "..."}
```

### 1.2 Trigger LiteLLM Team sync

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/sync"
# Expect: 202, {"status": "sync_started", "job_id": "..."}
```

`TenantSync.on_tenant_created` is also fired automatically on the
Forge `tenant_created` event. Re-triggering it is idempotent — safe.

Verify the Team exists in LiteLLM:

```bash
docker compose exec litellm curl -fsS \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  "http://localhost:4000/team/list" \
  | jq '.[] | select(.team_alias | contains("'"$TENANT_ID"'"))'
# Expect: one entry with team_id, team_alias, members: []
```

## 2. Key minting

### 2.1 Provision the first Virtual Key

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/keys" \
  -d '{"alias": "primary"}'
# Expect: 201, {"key_id": "...", "alias": "primary", "created_at": "..."}
# NOTE: the response contains key_id but NOT the key VALUE.
```

The first Virtual Key is auto-provisioned by `TenantSync` if
`LITELLM_AUTO_PROVISION_KEYS=true` (the default). Re-running the
above is idempotent on `alias=primary` — it returns the existing
key_id.

### 2.2 Confirm the key is in Secrets Manager

```bash
aws secretsmanager describe-secret \
  --secret-id "forge/tenants/$TENANT_ID/keys/primary" \
  --region "$AWS_REGION"
# Expect: a Description, KmsKeyId (if configured), and a LastChangedDate.
```

### 2.3 Verify the key is valid

The key value is **not** in any API response. To verify it works,
trigger an audit-only chat call from the backend (this uses the key
server-side):

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/keys/verify" \
  -d '{"key_id": "'"$KEY_ID"'"}'
# Expect: 200, {"valid": true, "models": [...]}
```

This endpoint exists specifically for the onboarding engineer. It is
not exposed in the UI.

## 3. Budget setup

### 3.1 Apply the default budget ($500/month)

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/budget" \
  -d '{"usd": "500.00", "period": "monthly"}'
# Expect: 200, {"tenant_id": "...", "usd": "500.00", "period": "monthly", "effective_at": "..."}
```

This is the OQ-32 default. If the customer has negotiated a
different ceiling, substitute it here.

### 3.2 Verify in LiteLLM

```bash
docker compose exec litellm curl -fsS \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  "http://localhost:4000/budget/info?team_id=$LITELLM_TEAM_ID"
# Expect: max_budget=500.0, budget_duration=monthly, spend=0.0
```

### 3.3 Document the override

If the customer's negotiated ceiling differs from the default, add
a row to `docs/pilot/llm-gateway-budget-overrides.csv` with:

```csv
tenant_id,negotiated_usd,negotiated_period,effective_date,approved_by
acme-corp,1500.00,monthly,2026-06-25,jane.doe
```

## 4. Guardrail assignment

### 4.1 Apply default guardrails

```bash
# PII redaction
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/guardrails" \
  -d '{"guardrail": "pii_redaction"}'

# Content safety
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/guardrails" \
  -d '{"guardrail": "content_safety"}'

# Prompt injection
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/guardrails" \
  -d '{"guardrail": "prompt_injection"}'
```

Each is governed by an env var:
`LITELLM_GUARDRAIL_PII_DEFAULT`, `LITELLM_GUARDRAIL_CONTENT_DEFAULT`,
`LITELLM_GUARDRAIL_INJECTION_DEFAULT`. Setting the env var to `false`
skips the corresponding guardrail; setting it to `true` is the
default.

### 4.2 Verify in LiteLLM

```bash
docker compose exec litellm curl -fsS \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  "http://localhost:4000/team/$LITELLM_TEAM_ID/info"
# Expect: a "guardrails" array with the 3 entries above.
```

### 4.3 Document any deviations

If a guardrail is skipped, record the reason in
`docs/pilot/llm-gateway-guardrail-exceptions.csv`:

```csv
tenant_id,guardrail,reason,approved_by,effective_date
acme-corp,pii_redaction,Customer contract clause 4.2 prohibits redaction,jane.doe,2026-06-25
```

## 5. Smoke test

The end-to-end smoke test makes a real Co-pilot call against the
provisioned tenant and verifies the audit trail.

### 5.1 Trigger a Co-pilot call

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/copilot/chat" \
  -d '{
        "tenant_id": "'"$TENANT_ID"'",
        "messages": [{"role": "user", "content": "Summarize the README"}]
      }'
# Expect: 200, with a non-empty assistant message.
```

### 5.2 Verify the call was routed via LiteLLM

```bash
# The forge_trace_id is in the response headers
curl -fsS -i -X POST \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/copilot/chat" \
  -d '{"tenant_id":"'"$TENANT_ID"'","messages":[{"role":"user","content":"hi"}]}' \
  | grep -i x-forge-trace-id
# Expect: X-Forge-Trace-Id: <uuid>
```

### 5.3 Verify the audit event

```bash
curl -fsS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/api/v1/audit/events?type=litellm.call.completed&tenant_id=$TENANT_ID&since=-5m" \
  | jq '.events[0]'
# Expect: {type, tenant_id, project_id, payload: {trace_id, model, tokens, cost_usd, ...}}
```

### 5.4 Verify the spend was recorded

```bash
docker compose exec litellm curl -fsS \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  "http://localhost:4000/spend/logs?team_id=$LITELLM_TEAM_ID" \
  | jq '.[0]'
# Expect: spend > 0, matching the audit event.
```

## 6. Monitoring (week 1)

For the first 7 days post-onboarding, watch for the following.
Each has a corresponding runbook or alert.

| Signal | What it means | What to do |
|---|---|---|
| `litellm.health.changed` with `healthy=false` | Proxy outage | [docs/runbooks/litellm-downtime.md](../runbooks/litellm-downtime.md) |
| `litellm.budget.threshold_reached` (80%) | Tenant hit 80% of budget | No action; plan to discuss with customer |
| `litellm.budget.exceeded` (100%) | Tenant hit 100% | [docs/runbooks/budget-exhausted.md](../runbooks/budget-exhausted.md) |
| `litellm.guardrail.violated` | Guardrail blocked a call | Check audit payload; if recurring, discuss with customer |
| Spend > 2x forecast | Mis-sized budget | Reach out to customer; consider raising |

The Pulse feed surfaces all of these for the Steward dashboard.

## 7. Rollback

If the customer experiences unacceptable behavior in week 1, you
can flip the integration off for their tenant without rolling back
the code.

### 7.1 Per-tenant disable (preferred)

There is no per-tenant toggle in Phase A. To achieve the same effect:

```bash
# Revoke the Virtual Key (customer stops at the proxy)
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/keys/revoke-all"

# Re-create a master-key-backed key (degraded mode)
curl -fsS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/v1/admin/llm-gateway/tenants/$TENANT_ID/keys/fallback-to-master" \
  -d '{}'
```

The customer continues to operate, but per-tenant budget, key
audit, and guardrail enforcement are disabled.

### 7.2 Global disable (last resort)

```bash
# On the backend task definition, set:
LITELLM_INTEGRATION_ENABLED=false

# Then restart the backend:
aws ecs update-service --cluster forge --service forge-backend --force-new-deployment
```

This disables the entire integration layer. Existing
`litellm_client.py` call sites fall through to the legacy master-key
path (see the "Rollback" section of the
[Implementation Plan](../../.claude/plans/zippy-sprouting-haven.md#rollback)).

### 7.3 Re-enable

Re-run this playbook from step 1. Re-provisioning is idempotent.

## 8. Sign-off

Before marking the onboarding complete:

- [ ] Steward has confirmed the budget is sized correctly.
- [ ] Customer has acknowledged the 80%/100% thresholds.
- [ ] First end-to-end Co-pilot call returned a valid response.
- [ ] Audit trail shows the call (forge_trace_id → litellm_call_id).
- [ ] LiteLLM spend log matches Forge cost_ledger for the call.
- [ ] No Virtual Key value appears in any UI, log, or audit event.

File the onboarding summary in
`docs/pilot/onboardings/<tenant_id>-<date>.md` with:

- Date and onboarding engineer
- Negotiated budget and any guardrail exceptions
- First-call `forge_trace_id` and `litellm_call_id`
- Customer sign-off contact

## Related

- [checklist.md](./checklist.md) — printed checklist version
- [backend/app/integrations/litellm/README.md](../../backend/app/integrations/litellm/README.md) — developer guide
- [docs/runbooks/litellm-downtime.md](../runbooks/litellm-downtime.md) — outage runbook
- [docs/runbooks/budget-exhausted.md](../runbooks/budget-exhausted.md) — budget runbook
- [docs/operations/oncall-runbook.md](../operations/oncall-runbook.md) — general on-call