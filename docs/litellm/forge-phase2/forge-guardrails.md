# Forge Guardrails (Phase 2 F6)

> Spec: `docs/goals/step-76.md` §Feature 6
> Module: `app/services/guardrails_service.py` + `app/api/v1/guardrails.py`
> Proxy: `app/integrations/litellm/guardrail_apply.py`

## Registration

```http
POST /api/v1/guardrails
{
  "guardrail_name": "pii_email",
  "kind": "pre_call_input",
  "litellm_params": {
    "pii_entities": ["EMAIL_ADDRESS", "PHONE_NUMBER"]
  }
}
```

Backend calls `POST /guardrails/register` and busts the 60s catalog
cache.

## Pre-call pipeline

```
input text → [pre_call_input] → [pre_call_llm] → chat → [post_call_output] → stream chunks → [during_call per chunk]
```

For each guardrail in the effective set, `GuardrailsService.apply` calls
`POST /apply_guardrail`. On `block` it raises `GuardrailViolation` (HTTP 422, `policy_id` in payload). On `mask` it replaces text and emits `forge.guardrails.masked`.

## Submissions log

```http
GET /api/v1/guardrails/submissions?since_hours=24
```

Every row carries `latency_ms` (AC #6).

## UI rule-builder

`/api/v1/guardrails/ui/*` proxies to `/guardrails/ui/{list,save,get}`. The rule-builder is the admin surface for composing guardrails without Python.

## Errors

`GuardrailViolationError` (422) — `{code, guardrail_name, decision, kind, reason, policy_id, request_id, occurred_at}`.