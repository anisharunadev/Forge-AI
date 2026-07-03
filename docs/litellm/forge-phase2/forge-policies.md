# Forge Policies (Phase 2 F7)

> Spec: `docs/goals/step-76.md` §Feature 7
> Module: `app/services/policies_service.py` + `app/api/v1/policies.py`
> Proxy: `app/integrations/litellm/policies_apply.py`

## Policy object

```yaml
Policy {
  id, name, description
  scope: { tenant_id?, team_id?, agent_id?, request_tags?[] }
  guardrails: GuardrailRef[]   # ordered
  tool_policy: { allowed_tools?, denied_tools?, requires_approval? }
  decision_logic: { on_violation, on_multiple_violations, budget_override? }
  priority: integer
  status: draft | review | active | archived
}
```

## Resolution

```http
POST /api/v1/policies/resolve
{ "tenant_id": "...", "agent_id": "...", "team_id": "...", "request_tags": ["..."] }
```

Returns `ResolveResult { policies[], effective_guardrails[], tool_policy }`. 60s per-context cache; bust on archive/update.

## Composition rules

1. Higher priority first.
2. More specific scope (agent > team > tenant > request).
3. Most recent activation.
4. deny wins over allow; block wins over warn.

## Templates

`GET /api/v1/policies/templates` returns 5 starters (`dev-permissive`, `staging-balanced`, `prod-strict`, `pii-only`, `read-only-investigative`). `POST /api/v1/policies/templates/{id}/clone` produces a tenant-owned copy.

## Compare + test

- `POST /api/v1/policies/compare` — `{left, right}` → diff
- `POST /api/v1/policies/{id}/test` — dry-run pipeline
- `POST /api/v1/policy/templates/{id}/clone` — stamp a fresh id

## Attachments

`GET/POST /api/v1/policies/attachments` — bind a policy to tenant/team/agent/user; `inherit: bool`, `override_lower_priority: bool`.

## Errors

`PolicyResolutionError` (422) → `PolicyResolutionErrorEnvelope { code, missing_fields[] }`.