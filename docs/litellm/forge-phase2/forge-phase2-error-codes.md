# Phase 2 Error Codes

> Typed error envelopes raised in Phase 2. Each maps to an HTTP status + machine-readable payload.

| Code | HTTP | Retry semantics | Payload |
|---|---|---|---|
| `GuardrailViolation` | 422 | Do not retry without changing the request | `{code, guardrail_name, decision, kind, reason, policy_id?, request_id?, occurred_at}` |
| `MCPAuthExpired` | 401 | Refresh via reauth flow; do not auto-retry | `{code, server_id, reauth_url}` |
| `MCPToolTimeout` | 504 | Retry once with exponential backoff | `{code, server_id, tool_name, duration_ms}` |
| `PolicyResolutionError` | 422 | Do not retry; fix the resolve context | `{code, missing_fields[]}` |
| `SkillRenderError` | 422 | Do not retry; fix the template | `{code, skill_id, template_error}` |
| `ToolApprovalRequired` | 409 | Surface UI approval; do not auto-dispatch | `{code, tool_name, request_id, approval_url}` |

## Mapping

- `GuardrailViolation` ↔ `app.schemas.guardrails.GuardrailViolationError`
- `MCPAuthExpired` ↔ `app.schemas.mcp.MCPAuthExpiredError`
- `MCPToolTimeout` ↔ `app.schemas.mcp.MCPToolTimeoutError`
- `PolicyResolutionError` ↔ `app.schemas.policies.PolicyResolutionErrorEnvelope`
- `SkillRenderError` ↔ `app.schemas.skills.SkillRenderError`
- `ToolApprovalRequired` ↔ no schema (HTTPException with detail)

## Anti-patterns

- Returning a free-form dict from a router (Rule 4 violation).
- Returning `null` for a typed field when the proxy returned an error.
- 500 on transport failures (must be a typed error envelope).
- Auto-retrying a 422 (the request itself is wrong).