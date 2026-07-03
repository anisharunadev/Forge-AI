# Step 70 — Phase 9 Co-pilot: SSE Streaming

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~1 week (6 zones)
> **Phase:** 9 — Co-pilot (currently `Beta` in `built-features.yaml`)
> **Goal:** Add token-level SSE streaming to the chat endpoint; frontend renders tokens as they arrive; flip `Beta` → `Production`

## /goal

The current `built-features.yaml` state:

```yaml
- area: Workspace
  order: 2
  feature: Co-pilot
  steps: ["19", "24", "37"]
  status: Beta                          # ← flip to Production
  docs: workspace/co-pilot

- area: Integration
  order: 48
  feature: "Phase 9 — Co-pilot (chat + streaming + V1 tools)"
  steps: []
  status: Beta                          # ← flip to Production
  docs: workspace/co-pilot
```

The **honest** reason for `Beta` (verified this session):

| Layer | State |
|---|---|
| **Backend: 7 routes** in `backend/app/api/v1/copilot.py` | ✅ Built (POST conversations, GET list, GET detail, DELETE, POST feedback, GET tools, GET cost) |
| **Backend: schemas** — `CopilotChatRequest`, `CopilotChatResponse`, `CopilotMessageRead`, `CopilotConversationRead`, `CopilotToolRead`, `CopilotCitation`, `CopilotToolCall`, `CopilotSuggestedAction` | ✅ Built in `schemas/copilot.py` |
| **Backend: `CopilotService.chat()`** — full pipeline (history, tool loop, LLM call, citations, persistence) | ✅ Built in `services/copilot_service.py` |
| **Backend: 11 V1 tools** registered in tool registry | ✅ Built (per `test_tools.py` docstring) |
| **Backend: SSE streaming** | 🔴 **Missing**. `chat()` is one-shot: builds full `assistant_text`, returns `CopilotChatResponse` |
| **Backend: precedent for SSE** | ✅ `runs.py` already has `StreamingResponse` for SDLC runs (see Zone 2) |
| **Frontend: `lib/api/copilot.ts`** — typed client for 7 routes, 25+ types | ✅ Built |
| **Frontend: `hooks/use-copilot.ts` + `use-copilot-mutations.ts`** — TanStack hooks for queries + mutations | ✅ Built |
| **Frontend: 5 components** — `CopilotPanel`, `CopilotLauncher`, `CopilotHeader`, `ComposerInput`, `MessageList`, `EmptyState`, `ErrorBanner`, `PermissionDeniedBanner`, `DraftReviewModal`, `CommandConfirmModal`, `HistoryPanel` | ✅ Built |
| **Frontend: `ComposerInput`** has `setStreaming(true)` and `sendMessage.mutate(...)` | ⚠️ Streaming UX is wired but no stream comes back. The flag is set optimistically, the mutation is awaited, content lands all-at-once |
| **Frontend: `/copilot` fullscreen page** | ✅ Built |

**Goal:** ship a real `text/event-stream` chat endpoint that emits tokens as they arrive, plus the frontend EventSource consumer that renders them token-by-token. Flip both rows to `Production`.

## Why streaming matters

Co-pilot answers are typically 200-1500 tokens. At ~30 tokens/sec, that's 7-50 seconds per response. Without streaming, the user sees a frozen UI for 7-50 seconds. With streaming, the response starts painting within 200-400ms and finishes in lockstep with the model. This is the single biggest perceived-latency win available.

The frontend **already pretends to stream** (`setStreaming(true)`), so the bug is visible — the user sees a "thinking…" state for 7 seconds, then the answer appears in one shot. That's worse than honest because it looks like the model is slow.

## What you'll see after this step

- Type a question in the Co-pilot FAB → first token appears in the assistant bubble within 400ms
- Each subsequent token paints as the model generates it
- Citations and tool-call chips appear in order as the model surfaces them (not all at the end)
- Cost + token counts stream as the final SSE event (after `event: done`)
- Refreshing the conversation still loads the full transcript (we persist the same way)
- `pytest tests/api/ -k copilot` — 1 new SSE test passes, no regression in 11 tool tests
- `npx tsc --noEmit` — 0 new errors
- `built-features.yaml` reads `Production` on rows 2 and 48

