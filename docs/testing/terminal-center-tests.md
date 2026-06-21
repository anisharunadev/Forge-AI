# Forge AI — Terminal Center Test Approach

> Status: Phase 11 / T14
> Linked: NFR-005 (workspace isolation), NFR-008 (audit trail), `apps/forge/components/terminal/`, `backend/app/terminal/`

The Terminal Center is a *high-stakes* surface: a real PTY running real commands with real filesystem access, scoped per workspace, audited per keystroke. Tests must prove three things:

1. **Isolation** — a command in tenant A can never see, read, write, or signal tenant B.
2. **Audit** — every command is recorded with a verifiable hash chain.
3. **UX** — the frontend renders the PTY stream faithfully and responsively.

## 1. Backend — real PTY in tests

We do **not** mock the PTY. A mocked PTY is a lie. We spawn a real `bash` in a real pseudo-terminal.

```python
# backend/app/terminal/tests/test_pty_isolation.py

import pty, os, select, time

@pytest.fixture
def workspace(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "README.md").write_text("hello")
    return ws

def test_pty_starts_in_workspace_cwd(workspace):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(workspace)
        os.execvp("bash", ["bash"])
    # parent: read prompt
    buf = read_until(fd, b"$", timeout=2)
    assert b"/tmp" in buf or b"bash" in buf  # we're somewhere

    os.write(fd, b"pwd\n")
    out = read_until(fd, b"$", timeout=2)
    assert str(workspace).encode() in out
```

### 1.1 Workspace isolation

```python
def test_pty_cannot_escape_workspace_via_cd_dotdot(workspace):
    pid, fd = spawn_pty_in(workspace)
    os.write(fd, b"cd ../../../etc\n")
    os.write(fd, b"pwd\n")
    out = read_until(fd, b"$", timeout=2)
    # PTY should have re-chdir'd back to workspace after each command
    assert str(workspace).encode() in out
    assert b"/etc" not in out
```

We also test symlink escape:

```python
def test_pty_cannot_follow_symlink_outside_workspace(workspace, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("nope")
    (workspace / "link").symlink_to(outside)
    pid, fd = spawn_pty_in(workspace)
    os.write(fd, b"cat link/secret.txt\n")
    out = read_until(fd, b"$", timeout=2)
    assert b"nope" not in out  # must be denied
    assert b"denied" in out or b"No such file" in out
```

### 1.2 WebSocket protocol

The backend exposes a WebSocket. We test it with an in-process ASGI client (`httpx-ws`).

```python
async def test_websocket_send_command_returns_output_frame(app):
    async with httpx_ws_connect(app, "/api/v1/terminal/ws?workspace=ws-1") as ws:
        await ws.send_json({"type": "input", "data": "echo hello\n"})
        frame = await ws.receive_json()
        assert frame["type"] == "output"
        assert "hello" in frame["data"]
```

Frame types we test:

| Frame `type` | Direction  | Tests                                                          |
|--------------|------------|----------------------------------------------------------------|
| `output`     | server → client | plain text, ANSI escape codes, large buffers, binary-safe   |
| `exit`       | server → client | exit code is included, fires exactly once                    |
| `resize`     | client → server | server re-issues `TIOCSWINSZ`                                 |
| `signal`     | client → server | SIGINT, SIGTERM; both reach the bash process                  |
| `error`      | server → client | includes a stable error code, never leaks internals           |

### 1.3 Audit trail

Every command — successful or failed — produces an audit row with a content hash. The hash chain must be tamper-evident.

```python
async def test_audit_trail_records_every_command(app, audit_sink):
    async with httpx_ws_connect(app, "/api/v1/terminal/ws?workspace=ws-2") as ws:
        await ws.send_json({"type": "input", "data": "echo secret\n"})
        await ws.send_json({"type": "input", "data": "exit\n"})

    rows = await audit_sink.fetchall()
    assert len(rows) == 2
    for row in rows:
        assert row.workspace_id == "ws-2"
        assert row.command_hash.startswith("sha256:")
        assert row.prev_hash is not None  # chain link

def test_audit_chain_breaks_when_row_tampered(audit_sink):
    await audit_sink.tamper(row_id=1, field="command", value="echo fake")
    with pytest.raises(AuditChainBroken):
        await audit_sink.verify_chain()
```

