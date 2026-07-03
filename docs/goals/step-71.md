# Step 71 — Phase 10 Terminal: WS Glue

> **Status:** Ready to run
> **Workspace:** `/workspace/codebase/forge-ai/`
> **Duration estimate:** ~3 days
> **Phase:** 10 — Terminal (currently `Planned` in `built-features.yaml`)
> **Goal:** Connect `TerminalPane` to the existing `backend/app/api/ws/terminal.py` WebSocket; flip `Planned` → `Production`

## /goal

Current `built-features.yaml`:

```yaml
- area: Integration
  order: 49
  feature: "Phase 10 — Terminal (PTY sidecar WebSocket)"
  steps: []
  status: Planned                       # ← flip to Production
  docs: lifecycle/terminal
```

The **honest** state (verified this session):

| Layer | State |
|---|---|
| **Backend WS router** in `backend/app/api/ws/terminal.py` (`@router.websocket("/ws/terminal/{session_id}")`) | ✅ Built |
| **PTY process management** in `backend/app/terminal/pty_process.py` | ✅ Built |
| **Session manager** in `backend/app/terminal/session_manager.py` (AgentType, TerminalSession) | ✅ Built |
| **Audit log** in `backend/app/terminal/audit.py` | ✅ Built |
| **Sidecar broadcast** in `backend/app/api/ws/terminal_broadcast.py` | ✅ Built |
| **Frontend page** `apps/forge/app/forge-terminal/page.tsx` (canvas-first layout) | ✅ Built |
| **Frontend components** — 10+ in `apps/forge/components/forge-terminal/` (`TerminalPane`, `SessionTabs`, `LeftRail`, `AuditRail`, `SidecarBanner`, `HelpOverlay`, etc.) | ✅ Built |
| **`useSidecarProbe`** hook — pings the sidecar for reachability | ✅ Built |
| **`useTerminalStore`** — Zustand store for sessions/layout/audit | ✅ Built |
| **`TerminalPane` → WS connection** | 🔴 **Not wired**. The component renders a "Connecting to ws://localhost:4001…" overlay and that's it — no `new WebSocket(...)` call, no message handler |
| **`SessionTabs` → `NewSessionDialog` → backend** | 🔴 New session dialog exists but doesn't call `POST /terminal/sessions` |
| **Sidecar probe → WebSocket handshake** | 🔴 Probe exists; if probe says "unreachable", we never try the WS |

**Goal:** wire `TerminalPane` to `/ws/terminal/{session_id}` with token-via-query-param; wire `NewSessionDialog` to `POST /api/v1/terminal/sessions`; pass auth tokens properly; flip `Planned` → `Production`.

This is the **smallest of the 4 phases** — just glue. ~3 days focused work.

## Files to read FIRST

1. `backend/app/api/ws/terminal.py` — the WS handler (`@router.websocket("/ws/terminal/{session_id}")`)
2. `backend/app/api/ws/terminal_broadcast.py` — the broadcast WS (for audit fanout)
3. `backend/app/terminal/session_manager.py` — `TerminalSession`, `AgentType`
4. `backend/app/terminal/pty_process.py` — `PTYProcess`
5. `apps/forge/components/forge-terminal/TerminalPane.tsx` — current "Connecting to..." overlay
6. `apps/forge/components/forge-terminal/NewSessionDialog.tsx` — current static form
7. `apps/forge/components/forge-terminal/SidecarBanner.tsx` — current probe
8. `apps/forge/hooks/use-sidecar-probe.ts` — existing probe hook
9. `apps/forge/lib/store/index.ts` — `useTerminalStore`
10. `/workspace/docs/features/terminal.md` — feature doc

## ZONE 1 — Auth bridge (token via query param)

The WS endpoint accepts `?token=<JWT>` because `EventSource` and `WebSocket` cannot set custom headers (browser limitation). Verify the current handler accepts it:

```python
@router.websocket("/ws/terminal/{session_id}")
async def terminal_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str | None = Query(default=None),
    ...
):
```

If yes, **mirror this pattern** in the frontend WebSocket constructor:

