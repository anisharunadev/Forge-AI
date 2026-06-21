# ADR-006: Terminal Center via xterm.js + native PTY

- Status: Accepted
- Date: 2026-06-20
- Deciders: Forge Architecture Working Group

## Context and Problem Statement

F-401..F-415 in the PRD require an in-browser multi-agent terminal that can launch Claude Code, Codex CLI, Gemini CLI, and custom shells. The terminal must support:

- A tab interface (multiple agent sessions in parallel).
- Split panes (side-by-side terminals).
- Agent detection (which agent is running in each session).
- Workspace isolation (each session's working directory is the session's workspace, not user-controllable).
- Full audit trail per NFR-039 (100% of terminal commands captured).
- Real-time bidirectional I/O (input typed in browser reaches the agent; agent output reaches the browser).

We must choose how to bridge browser -> server -> agent process.

The forces at play:

- xterm.js is the de facto browser terminal emulator; we should use it.
- The server side needs to spawn real agent processes (Claude Code, Codex, etc.) and stream I/O.
- Authentication must be enforced on every session; the terminal cannot be a back door.
- Audit must capture every byte, not just command lines (LLM prompts and responses pass through terminals).
- PTY semantics are required for proper TUI behavior (resize signals, line buffering, raw mode).

## Decision Drivers

- F-401..F-415: Terminal Center feature set
- NFR-039: 100% command audit capture
- NFR-035: Pen-test readiness (auth enforced)
- Rule 6: Mandatory auditability
- DL-024: White-label - terminal displays `forge-*` only (ADR-004)

## Considered Options

- xterm.js + FastAPI WebSocket + native Python `pty` (chosen)
- ttyd (single-binary WebSocket-to-PTY bridge)
- tmux + ttyd
- Proprietary SaaS terminal (e.g., Coder, Gitpod-style)
- VNC / noVNC

## Decision Outcome

Chosen option: **xterm.js on the frontend connected via WebSocket to a FastAPI process manager that spawns agents in native Python `pty` (stdlib)**.

Architecture:

```text
Browser
  |
  | WebSocket (authenticated, tenant-scoped)
  v
FastAPI Terminal Session Manager
  |  - Authenticates WebSocket (Keycloak token, tenant binding)
  |  - Enforces workspace isolation (cwd is session.workspace, never user input)
  |  - Captures every byte to audit log
  |  - Forwards resize, signal events
  v
Python `pty` (stdlib) -> fork -> agent process (claude-code, codex, gemini-cli, shell)
```

Key commitments:

- Session Manager: `backend/app/terminal/session_manager.py` (FastAPI WebSocket endpoint).
- PTY process wrapper: `backend/app/terminal/pty_process.py` (uses `pty.openpty` and `os.read` / `os.write`).
- Agent launcher: `backend/app/terminal/agent_launcher.py` (resolves `forge-*` command via FORGE_COMMAND_MAP and spawns it under PTY).
- Workspace isolation: the PTY's cwd is set programmatically to `session.workspace`; the user cannot override it from the terminal input.
- Audit: every input byte and output chunk is recorded to the append-only audit log (ADR-008) with `actor`, `session_id`, `terminal_session_id`, `direction`, `payload`, `occurred_at`.
- Agent detection: the session manager parses ANSI escape sequences and process metadata to identify which agent is running (Claude Code's banner, Codex's prompt, Gemini CLI's prompt).

### Consequences

Positive:

- Standards-based: xterm.js is the browser standard; PTY is a POSIX primitive.
- No extra binaries to install beyond Python stdlib.
- Full audit: every byte is captured, not just command lines.
- Workspace isolation is enforced at the OS level (PTY cwd), not just at the application level.
- Native resize and signal handling (PTY semantics).
- Pen-test friendly: no undocumented binary in the deployment.

Negative:

- PTY management has edge cases: signal forwarding, terminal resize timing, child reaping.
- WebSocket reconnection logic must handle PTY state cleanly.
- Authentication must be re-validated on every WebSocket upgrade; long-lived sessions need refresh handling.

Neutral:

- The agent launcher's whitelist of allowed binaries is a single, reviewable list.

## Alternatives Considered

### ttyd (single-binary WebSocket-to-PTY bridge)

Pros:

- Single binary, easy to deploy.
- Battle-tested in many projects.

Cons:

- No native multi-session management (must be wrapped anyway).
- No built-in auth (must be fronted by a reverse proxy with auth).
- No built-in audit (must be added on top).
- No workspace isolation primitives.
- Rejected: too many missing primitives forces us to wrap it anyway, at which point the wrapper is the actual implementation.

### tmux + ttyd

Pros:

- tmux provides session multiplexing and persistence.
- ttyd bridges tmux to the browser.

Cons:

- tmux adds another stateful daemon to operate.
- Audit becomes harder: tmux owns the PTY; capturing every byte requires patching tmux or scraping its buffer.
- Workspace isolation is not enforced by tmux.
- Rejected: audit story is weak; tmux as middleman obscures session semantics.

### Proprietary SaaS terminal (Coder, Gitpod)

Pros:

- Mature multi-session, multi-user terminal.
- Built-in IDE integration.

Cons:

- Data residency concerns: terminal output (including LLM prompts and responses) leaves Forge's VPC.
- License cost at scale.
- Vendor lock-in for a security-critical surface.
- Rejected: data residency and lock-in unacceptable for a SOC2-controls-ready pilot.

### VNC / noVNC

Pros:

- Full GUI access; not just terminal.

Cons:

- Heavy: full desktop over VNC, much higher bandwidth and CPU than a terminal stream.
- Audit story is weak: must record entire screen frames or OCR.
- Not a fit for headless CLI agents (Claude Code, Codex, Gemini CLI).
- Rejected: weight and audit gap make it a poor match.

## Pros and Cons of the Chosen Option

Pros:

- Minimal dependency surface: stdlib + xterm.js.
- PTY semantics are native (resize, signals, raw mode).
- Audit is built into the data path, not bolted on.
- Workspace isolation is enforceable at the OS level.

Cons:

- Edge cases in PTY lifecycle management require careful testing.
- WebSocket reconnection must preserve session state.

## References

- ADR-004: GSD white-labeling (`forge-*` brand in terminal UI)
- ADR-008: Append-only WORM audit trail (terminal bytes captured here)
- ADR-007: LangGraph as SDLC agent orchestrator (agents launched from terminal sessions)
- Constitution Rule 6 (Mandatory auditability)
- PRD F-401..F-415, NFR-039, NFR-035, DL-024