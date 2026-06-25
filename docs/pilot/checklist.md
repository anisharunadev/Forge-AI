# Pilot Onboarding Checklist — LLM Gateway

> **Use this checklist alongside [llm-gateway-setup.md](./llm-gateway-setup.md).**
> Every step in the playbook has a line here. Tick the box as you
> complete the step; write the verification value in the right-hand
> column. Hand the completed checklist to the pilot owner for sign-off.

---

## Pilot info

| Field | Value |
|---|---|
| Tenant ID | `_____________________________` |
| Tenant name | `_____________________________` |
| Onboarding engineer | `_____________________________` |
| Date | `_____________________________` |
| Steward | `_____________________________` |
| L3 architect | `_____________________________` |

---

## Pre-flight

- [ ] **PF-1.** LiteLLM Proxy reachable: `curl https://litellm.<env>.forge.example.com/health/liveliness` → HTTP 200
  - Value: `_____________________________`
- [ ] **PF-2.** Keycloak realm `forge` imported; pilot customer has realm-roles
  - Value: `_____________________________`
- [ ] **PF-3.** RLS migration applied: `psql -c '\d litellm_team_mappings'` lists 5 tables, each RLS-enabled
  - Value: `_____________________________`
- [ ] **PF-4.** Backend IAM role allows Secrets Manager `Get/Put` on `forge/tenants/*`
  - Value: `_____________________________`
- [ ] **PF-5.** All 10 `LITELLM_*` env vars set on backend container
  - Value: `_____________________________`
- [ ] **PF-6.** `LITELLM_INTEGRATION_ENABLED=true` in this env
  - Value: `_____________________________`
- [ ] **PF-7.** Steward user has `steward` realm-role
  - Value: `_____________________________`
- [ ] **PF-8.** Pilot customer has signed the LLM Gateway addendum
  - Value: `_____________________________`

---

## Step 1 — Tenant provisioning

- [ ] **1.1.** Verified Forge tenant exists
  - `GET /api/v1/admin/tenants/$TENANT_ID` → 200
  - Value: `_____________________________`
- [ ] **1.2.** Triggered LiteLLM Team sync
  - `POST /api/v1/admin/llm-gateway/tenants/$TENANT_ID/sync` → 202
  - Job ID: `_____________________________`
- [ ] **1.3.** Confirmed Team exists in LiteLLM
  - LiteLLM team_id: `_____________________________`

---

## Step 2 — Key minting

- [ ] **2.1.** Provisioned first Virtual Key (alias=primary)
  - `POST /api/v1/admin/llm-gateway/tenants/$TENANT_ID/keys` → 201
  - key_id: `_____________________________`
  - key_value: **DO NOT WRITE DOWN** (use the verify endpoint)
- [ ] **2.2.** Confirmed key is in Secrets Manager at `forge/tenants/$TENANT_ID/keys/primary`
  - Value: `_____________________________`
- [ ] **2.3.** Verified key works via `POST /keys/verify` → `{"valid": true}`
  - Value: `_____________________________`

---

## Step 3 — Budget setup

- [ ] **3.1.** Applied default budget ($500/month or negotiated override)
  - `POST /api/v1/admin/llm-gateway/tenants/$TENANT_ID/budget`
  - Budget: `_____________________________` USD / period: `_____________________________`
- [ ] **3.2.** Verified in LiteLLM `GET /budget/info?team_id=$LITELLM_TEAM_ID`
  - Value: `_____________________________`
- [ ] **3.3.** Recorded override in `docs/pilot/llm-gateway-budget-overrides.csv` (if non-default)
  - Value: `_____________________________`

---

## Step 4 — Guardrail assignment

- [ ] **4.1a.** Assigned PII redaction guardrail
  - Value: `_____________________________`
- [ ] **4.1b.** Assigned content safety guardrail
  - Value: `_____________________________`
- [ ] **4.1c.** Assigned prompt injection guardrail
  - Value: `_____________________________`
- [ ] **4.2.** Verified guardrails in LiteLLM `GET /team/$LITELLM_TEAM_ID/info`
  - Value: `_____________________________`
- [ ] **4.3.** Recorded exceptions in `docs/pilot/llm-gateway-guardrail-exceptions.csv` (if any)
  - Value: `_____________________________`

---

## Step 5 — Smoke test

- [ ] **5.1.** Triggered Co-pilot call → 200 with non-empty assistant message
  - Value: `_____________________________`
- [ ] **5.2.** Verified `X-Forge-Trace-Id` header in response
  - forge_trace_id: `_____________________________`
- [ ] **5.3.** Verified `litellm.call.completed` audit event present
  - Event payload: `_____________________________`
- [ ] **5.4.** Verified spend > 0 in LiteLLM spend logs
  - Value: `_____________________________`
- [ ] **5.5.** Confirmed `litellm_call_records` row matches audit (trace correlation)
  - Value: `_____________________________`

---

## Step 6 — Monitoring

- [ ] **6.1.** Subscribed to Pulse feed alerts for this tenant
  - Value: `_____________________________`
- [ ] **6.2.** Confirmed Steward sees `BudgetGauge` in tenant config page
  - Value: `_____________________________`
- [ ] **6.3.** Briefed Steward on the 80%/100% thresholds and on-call runbooks
  - Value: `_____________________________`

---

## Step 7 — Sign-off

- [ ] **7.1.** Steward confirms budget size
  - Sign-off: `_____________________________` Date: `_____________________________`
- [ ] **7.2.** Customer acknowledges the 80%/100% thresholds
  - Sign-off: `_____________________________` Date: `_____________________________`
- [ ] **7.3.** First end-to-end Co-pilot call returned valid response
  - Trace ID: `_____________________________`
- [ ] **7.4.** Audit trail shows the call (forge_trace_id → litellm_call_id)
  - Value: `_____________________________`
- [ ] **7.5.** LiteLLM spend log matches Forge cost_ledger for the call
  - Value: `_____________________________`
- [ ] **7.6.** No Virtual Key value appears in any UI / log / audit event
  - Verified by: `_____________________________`
- [ ] **7.7.** Onboarding summary filed at `docs/pilot/onboardings/<tenant_id>-<date>.md`
  - Path: `_____________________________`

---

## Rollback (if needed during week 1)

- [ ] **R-1.** Per-tenant rollback executed (revoke all keys, fall back to master key)
  - Value: `_____________________________`
- [ ] **R-2.** OR global rollback executed (`LITELLM_INTEGRATION_ENABLED=false`, restart backend)
  - Value: `_____________________________`
- [ ] **R-3.** Customer notified of degraded mode
  - Value: `_____________________________`

---

## Hand-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Onboarding engineer | | | |
| Steward | | | |
| L3 architect | | | |
| Pilot owner | | | |

---

## Related

- [llm-gateway-setup.md](./llm-gateway-setup.md) — full playbook
- [backend/app/integrations/litellm/README.md](../../backend/app/integrations/litellm/README.md) — developer guide
- [docs/runbooks/litellm-downtime.md](../runbooks/litellm-downtime.md) — outage runbook
- [docs/runbooks/budget-exhausted.md](../runbooks/budget-exhausted.md) — budget runbook