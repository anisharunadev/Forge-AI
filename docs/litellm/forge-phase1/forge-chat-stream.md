# P5 — Chat Completion (SSE Passthrough)

Feature 4 of step-75. Forge Backend proxies a UI chat request to LiteLLM
`POST /v1/chat/completions` over Server-Sent Events, attaching Forge
metadata, translating every LiteLLM chunk into a typed SSE event, and
recording spend on stream end.

> **Rule 6 hook**: the `metadata` block on every outbound `chat/completions`
> call is the single source of truth that ties an upstream LiteLLM log row
> to a Forge `forge_run_id`. Lose it and audit reconciliation breaks.

## Scope

- In: token streaming, reasoning channels, tool-call events, run
  lifecycle (start/cancel/status), typed error mapping, pre-call budget
  guard, fire-and-forget spend record.
- Out: WebSocket variants, `/v1/responses` long-running mode, MCP tool
  merging. All of these are Phase 2 (see "Out of scope" at the bottom).

## Wire path

```
apps/forge UI ─POST /api/forge/chat/stream─▶ backend/app/api/v1/forge_chat.py
                                                  │
                                                  ▼
                                  backend/app/services/forge_chat.py
                                  (BudgetGuard → VirtualKeyBroker → LiteLLM)
                                                  │
                                          stream: true
                                                  ▼
                                       LiteLLM /v1/chat/completions
                                                  │
                                          SSE chunks back
                                                  ▼
                                  SSE translated events → UI
                                                  │
                                          final usage chunk
                                                  ▼
                              spend recorder + audit row (fire-and-forget)
```

## SSE protocol

### Endpoint

`POST /api/forge/chat/stream` mounted in
`backend/app/api/v1/forge_chat.py:92` (`stream_chat_endpoint`).
Body shape and headers per step-75 §Feature 4: `{ agent_id, messages[],
tools?, tool_choice?, temperature?, max_tokens?, stop?, response_format? }`
plus `X-Forge-Run-Id` (optional; generated when absent).

### Response headers

Set by the `StreamingResponse` at
`backend/app/api/v1/forge_chat.py:142`:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform` — proxies must not buffer.
- `X-Accel-Buffering: no` — disables nginx response buffering so chunks
  reach the UI immediately.
- `Connection: keep-alive`.

### Event names

Each LiteLLM chunk is translated 1:1 into one of these typed events
(implemented in `backend/app/services/forge_chat.py` —
`_chat_stream_iter`):

| Forge SSE event | LiteLLM source field |
|---|---|
| `token` | `choices[].delta.content` |
| `reasoning` | `choices[].delta.reasoning_content` |
| `tool_call` | `choices[].delta.tool_calls` |
| `finish` | `choices[].finish_reason` |
| `usage` | `usage` (final chunk only) |
| `error` | any error chunk |

### Wire format

Each event is two CRLF-terminated lines:

```
event: token
data: {"text": "Hello"}

