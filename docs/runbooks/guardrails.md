# Runbook: Pre-Call Guardrails

> **Status:** Phase 6 SC-6.7 owner
> **Source of truth:** `backend/app/integrations/litellm/llm_client.py` + `scripts/audit-guardrail-callsites.py`
> **Last verified:** 2026-07-06

## Why this runbook exists

Every chat completion must pass through the **pre-call guardrail
envelope** (`ForgeLLMClient._enforce_pre_call_guardrails`,
`backend/app/integrations/litellm/llm_client.py:681-777`). On a guardrail
**block** the chat short-circuits with `LLMUnavailableError` wrapping a
`GuardrailViolation`. On a **mask** the user message is sanitized before
the upstream call. Bypassing this wrapper = unfiltered prompts reaching
the model = data-leak / abuse vector.

## How the wrapper enforces it

```python
async def chat(self, messages, ...):
    # step-77 P2 — Guardrail pre-call envelope
    messages = await self._enforce_pre_call_guardrails(
        messages=messages,
        tenant_id=tenant_id,
        project_id=project_id,
        ...
    )
    # Then the upstream call.
    response_body, _ = await base_client.chat(...)
```

`ForgeLLMClient.chat()` is the **only** entry point that runs the
guardrail. Legacy `LiteLLMClient.chat()` does NOT.

## How to migrate a caller

1. Open the file flagged by `scripts/audit-guardrail-callsites.py`.
2. Replace `from app.services.litellm_client import LiteLLMClient` with
   `from app.integrations.litellm.llm_client import ForgeLLMClient`.
3. Replace the call site:

```python
# before
async with LiteLLMClient() as client:
    response = await client.chat(messages=[...], model="gpt-4o-mini")

# after
client = ForgeLLMClient()
response = await client.chat(
    messages=[...],
    model="gpt-4o-mini",
    tenant_id=...,
    project_id=...,
)
```

4. Run `python3 scripts/audit-guardrail-callsites.py` — must exit 0.
5. Run the file's existing tests.

## How to verify CI catches a regression

`scripts/audit-guardrail-callsites.py` is wired into the Python CI
lane. A PR that adds a new `client.chat(messages=…)` call site outside
the wrapper fails the build.

## Failure modes

| Failure | What happens | Recovery |
|---|---|---|
| Guardrail returns 5xx (LiteLLM down) | `_enforce_pre_call_guardrails` returns the original messages (fail-open on the guardrail call, not on the chat) | Chat proceeds without guardrail. Alert fires; investigate LiteLLM. |
| Guardrail blocks on PII | `GuardrailViolation` → `LLMUnavailableError` → SSE error event | Client sees `code=guardrail_blocked`. User retries with sanitized input. |
| Guardrail mask changes message length | Token-count estimate drifts | `_record_successful_call` reads final `usage` chunk; cost reflects actual tokens. |

## Anti-patterns (forbidden)

- `import openai` or any direct provider SDK (Rule 1).
- `httpx.post("https://api.openai.com/v1/chat/completions", ...)` (bypasses LiteLLM).
- `LiteLLMClient()` for any new code (bypasses guardrail envelope).
- Catching `GuardrailViolation` and continuing (defeats the guardrail).