```typescript
const url = `${WS_BASE}/ws/terminal/${sessionId}?token=${encodeURIComponent(jwt)}`;
const ws = new WebSocket(url);
```

Where to get the JWT: read from the auth store (`useAuthStore().jwt`) or pull from a `/api/auth/me/token` endpoint if not in the store.

## ZONE 2 — `TerminalPane` WS subscriber

In `apps/forge/components/forge-terminal/TerminalPane.tsx`:

```typescript
import { useTerminalStore } from '@/lib/store';

const STAGE = 'terminal.ws.pane';

export function TerminalPane({ sessionId }: { sessionId: string }) {
  const appendOutput = useTerminalStore(s => s.appendOutput);
  const markReady = useTerminalStore(s => s.markSessionReady);
  const markClosed = useTerminalStore(s => s.markSessionClosed);
  const setInputHandler = useTerminalStore(s => s.setInputHandler);

  const wsRef = React.useRef<WebSocket | null>(null);
  const [status, setStatus] = React.useState<'connecting' | 'ready' | 'closed' | 'error'>('connecting');

  React.useEffect(() => {
    const jwt = useAuthStore.getState().jwt;
    const url = `ws://localhost:4001/ws/terminal/${sessionId}?token=${encodeURIComponent(jwt ?? '')}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => setStatus('ready');
    ws.onclose = () => {
      setStatus('closed');
      markClosed(sessionId);
    };
    ws.onerror = () => setStatus('error');

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'ready':
          markReady(sessionId, msg.agent_type);
          break;
        case 'output':
          appendOutput(sessionId, base64ToUtf8(msg.data));
          break;
        case 'audit':
          // Forward to audit rail
          useTerminalStore.getState().pushAuditRow({
            session_id: sessionId,
            kind: msg.kind,
            summary: msg.summary,
            ts: msg.ts,
          });
          break;
        case 'closed':
          setStatus('closed');
          break;
      }
    };

    // Register a sender so SessionTabs / Toolbar can write input
    setInputHandler(sessionId, (data: string) => {
      ws.send(JSON.stringify({
        type: 'input',
        data: btoa(unescape(encodeURIComponent(data))),
      }));
    });

    return () => {
      ws.close();
      setInputHandler(sessionId, null);
    };
  }, [sessionId]);

  // Existing xterm.js setup reads from useTerminalStore
  return <XtermHost status={status} />;
}
```

The `base64ToUtf8` helper:
```typescript
function base64ToUtf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
```

## ZONE 3 — `NewSessionDialog` → backend

In `apps/forge/components/forge-terminal/NewSessionDialog.tsx`:

Replace the static form submit with:

```typescript
const createSession = useMutation({
  mutationFn: (body: { agent_type: AgentType; cwd?: string }) =>
    forgeFetch<{ id: string; agent_type: AgentType }>('/terminal/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  onSuccess: (session) => {
    useTerminalStore.getState().addSession({
      id: session.id,
      agent_type: session.agent_type,
      title: `${session.agent_type} — ${new Date().toISOString().slice(0, 16)}`,
    });
    onClose();
  },
});
```

The backend route `POST /api/v1/terminal/sessions` must exist. If it doesn't, add it to `backend/app/api/v1/terminal.py` (likely missing — verify):

```python
@router.post("/sessions", response_model=TerminalSessionRead, status_code=201)
@audit(action="terminal.session.create", target_type="terminal_session")
async def create_session(
    body: TerminalSessionCreate,
    principal: Principal,
) -> TerminalSessionRead:
    return await session_manager.create(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
        agent_type=body.agent_type,
        cwd=body.cwd,
    )