## 2. Frontend — xterm.js rendering

### 2.1 Snapshot rendering

Use `happy-dom` to render `<Terminal />`, then snapshot the rendered DOM structure and a recording of the bytes that the PTY adapter would have written.

```typescript
// apps/forge/components/terminal/__tests__/Terminal.snapshot.test.tsx

import { Terminal } from '../Terminal';
import { fixturePtyStream } from './fixtures/long-output';

it('renders long output without layout shift', async () => {
  const { container } = render(
    <Terminal workspaceId="ws-1" sessionId="s-1" />,
    { wrapper: happyDomWrapper }
  );
  await fixturePtyStream.write('long-output.bin');
  expect(container).toMatchSnapshot();
});
```

### 2.2 Tab / split layout

```typescript
describe('TerminalLayout', () => {
  it('supports horizontal split when the user clicks split-right', async () => {
    const { getByRole } = render(<TerminalLayout />);
    await userEvent.click(getByRole('button', { name: /split right/i }));
    expect(getByRole('region', { name: /terminal pane 2/i })).toBeInTheDocument();
  });

  it('closes a pane and redistributes remaining panes', async () => { ... });

  it('persists layout across reloads via localStorage', async () => { ... });
});
```

### 2.3 State management

Terminal state is in a Zustand store. We test the store directly:

```typescript
// apps/forge/state/terminal.test.ts

describe('terminalStore', () => {
  it('buffers 4 KiB per pane without dropping frames', () => {
    const store = useTerminalStore.getState();
    store.appendOutput('p1', 'x'.repeat(10_000));
    expect(useTerminalStore.getState().buffers.p1.length).toBe(4096);
  });

  it('dispatches output to the correct pane based on session id', () => { ... });
  it('clears the buffer on user clear', () => { ... });
});
```

## 3. End-to-end (Playwright)

The end-to-end test proves the round-trip works in a real browser against a real backend.

```typescript
// apps/forge/e2e/terminal.spec.ts

import { test, expect } from '@playwright/test';

test('user can open terminal, run ls, see output, and the audit row exists', async ({ page, request }) => {
  await login(page);
  await page.goto('/workspaces/ws-1');

  await page.getByRole('button', { name: /open terminal/i }).click();
  const term = page.getByRole('region', { name: /terminal/i });

  // Wait for prompt
  await expect(term).toContainText('$');

  await term.getByRole('textbox').fill('ls');
  await page.keyboard.press('Enter');

  await expect(term).toContainText('README.md');

  // Audit row should exist
  const audit = await request.get('/api/v1/audit?workspace=ws-1&limit=1');
  const { items } = await audit.json();
  expect(items[0].command).toBe('ls');
  expect(items[0].command_hash).toMatch(/^sha256:/);
});
```

## 4. Tools

| Tool                       | Use                                |
|----------------------------|------------------------------------|
| `pytest`                   | Backend                            |
| `pytest-asyncio`           | Async backend                      |
| `httpx-ws`                 | WebSocket client                   |
| `pty` (stdlib)             | Real PTY spawning                  |
| `vitest`                   | Frontend unit                      |
| `@testing-library/react`   | Component tests                    |
| `happy-dom`                | Lightweight DOM for terminal tests |
| `@playwright/test`         | E2E                                |
| `xterm-addon-snapshot`     | xterm.js deterministic rendering   |

## 5. Anti-patterns

- Mocking the PTY.
- Asserting on raw bytes (depends on terminal width; assert on the *content* of the output stream).
- Sharing one PTY across tests (race conditions).
- Using `time.sleep` instead of polling with timeout.
- Asserting on terminal escape codes (test the rendered text, not the bytes).