## What you'll NOT see (out of scope, deliberately)

- **Streaming tool execution.** Tool calls still happen synchronously (in-process); only the final LLM summarization step streams. A future step can stream the tool loop.
- **Streaming citations live-updates.** Citations appear in the final `done` event, not token-by-token (we'd need the model to emit them inline; out of scope).
- **Multi-message parallel streams.** One user → one stream. The existing `conversation_id` flow already serializes.
- **WebSocket alternative.** We ship SSE only. WebSocket would add bidirectional overhead for no current benefit.
- **Resume / replay from offset.** The stream is fire-and-forget. If the user closes the panel mid-stream, they get whatever was rendered.
- **Refactor the 11 tools.** All 11 V1 tools keep their existing contract; only the LLM call path changes.
- **V2 tools.** Not in scope.

## Files to read FIRST (in this order)

1. This file
2. `/workspace/prompts/step66-phase4-production.md` — same SSE precedent (Workflows + Runs)
3. `/workspace/prompts/step64-explainability-slack-knowledge.md` — previous Phase 9 sibling prompt
4. `backend/app/services/copilot_service.py` — find the `_call_llm` method, the place where `assistant_text` is built
5. `backend/app/api/v1/runs.py` — the `StreamingResponse` precedent (search for `_sse_format`, `_state_to_response`, `_gen()`)
6. `backend/app/api/v1/copilot.py` — the route that calls `service.chat(request)` (search for `post_chat`)
7. `backend/app/schemas/copilot.py` — `CopilotChatRequest`, `CopilotChatResponse` shapes
8. `backend/app/services/_litellm_tools.py` — the LiteLLM call wrapper (search for `acompletion`, `streaming`)
9. `apps/forge/components/copilot/ComposerInput.tsx` — see `setStreaming(true)` + `sendMessage.mutate(...)`
10. `apps/forge/components/copilot/MessageList.tsx` — see how `Message` is rendered (we'll patch this for streaming)
11. `apps/forge/hooks/use-copilot-mutations.ts` — see `useSendMessage()` (we'll add `useStreamMessage()`)
12. `apps/forge/lib/api/copilot.ts` — see `sendMessage()` (we'll add `streamMessage()`)
13. `/workspace/docs/features/co-pilot.md` — feature doc; update if behavior changes

## ZONE 1 — Backend: add streaming variant of the LLM call

The `CopilotService.chat()` is one-shot. We need a **streaming variant** that yields `AsyncIterator[str]` of assistant text chunks, then yields one final `CopilotChatResponse`-shaped envelope with citations + cost.

**Two options:**

### Option A — `async def stream_chat()` returns `AsyncIterator[bytes]`

Add a sibling method to `CopilotService` that:

1. Does the same prep (history, budget, tool loop pre-flight) as `chat()`
2. Calls the LLM with `stream=True`
3. Yields each chunk as it arrives
4. Yields a final envelope with citations, cost, tool calls, message_id, conversation_id

This duplicates ~70% of `chat()`. The cleanest version is a refactor where `chat()` calls `stream_chat()` and aggregates the iterator. **Don't do that in this step** — too risky. Just add a sibling method.

### Option B — Yield progressively, share the persistence path

A middle ground: add a generator that wraps the existing pipeline:

```python
async def stream_chat(self, request: CopilotChatRequest) -> AsyncIterator[dict[str, Any]]:
    """Same pipeline as chat() but yields SSE-shaped dicts as we go."""
    # ... same prep as chat() ...
    
    # Stream the final LLM call (after tool loop, if any)
    accumulated_text = ""
    stream = await litellm.acompletion(  # pass stream=True
        model=...,
        messages=...,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            accumulated_text += delta
            yield {"event": "token", "data": delta}
    
    # Persist the full message (same as chat())
    # ...
    
    # Final envelope
    yield {
        "event": "done",
        "data": {
            "conversation_id": str(conversation.id),
            "message_id": str(assistant_message.id),
            "content": accumulated_text,
            "citations": [...],
            "tool_calls": [...],
            "suggested_actions": [...],
            "confidence": assistant_message.confidence,
            "cost_usd": str(cost_usd),
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "model": model,
            "latency_ms": latency_ms,
        },
    }
```

**My recommendation: Option B.** The yield format is the SSE wire format. The route handler just wraps the iterator.

## ZONE 2 — Backend: new `POST /api/v1/copilot/conversations:stream` route

Add a new route that consumes `CopilotChatRequest` and returns `StreamingResponse`. **Don't modify the existing `POST /conversations`** — the one-shot path still works for non-streaming clients (e.g. CLI, future programmatic consumers).

```python
# In backend/app/api/v1/copilot.py

import asyncio
import json
from collections.abc import AsyncIterator
from fastapi.responses import StreamingResponse

def _sse_format(payload: dict[str, Any]) -> bytes:
    """Format a dict as a single SSE ``data:`` line.

    The frontend EventSource expects a JSON string per line.
    """
    return f"data: {json.dumps(payload, default=str)}\n\n".encode("utf-8")


@router.post(
    "/conversations:stream",
    response_class=StreamingResponse,
    responses={
        200: {"content": {TEXT_EVENT_STREAM: {}}},
    },
)
@audit(action="copilot.conversation.chat.stream", target_type="copilot_conversation")
async def post_chat_stream(
    request: CopilotChatRequest,
    db: DbSession,
    principal: AuthenticatedPrincipal = Depends(require_permission(COPILOT_PERMISSION_USE)),
) -> StreamingResponse:
    """Stream one chat turn as Server-Sent Events.

    Wire format (one JSON payload per ``data:`` line):

        data: {"event":"token","data":"Hello"}
        data: {"event":"token","data":" there"}
        data: {"event":"done","data":{ full CopilotChatResponse }}

    The first event is always ``{"event": "start", "data": {"conversation_id": ...}}``
    so the frontend can allocate the assistant bubble before any token arrives.

    On error, an event of shape ``{"event": "error", "data": {"message": ...}}``
    is emitted and the stream closes.
    """
    _ensure_enabled()

    service = _service(principal, db)

    async def _gen() -> AsyncIterator[bytes]:
        try:
            # Yield start event with conversation_id as soon as we know it
            conversation_id = await service.peek_conversation_id(
                request.conversation_id, request.project_id
            )
            yield _sse_format({
                "event": "start",
                "data": {"conversation_id": str(conversation_id)},
            })

            # Stream the actual chat
            async for event in service.stream_chat(request):
                yield _sse_format(event)

        except CopilotBudgetBlocked as exc:
            yield _sse_format({
                "event": "error",
                "data": {"code": "budget_blocked", "message": str(exc)},
            })
        except RateLimitExceeded as exc:
            yield _sse_format({
                "event": "error",
                "data": {"code": "rate_limited", "message": str(exc)},
            })
        except Exception as exc:  # noqa: BLE001
            logger.exception("copilot.stream.error", exc_info=exc)
            yield _sse_format({
                "event": "error",
                "data": {"code": "internal", "message": str(exc)[:200]},
            })

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )
```

`peek_conversation_id()` is a tiny helper that does the conversation lookup without persisting anything:

```python
async def peek_conversation_id(
    self,
    conversation_id: UUID | None,
    project_id: UUID | None,
) -> UUID:
    if conversation_id is not None:
        # Verify it exists + belongs to caller (tenant check is implicit via service principal)
        conv = await self._get_conversation(conversation_id)
        return conv.id
    # New conversation — generate the id without saving yet
    return uuid4()
```

This lets the frontend show "thinking…" with a stable `conversation_id` placeholder even before the LLM call starts.

## ZONE 3 — Frontend: `streamMessage()` client

In `apps/forge/lib/api/copilot.ts`, add:

```typescript
/**
 * SSE consumer for `POST /api/v1/copilot/conversations:stream`.
 *
 * Returns an AbortController so the caller can cancel mid-stream
 * (e.g. user closes the panel, navigates away).
 */
export interface CopilotStreamEvent {
  event: 'start' | 'token' | 'done' | 'error';
  data:
    | { conversation_id: string }
    | string
    | CopilotChatResponse
    | { code: string; message: string };
}

export function streamMessage(
  req: CopilotChatRequest,
  onEvent: (event: CopilotStreamEvent) => void,
  tenantId: string = SEED_TENANT_ID,
): AbortController {
  const controller = new AbortController();
  void (async () => {
    try {
      const res = await forgeFetch<Response>(
        '/copilot/conversations:stream',
        {
          method: 'POST',
          body: JSON.stringify(req),
          tenantId,
          stream: true,  // forgeFetch flag — see Zone 3a
          signal: controller.signal,
        } as any,
      );
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE messages are separated by \n\n
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = raw.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()));
          } catch (err) {
            console.error('copilot.stream.parse_error', err, line);
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        onEvent({
          event: 'error',
          data: { code: 'network', message: String(err) },
        });
      }
    }
  })();
  return controller;
}
```

The `stream: true` flag on `forgeFetch` is the existing pattern from `useApiData` consumers; verify by looking at how `lib/api/copilot.ts` already uses `forgeFetch`. If it doesn't support `stream`, fall back to `fetch()` directly.

## Zone 3a — `forgeFetch` stream support (if missing)

If `forgeFetch` doesn't support `stream: true`, add it. Look at `apps/forge/lib/forge-api.ts`. The change is small: when `init.stream` is true, return the raw `Response` instead of calling `.json()`. This is a 5-line change.

## ZONE 4 — Frontend: `useStreamMessage()` hook

In `apps/forge/hooks/use-copilot-mutations.ts`, add:

```typescript
import { streamMessage, type CopilotStreamEvent } from '@/lib/api/copilot';

export interface StreamMessageArgs {
  conversation_id: string | null;
  project_id: string | null;
  message: string;
  context: CopilotPageContext;
}

/**
 * Token-by-token stream consumer for the chat endpoint.
 *
 * The hook returns a `send` function and live state for the
 * assistant bubble. Callers (ComposerInput, MessageList) subscribe
 * to the state and render progressively.
 */
export function useStreamMessage() {
  const qc = useQueryClient();
  const [streaming, setStreaming] = React.useState(false);
  const [streamedText, setStreamedText] = React.useState<string>('');
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const conversationIdRef = React.useRef<string | null>(null);

  const send = React.useCallback(
    async (args: StreamMessageArgs): Promise<CopilotChatResponse | null> => {
      setStreaming(true);
      setStreamedText('');
      setError(null);

      const acc: CopilotChatResponse | null = { /* partial */ } as any;
      let finalResponse: CopilotChatResponse | null = null;

      return new Promise((resolve) => {
        const controller = streamMessage(
          args,
          (event: CopilotStreamEvent) => {
            switch (event.event) {
              case 'start':
                conversationIdRef.current = (event.data as { conversation_id: string }).conversation_id;
                break;
              case 'token':
                setStreamedText(prev => prev + (event.data as string));
                break;
              case 'done':
                finalResponse = event.data as CopilotChatResponse;
                qc.invalidateQueries({ queryKey: ['copilot-conversations'] });
                if (finalResponse) {
                  qc.invalidateQueries({ queryKey: ['copilot-conversation', finalResponse.conversation_id] });
                }
                break;
              case 'error':
                setError(event.data as { code: string; message: string });
                break;
            }
          },
        );
        abortRef.current = controller;

        // Resolve when stream closes (after 'done' or 'error')
        const checkClosed = setInterval(() => {
          if (finalResponse || error) {
            clearInterval(checkClosed);
            setStreaming(false);
            resolve(finalResponse);
          }
        }, 100);
      });
    },
    [qc, error],
  );

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  return { send, cancel, streaming, streamedText, error };
}
```

This is a **rough** shape. The actual implementation may need to be tighter — but the contract is: `send(args)` returns the final `CopilotChatResponse` after the stream closes; `streamedText` updates live; `cancel()` aborts.

## ZONE 5 — Wire `ComposerInput` + `MessageList` to streaming

In `apps/forge/components/copilot/ComposerInput.tsx`:

```typescript
// Before
const sendMessage = useSendMessage();
// ...
sendMessage.mutate(
  { ...request body... },
  {
    onSuccess: (response) => {
      // content lands in one shot
    },
  },
);

// After
const { send, cancel, streaming, streamedText, error } = useStreamMessage();
// ...
const handleSubmit = async () => {
  setStreaming(true);
  setError(null);
  await send({
    conversation_id: activeConversationId,
    project_id: null,
    message: trimmed,
    context: { ... },
  });
  setStreaming(false);
};
```

In `apps/forge/components/copilot/MessageList.tsx`:

The list renders `Message[]` (read from the conversation cache). For an in-flight assistant message, it should render the streamed text from `useStreamMessage().streamedText` instead. This requires lifting the streamed text to a context or a store. The cleanest version:

```typescript
// New store: apps/forge/lib/store/copilot-stream.ts
interface CopilotStreamState {
  // Map of conversation_id -> in-flight streamed text
  streams: Record<string, string>;
  append: (conversationId: string, delta: string) => void;
  clear: (conversationId: string) => void;
}
export const useCopilotStreamStore = create<CopilotStreamState>(...);
```

`useStreamMessage` writes to this store; `MessageList` reads from it. When the stream's `done` event fires, the conversation cache invalidates and the full message appears in `MessageList` from the cache (the streamed text was already saved by the backend).

**Important:** the backend's existing `chat()` already persists the assistant message. `stream_chat()` should do the same. So the `done` event is just "the message is now in the DB; refresh the conversation cache."

## ZONE 6 — Tests + YAML

### `backend/tests/copilot/test_streaming.py` (NEW)

```python
"""SSE streaming test for Co-pilot chat.

We test the wire format, not the LLM — we mock litellm.acompletion
to yield 3 tokens and verify the SSE output is correct.
"""

import pytest
import json


@pytest.mark.asyncio
async def test_chat_stream_emits_sse_events(
    client, principal_steward, monkeypatch
):
    """POST /copilot/conversations:stream yields start → token×3 → done."""

    # Mock the LLM to return 3 deterministic chunks
    async def fake_stream(**kwargs):
        for chunk_text in ['Hello', ' there', ' world']:
            yield _mock_chunk(chunk_text)

    monkeypatch.setattr(
        'app.services.copilot_service.litellm.acompletion',
        fake_stream,
    )

    # Use a raw ASGI call so we can read the streamed body
    response = await client.post(
        '/api/v1/copilot/conversations:stream',
        json={
            'message': 'Hi',
            'context': {
                'current_page': '/copilot',
                'current_center': None,
                'current_artifact_id': None,
                'recent_actions': [],
            },
        },
        headers=auth_headers(principal_steward),
    )
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/event-stream')

    body = response.text
    lines = [l for l in body.split('\n') if l.startswith('data:')]

    # Parse each line; first is start, then 3 tokens, then done
    events = [json.loads(l[5:].strip()) for l in lines]
    assert events[0]['event'] == 'start'
    assert 'conversation_id' in events[0]['data']

    token_events = [e for e in events if e['event'] == 'token']
    assert len(token_events) == 3
    assert ''.join(e['data'] for e in token_events) == 'Hello there world'

    done = [e for e in events if e['event'] == 'done']
    assert len(done) == 1
    assert done[0]['data']['content'] == 'Hello there world'


def _mock_chunk(text):
    class _Choice:
        delta = type('Delta', (), {'content': text})()
    class _Chunk:
        choices = [_Choice()]
    return _Chunk()
```

### `apps/forge/__tests__/copilot-streaming.test.tsx`

Vitest test for the EventSource consumer. Mock the SSE endpoint, verify `streamedText` updates after each event.

### `built-features.yaml` flip

```yaml
- area: Workspace
  order: 2
  feature: Co-pilot
  steps: ["19", "24", "37", "70"]
  status: Production
  docs: workspace/co-pilot

- area: Integration
  order: 48
  feature: "Phase 9 — Co-pilot (chat + streaming + V1 tools)"
  steps: ["70"]
  status: Production
  docs: workspace/co-pilot
```

## CONSTRAINTS

- **No schema migration.** Pydantic schemas stay; we add wire-format dicts.
- **Don't break the existing `POST /conversations` route.** It's the one-shot path used by CLI and programmatic consumers.
- **Tenant scoping (Rule 2)** — the SSE route uses the same `principal.tenant_id` as the existing one-shot route.
- **Audit emission** — the new stream route emits `copilot.conversation.chat.stream` (vs the existing `copilot.conversation.chat`).
- **No buffering** — emit `X-Accel-Buffering: no` and `Cache-Control: no-cache` headers. Otherwise nginx (or any reverse proxy) will buffer the stream and the user sees nothing for 30 seconds.
- **Token + cost persistence** — `stream_chat()` persists the same way `chat()` does. The full message lands in `CopilotMessage` at the end. Refreshing the conversation after the stream closes must show the same content.
- **Don't refactor the 11 V1 tools.** Their contract is locked; only the LLM call path changes.
- **Don't change the existing frontend `useSendMessage()` mutation.** It's still used for non-streaming consumers (e.g. a future "send a fixed question" CLI). The new `useStreamMessage()` is a sibling.
- **Dark theme only** — the streaming cursor uses `--accent-cyan` (the existing typing-indicator color).

## DELIVERABLE

Modified:
- [ ] `backend/app/services/copilot_service.py` — add `stream_chat()` and `peek_conversation_id()`
- [ ] `backend/app/api/v1/copilot.py` — add `POST /conversations:stream` + `_sse_format()` helper
- [ ] `apps/forge/lib/api/copilot.ts` — add `streamMessage()` + `CopilotStreamEvent` type
- [ ] `apps/forge/lib/forge-api.ts` — add `stream: true` support to `forgeFetch` (if missing)
- [ ] `apps/forge/hooks/use-copilot-mutations.ts` — add `useStreamMessage()`
- [ ] `apps/forge/lib/store/copilot-stream.ts` — new store for in-flight streams
- [ ] `apps/forge/components/copilot/ComposerInput.tsx` — wire to `useStreamMessage()`
- [ ] `apps/forge/components/copilot/MessageList.tsx` — render streamed text from store
- [ ] `built-features.yaml` — flip rows 2 + 48 to `Production`

Created:
- [ ] `backend/tests/copilot/test_streaming.py` (NEW)
- [ ] `apps/forge/__tests__/copilot-streaming.test.tsx` (NEW)

Verify:
- [ ] `pytest tests/copilot/ -v` — all pass (11 tool tests + 1 new streaming test)
- [ ] `pytest tests/api/ -k copilot -v` — HTTP layer green
- [ ] `npx vitest run __tests__/copilot-streaming` — passes
- [ ] `npx tsc --noEmit` — 0 new errors
- [ ] `bash scripts/generate-built-features.sh --check` — no drift
- [ ] `python3 scripts/check-feature-docs.py` — 41 passed, 0 missing
- [ ] End-to-end: open Co-pilot FAB, type "what is forge-ai?", verify tokens appear within 400ms; final message persists across refresh

## "What we deliberately did NOT do"

- **Did not stream tool execution.** Only the final LLM call streams. Tool calls are synchronous (in-process).
- **Did not stream citations live.** Citations appear in the `done` event, not token-by-token.
- **Did not add WebSocket.** SSE only.
- **Did not refactor `chat()` to call `stream_chat()`.** Sibling methods; risky refactor deferred.
- **Did not add resume-from-offset.** Fire-and-forget stream.
- **Did not change the 11 tools.** Their contract is locked.
- **Did not change `useSendMessage()`.** It's still the one-shot path; `useStreamMessage()` is the new streaming path.

---

**Total scope:** ~1 week focused work for 1 engineer. ~600 lines backend + ~400 lines frontend + ~250 lines tests + 50 lines YAML.

This is the **highest-UX-impact step** in the pipeline. Single biggest perceived-latency win. The frontend already has `setStreaming(true)` so users are already expecting streaming; we just need to actually deliver it.

Tell me to ship it and I'll walk zones in order: **1 (backend stream_chat) → 2 (SSE route) → 3 (streamMessage client) → 4 (useStreamMessage hook) → 5 (ComposerInput + MessageList) → 6 (tests + YAML)**. Or tell me which zone to inspect first.