```

## ZONE 4 — Sidecar probe → ready signal

The existing `useSidecarProbe()` returns `idle | probing | reachable | unreachable`. Wire it to `TerminalPane` so the "Connecting..." overlay only shows when the probe returns `reachable`:

```typescript
const probe = useSidecarProbe();
if (probe.state === 'probing' || probe.state === 'idle') {
  return <ConnectingOverlay message="Probing sidecar..." />;
}
if (probe.state === 'unreachable') {
  return <SidecarBanner unreachable />;
}
// probe.state === 'reachable' → open WS
```

## ZONE 5 — Tests + YAML

### `backend/tests/test_terminal_ws.py` (NEW or extend existing)

```python
@pytest.mark.asyncio
async def test_terminal_ws_roundtrip(websocket_client, principal_steward):
    """WebSocket sends input, server forwards to PTY, PTY echoes, server returns output."""
    session = await create_test_session(principal_steward)
    url = f"/ws/terminal/{session.id}?token={principal_steward.jwt}"
    async with websocket_client.connect(url) as ws:
        msg = await ws.receive_json()
        assert msg["type"] == "ready"
        assert msg["agent_type"] in ("bash", "claude", "codex")

        await ws.send_json({"type": "input", "data": base64.b64encode(b"echo hello\n").decode()})
        # PTY echoes and runs echo; we should see "hello" in output
        seen_hello = False
        for _ in range(10):
            chunk = await ws.receive_json()
            if chunk["type"] == "output":
                text = base64.b64decode(chunk["data"]).decode()
                if "hello" in text:
                    seen_hello = True
                    break
        assert seen_hello, "PTY echo of 'hello' must reach client"
```

### `apps/forge/__tests__/terminal-pane-ws.test.tsx`

Vitest test that mocks `WebSocket` and verifies the `TerminalPane` subscribes on mount, parses `output` messages, and appends to the store.

### `built-features.yaml` flip

```yaml
- area: Integration
  order: 49
  feature: "Phase 10 — Terminal (PTY sidecar WebSocket)"
  steps: ["71"]
  status: Production
  docs: lifecycle/terminal
```

## CONSTRAINTS

- **No schema migration.** WS protocol is locked.
- **Tenant scoping (Rule 2)** — the WS handler must verify `principal.tenant_id` matches `session.tenant_id` before allowing the connection. If the current handler doesn't, **add that check.**
- **Audit emission** — every input/output should generate an audit row (the existing `terminal_audit.py` does this).
- **Don't change the WS protocol.** Backend already settled the message shape (`{type, data, ...}`); frontend parses that.
- **Don't change the 10 existing components' visual layout.** Only the wiring.
- **Don't add a fallback HTTP endpoint.** WS only.
- **Dark theme only.** xterm.js uses existing theme tokens.

## DELIVERABLE

Modified:
- [ ] `apps/forge/components/forge-terminal/TerminalPane.tsx` — WS subscriber
- [ ] `apps/forge/components/forge-terminal/NewSessionDialog.tsx` — `useMutation` to backend
- [ ] `apps/forge/lib/store/terminal.ts` (or wherever `useTerminalStore` lives) — `setInputHandler`, `addSession`, `markReady`, `markClosed`, `appendOutput`, `pushAuditRow`
- [ ] `built-features.yaml` — Planned → Production on Phase 10

Created:
- [ ] `backend/app/api/v1/terminal.py` (NEW if missing) — `POST /sessions` route
- [ ] `backend/tests/test_terminal_ws.py` — WS roundtrip test (extend existing if already there)
- [ ] `apps/forge/__tests__/terminal-pane-ws.test.tsx` (NEW)

Verify:
- [ ] `pytest tests/test_terminal_ws.py -v` — passes
- [ ] `npx vitest run __tests__/terminal-pane-ws` — passes
- [ ] `npx tsc --noEmit` — 0 new errors
- [ ] End-to-end: open `/forge-terminal`, click "New session", pick agent, click "Start" → terminal connects, "ls\n" produces output

## "What we deliberately did NOT do"

- **Did not change the WS protocol.** Backend settled it.
- **Did not add xterm.js theme customization.** Existing dark theme works.
- **Did not implement reconnection logic with exponential backoff.** Add a TODO; defer to a follow-up.
- **Did not add session recording.** The audit log already records commands.
- **Did not change the broadcast WS** (`terminal_broadcast.py`). It's for cross-tab fanout; the pane WS is per-session.

---

**Total scope:** ~3 days focused work for 1 engineer. ~300 lines frontend + ~100 lines backend + ~150 lines tests + 5 lines YAML.

Tell me to ship it. Or name a zone to inspect first.