```

The `usage` event payload is
`{prompt_tokens, completion_tokens, total_tokens, cost_usd}`. The
`error` event payload is `{code, message}` where `code` is one of the
typed names listed under "Typed error mapping" below.

### Streaming rules (from spec)

- First byte to UI within 200 ms of request (AC1: ≤300 ms ceiling).
- No buffering beyond one chunk.
- Backpressure: when the UI is slow, the upstream `httpx` stream is
  paused at the chunk boundary (no overlap with the LiteLLM TCP read).
- Chunks logged at `structlog.debug` only — token content is sensitive
  and never reaches `info` or higher.

## Metadata injection — the Rule 6 auditability hook

Every outbound `POST /v1/chat/completions` carries this metadata block,
set in `backend/app/services/forge_chat.py` before the call:

```python
metadata = {
    "forge_run_id": run_id,
    "forge_agent_id": agent_id,
    "forge_tenant_id": principal.tenant_id,
    "forge_user_id": principal.user_id,
    "forge_team_id": principal.team_id,
}
```

This block is the **only** link between a LiteLLM `/spend/logs` row and
a Forge `spend_records` row. The reconciliation job in P3
(`backend/app/services/forge_spend.py`) joins on `forge_run_id` to detect
drift and fill missing rows. **Stripping any field is an audit break.**

The same `forge_run_id` is also set as `user=` on the LiteLLM request for
spend-attribution fallback, and as the `X-Forge-Run-Id` response header
so the UI can correlate without parsing the body.

## Pre-call budget guard

Before the outbound LiteLLM call, `BudgetGuard.check_pre_call()` runs
(`backend/app/services/forge_budget_guard.py:131`). It:

1. Resolves the active virtual key for the agent.
2. Compares `key.spend_usd + estimated_cost_usd` against
   `key.max_budget_usd` (or the per-agent ceiling from
   `forge_key_broker.py:49`).
3. On exceedance, raises `BudgetExceeded` — translated by the router
   to a `402` SSE error event (see below) **before** any upstream bytes
   are read.

This guard runs synchronously on the request path; cost ≤5 ms on warm
cache (the `key.spend_usd` value is refreshed by `budget_sync.py` every
60 s).

## Typed error mapping

Defined in `backend/app/services/forge_chat_errors.py` and applied in
`stream_chat_endpoint`. Each typed exception maps to one SSE event with
`code` set to the typed name, plus the originating HTTP status:

| Typed exception | HTTP | SSE `code` | Notes |
|---|---|---|---|
| `AuthenticationError` | 401 | `authentication_error` | Re-resolves virtual key once; if still 401, surfaces to UI |
| `BudgetExceeded` | 402 | `budget_exceeded` | Emitted by pre-call guard; agent panel badge |
| `ContextLengthExceeded` | 413 | `context_length_exceeded` | Suggests summarization in `message` |
| `GuardrailViolation` | 422 | `guardrail_violation` | Phase 2; placeholder for now |
| `RateLimitError` | 429 | `rate_limit_error` | Message carries retry-after hint |
| `UpstreamError` | 502 | `upstream_error` | LiteLLM 5xx; retried up to 3× internally before surfacing |
| `ValidationError` | 400 | `validation_error` | Field-level details in `message` |

AC8 requires that budget-exceeded and rate-limit errors never surface as
raw 500s — every typed exception lands on the SSE channel with a stable
`code` so the UI can branch on it.

## Cancel-on-disconnect

The stream iterator in `backend/app/services/forge_chat.py` runs inside
an `asyncio` task tied to the request. On client disconnect:

1. FastAPI raises `asyncio.CancelledError` into the generator.
2. The generator's `finally` block calls `cancel_run(run_id)` which:
   - Closes the local SSE stream (drops the `httpx` response).
   - Best-effort `POST /v1/responses/{id}/cancel` against LiteLLM if the
     call has been backgrounded (response id available in chunk 0).
3. The run registry marks the run `cancelled` so subsequent
   `GET /forge/chat/runs/{run_id}` returns the terminal status.

AC4 requires **no orphaned upstream requests** — disconnect → cancel is
synchronous from the client's perspective; the upstream cancel is fire-
and-forget and does not block the 499 response.

## Spend recording

On the final `usage` SSE chunk:

1. Cost is computed: `cost_usd = (prompt_tokens / 1000) * input_cost_per_1k + (completion_tokens / 1000) * output_cost_per_1k`,
   using the cached cost map (see `forge_spend.py`).
2. A `spend_records` row is written with `litellm_request_id` as the
   idempotency key.
3. A `forge.chat.completed` audit row is emitted (Rule 6) carrying
   `{agent, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, run_id}`.

Steps 2 and 3 run on a fire-and-forget `asyncio.create_task` so the SSE
`finish` event reaches the UI without waiting for the DB write. The
task is bounded by a 5 s timeout — anything slower logs a warning and
relies on the 5-minute reconciliation sweep to backfill.

## API contract (3 endpoints)

All three are mounted on the `router` from
`backend/app/api/v1/forge_chat.py:44` with prefix `/forge`:

| Method | Path | Purpose |
|---|---|---|
| POST | `/forge/chat/stream` | SSE stream of a chat completion for an agent |
| POST | `/forge/chat/cancel` | Abort an in-flight stream by `run_id` |
| GET | `/forge/chat/runs/{run_id}` | Durable status lookup (synchronous) |

The `GET /forge/chat/runs/{run_id}` response includes `status` ∈
`{queued, streaming, completed, cancelled, errored}` plus token totals
and cost for runs that have already produced a `usage` chunk. This is
the polling companion to the SSE stream for clients that reattach after
a network blip.

The WS variant `/api/forge/chat/ws` listed in step-75 §Feature 4
"Backend contract" is **explicitly out of scope** for P5 — see "Out of
scope" below.

## Acceptance evidence (AC1–AC6 → tests)

| AC | Spec line | Test |
|---|---|---|
| AC1: first token ≤300 ms | step-75:287 | `tests/api/test_forge_chat_router.py::test_stream_first_byte_under_300ms` |
| AC2: tool calls as discrete events | step-75:288 | `tests/api/test_forge_chat_router.py::test_tool_call_event_separate_from_token` |
| AC3: reasoning streams separately | step-75:289 | `tests/api/test_forge_chat_router.py::test_reasoning_event_separate_channel` |
| AC4: disconnect cancels upstream | step-75:290 | `tests/api/test_forge_chat_router.py::test_disconnect_triggers_upstream_cancel` |
| AC5: 1000-token response <5 s | step-75:291 | `tests/api/test_forge_chat_router.py::test_1k_token_e2e_under_5s` |
| AC6: master/virtual key never in payload | step-75:292 | `tests/api/test_forge_chat_router.py::test_no_key_in_sse_payload` |

AC7 (audit row per chat) is covered by
`tests/services/test_forge_spend.py` (P3); AC8 (typed error surfacing) is
covered by `tests/api/test_forge_chat_router.py::test_typed_error_codes`.

## Out of scope (Phase 2)

- **WS variant** — `/api/forge/chat/ws` (step-75 mentions it; P5 ships
  SSE only; WS is a thin re-wrap of the same iterator).
- **`/v1/responses` long-running mode** — the `POST /v1/responses`
  endpoint with background poll and `POST /responses/{id}/input_items`
  resume are deferred; the cancel hook above is a thin shim for when it
  lands.
- **MCP tool merging** — `tools[]` in the request body is passed through
  verbatim in P5; static agent tools are merged, MCP-derived tools are
  not. Phase 2 will own the MCP tool registry and merge order
  (per step-75 §Feature 4 step 2).

## Files touched

- `backend/app/api/v1/forge_chat.py` — router + SSE `StreamingResponse`
- `backend/app/services/forge_chat.py` — stream iterator, metadata block,
  budget guard hookup, cancel, run registry
- `backend/app/services/forge_chat_errors.py` — typed exceptions and
  HTTP/SSE mapping
- `backend/app/services/forge_budget_guard.py` — `check_pre_call` entry
- `backend/app/services/forge_spend.py` — usage-chunk write path
- `tests/api/test_forge_chat_router.py` — AC1–AC6 + AC8 evidence
- `docs/litellm/forge-phase1/forge-chat-stream.md` — this doc